/**
 * 全域快速搜尋
 * 搜尋範圍：專案編號、專案名稱、客戶、發票號碼
 */
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Project = require('../models/Project');

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.render('search/index', {
      title: '搜尋',
      q: '',
      projects: [],
      customers: [],
      invoices: [],
      message: q.length === 1 ? '請至少輸入 2 個字元' : '請輸入搜尋關鍵字'
    });
  }

  const searchPattern = '%' + q + '%';

  // 搜尋專案（project_code, project_name）
  let projects = db.prepare(`
    SELECT p.id, p.project_code, p.project_name, p.project_type, p.price_with_tax, p.status, sp.name as salesperson_name
    FROM projects p
    LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
    WHERE p.project_code LIKE ? OR p.project_name LIKE ?
    ORDER BY p.updated_at DESC
    LIMIT 20
  `).all(searchPattern, searchPattern);

  // 依使用者權限過濾專案
  projects = projects.filter(p => Project.findById(p.id, req.user));

  // 搜尋客戶（customer_code, company_name）
  const customers = db.prepare(`
    SELECT id, customer_code, company_name, tax_id
    FROM customers
    WHERE customer_code LIKE ? OR company_name LIKE ?
    ORDER BY company_name
    LIMIT 20
  `).all(searchPattern, searchPattern);

  // 搜尋發票號碼
  let invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.amount_with_tax, i.invoice_date, i.project_id, p.project_code, p.project_name
    FROM invoices i
    JOIN projects p ON i.project_id = p.id
    WHERE i.invoice_number LIKE ?
    ORDER BY i.invoice_date DESC
    LIMIT 20
  `).all(searchPattern);

  invoices = invoices.filter(inv => Project.findById(inv.project_id, req.user));

  let typeColorMap = {};
  try {
    const allTypes = db.prepare('SELECT type_name, badge_color FROM project_types').all();
    allTypes.forEach(t => { typeColorMap[t.type_name] = t.badge_color || 'info'; });
  } catch (e) {}

  res.render('search/index', {
    title: '搜尋結果',
    q,
    projects,
    customers,
    invoices,
    typeColorMap,
    message: null
  });
});

module.exports = router;
