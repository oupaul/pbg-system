/**
 * 專案毛利分析服務（方案 A：以專案未稅價格為收入）
 * 毛利 = price_without_tax - 總成本
 * 毛利率 = 毛利 / price_without_tax × 100%
 */
const db = require('../models/db');

const GrossProfitAnalysisService = {
  /**
   * 取得專案毛利明細
   * @param {number|null} year - 專案簽約年度，null 為全部
   * @returns {Array}
   */
  getAnalysisByProject(year = null) {
    const yearCondition = year ? 'WHERE p.contract_year = ?' : '';
    const params = year ? [year] : [];

    const sql = `
      SELECT 
        p.id,
        p.project_code,
        p.project_name,
        p.contract_year,
        p.project_type,
        p.status,
        s.name as salesperson_name,
        p.price_without_tax as revenue,
        COALESCE(c.total_cost, 0) as total_cost,
        (p.price_without_tax - COALESCE(c.total_cost, 0)) as gross_profit,
        CASE WHEN p.price_without_tax > 0 
          THEN ROUND((p.price_without_tax - COALESCE(c.total_cost, 0)) / p.price_without_tax * 100, 1) 
          ELSE 0 END as gross_margin_pct
      FROM projects p
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      ${yearCondition}
      ORDER BY gross_profit DESC, p.contract_year DESC, p.project_code
    `;

    return db.prepare(sql).all(...params);
  },

  /**
   * 取得依業務彙總的毛利
   * @param {number|null} year
   * @returns {Array}
   */
  getAnalysisBySalesperson(year = null) {
    const yearCondition = year ? 'AND p.contract_year = ?' : '';
    const params = year ? [year] : [];

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
      LEFT JOIN projects p ON s.id = p.salesperson_id ${yearCondition}
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost FROM costs GROUP BY project_id
      ) c ON p.id = c.project_id
      WHERE p.id IS NOT NULL
      GROUP BY s.id
      HAVING project_count > 0
      ORDER BY gross_profit DESC
    `;

    return db.prepare(sql).all(...params);
  },

  /**
   * 取得依專案類型彙總的毛利
   * @param {number|null} year
   * @returns {Array}
   */
  getAnalysisByType(year = null) {
    const yearCondition = year ? 'WHERE p.contract_year = ?' : '';
    const params = year ? [year] : [];

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
      ${yearCondition}
      GROUP BY p.project_type
      HAVING project_count > 0
      ORDER BY gross_profit DESC
    `;

    return db.prepare(sql).all(...params);
  }
};

module.exports = GrossProfitAnalysisService;
