const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Project = require('../models/Project');
const { getUserInfo } = require('../utils/authHelper');

// 新增發票
router.post('/', (req, res) => {
  try {
    Invoice.create({
      project_id: req.body.project_id,
      invoice_date: req.body.invoice_date,
      invoice_number: req.body.invoice_number,
      amount_with_tax: parseFloat(req.body.amount_with_tax) || 0,
      expected_payment_date: req.body.expected_payment_date || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新發票
router.post('/:id', (req, res) => {
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

// 刪除發票
router.post('/:id/delete', (req, res) => {
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: '找不到發票' });
    }

    const projectId = invoice.project_id;
    Invoice.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// 作廢發票
router.post('/:id/void', (req, res) => {
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
router.post('/:id/void-and-reissue', (req, res) => {
  let projectId;
  try {
    const invoice = Invoice.findById(req.params.id);
    if (!invoice) {
      return res.redirect('/projects?error=' + encodeURIComponent('找不到發票'));
    }
    projectId = invoice.project_id;
    Invoice.voidAndReissue(req.params.id, {
      invoice_date: req.body.invoice_date,
      invoice_number: req.body.invoice_number,
      amount_with_tax: req.body.amount_with_tax,
      expected_payment_date: req.body.expected_payment_date || null
    }, {
      void_reason: (req.body.void_reason || '').trim() || undefined
    }, getUserInfo(req));
    res.redirect(`/projects/${projectId}?success=` + encodeURIComponent('發票已作廢並重開'));
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
router.post('/:id/allowance', (req, res) => {
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

module.exports = router;
