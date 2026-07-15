const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Project = require('../models/Project');
const { getUserInfo } = require('../utils/authHelper');
const cache = require('../services/CacheService');
const { requireEditPermission } = require('../middleware/auth');

// 新增發票
router.post('/', requireEditPermission, (req, res) => {
  try {
    Invoice.create({
      project_id: req.body.project_id,
      invoice_date: req.body.invoice_date,
      invoice_number: req.body.invoice_number,
      amount_with_tax: parseFloat(req.body.amount_with_tax) || 0,
      expected_payment_date: req.body.expected_payment_date || null,
      userInfo: getUserInfo(req)
    });

    cache.delByPrefix('dashboard:');
    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新發票
router.post('/:id', requireEditPermission, (req, res) => {
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).render('error', { 
        title: '找不到發票',
        message: '找不到發票', 
        error: {} 
      });
    }

    Invoice.update(req.params.id, {
      invoice_date: req.body.invoice_date,
      invoice_number: req.body.invoice_number,
      amount_with_tax: parseFloat(req.body.amount_with_tax) || 0,
      expected_payment_date: (req.body.expected_payment_date && String(req.body.expected_payment_date).trim()) || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${invoice.project_id}`);
  } catch (err) {
    console.error(err);
    const invoice = Invoice.findById(req.params.id);
    if (invoice) {
      res.redirect(`/projects/${invoice.project_id}?error=` + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除發票（軟刪除）
router.post('/:id/delete', requireEditPermission, (req, res) => {
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: '找不到發票' });
    }

    const projectId = invoice.project_id;
    Invoice.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('發票已刪除，可於下方「顯示已刪除」還原'));
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// 還原發票
router.post('/:id/restore', requireEditPermission, (req, res) => {
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    const projectId = invoice.project_id;
    Invoice.restore(req.params.id, getUserInfo(req));
    res.redirect(`/projects/${projectId}?show_deleted=1&success=` + encodeURIComponent('發票已還原'));
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// 作廢發票
router.post('/:id/void', requireEditPermission, (req, res) => {
  let projectId;
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    projectId = invoice.project_id;
    Invoice.void(req.params.id, {
      voided_at: req.body.voided_at || undefined,
      void_reason: (req.body.void_reason || '').trim() || undefined
    }, getUserInfo(req));
    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('發票已作廢'));
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId || ''}?error=` + encodeURIComponent(err.message));
  }
});

// 作廢並重開
router.post('/:id/void-and-reissue', requireEditPermission, (req, res) => {
  let projectId;
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    projectId = invoice.project_id;
    const result = Invoice.voidAndReissue(req.params.id, {
      invoice_date: req.body.invoice_date,
      invoice_number: req.body.invoice_number,
      amount_with_tax: req.body.amount_with_tax,
      expected_payment_date: req.body.expected_payment_date || null
    }, {
      void_reason: (req.body.void_reason || '').trim() || undefined
    }, getUserInfo(req));
    const movedMsg = result && result.movedPayments > 0
      ? `（已自動轉移 ${result.movedPayments} 筆收款記錄至新發票）`
      : '';
    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent(`發票已作廢並重開${movedMsg}`));
  } catch (err) {
    console.error(err);
    if (!projectId) {
      const inv = Invoice.findById(req.params.id);
      projectId = inv ? inv.project_id : '';
    }
    res.redirect(`/projects/${projectId}?error=` + encodeURIComponent(err.message));
  }
});

// 整筆折讓
router.post('/:id/allowance', requireEditPermission, (req, res) => {
  let projectId;
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    projectId = invoice.project_id;
    Invoice.setAllowance(req.params.id, {
      voided_at: req.body.voided_at || undefined,
      void_reason: (req.body.void_reason || '').trim() || undefined
    }, getUserInfo(req));
    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('發票已設為整筆折讓'));
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId || ''}?error=` + encodeURIComponent(err.message));
  }
});

// 部分折讓
router.post('/:id/partial-allowance', requireEditPermission, (req, res) => {
  let projectId;
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    projectId = invoice.project_id;
    Invoice.setPartialAllowance(req.params.id, {
      allowance_amount: req.body.allowance_amount,
      voided_at: req.body.voided_at || undefined,
      void_reason: (req.body.void_reason || '').trim() || undefined
    }, getUserInfo(req));
    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('發票已設定部分折讓'));
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId || ''}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
