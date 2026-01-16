const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { getUserInfo } = require('../utils/authHelper');

// 新增收款
router.post('/', (req, res) => {
  try {
    Payment.create({
      project_id: req.body.project_id,
      invoice_id: req.body.invoice_id || null,
      payment_date: req.body.payment_date,
      bank_deposit_amount: parseFloat(req.body.bank_deposit_amount) || 0,
      payment_difference: parseFloat(req.body.payment_difference) || 0,
      difference_type: req.body.difference_type || null,
      notes: req.body.notes,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新收款
router.post('/:id', (req, res) => {
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
      bank_deposit_amount: parseFloat(req.body.bank_deposit_amount) || 0,
      payment_difference: parseFloat(req.body.payment_difference) || 0,
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

// 刪除收款
router.post('/:id/delete', (req, res) => {
  try {
    const payment = Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: '找不到收款記錄' });
    }

    const projectId = payment.project_id;
    Payment.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
