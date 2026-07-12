const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Pipeline = require('../models/Pipeline');
const DeletionRequest = require('../models/DeletionRequest');
const Project = require('../models/Project');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission, requireCrmEditPermission } = require('../middleware/auth');
const cache = require('../services/CacheService');

function getActiveProjectTypes() {
  try {
    return db.prepare(`
      SELECT * FROM project_types
      WHERE is_active = 1
      ORDER BY display_order ASC, type_name ASC
    `).all();
  } catch (err) {
    return [];
  }
}

// 潛在商機列表
router.get('/', (req, res) => {
  try {
    const status = req.query.status || '';
    const pipelines = Pipeline.findAll({ status: status || undefined }, req.user);

    res.render('pipelines/index', {
      title: '潛在商機',
      pipelines: pipelines || [],
      statusFilter: status,
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('潛在商機列表錯誤:', err);
    res.status(500).render('error', {
      title: '系統錯誤',
      message: '載入潛在商機列表時發生錯誤',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
});

// 新增商機表單
router.get('/new', requireCrmEditPermission, (req, res) => {
  res.render('pipelines/form', {
    title: '新增潛在商機',
    pipeline: null,
    salespeople: Salesperson.findAll(),
    staffUsers: User.findActive(),
    customers: Customer.findAll(),
    projectTypes: getActiveProjectTypes(),
    action: '/pipelines',
    presetCustomerId: req.query.customer_id || '',
    error: req.query.error || ''
  });
});

// 建立商機
router.post('/', requireCrmEditPermission, (req, res) => {
  try {
    const id = Pipeline.create({
      customer_id: req.body.customer_id,
      salesperson_id: req.body.salesperson_id || null,
      owner_user_id: req.body.owner_user_id || null,
      opportunity_name: req.body.opportunity_name,
      project_type: req.body.project_type || null,
      estimated_amount: req.body.estimated_amount,
      win_probability: req.body.win_probability,
      expected_close_year_month: req.body.expected_close_year_month,
      notes: req.body.notes,
      userInfo: getUserInfo(req)
    });
    res.redirect(`/pipelines/${id}`);
  } catch (err) {
    console.error(err);
    res.redirect('/pipelines/new?error=' + encodeURIComponent(err.message));
  }
});

// 商機詳情
router.get('/:id', (req, res) => {
  const pipeline = Pipeline.findById(req.params.id);
  if (!pipeline) {
    return res.status(404).render('error', { title: '找不到商機', message: '找不到此潛在商機', error: {} });
  }

  const convertedProject = pipeline.converted_project_id ? Project.findById(pipeline.converted_project_id) : null;
  const pendingDeletion = DeletionRequest.findPendingByTarget('pipeline', pipeline.id);

  res.render('pipelines/show', {
    title: pipeline.opportunity_name,
    pipeline,
    convertedProject,
    pendingDeletion,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 編輯商機表單
router.get('/:id/edit', requireCrmEditPermission, (req, res) => {
  const pipeline = Pipeline.findById(req.params.id);
  if (!pipeline) {
    return res.status(404).render('error', { title: '找不到商機', message: '找不到此潛在商機', error: {} });
  }

  res.render('pipelines/form', {
    title: '編輯潛在商機',
    pipeline,
    salespeople: Salesperson.findAll(),
    staffUsers: User.findActive(),
    customers: Customer.findAll(),
    projectTypes: getActiveProjectTypes(),
    action: `/pipelines/${pipeline.id}`,
    presetCustomerId: '',
    error: req.query.error || ''
  });
});

// 更新商機
router.post('/:id', requireCrmEditPermission, (req, res) => {
  try {
    Pipeline.update(req.params.id, {
      salesperson_id: req.body.salesperson_id || null,
      owner_user_id: req.body.owner_user_id || null,
      opportunity_name: req.body.opportunity_name,
      project_type: req.body.project_type || null,
      estimated_amount: req.body.estimated_amount,
      win_probability: req.body.win_probability,
      expected_close_year_month: req.body.expected_close_year_month,
      notes: req.body.notes,
      userInfo: getUserInfo(req)
    });
    res.redirect(`/pipelines/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/pipelines/${req.params.id}/edit?error=` + encodeURIComponent(err.message));
  }
});

// 標記成交 / 流失 / 重新開啟（洽談中）
router.post('/:id/status', requireCrmEditPermission, (req, res) => {
  try {
    Pipeline.setStatus(req.params.id, req.body.status, {
      lost_reason: req.body.lost_reason,
      userInfo: getUserInfo(req)
    });
    res.redirect(`/pipelines/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/pipelines/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 轉入專案表單（財務人員補上專案編號）
router.get('/:id/convert', requireEditPermission, (req, res) => {
  const pipeline = Pipeline.findById(req.params.id);
  if (!pipeline) {
    return res.status(404).render('error', { title: '找不到商機', message: '找不到此潛在商機', error: {} });
  }
  if (pipeline.status !== '已成交') {
    return res.redirect(`/pipelines/${pipeline.id}?error=` + encodeURIComponent('僅「已成交」的商機可以轉入專案'));
  }
  if (pipeline.converted_project_id) {
    return res.redirect(`/pipelines/${pipeline.id}?error=` + encodeURIComponent('此商機已轉入專案'));
  }

  res.render('pipelines/convert', {
    title: '轉入專案：' + pipeline.opportunity_name,
    pipeline,
    projectTypes: getActiveProjectTypes(),
    error: req.query.error || ''
  });
});

// 執行轉入專案（沿用 projects.js 相同的必填/唯一性驗證規則）
router.post('/:id/convert', requireEditPermission, (req, res) => {
  const pipeline = Pipeline.findById(req.params.id);
  if (!pipeline) {
    return res.status(404).render('error', { title: '找不到商機', message: '找不到此潛在商機', error: {} });
  }

  try {
    if (!req.body.project_code || !req.body.project_code.trim()) {
      return res.redirect(`/pipelines/${pipeline.id}/convert?error=` + encodeURIComponent('專案編號為必填欄位（由財務人員提供）'));
    }
    if (!req.body.project_type || !req.body.project_type.trim()) {
      return res.redirect(`/pipelines/${pipeline.id}/convert?error=` + encodeURIComponent('專案類型為必填欄位'));
    }

    const existingProject = Project.findByCodeTypeAndCustomer(
      req.body.project_code.trim(),
      req.body.project_type.trim(),
      pipeline.customer_id
    );
    if (existingProject) {
      return res.redirect(`/pipelines/${pipeline.id}/convert?error=` + encodeURIComponent(
        `專案編號 "${req.body.project_code}" 在類型 "${req.body.project_type}" 中與該客戶已存在`
      ));
    }

    const projectId = Pipeline.convertToProject(pipeline.id, {
      project_code: req.body.project_code.trim(),
      contract_year: parseInt(req.body.contract_year) || new Date().getFullYear(),
      contract_month: parseInt(req.body.contract_month) || new Date().getMonth() + 1,
      status: '未結案',
      project_type: req.body.project_type.trim(),
      salesperson_id: req.body.salesperson_id || pipeline.salesperson_id || null,
      project_name: req.body.project_name ? req.body.project_name.trim() : pipeline.opportunity_name,
      price_with_tax: parseFloat(req.body.price_with_tax) || pipeline.estimated_amount || 0,
      price_without_tax: parseFloat(req.body.price_without_tax) || 0,
      notes: req.body.notes || pipeline.notes,
      userInfo: getUserInfo(req)
    });

    cache.delByPrefix('dashboard:');
    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.redirect(`/pipelines/${pipeline.id}/convert?error=` + encodeURIComponent(
        `專案編號 "${req.body.project_code}" 已存在`
      ));
    }
    res.redirect(`/pipelines/${pipeline.id}/convert?error=` + encodeURIComponent(err.message));
  }
});

// 刪除商機（軟刪除，已轉入專案者不可刪除）
// 有 can_delete 權限者直接刪除；否則送出刪除申請，待管理員核准後才真正刪除
router.post('/:id/delete', requireCrmEditPermission, (req, res) => {
  const pipeline = Pipeline.findById(req.params.id);
  if (!pipeline) {
    return res.status(404).render('error', { title: '找不到商機', message: '找不到此潛在商機', error: {} });
  }

  try {
    if (req.user.canDelete) {
      Pipeline.softDelete(req.params.id, getUserInfo(req));
      return res.redirect('/pipelines');
    }

    const existing = DeletionRequest.findPendingByTarget('pipeline', pipeline.id);
    if (existing) {
      return res.redirect(`/pipelines/${pipeline.id}?error=` + encodeURIComponent('此商機已送出過刪除申請，待審核中'));
    }

    DeletionRequest.create({
      target_type: 'pipeline',
      target_id: pipeline.id,
      target_summary: `${pipeline.opportunity_name}（客戶：${pipeline.customer_name || '-'}）`,
      requested_by: req.user.id,
      requested_by_name: getUserInfo(req)
    });
    res.redirect(`/pipelines/${pipeline.id}?success=` + encodeURIComponent('已送出刪除申請，待管理員審核後才會真正刪除'));
  } catch (err) {
    console.error(err);
    res.redirect(`/pipelines/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
