const express = require('express');
const { toMoney } = require('../utils/money');
const router = express.Router();
const Payment = require('../models/Payment');
const { getUserInfo } = require('../utils/authHelper');
const cache = require('../services/CacheService');
const { requireEditPermission } = require('../middleware/auth');
const { requireProjectScopeFromBody, requireProjectScopeFromRecord } = require('../utils/projectScope');
const { runBatch } = require('../utils/batchOps');

// 寫入收款需要編輯權限，且操作的專案必須在使用者的專案範圍內
const paymentScope = requireProjectScopeFromRecord(id => Payment.findById(id));

// 新增收款
router.post('/', requireEditPermission, requireProjectScopeFromBody, (req, res) => {
  try {
    Payment.create({
      project_id: req.body.project_id,
      invoice_id: req.body.invoice_id || null,
      payment_date: req.body.payment_date,
      bank_deposit_amount: toMoney(req.body.bank_deposit_amount),
      payment_difference: toMoney(req.body.payment_difference),
      difference_type: req.body.difference_type || null,
      notes: req.body.notes,
      userInfo: getUserInfo(req)
    });

    cache.delByPrefix('dashboard:');
    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 批次刪除／還原收款（同一專案、全有或全無；須定義在 /:id 之前）
router.post('/batch-delete', requireEditPermission, (req, res) => {
  const userInfo = getUserInfo(req);
  runBatch({
    req, res, find: (id) => Payment.findById(id), unit: '筆收款', verb: '刪除', tab: 'pane-payments',
    apply: (pay) => { if (pay.deleted_at) return false; return Payment.delete(pay.id, userInfo); }
  });
});
router.post('/batch-restore', requireEditPermission, (req, res) => {
  const userInfo = getUserInfo(req);
  runBatch({
    req, res, find: (id) => Payment.findById(id), unit: '筆收款', verb: '還原', tab: 'pane-payments', showDeleted: true,
    apply: (pay) => { if (!pay.deleted_at) return false; return Payment.restore(pay.id, userInfo); }
  });
});

// 更新收款
router.post('/:id', requireEditPermission, paymentScope, (req, res) => {
  try {
    const payment = Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).render('error', { 
        title: '找不到收款記錄',
        message: '找不到收款記錄', 
        error: {} 
      });
    }

    Payment.update(req.params.id, {
      invoice_id: req.body.invoice_id || null,
      payment_date: req.body.payment_date,
      bank_deposit_amount: toMoney(req.body.bank_deposit_amount),
      payment_difference: toMoney(req.body.payment_difference),
      difference_type: req.body.difference_type || null,
      notes: req.body.notes || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${payment.project_id}`);
  } catch (err) {
    console.error(err);
    const payment = Payment.findById(req.params.id);
    if (payment) {
      res.redirect(`/projects/${payment.project_id}?error=` + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除收款（軟刪除）
router.post('/:id/delete', requireEditPermission, paymentScope, (req, res) => {
  try {
    const payment = Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: '找不到收款記錄' });
    }

    const projectId = payment.project_id;
    Payment.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('收款已刪除，可於下方「顯示已刪除」還原'));
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// 還原收款
router.post('/:id/restore', requireEditPermission, paymentScope, (req, res) => {
  try {
    const payment = Payment.findById(req.params.id);
    if (!payment) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到收款記錄'));
    }
    const projectId = payment.project_id;
    Payment.restore(req.params.id, getUserInfo(req));
    res.redirect(`/projects/${projectId}?show_deleted=1&success=` + encodeURIComponent('收款已還原'));
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
