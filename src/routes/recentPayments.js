const express = require('express');
const router = express.Router();
const db = require('../models/db');

// 近期收款查詢
router.get('/', (req, res) => {
  const days = parseInt(req.query.days) || 30; // 預設 30 天
  const validDays = [7, 30, 60, 90, 120, 360];
  const selectedDays = validDays.includes(days) ? days : 30;

  // 查詢近期收款
  const payments = db.prepare(`
    SELECT 
      p.id,
      p.payment_date,
      p.bank_deposit_amount,
      p.payment_difference,
      p.difference_type,
      p.notes,
      p.project_id,
      pr.project_code,
      pr.project_name,
      pr.project_type,
      c.company_name,
      c.customer_code,
      s.name as salesperson_name,
      i.invoice_number,
      pt.type_name,
      pt.badge_color
    FROM payments p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN customers c ON pr.customer_id = c.id
    LEFT JOIN salespeople s ON pr.salesperson_id = s.id
    LEFT JOIN invoices i ON p.invoice_id = i.id
    LEFT JOIN project_types pt ON pr.project_type = pt.type_name
    WHERE p.payment_date IS NOT NULL
      AND date(p.payment_date) >= date('now', '-' || ? || ' days')
    ORDER BY p.payment_date DESC, pr.project_code ASC
  `).all(selectedDays);

  // 計算統計（考慮匯費差異）
  const totalAmount = payments.reduce((sum, p) => {
    const bankAmount = p.bank_deposit_amount || 0;
    const difference = p.payment_difference || 0;
    // 如果差異類型是「匯費」，則實際收款 = 銀行匯入金額 + 差異金額
    if (p.difference_type === '匯費') {
      return sum + bankAmount + difference;
    }
    return sum + bankAmount;
  }, 0);
  const totalCount = payments.length;

  // 建立類型顏色映射
  let typeColorMap = {};
  try {
    const allTypes = db.prepare('SELECT type_name, badge_color FROM project_types').all();
    allTypes.forEach(type => {
      typeColorMap[type.type_name] = type.badge_color;
    });
  } catch (err) {
    // 不預載任何類型顏色映射
    typeColorMap = {};
  }

  res.render('recentPayments/index', {
    title: '近期收款查詢',
    payments,
    days: selectedDays,
    validDays: validDays,
    totalAmount,
    totalCount,
    typeColorMap
  });
});

module.exports = router;

