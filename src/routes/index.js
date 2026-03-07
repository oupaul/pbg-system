const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Project = require('../models/Project');
const ReceivablesAgingService = require('../services/ReceivablesAgingService');
const Role = require('../models/Role');

// 取得使用者角色的儀表板檢視模式
function getDashboardViewMode(user) {
  if (!user || !user.role) return 'all_and_separate';
  try {
    const role = Role.findByKey(user.role);
    if (role && role.dashboard_view_mode) return role.dashboard_view_mode;
  } catch (e) { /* ignore */ }
  return 'all_and_separate';
}

// 取得「儀表板獨立加總」的專案類型名稱列表（project_types.show_separate_dashboard = 1）
function getSeparateTypeNames() {
  try {
    const rows = db.prepare('SELECT type_name FROM project_types WHERE COALESCE(show_separate_dashboard, 0) = 1 AND is_active = 1').all();
    return rows.map(r => r.type_name);
  } catch (e) { return []; }
}

router.get('/', (req, res) => {
  const dashboardMode = getDashboardViewMode(req.user);

  // dashboard_view_mode = 'none'：顯示歡迎頁（不顯示儀表板），但業務員仍顯示收款提醒與開票提醒
  if (dashboardMode === 'none') {
    let paymentReminder = { upcoming: [], overdue: [] };
    let upcomingInvoiceProjects = [];
    let overdueInvoiceProjects = [];
    let showNotification = false;
    let daysUntilEndOfMonth = 0;
    let currentYearMonth = '';
    let typeColorMap = {};

    if (req.user && req.user.role === 'salesperson' && req.user.salesperson_id) {
      // 收款提醒
      let paymentReminderDays = 7;
      try {
        const reminderSetting = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('payment_reminder_days');
        if (reminderSetting) paymentReminderDays = parseInt(reminderSetting.setting_value, 10) || 7;
      } catch (e) { /* use default */ }
      paymentReminder = ReceivablesAgingService.getPaymentReminder(paymentReminderDays, null, req.user.salesperson_id);

      // 開票提醒（業務員僅見自己專案）
      let notificationEnabled = true;
      let notificationDaysBeforeMonth = 6;
      try {
        const nd = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('invoice_notification_days_before_month_end');
        if (nd) notificationDaysBeforeMonth = parseInt(nd.setting_value, 10) || 6;
        const ne = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('invoice_notification_enabled');
        if (ne) notificationEnabled = ne.setting_value === 'true';
      } catch (e) { /* use default */ }
      const now = new Date();
      currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      daysUntilEndOfMonth = lastDayOfMonth - now.getDate();
      const showUpcoming = notificationEnabled && daysUntilEndOfMonth <= notificationDaysBeforeMonth;

      if (notificationEnabled) {
        overdueInvoiceProjects = db.prepare(`
          SELECT v.id, v.project_code, v.project_name, v.project_type, v.salesperson_name,
            v.price_with_tax, v.expected_invoice_year_month, v.status, v.total_invoiced,
            (v.price_with_tax - v.total_invoiced) as uninvoiced_amount, 'overdue' as notification_type
          FROM v_project_summary v
          WHERE v.expected_invoice_year_month IS NOT NULL AND v.expected_invoice_year_month < ?
            AND v.status = '未結案' AND v.salesperson_id = ?
          ORDER BY v.expected_invoice_year_month ASC, v.price_with_tax DESC
        `).all(currentYearMonth, req.user.salesperson_id);
      }
      if (showUpcoming) {
        upcomingInvoiceProjects = db.prepare(`
          SELECT v.id, v.project_code, v.project_name, v.project_type, v.salesperson_name,
            v.price_with_tax, v.expected_invoice_year_month, v.status, v.total_invoiced,
            (v.price_with_tax - v.total_invoiced) as uninvoiced_amount, 'upcoming' as notification_type
          FROM v_project_summary v
          WHERE v.expected_invoice_year_month = ? AND v.status = '未結案' AND v.salesperson_id = ?
          ORDER BY v.price_with_tax DESC
        `).all(currentYearMonth, req.user.salesperson_id);
      }
      showNotification = notificationEnabled && (upcomingInvoiceProjects.length > 0 || overdueInvoiceProjects.length > 0);

      try {
        db.prepare('SELECT type_name, badge_color FROM project_types').all().forEach(t => { typeColorMap[t.type_name] = t.badge_color; });
      } catch (e) { /* ignore */ }
    }

    return res.render('index', {
      title: '首頁',
      showWelcome: true,
      years: Project.getYears(),
      selectedYear: 'all',
      paymentReminder,
      upcomingInvoiceProjects: [...upcomingInvoiceProjects, ...overdueInvoiceProjects],
      overdueInvoiceProjects,
      showNotification,
      daysUntilEndOfMonth,
      currentYearMonth,
      typeColorMap
    });
  }

  const currentYear = new Date().getFullYear();
  const years = Project.getYears();
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;

  const separateTypeNames = getSeparateTypeNames();
  // 主區塊排除獨立加總類型：exclude_separate 時排除；all_and_separate 時也排除，避免與獨立區塊重複計算
  const excludeFromMain = (dashboardMode === 'exclude_separate' || dashboardMode === 'all_and_separate') && separateTypeNames.length > 0;
  const excludeCond = excludeFromMain && separateTypeNames.length > 0
    ? ` AND (p.project_type IS NULL OR p.project_type NOT IN (${separateTypeNames.map(() => '?').join(',')}))`
    : '';
  const excludeCondParams = excludeFromMain ? separateTypeNames : [];
  
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
  
  // 取得統計資料（排除獨立加總類型，避免重複計算）
  const excludeTypeNames = excludeFromMain ? separateTypeNames : null;
  let stats = Project.getStatistics(selectedYear, null, excludeTypeNames);
  
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
  
  // 獲取專案類型（用於儀表板專案類型分布，僅顯示 show_in_dashboard = 1 的類型）
  let projectTypeStats = [];
  try {
    let allTypes;
    try {
      allTypes = db.prepare('SELECT type_name, badge_color, display_order FROM project_types WHERE is_active = 1 AND (COALESCE(show_in_dashboard, 1) = 1) ORDER BY display_order ASC, type_name ASC').all();
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('show_in_dashboard')) {
        allTypes = db.prepare('SELECT type_name, badge_color, display_order FROM project_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC').all();
      } else throw colErr;
    }
    allTypes.forEach(type => {
      const amount = stats.typeAmounts[type.type_name] || 0;
      projectTypeStats.push({
        type_name: type.type_name,
        badge_color: type.badge_color,
        amount: amount
      });
    });
    
    // 若有類型在專案中使用但未在 project_types 中勾選儀表板顯示，不加入（僅顯示已勾選的類型）
  } catch (err) {
    console.warn('無法獲取專案類型列表:', err.message);
    // 不預載任何類型，只顯示實際存在的類型
    projectTypeStats = [];
  }

  // 取得最近專案（主區塊排除獨立加總類型時需過濾）
  let recentProjects;
  if (excludeFromMain && separateTypeNames.length > 0) {
    const yearCond = selectedYear ? 'p.contract_year = ?' : '1=1';
    const params = selectedYear ? [selectedYear, ...excludeCondParams] : [...excludeCondParams];
    recentProjects = db.prepare(`
      SELECT v.* FROM v_project_summary v
      JOIN projects p ON v.id = p.id
      WHERE ${yearCond} AND (p.project_type IS NULL OR p.project_type NOT IN (${separateTypeNames.map(() => '?').join(',')}))
      ORDER BY v.updated_at DESC 
      LIMIT 10
    `).all(...params);
  } else if (selectedYear) {
    recentProjects = db.prepare(`SELECT * FROM v_project_summary WHERE contract_year = ? ORDER BY updated_at DESC LIMIT 10`).all(selectedYear);
  } else {
    recentProjects = db.prepare(`SELECT * FROM v_project_summary ORDER BY updated_at DESC LIMIT 10`).all();
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
      WHERE p.contract_year = ? ${excludeCond}
    `).get(selectedYear, ...excludeCondParams);
  } else {
    bonusStats = db.prepare(`
      SELECT 
        SUM(bc.bonus_amount) as total_bonus,
        SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
        SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus,
        SUM(CASE WHEN bc.status = '充公' THEN bc.bonus_amount ELSE 0 END) as forfeited_bonus
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      WHERE 1=1 ${excludeCond}
    `).get(...excludeCondParams);
  }
  
  bonusStats = bonusStats || {
    total_bonus: 0,
    paid_bonus: 0,
    pending_bonus: 0,
    forfeited_bonus: 0
  };

  // 取得發票統計
  let invoiceStats;
  if (selectedYear) {
    invoiceStats = db.prepare(`
      SELECT 
        COALESCE(SUM(i.amount_with_tax - COALESCE(i.allowance_amount, 0)), 0) as total_invoiced,
        COUNT(DISTINCT i.project_id) as projects_with_invoices,
        COUNT(i.id) as invoice_count
      FROM invoices i
      JOIN projects p ON i.project_id = p.id
      WHERE p.contract_year = ? AND (i.status IS NULL OR i.status = '有效') AND (i.deleted_at IS NULL) ${excludeCond}
    `).get(selectedYear, ...excludeCondParams);
  } else {
    invoiceStats = db.prepare(`
      SELECT 
        COALESCE(SUM(i.amount_with_tax - COALESCE(i.allowance_amount, 0)), 0) as total_invoiced,
        COUNT(DISTINCT i.project_id) as projects_with_invoices,
        COUNT(i.id) as invoice_count
      FROM invoices i
      JOIN projects p ON i.project_id = p.id
      WHERE (i.status IS NULL OR i.status = '有效') AND (i.deleted_at IS NULL) ${excludeCond}
    `).get(...excludeCondParams);
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
      WHERE p.contract_year = ? AND (pm.deleted_at IS NULL) ${excludeCond}
    `).all(selectedYear, ...excludeCondParams);
    
    const totalReceived = payments.reduce((sum, p) => {
      return sum + Payment.calculateActualReceived(p);
    }, 0);
    
    const salesDiscountResult = db.prepare(`
      SELECT COALESCE(SUM(p.sales_discount), 0) as total_sales_discount
      FROM projects p
      WHERE p.contract_year = ? ${excludeCond}
    `).get(selectedYear, ...excludeCondParams);
    
    paymentStats = {
      total_received: totalReceived,
      total_sales_discount: salesDiscountResult ? (salesDiscountResult.total_sales_discount || 0) : 0
    };
  } else {
    const payments = excludeFromMain
      ? db.prepare(`
          SELECT pm.bank_deposit_amount, pm.payment_difference, pm.difference_type
          FROM payments pm
          JOIN projects p ON pm.project_id = p.id
          WHERE pm.deleted_at IS NULL ${excludeCond}
        `).all(...excludeCondParams)
      : db.prepare('SELECT bank_deposit_amount, payment_difference, difference_type FROM payments WHERE deleted_at IS NULL').all();
    
    const totalReceived = payments.reduce((sum, p) => {
      return sum + Payment.calculateActualReceived(p);
    }, 0);
    
    const salesDiscountResult = excludeFromMain
      ? db.prepare(`SELECT COALESCE(SUM(p.sales_discount), 0) as total_sales_discount FROM projects p WHERE 1=1 ${excludeCond}`).get(...excludeCondParams)
      : db.prepare('SELECT COALESCE(SUM(sales_discount), 0) as total_sales_discount FROM projects').get();
    
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
  
  // 開票提醒：包含所有專案（含獨立加總業務）；業務員僅見自己負責專案
  const notifSalespersonCond = (req.user && req.user.role === 'salesperson' && req.user.salesperson_id)
    ? ' AND v.salesperson_id = ?' : '';
  const notifSalespersonParam = (req.user && req.user.role === 'salesperson' && req.user.salesperson_id)
    ? req.user.salesperson_id : null;
  if (notificationEnabled) {
    const overdueParams = notifSalespersonParam != null ? [currentYearMonth, notifSalespersonParam] : [currentYearMonth];
    overdueInvoiceProjects = db.prepare(`
      SELECT 
        v.id, v.project_code, v.project_name, v.project_type, v.salesperson_name,
        v.price_with_tax, v.expected_invoice_year_month, v.status, v.total_invoiced,
        (v.price_with_tax - v.total_invoiced) as uninvoiced_amount,
        'overdue' as notification_type
      FROM v_project_summary v
      WHERE v.expected_invoice_year_month IS NOT NULL
        AND v.expected_invoice_year_month < ?
        AND v.status = '未結案'${notifSalespersonCond}
      ORDER BY v.expected_invoice_year_month ASC, v.price_with_tax DESC
    `).all(...overdueParams);
  }
  if (showUpcomingNotification) {
    const upcomingParams = notifSalespersonParam != null ? [currentYearMonth, notifSalespersonParam] : [currentYearMonth];
    upcomingInvoiceProjects = db.prepare(`
      SELECT 
        v.id, v.project_code, v.project_name, v.project_type, v.salesperson_name,
        v.price_with_tax, v.expected_invoice_year_month, v.status, v.total_invoiced,
        (v.price_with_tax - v.total_invoiced) as uninvoiced_amount,
        'upcoming' as notification_type
      FROM v_project_summary v
      WHERE v.expected_invoice_year_month = ?
        AND v.status = '未結案'${notifSalespersonCond}
      ORDER BY v.price_with_tax DESC
    `).all(...upcomingParams);
  }
  
  // 如果有過期專案或當月專案，則顯示通知
  const showNotification = notificationEnabled && (upcomingInvoiceProjects.length > 0 || overdueInvoiceProjects.length > 0);
  
  // 合併兩個列表（當月的在前，過期的在後）
  const allInvoiceProjects = [...upcomingInvoiceProjects, ...overdueInvoiceProjects];

  // 應收帳款帳齡分析（admin/user 可見），始終包含全部發票（含獨立加總業務），以掌握完整應收狀況
  let receivablesAging = null;
  if (req.user && (req.user.role === 'admin' || req.user.role === 'user')) {
    receivablesAging = ReceivablesAgingService.getAgingReport(selectedYear, null);
  }

  // 收款提醒：預計收款日即將到期或已逾期
  // admin/user 可見全部；salesperson 僅見自己負責專案
  let paymentReminder = { upcoming: [], overdue: [] };
  if (req.user && (req.user.role === 'admin' || req.user.role === 'user' || req.user.role === 'salesperson')) {
    let paymentReminderDays = 7;
    try {
      const reminderSetting = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('payment_reminder_days');
      if (reminderSetting) paymentReminderDays = parseInt(reminderSetting.setting_value, 10) || 7;
    } catch (e) { /* use default */ }
    const salespersonFilter = (req.user.role === 'salesperson' && req.user.salesperson_id) ? req.user.salesperson_id : null;
    paymentReminder = ReceivablesAgingService.getPaymentReminder(paymentReminderDays, null, salespersonFilter);
  }

  // 獨立類型區塊（all_and_separate 時，為每個 show_separate_dashboard 類型計算獨立統計）
  let separateBlocks = [];
  if (dashboardMode === 'all_and_separate' && separateTypeNames.length > 0) {
    const yearCondP = selectedYear ? 'p.contract_year = ?' : '1=1';
    const yearCond = selectedYear ? 'contract_year = ?' : '1=1';
    for (const typeName of separateTypeNames) {
      const params = selectedYear ? [typeName, selectedYear] : [typeName];
      const typeStats = db.prepare(`
        SELECT COUNT(*) as total_projects,
          COALESCE(SUM(CASE WHEN p.status = '未結案' THEN 1 ELSE 0 END), 0) as open_projects,
          COALESCE(SUM(CASE WHEN p.status = '已結案' THEN 1 ELSE 0 END), 0) as closed_projects,
          COALESCE(SUM(p.price_with_tax), 0) as total_amount
        FROM projects p WHERE p.project_type = ? AND ${yearCondP}
      `).get(...params);
      const typeAmounts = { [typeName]: typeStats.total_amount || 0 };
      const typeInvoiceStats = db.prepare(`
        SELECT COALESCE(SUM(i.amount_with_tax - COALESCE(i.allowance_amount, 0)), 0) as total_invoiced,
          COUNT(DISTINCT i.project_id) as projects_with_invoices, COUNT(i.id) as invoice_count
        FROM invoices i JOIN projects p ON i.project_id = p.id
        WHERE p.project_type = ? AND (i.status IS NULL OR i.status = '有效') AND (i.deleted_at IS NULL) AND ${yearCondP}
      `).get(...params);
      const typePayments = db.prepare(`
        SELECT pm.bank_deposit_amount, pm.payment_difference, pm.difference_type
        FROM payments pm JOIN projects p ON pm.project_id = p.id
        WHERE p.project_type = ? AND (pm.deleted_at IS NULL) AND ${yearCondP}
      `).all(...params);
      const totalReceived = typePayments.reduce((s, p) => s + Payment.calculateActualReceived(p), 0);
      const typeSalesDiscount = db.prepare(`
        SELECT COALESCE(SUM(sales_discount), 0) as total_sales_discount
        FROM projects WHERE project_type = ? AND ${yearCond}
      `).get(...params);
      const typeBonusStats = db.prepare(`
        SELECT SUM(bc.bonus_amount) as total_bonus,
          SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
          SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus
        FROM bonus_calculations bc JOIN projects p ON bc.project_id = p.id
        WHERE p.project_type = ? AND ${yearCondP}
      `).get(...params);
      const totalUnpaid = (typeInvoiceStats.total_invoiced || 0) - totalReceived - (typeSalesDiscount.total_sales_discount || 0);
      separateBlocks.push({
        typeName,
        stats: { ...typeStats, typeAmounts },
        invoiceStats: typeInvoiceStats || { total_invoiced: 0, projects_with_invoices: 0, invoice_count: 0 },
        paymentStats: { total_received: totalReceived, total_sales_discount: typeSalesDiscount?.total_sales_discount || 0 },
        bonusStats: typeBonusStats || { total_bonus: 0, paid_bonus: 0, pending_bonus: 0 },
        totalUnpaidInvoiced: totalUnpaid
      });
    }
  }
  
  res.render('index', {
    title: '首頁',
    showWelcome: false,
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
    receivablesAging,
    paymentReminder,
    separateBlocks
  });
});

module.exports = router;
