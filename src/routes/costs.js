const express = require('express');
const { toMoney } = require('../utils/money');
const router = express.Router();
const Cost = require('../models/Cost');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');
const { requireProjectScopeFromBody, requireProjectScopeFromRecord } = require('../utils/projectScope');
const { runBatch } = require('../utils/batchOps');
const db = require('../models/db');

// 寫入成本需要編輯權限，且操作的專案必須在使用者的專案範圍內
const costScope = requireProjectScopeFromRecord(id => Cost.findById(id));

// 新增成本
router.post('/', requireEditPermission, requireProjectScopeFromBody, (req, res) => {
  try {
    Cost.create({
      project_id: req.body.project_id,
      cost_date: req.body.cost_date,
      cost_type: req.body.cost_type || null,
      vendor_id: req.body.vendor_id || null,
      estimated_amount: toMoney(req.body.estimated_amount),
      actual_amount: toMoney(req.body.actual_amount),
      tax_included: req.body.tax_included, // 沒帶（舊表單）：新增＝含稅、編輯＝不變
      notes: req.body.notes || null,
      item_name: req.body.item_name || '',
      cost_category: req.body.cost_category || null,
      payment_method: req.body.payment_method || null,
      payment_term: req.body.payment_term || null,
      order_status: req.body.order_status || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 批次刪除／還原／編輯成本（同一專案、全有或全無；須定義在 /:id 之前）。
// 刪除是軟刪除（可在「顯示已刪除」還原），和發票、收款一致。
router.post('/batch-delete', requireEditPermission, (req, res) => {
  const userInfo = getUserInfo(req);
  runBatch({
    req, res, find: (id) => Cost.findById(id), unit: '筆成本', verb: '刪除', tab: 'pane-costs',
    apply: (cost) => { if (cost.deleted_at) return false; return Cost.delete(cost.id, userInfo); }
  });
});
router.post('/batch-restore', requireEditPermission, (req, res) => {
  const userInfo = getUserInfo(req);
  runBatch({
    req, res, find: (id) => Cost.findById(id), unit: '筆成本', verb: '還原', tab: 'pane-costs', showDeleted: true,
    apply: (cost) => { if (!cost.deleted_at) return false; return Cost.restore(cost.id, userInfo); }
  });
});

// 批次編輯：只更新「有填值」的欄位（留空＝不變更），金額與名稱不在批次範圍（稅別可批次改，會依目前稅率重算未稅金額）。
// 選項類欄位由 Cost.update 驗證是否存在且啟用；整批在同一交易，任何一筆失敗全部復原。
const BATCH_EDIT_TEXT_FIELDS = ['cost_type', 'cost_category', 'payment_method', 'payment_term', 'order_status'];
router.post('/batch-update', requireEditPermission, (req, res) => {
  const userInfo = getUserInfo(req);
  const changes = {};
  for (const f of BATCH_EDIT_TEXT_FIELDS) {
    const v = typeof req.body[f] === 'string' ? req.body[f].trim() : '';
    if (v) changes[f] = v;
  }
  const tax = typeof req.body.tax_included === 'string' ? req.body.tax_included.trim() : '';
  if (tax) changes.tax_included = tax;
  const date = typeof req.body.cost_date === 'string' ? req.body.cost_date.trim() : '';
  if (date) changes.cost_date = date;
  const vendor = typeof req.body.vendor_id === 'string' ? req.body.vendor_id.trim() : '';
  if (vendor) changes.vendor_id = vendor;

  const back = /^\d+$/.test(String(req.body.project_id || '')) ? parseInt(req.body.project_id, 10) : null;
  const bad = (message) => back
    ? res.redirect(`/projects/${back}?error=${encodeURIComponent(message)}#pane-costs`)
    : res.status(400).render('error', { title: '請求錯誤', message, error: {} });
  if (Object.keys(changes).length === 0) return bad('請至少填寫一個要變更的欄位（留空的欄位不會變更）');
  if (changes.cost_date && !/^\d{4}-\d{2}-\d{2}$/.test(changes.cost_date)) return bad('成本日期格式不正確');
  if (changes.tax_included && !['0', '1'].includes(changes.tax_included)) return bad('稅別必須是「含稅」或「免稅」');
  if (changes.vendor_id) {
    const ok = /^\d{1,15}$/.test(changes.vendor_id) && db.prepare(
      `SELECT 1 FROM customers WHERE id = ? AND deleted_at IS NULL AND party_type IN ('廠商', '兩者皆是')`
    ).get(Number(changes.vendor_id));
    if (!ok) return bad('找不到指定的廠商');
  }

  runBatch({
    req, res, find: (id) => Cost.findById(id), unit: '筆成本', verb: '編輯', tab: 'pane-costs',
    // 已刪除的成本略過（要先還原才能改）
    apply: (cost) => { if (cost.deleted_at) return false; return Cost.update(cost.id, { ...changes, userInfo }); }
  });
});

// 還原單筆成本
router.post('/:id/restore', requireEditPermission, costScope, (req, res) => {
  const cost = Cost.findById(req.params.id);
  if (!cost) return res.status(404).render('error', { title: '找不到成本記錄', message: '找不到成本記錄', error: {} });
  try {
    Cost.restore(req.params.id, getUserInfo(req));
    res.redirect(`/projects/${cost.project_id}?show_deleted=1#pane-costs`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${cost.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新成本
router.post('/:id', requireEditPermission, costScope, (req, res) => {
  try {
    const cost = Cost.findById(req.params.id);
    if (!cost) {
      return res.status(404).render('error', { 
        title: '找不到成本記錄',
        message: '找不到成本記錄', 
        error: {} 
      });
    }

    Cost.update(req.params.id, {
      cost_date: req.body.cost_date,
      cost_type: req.body.cost_type || null,
      vendor_id: req.body.vendor_id || null,
      estimated_amount: toMoney(req.body.estimated_amount),
      actual_amount: toMoney(req.body.actual_amount),
      tax_included: req.body.tax_included, // 沒帶（舊表單）：新增＝含稅、編輯＝不變
      notes: req.body.notes || null,
      item_name: req.body.item_name || '',
      cost_category: req.body.cost_category || null,
      payment_method: req.body.payment_method || null,
      payment_term: req.body.payment_term || null,
      order_status: req.body.order_status || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${cost.project_id}`);
  } catch (err) {
    console.error(err);
    const cost = Cost.findById(req.params.id);
    if (cost) {
      res.redirect(`/projects/${cost.project_id}?error=` + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除成本
router.post('/:id/delete', requireEditPermission, costScope, (req, res) => {
  try {
    const cost = Cost.findById(req.params.id);
    if (!cost) {
      return res.status(404).json({ error: '找不到成本記錄' });
    }

    const projectId = cost.project_id;
    Cost.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;

