const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Project = require('../models/Project');
const ReceivablesAgingService = require('../services/ReceivablesAgingService');

router.get('/', (req, res) => {
  const currentYear = new Date().getFullYear();
  const years = Project.getYears();
  // 預設顯示全部年度，除非明確指定年度
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;
  
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
  
  // 取得統計資料（如果選擇全部年度，傳入 null）
  let stats = Project.getStatistics(selectedYear);
  
  // 處理 NULL 值，確保所有統計都有預設值
  if (!stats) {
    stats = {
      total_projects: 0,
      open_projects: 0,
      closed_projects: 0,
      total_amount: 0,
      lab_amount: 0,
      ad_amount: 0,
      project_amount: 0,
      typeAmounts: {}
    };
  } else {
    // 確保統計資料的數值正確（處理 NULL 值）
    stats.total_projects = stats.total_projects || 0;
    stats.open_projects = stats.open_projects || 0;
    stats.closed_projects = stats.closed_projects || 0;
    stats.total_amount = stats.total_amount || 0;
    stats.lab_amount = stats.lab_amount || 0;
    stats.ad_amount = stats.ad_amount || 0;
    stats.project_amount = stats.project_amount || 0;
    stats.typeAmounts = stats.typeAmounts || {};
  }
  
  // 獲取所有專案類型（用於動態顯示）
  let projectTypeStats = [];
  try {
    const allTypes = db.prepare('SELECT type_name, badge_color, display_order FROM project_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC').all();
    allTypes.forEach(type => {
      const amount = stats.typeAmounts[type.type_name] || 0;
      projectTypeStats.push({
        type_name: type.type_name,
        badge_color: type.badge_color,
        amount: amount
      });
    });
    
    // 如果有類型不在 project_types 表中，但專案中有使用，也要顯示
    if (stats.typeAmounts) {
      Object.keys(stats.typeAmounts).forEach(typeName => {
        const exists = projectTypeStats.find(t => t.type_name === typeName);
        if (!exists && stats.typeAmounts[typeName] > 0) {
          projectTypeStats.push({
            type_name: typeName,
            badge_color: 'info', // 預設顏色
            amount: stats.typeAmounts[typeName]
          });
        }
      });
    }
  } catch (err) {
    console.warn('無法獲取專案類型列表:', err.message);
    // 不預載任何類型，只顯示實際存在的類型
    projectTypeStats = [];
  }

  // 取得最近專案
  let recentProjects;
  if (selectedYear) {
    recentProjects = db.prepare(`
      SELECT * FROM v_project_summary 
      WHERE contract_year = ?
      ORDER BY updated_at DESC 
      LIMIT 10
    `).all(selectedYear);
  } else {
    recentProjects = db.prepare(`
      SELECT * FROM v_project_summary 
      ORDER BY updated_at DESC 
      LIMIT 10
    `).all();
  }

  // 取得獎金統計
  let bonusStats;
  if (selectedYear) {
    bonusStats = db.prepare(`
      SELECT 
        SUM(bc.bonus_amount) as total_bonus,
        SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
        SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus,
        SUM(CASE WHEN bc.status = '充公' THEN bc.bonus_amount ELSE 0 END) as forfeited_bonus
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      WHERE p.contract_year = ?
    `).get(selectedYear);
  } else {
    bonusStats = db.prepare(`
      SELECT 
        SUM(bc.bonus_amount) as total_bonus,
        SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
        SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus,
        SUM(CASE WHEN bc.status = '充公' THEN bc.bonus_amount ELSE 0 END) as forfeited_bonus
      FROM bonus_calculations bc
    `).get();
  }
  
  bonusStats = bonusStats || {
    total_bonus: 0,
    paid_bonus: 0,
    pending_bonus: 0,
    forfeited_bonus: 0
  };

  // 取得發票統計（已開立發票金額加總，僅計有效發票）
  const validStatusCondition = "(status IS NULL OR status = '有效')";
  let invoiceStats;
  if (selectedYear) {
    invoiceStats = db.prepare(`
      SELECT 
        COALESCE(SUM(i.amount_with_tax), 0) as total_invoiced,
        COUNT(DISTINCT i.project_id) as projects_with_invoices,
        COUNT(i.id) as invoice_count
      FROM invoices i
      JOIN projects p ON i.project_id = p.id
      WHERE p.contract_year = ? AND ${validStatusCondition}
    `).get(selectedYear);
  } else {
    invoiceStats = db.prepare(`
      SELECT 
        COALESCE(SUM(amount_with_tax), 0) as total_invoiced,
        COUNT(DISTINCT project_id) as projects_with_invoices,
        COUNT(id) as invoice_count
      FROM invoices
      WHERE ${validStatusCondition}
    `).get();
  }
  
  invoiceStats = invoiceStats || {
    total_invoiced: 0,
    projects_with_invoices: 0,
    invoice_count: 0
  };

  // 取得收款統計（已收款總額，考慮匯費差異）
  let paymentStats;
  const Payment = require('../models/Payment');
  if (selectedYear) {
    const payments = db.prepare(`
      SELECT pm.bank_deposit_amount, pm.payment_difference, pm.difference_type
      FROM payments pm
      JOIN projects p ON pm.project_id = p.id
      WHERE p.contract_year = ?
    `).all(selectedYear);
    
    const totalReceived = payments.reduce((sum, p) => {
      return sum + Payment.calculateActualReceived(p);
    }, 0);
    
    // 計算銷貨折讓總額
    const salesDiscountResult = db.prepare(`
      SELECT COALESCE(SUM(p.sales_discount), 0) as total_sales_discount
      FROM projects p
      WHERE p.contract_year = ?
    `).get(selectedYear);
    
    paymentStats = {
      total_received: totalReceived,
      total_sales_discount: salesDiscountResult ? (salesDiscountResult.total_sales_discount || 0) : 0
    };
  } else {
    const payments = db.prepare('SELECT bank_deposit_amount, payment_difference, difference_type FROM payments').all();
    
    const totalReceived = payments.reduce((sum, p) => {
      return sum + Payment.calculateActualReceived(p);
    }, 0);
    
    // 計算銷貨折讓總額
    const salesDiscountResult = db.prepare('SELECT COALESCE(SUM(sales_discount), 0) as total_sales_discount FROM projects').get();
    
    paymentStats = {
      total_received: totalReceived,
      total_sales_discount: salesDiscountResult ? (salesDiscountResult.total_sales_discount || 0) : 0
    };
  }
  
  paymentStats = paymentStats || {
    total_received: 0,
    total_sales_discount: 0
  };
  
  // 計算已開立發票未收款總額 = 已開立發票總額 - 已收款總額 - 銷貨折讓總額
  const totalUnpaidInvoiced = (invoiceStats.total_invoiced || 0) - (paymentStats.total_received || 0) - (paymentStats.total_sales_discount || 0);
  
  // 檢查即將到期的預計開票專案（從系統設定讀取通知天數）
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
  const currentDay = now.getDate();
  
  // 計算當月最後一天
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  
  // 從系統設定讀取通知天數（預設6天，即倒數第7天開始）
  let notificationDaysBeforeMonth = 6; // 預設值
  let notificationEnabled = true; // 預設啟用
  
  try {
    const notificationDaysSetting = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('invoice_notification_days_before_month_end');
    if (notificationDaysSetting) {
      notificationDaysBeforeMonth = parseInt(notificationDaysSetting.setting_value, 10) || 6;
    }
    
    const notificationEnabledSetting = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('invoice_notification_enabled');
    if (notificationEnabledSetting) {
      notificationEnabled = notificationEnabledSetting.setting_value === 'true';
    }
  } catch (err) {
    console.error('讀取系統設定失敗:', err);
    // 使用預設值
  }
  
  const daysUntilEndOfMonth = lastDayOfMonth - currentDay;
  const showUpcomingNotification = notificationEnabled && daysUntilEndOfMonth <= notificationDaysBeforeMonth;
  
  let upcomingInvoiceProjects = [];
  let overdueInvoiceProjects = []; // 已超過設定月份的專案
  
  // 查詢已超過設定月份的專案（過期專案，應隨時顯示，不受剩餘天數限制）
  if (notificationEnabled) {
    overdueInvoiceProjects = db.prepare(`
      SELECT 
        id,
        project_code,
        project_name,
        project_type,
        salesperson_name,
        price_with_tax,
        expected_invoice_year_month,
        status,
        total_invoiced,
        (price_with_tax - total_invoiced) as uninvoiced_amount,
        'overdue' as notification_type
      FROM v_project_summary
      WHERE expected_invoice_year_month IS NOT NULL
        AND expected_invoice_year_month < ?
        AND status = '未結案'
      ORDER BY expected_invoice_year_month ASC, price_with_tax DESC
    `).all(currentYearMonth);
  }
  
  // 查詢當月預計開票且尚未結案的專案（僅在剩餘天數≤6天時查詢）
  if (showUpcomingNotification) {
    upcomingInvoiceProjects = db.prepare(`
      SELECT 
        id,
        project_code,
        project_name,
        project_type,
        salesperson_name,
        price_with_tax,
        expected_invoice_year_month,
        status,
        total_invoiced,
        (price_with_tax - total_invoiced) as uninvoiced_amount,
        'upcoming' as notification_type
      FROM v_project_summary
      WHERE expected_invoice_year_month = ?
        AND status = '未結案'
      ORDER BY price_with_tax DESC
    `).all(currentYearMonth);
  }
  
  // 如果有過期專案或當月專案，則顯示通知
  const showNotification = notificationEnabled && (upcomingInvoiceProjects.length > 0 || overdueInvoiceProjects.length > 0);
  
  // 合併兩個列表（當月的在前，過期的在後）
  const allInvoiceProjects = [...upcomingInvoiceProjects, ...overdueInvoiceProjects];

  // 應收帳款帳齡分析（admin/user 可見）
  let receivablesAging = null;
  if (req.user && (req.user.role === 'admin' || req.user.role === 'user')) {
    receivablesAging = ReceivablesAgingService.getAgingReport(selectedYear);
  }
  
  res.render('index', {
    title: '首頁',
    years,
    selectedYear: selectedYear ? selectedYear : 'all',
    stats,
    bonusStats,
    invoiceStats,
    paymentStats,
    totalUnpaidInvoiced, // 已開立發票未收款總額
    recentProjects,
    upcomingInvoiceProjects: allInvoiceProjects, // 合併後的列表（包含當月和過期的）
    overdueInvoiceProjects: overdueInvoiceProjects, // 過期專案（用於顯示區分）
    showNotification,
    typeColorMap,
    projectTypeStats, // 專案類型統計（動態）
    currentYearMonth,
    daysUntilEndOfMonth,
    receivablesAging
  });
});

module.exports = router;
