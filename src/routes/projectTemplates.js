const express = require('express');
const router = express.Router();
const ProjectTemplate = require('../models/ProjectTemplate');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const db = require('../models/db');

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

// 列表（需登入）
router.get('/', (req, res) => {
  const templates = ProjectTemplate.findAll();
  res.render('project-templates/index', {
    title: '專案範本',
    templates
  });
});

// 新增表單
router.get('/new', (req, res) => {
  const salespeople = Salesperson.findAll(true);
  const customers = Customer.findAll();
  const projectTypes = getActiveProjectTypes();
  res.render('project-templates/form', {
    title: '新增專案範本',
    template: null,
    salespeople,
    customers,
    projectTypes,
    action: '/project-templates',
    method: 'POST'
  });
});

// 建立範本
router.post('/', (req, res) => {
  try {
    if (!(req.body.name || '').trim()) {
      return res.redirect('/project-templates/new?error=' + encodeURIComponent('範本名稱為必填'));
    }
    ProjectTemplate.create({
      name: req.body.name.trim(),
      description: req.body.description ? req.body.description.trim() : null,
      project_type: req.body.project_type || null,
      salesperson_id: req.body.salesperson_id ? parseInt(req.body.salesperson_id) : null,
      customer_id: req.body.customer_id ? parseInt(req.body.customer_id) : null,
      project_name: req.body.project_name ? req.body.project_name.trim() : null,
      price_with_tax: req.body.price_with_tax != null ? parseFloat(req.body.price_with_tax) : 0,
      price_without_tax: req.body.price_without_tax != null ? parseFloat(req.body.price_without_tax) : 0,
      is_new_customer: req.body.is_new_customer === '1',
      expected_invoice_year_month: req.body.expected_invoice_year_month || null,
      sales_discount: req.body.sales_discount != null ? parseFloat(req.body.sales_discount) : 0,
      notes: req.body.notes ? req.body.notes.trim() : null
    });
    res.redirect('/project-templates?success=' + encodeURIComponent('範本已建立'));
  } catch (err) {
    console.error(err);
    res.redirect('/project-templates/new?error=' + encodeURIComponent(err.message));
  }
});

// 編輯表單
router.get('/:id/edit', (req, res) => {
  const template = ProjectTemplate.findById(req.params.id);
  if (!template) {
    return res.status(404).render('error', { message: '找不到範本', error: {} });
  }
  const salespeople = Salesperson.findAll(true);
  const customers = Customer.findAll();
  const projectTypes = getActiveProjectTypes();
  res.render('project-templates/form', {
    title: '編輯專案範本',
    template,
    salespeople,
    customers,
    projectTypes,
    action: '/project-templates/' + template.id,
    method: 'POST'
  });
});

// 更新範本
router.post('/:id', (req, res) => {
  try {
    const template = ProjectTemplate.findById(req.params.id);
    if (!template) {
      return res.redirect('/project-templates?error=' + encodeURIComponent('找不到範本'));
    }
    if (!(req.body.name || '').trim()) {
      return res.redirect('/project-templates/' + req.params.id + '/edit?error=' + encodeURIComponent('範本名稱為必填'));
    }
    ProjectTemplate.update(req.params.id, {
      name: req.body.name.trim(),
      description: req.body.description ? req.body.description.trim() : null,
      project_type: req.body.project_type || null,
      salesperson_id: req.body.salesperson_id ? parseInt(req.body.salesperson_id) : null,
      customer_id: req.body.customer_id ? parseInt(req.body.customer_id) : null,
      project_name: req.body.project_name ? req.body.project_name.trim() : null,
      price_with_tax: req.body.price_with_tax != null ? parseFloat(req.body.price_with_tax) : 0,
      price_without_tax: req.body.price_without_tax != null ? parseFloat(req.body.price_without_tax) : 0,
      is_new_customer: req.body.is_new_customer === '1',
      expected_invoice_year_month: req.body.expected_invoice_year_month || null,
      sales_discount: req.body.sales_discount != null ? parseFloat(req.body.sales_discount) : 0,
      notes: req.body.notes ? req.body.notes.trim() : null
    });
    res.redirect('/project-templates?success=' + encodeURIComponent('範本已更新'));
  } catch (err) {
    console.error(err);
    res.redirect('/project-templates/' + req.params.id + '/edit?error=' + encodeURIComponent(err.message));
  }
});

// 刪除範本
router.post('/:id/delete', (req, res) => {
  try {
    ProjectTemplate.delete(req.params.id);
    res.redirect('/project-templates?success=' + encodeURIComponent('範本已刪除'));
  } catch (err) {
    console.error(err);
    res.redirect('/project-templates?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
