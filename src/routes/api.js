const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Bonus = require('../models/Bonus');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const db = require('../models/db');

// API回應格式化
const respond = (res, data, status = 200) => {
  res.status(status).json({ success: true, data });
};

const error = (res, message, status = 400) => {
  res.status(status).json({ success: false, error: message });
};

// 專案API
router.get('/projects', (req, res) => {
  try {
    const projects = Project.findAll(req.query);
    respond(res, projects);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.get('/projects/:id', (req, res) => {
  try {
    const project = Project.findById(req.params.id);
    if (!project) return error(res, '找不到專案', 404);
    
    project.invoices = Invoice.findByProject(project.id);
    project.payments = Payment.findByProject(project.id);
    project.bonuses = Bonus.findByProject(project.id);
    
    respond(res, project);
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 發票API
router.get('/projects/:id/invoices', (req, res) => {
  try {
    const invoices = Invoice.findByProject(req.params.id);
    respond(res, invoices);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.post('/invoices', (req, res) => {
  try {
    const id = Invoice.create(req.body);
    const invoice = Invoice.findById(id);
    respond(res, invoice, 201);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.put('/invoices/:id', (req, res) => {
  try {
    Invoice.update(req.params.id, req.body);
    const invoice = Invoice.findById(req.params.id);
    respond(res, invoice);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.delete('/invoices/:id', (req, res) => {
  try {
    Invoice.delete(req.params.id);
    respond(res, { deleted: true });
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 收款API
router.get('/projects/:id/payments', (req, res) => {
  try {
    const payments = Payment.findByProject(req.params.id);
    respond(res, payments);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.post('/payments', (req, res) => {
  try {
    const id = Payment.create(req.body);
    const payment = Payment.findById(id);
    respond(res, payment, 201);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.put('/payments/:id', (req, res) => {
  try {
    Payment.update(req.params.id, req.body);
    const payment = Payment.findById(req.params.id);
    respond(res, payment);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.delete('/payments/:id', (req, res) => {
  try {
    Payment.delete(req.params.id);
    respond(res, { deleted: true });
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 獎金API
router.get('/bonuses', (req, res) => {
  try {
    const year = req.query.year;
    const bonuses = year 
      ? db.prepare(`
          SELECT b.* FROM v_bonus_summary b
          JOIN projects p ON b.project_id = p.id
          WHERE p.contract_year = ?
        `).all(year)
      : db.prepare(`SELECT * FROM v_bonus_summary`).all();
    respond(res, bonuses);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.get('/bonuses/stats/:year', (req, res) => {
  try {
    const stats = Bonus.getStatistics(req.params.year);
    const summary = Bonus.getSalespersonSummary(req.params.year);
    respond(res, { stats, summary });
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.put('/bonuses/:id', (req, res) => {
  try {
    Bonus.update(req.params.id, req.body);
    const bonus = Bonus.findById(req.params.id);
    respond(res, bonus);
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 業務API
router.get('/salespeople', (req, res) => {
  try {
    const salespeople = Salesperson.findAll(req.query.all === 'true');
    respond(res, salespeople);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.get('/salespeople/:id/performance/:year', (req, res) => {
  try {
    const performance = Salesperson.getPerformance(req.params.id, req.params.year);
    respond(res, performance);
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 客戶API
router.get('/customers', (req, res) => {
  try {
    const customers = Customer.findAll();
    respond(res, customers);
  } catch (err) {
    error(res, err.message, 500);
  }
});

router.get('/customers/search', (req, res) => {
  try {
    const q = req.query.q;
    const customers = db.prepare(`
      SELECT * FROM customers
      WHERE company_name LIKE ? OR customer_code LIKE ? OR tax_id LIKE ?
      LIMIT 20
    `).all(`%${q}%`, `%${q}%`, `%${q}%`);
    respond(res, customers);
  } catch (err) {
    error(res, err.message, 500);
  }
});

// 統計API
router.get('/stats/dashboard/:year', (req, res) => {
  try {
    const year = req.params.year;
    
    const projectStats = Project.getStatistics(year);
    const bonusStats = Bonus.getStatistics(year);
    
    const monthlyInvoices = db.prepare(`
      SELECT 
        strftime('%m', invoice_date) as month,
        SUM(amount_with_tax) as total
      FROM invoices i
      JOIN projects p ON i.project_id = p.id
      WHERE p.contract_year = ?
      GROUP BY strftime('%m', invoice_date)
      ORDER BY month
    `).all(year);

    // 計算實際收款金額（考慮匯費差異）
    const monthlyPaymentsRaw = db.prepare(`
      SELECT 
        strftime('%m', payment_date) as month,
        bank_deposit_amount,
        payment_difference,
        difference_type
      FROM payments pm
      JOIN projects p ON pm.project_id = p.id
      WHERE p.contract_year = ? AND payment_date IS NOT NULL
      ORDER BY month
    `).all(year);
    
    // 按月份分組並計算實際收款金額
    const monthlyPaymentsMap = {};
    monthlyPaymentsRaw.forEach(p => {
      const month = p.month;
      if (!monthlyPaymentsMap[month]) {
        monthlyPaymentsMap[month] = 0;
      }
      const bankAmount = p.bank_deposit_amount || 0;
      const difference = p.payment_difference || 0;
      // 如果差異類型是「匯費」，則實際收款 = 銀行匯入金額 + 差異金額
      if (p.difference_type === '匯費') {
        monthlyPaymentsMap[month] += bankAmount + difference;
      } else {
        monthlyPaymentsMap[month] += bankAmount;
      }
    });
    
    const monthlyPayments = Object.keys(monthlyPaymentsMap).map(month => ({
      month,
      total: monthlyPaymentsMap[month]
    })).sort((a, b) => a.month.localeCompare(b.month));

    respond(res, {
      projects: projectStats,
      bonuses: bonusStats,
      monthlyInvoices,
      monthlyPayments
    });
  } catch (err) {
    error(res, err.message, 500);
  }
});

module.exports = router;
