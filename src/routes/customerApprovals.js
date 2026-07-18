const express = require('express');
const router = express.Router();
const CustomerCreationRequest = require('../models/CustomerCreationRequest');
const Salesperson = require('../models/Salesperson');
const User = require('../models/User');
const db = require('../models/db');
const NotificationService = require('../services/NotificationService');

// 新客戶/廠商審核：僅系統管理員（admin）與專案管理員（user）可使用
const requireCustomerApprovalPermission = (req, res, next) => {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.status(403).render('error', { title: '權限不足', message: '此功能僅限系統管理員與專案管理員使用', error: {} });
    }
    return res.status(401).json({ error: '未登入' });
  }
  if (req.user.role === 'admin' || req.user.role === 'user') return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '權限不足', message: '此功能僅限系統管理員與專案管理員使用', error: {} });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限系統管理員與專案管理員使用' });
};

function getActiveProjectTypes() {
  try {
    return db.prepare(`SELECT * FROM project_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC`).all();
  } catch (err) {
    return [];
  }
}

// 提取編輯表單提交的欄位（僅在有送出對應欄位時才更新，避免覆蓋成空值）
function extractEditableFields(body) {
  const fields = {};
  const KEYS = [
    'customer_code', 'tax_id', 'company_name', 'party_type', 'vendor_type',
    'owner_salesperson_id', 'contact_name', 'contact_phone', 'contact_email',
    'bank_name', 'bank_account', 'address', 'customer_level', 'industry', 'status',
    'pipeline_opportunity_name', 'pipeline_project_type', 'pipeline_estimated_amount',
    'pipeline_win_probability', 'pipeline_expected_close_year_month', 'pipeline_salesperson_id', 'pipeline_notes'
  ];
  KEYS.forEach(key => {
    if (body[key] !== undefined) fields[key] = body[key];
  });
  if (body.is_new_customer !== undefined) fields.is_new_customer = body.is_new_customer === '1';
  // 預估專案類型可能是複選 checkbox/select，正規化成逗號分隔字串
  if (Array.isArray(fields.pipeline_project_type)) {
    fields.pipeline_project_type = fields.pipeline_project_type.filter(Boolean).join(',');
  }
  return fields;
}

// 待審核新客戶/廠商列表
router.get('/', requireCustomerApprovalPermission, (req, res) => {
  const requests = CustomerCreationRequest.findPending();

  res.render('customer-approvals/index', {
    title: '客戶/廠商審核',
    requests,
    salespeople: Salesperson.findAll(),
    staffUsers: User.findActive(),
    projectTypes: getActiveProjectTypes(),
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 核准：先套用管理員的編輯（若有），再真正建立客戶/廠商資料（若有綁定銷售機會也一併建立）
router.post('/:id/approve', requireCustomerApprovalPermission, (req, res) => {
  try {
    const editable = extractEditableFields(req.body);
    if (Object.keys(editable).length > 0) {
      CustomerCreationRequest.update(req.params.id, { ...editable, editedByName: req.user.name || req.user.username });
    }

    const request = CustomerCreationRequest.findById(req.params.id);
    const { customerId, pipelineId } = CustomerCreationRequest.approve(req.params.id, req.user);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'customer_approval_approved',
        title: `審核通過：${request.company_name}`,
        message: pipelineId
          ? `審核人：${req.user.name || req.user.username}（含銷售機會：${request.pipeline_opportunity_name}）`
          : `審核人：${req.user.name || req.user.username}`,
        link: pipelineId ? `/pipelines/${pipelineId}` : `/customers/${customerId}`,
        related_type: pipelineId ? 'pipeline' : 'customer',
        related_id: pipelineId || customerId
      });
    }
    res.redirect('/customer-approvals?success=' + encodeURIComponent(
      pipelineId ? '已核准，客戶/廠商與銷售機會資料已建立' : '已核准，客戶/廠商資料已建立'
    ));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

// 駁回：不會建立客戶/廠商資料，綁定的銷售機會也一併作廢
router.post('/:id/reject', requireCustomerApprovalPermission, (req, res) => {
  try {
    const request = CustomerCreationRequest.findById(req.params.id);
    CustomerCreationRequest.reject(req.params.id, req.user, req.body.review_note);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'customer_approval_rejected',
        title: `審核駁回：${request.company_name}`,
        message: req.body.review_note ? `駁回原因：${req.body.review_note}` : `審核人：${req.user.name || req.user.username}`,
        link: '/customers',
        related_type: 'customer_creation_request',
        related_id: request.id
      });
    }
    res.redirect('/customer-approvals?success=' + encodeURIComponent('已駁回此申請'));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
