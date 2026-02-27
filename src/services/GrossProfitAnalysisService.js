/**
 * 專案毛利分析服務（方案 A：以專案未稅價格為收入）
 * 毛利 = price_without_tax - 總成本
 * 毛利率 = 毛利 / price_without_tax × 100%
 */
const db = require('../models/db');

// 非 admin/user/boss 時排除「儀表板獨立加總」業務員的專案
function excludeSeparateCondition(user) {
  if (!user || ['admin', 'user', 'boss'].includes(user.role)) return '';
  return "(p.salesperson_id IS NULL OR p.salesperson_id NOT IN (SELECT id FROM salespeople WHERE show_separate_dashboard = 1))";
}
function excludeSeparateSalespersonCondition(user) {
  if (!user || ['admin', 'user', 'boss'].includes(user.role)) return '';
  return "(COALESCE(s.show_separate_dashboard, 0) <> 1)";
}

const GrossProfitAnalysisService = {
  /**
   * 取得專案毛利明細
   * @param {number|null} year - 專案簽約年度，null 為全部。選擇年度時：該年度簽約的專案 ＋ 「之前年度」簽約且尚未結案的專案（不含之後年度）
   * @param {Object|null} user - 使用者物件，用於權限過濾（salesperson 只能看自己的專案）
   * @param {string|null} statusFilter - 狀態篩選：'未結案' | '已結案' | null（全部）
   * @returns {Array}
   */
  getAnalysisByProject(year = null, user = null, statusFilter = null) {
    let yearCondition = year
      ? "(p.contract_year = ? OR (COALESCE(p.status, '未結案') <> '已結案' AND p.contract_year < ?))"
      : '';
    const params = year ? [year, year] : [];
    
    // 角色權限過濾
    let roleCondition = '';
    if (user && user.role === 'salesperson' && user.salesperson_id) {
      roleCondition = 'p.salesperson_id = ?';
      params.push(user.salesperson_id);
    }
    
    // 狀態篩選：只顯示未結案或已結案
    let statusCondition = '';
    if (statusFilter === '已結案') {
      statusCondition = 'p.status = ?';
      params.push('已結案');
    } else if (statusFilter === '未結案') {
      statusCondition = "(COALESCE(p.status, '未結案') = '未結案')";
    }
    
    // 組合 WHERE 條件
    let whereClause = '';
    const conditions = [];
    if (yearCondition) conditions.push(yearCondition);
    if (roleCondition) conditions.push(roleCondition);
    if (statusCondition) conditions.push(statusCondition);
    const exc = excludeSeparateCondition(user);
    if (exc) conditions.push(exc);
    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const sql = `
      SELECT 
        p.id,
        p.project_code,
        COALESCE(cust.company_name, '') as customer_name,
        p.project_name,
        p.contract_year,
        p.project_type,
        p.status,
        COALESCE(rg.name, '') as report_group_name,
        s.name as salesperson_name,
        p.price_without_tax as revenue,
        COALESCE(c.total_cost, 0) as total_cost,
        (p.price_without_tax - COALESCE(c.total_cost, 0)) as gross_profit,
        CASE WHEN p.price_without_tax > 0 
          THEN ROUND((p.price_without_tax - COALESCE(c.total_cost, 0)) / p.price_without_tax * 100, 1) 
          ELSE 0 END as gross_margin_pct
      FROM projects p
      LEFT JOIN customers cust ON p.customer_id = cust.id
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN report_groups rg ON p.report_group_id = rg.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      ${whereClause}
      ORDER BY gross_profit DESC, p.contract_year DESC, p.project_code
    `;

    try {
      return db.prepare(sql).all(...params);
    } catch (err) {
      if (err.message && (err.message.includes('no such table') || err.message.includes('report_groups') || err.message.includes('customers'))) {
        const fallbackParams = year ? [year, year] : [];
        if (user && user.role === 'salesperson' && user.salesperson_id) {
          fallbackParams.push(user.salesperson_id);
        }
        if (statusFilter === '已結案') fallbackParams.push('已結案');
        const fallbackWhere = [];
        if (yearCondition) fallbackWhere.push(yearCondition);
        if (roleCondition) fallbackWhere.push(roleCondition);
        if (statusCondition) fallbackWhere.push(statusCondition);
        if (exc) fallbackWhere.push(exc);
        const fallbackWhereClause = fallbackWhere.length > 0 ? 'WHERE ' + fallbackWhere.join(' AND ') : '';
        return db.prepare(`
          SELECT 
            p.id, p.project_code, COALESCE(cust.company_name, '') as customer_name, p.project_name, p.contract_year, p.project_type, p.status,
            '' as report_group_name,
            s.name as salesperson_name,
            p.price_without_tax as revenue,
            COALESCE(c.total_cost, 0) as total_cost,
            (p.price_without_tax - COALESCE(c.total_cost, 0)) as gross_profit,
            CASE WHEN p.price_without_tax > 0 THEN ROUND((p.price_without_tax - COALESCE(c.total_cost, 0)) / p.price_without_tax * 100, 1) ELSE 0 END as gross_margin_pct
          FROM projects p
          LEFT JOIN customers cust ON p.customer_id = cust.id
          LEFT JOIN salespeople s ON p.salesperson_id = s.id
          LEFT JOIN (SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id) c ON p.id = c.project_id
          ${fallbackWhereClause}
          ORDER BY gross_profit DESC, p.contract_year DESC, p.project_code
        `).all(...fallbackParams);
      }
      throw err;
    }
  },

  /**
   * 取得依業務彙總的毛利（年度篩選同 getAnalysisByProject：該年度簽約 + 之前年度未結案）
   * @param {number|null} year
   * @param {Object|null} user - 使用者物件，用於權限過濾（salesperson 只能看自己的專案）
   * @param {string|null} statusFilter - 狀態篩選：'未結案' | '已結案' | null（全部）
   * @returns {Array}
   */
  getAnalysisBySalesperson(year = null, user = null, statusFilter = null) {
    let yearCondition = year
      ? "(p.contract_year = ? OR (COALESCE(p.status, '未結案') <> '已結案' AND p.contract_year < ?))"
      : '';
    const params = year ? [year, year] : [];
    
    // 角色權限過濾
    let roleCondition = '';
    if (user && user.role === 'salesperson' && user.salesperson_id) {
      roleCondition = 'p.salesperson_id = ?';
      params.push(user.salesperson_id);
    }
    
    // 狀態篩選
    let statusCondition = '';
    if (statusFilter === '已結案') {
      statusCondition = 'p.status = ?';
      params.push('已結案');
    } else if (statusFilter === '未結案') {
      statusCondition = "(COALESCE(p.status, '未結案') = '未結案')";
    }
    
    // 組合 WHERE 條件
    const conditions = ['p.id IS NOT NULL'];
    if (yearCondition) conditions.push(yearCondition);
    if (roleCondition) conditions.push(roleCondition);
    if (statusCondition) conditions.push(statusCondition);
    const excSp = excludeSeparateSalespersonCondition(user);
    if (excSp) conditions.push(excSp);
    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const sql = `
      SELECT 
        s.id,
        s.name,
        COUNT(p.id) as project_count,
        COALESCE(SUM(p.price_without_tax), 0) as total_revenue,
        COALESCE(SUM(c.total_cost), 0) as total_cost,
        COALESCE(SUM(p.price_without_tax), 0) - COALESCE(SUM(c.total_cost), 0) as gross_profit,
        CASE WHEN SUM(p.price_without_tax) > 0 
          THEN ROUND((SUM(p.price_without_tax) - COALESCE(SUM(c.total_cost), 0)) / SUM(p.price_without_tax) * 100, 1) 
          ELSE 0 END as gross_margin_pct
      FROM salespeople s
      LEFT JOIN projects p ON s.id = p.salesperson_id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      ${whereClause}
      GROUP BY s.id
      HAVING project_count > 0
      ORDER BY gross_profit DESC
    `;

    return db.prepare(sql).all(...params);
  },

  /**
   * 取得依專案類型彙總的毛利（年度篩選同 getAnalysisByProject）
   * @param {number|null} year
   * @param {Object|null} user - 使用者物件，用於權限過濾（salesperson 只能看自己的專案）
   * @param {string|null} statusFilter - 狀態篩選：'未結案' | '已結案' | null（全部）
   * @returns {Array}
   */
  getAnalysisByType(year = null, user = null, statusFilter = null) {
    let yearCondition = year
      ? "(p.contract_year = ? OR (COALESCE(p.status, '未結案') <> '已結案' AND p.contract_year < ?))"
      : '';
    const params = year ? [year, year] : [];
    
    // 角色權限過濾
    let roleCondition = '';
    if (user && user.role === 'salesperson' && user.salesperson_id) {
      roleCondition = 'p.salesperson_id = ?';
      params.push(user.salesperson_id);
    }
    
    // 狀態篩選
    let statusCondition = '';
    if (statusFilter === '已結案') {
      statusCondition = 'p.status = ?';
      params.push('已結案');
    } else if (statusFilter === '未結案') {
      statusCondition = "(COALESCE(p.status, '未結案') = '未結案')";
    }
    
    // 組合 WHERE 條件
    const conditions = [];
    if (yearCondition) conditions.push(yearCondition);
    if (roleCondition) conditions.push(roleCondition);
    if (statusCondition) conditions.push(statusCondition);
    const exc2 = excludeSeparateCondition(user);
    if (exc2) conditions.push(exc2);
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT 
        p.project_type,
        COUNT(p.id) as project_count,
        COALESCE(SUM(p.price_without_tax), 0) as total_revenue,
        COALESCE(SUM(c.total_cost), 0) as total_cost,
        COALESCE(SUM(p.price_without_tax), 0) - COALESCE(SUM(c.total_cost), 0) as gross_profit,
        CASE WHEN SUM(p.price_without_tax) > 0 
          THEN ROUND((SUM(p.price_without_tax) - COALESCE(SUM(c.total_cost), 0)) / SUM(p.price_without_tax) * 100, 1) 
          ELSE 0 END as gross_margin_pct
      FROM projects p
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      ${whereClause}
      GROUP BY p.project_type
      HAVING project_count > 0
      ORDER BY gross_profit DESC
    `;

    return db.prepare(sql).all(...params);
  },

  /**
   * 取得依報表群組彙總的毛利（年度篩選同 getAnalysisByProject）
   * 未分群專案歸在「未分群」一組
   * @param {number|null} year
   * @param {Object|null} user - 使用者物件，用於權限過濾（salesperson 只能看自己的專案）
   * @param {string|null} statusFilter - 狀態篩選：'未結案' | '已結案' | null（全部）
   * @returns {Array} { report_group_id, report_group_name, project_count, total_revenue, total_cost, gross_profit, gross_margin_pct }
   */
  getAnalysisByReportGroup(year = null, user = null, statusFilter = null) {
    let yearCondition = year
      ? "(p.contract_year = ? OR (COALESCE(p.status, '未結案') <> '已結案' AND p.contract_year < ?))"
      : '';
    const params = year ? [year, year] : [];
    
    // 角色權限過濾
    let roleCondition = '';
    if (user && user.role === 'salesperson' && user.salesperson_id) {
      roleCondition = 'p.salesperson_id = ?';
      params.push(user.salesperson_id);
    }
    
    // 狀態篩選
    let statusCondition = '';
    if (statusFilter === '已結案') {
      statusCondition = 'p.status = ?';
      params.push('已結案');
    } else if (statusFilter === '未結案') {
      statusCondition = "(COALESCE(p.status, '未結案') = '未結案')";
    }
    
    // 組合 WHERE 條件
    const conditions = [];
    if (yearCondition) conditions.push(yearCondition);
    if (roleCondition) conditions.push(roleCondition);
    if (statusCondition) conditions.push(statusCondition);
    const exc3 = excludeSeparateCondition(user);
    if (exc3) conditions.push(exc3);
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT 
        p.report_group_id,
        COALESCE(rg.name, '未分群') as report_group_name,
        COUNT(p.id) as project_count,
        COALESCE(SUM(p.price_without_tax), 0) as total_revenue,
        COALESCE(SUM(c.total_cost), 0) as total_cost,
        COALESCE(SUM(p.price_without_tax), 0) - COALESCE(SUM(c.total_cost), 0) as gross_profit,
        CASE WHEN SUM(p.price_without_tax) > 0 
          THEN ROUND((SUM(p.price_without_tax) - COALESCE(SUM(c.total_cost), 0)) / SUM(p.price_without_tax) * 100, 1) 
          ELSE 0 END as gross_margin_pct
      FROM projects p
      LEFT JOIN report_groups rg ON p.report_group_id = rg.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      ${whereClause}
      GROUP BY p.report_group_id
      HAVING project_count > 0
      ORDER BY COALESCE(rg.display_order, 999999), report_group_name
    `;

    try {
      return db.prepare(sql).all(...params);
    } catch (err) {
      if (err.message && (err.message.includes('no such table') || err.message.includes('report_groups'))) {
        return [];
      }
      throw err;
    }
  }
};

module.exports = GrossProfitAnalysisService;
