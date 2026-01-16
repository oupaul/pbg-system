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

module.exports = router;
