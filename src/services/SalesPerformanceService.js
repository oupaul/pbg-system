/**
 * 業務績效彙總服務
 * 依業務人員彙總專案、發票、收款、獎金等數據
 */
const db = require('../models/db');

const SalesPerformanceService = {
  /**
   * 取得所有業務的績效彙總
   * @param {number|null} year - 專案簽約年度，null 為全部
   * @returns {Array}
   */
  getPerformanceBySalesperson(year = null) {
    const yearCondition = year ? 'AND p.contract_year = ?' : '';
    const params = year ? [year] : [];

    // 洽談中銷售機會預估營收（先彙總成一列一業務，避免與 projects join 交叉相乘）
    const pipelineYearCondition = year ? "AND substr(pl.expected_close_year_month, 1, 4) = ?" : '';
    const pipelineParams = year ? [String(year)] : [];

    const sql = `
      SELECT
        s.id,
        s.name,
        COUNT(DISTINCT p.id) as project_count,
        COALESCE(SUM(p.price_with_tax), 0) as total_price,
        COALESCE(SUM(v.total_invoiced), 0) as total_invoiced,
        COALESCE(SUM(v.total_received), 0) as total_received,
        COALESCE(SUM(p.sales_discount), 0) as total_sales_discount,
        COALESCE(pf.pipeline_count, 0) as pipeline_count,
        COALESCE(pf.pipeline_amount, 0) as pipeline_amount
      FROM salespeople s
      LEFT JOIN projects p ON s.id = p.salesperson_id ${yearCondition}
      LEFT JOIN v_project_summary v ON p.id = v.id
      LEFT JOIN (
        SELECT pl.salesperson_id,
          COUNT(*) as pipeline_count,
          COALESCE(SUM(pl.estimated_amount), 0) as pipeline_amount
        FROM pipelines pl
        WHERE pl.status = '洽談中' AND pl.deleted_at IS NULL ${pipelineYearCondition}
        GROUP BY pl.salesperson_id
      ) pf ON pf.salesperson_id = s.id
      WHERE s.status = 'active' OR p.id IS NOT NULL OR pf.salesperson_id IS NOT NULL
      GROUP BY s.id
      HAVING project_count > 0 OR total_price > 0 OR pipeline_count > 0
      ORDER BY total_invoiced DESC, total_price DESC
    `;

    const rows = db.prepare(sql).all(...params, ...pipelineParams);

    // 取得獎金彙總
    const bonusSql = year
      ? `SELECT bc.salesperson_id, SUM(bc.bonus_amount) as total_bonus, 
         SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
         SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus
         FROM bonus_calculations bc JOIN projects p ON bc.project_id = p.id 
         WHERE p.contract_year = ? GROUP BY bc.salesperson_id`
      : `SELECT salesperson_id, SUM(bonus_amount) as total_bonus,
         SUM(CASE WHEN status = '已發放' THEN bonus_amount ELSE 0 END) as paid_bonus,
         SUM(CASE WHEN status = '待發放' THEN bonus_amount ELSE 0 END) as pending_bonus
         FROM bonus_calculations GROUP BY salesperson_id`;

    const bonusRows = db.prepare(bonusSql).all(...(year ? [year] : []));
    const bonusMap = {};
    bonusRows.forEach(b => {
      bonusMap[b.salesperson_id] = {
        total_bonus: b.total_bonus || 0,
        paid_bonus: b.paid_bonus || 0,
        pending_bonus: b.pending_bonus || 0
      };
    });

    return rows.map(r => {
      const bonus = bonusMap[r.id] || { total_bonus: 0, paid_bonus: 0, pending_bonus: 0 };
      const totalInvoiced = r.total_invoiced || 0;
      const totalReceived = r.total_received || 0;
      const salesDiscount = r.total_sales_discount || 0;
      const totalUnpaid = Math.max(0, totalInvoiced - totalReceived - salesDiscount);

      return {
        id: r.id,
        name: r.name,
        project_count: r.project_count || 0,
        total_price: r.total_price || 0,
        total_invoiced: totalInvoiced,
        total_received: totalReceived,
        total_sales_discount: salesDiscount,
        total_unpaid: totalUnpaid,
        uninvoiced_amount: Math.max(0, (r.total_price || 0) - totalInvoiced),
        pipeline_count: r.pipeline_count || 0,
        pipeline_amount: r.pipeline_amount || 0,
        ...bonus
      };
    });
  },

  /**
   * 取得全公司銷售機會總覽：洽談中預估營收、已成交但尚未轉入專案的銷售機會（提醒財務盡快處理）
   * @returns {{open_count:number, open_amount:number, won_pending_count:number, won_pending_amount:number}}
   */
  getPipelineSummary() {
    const open = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(estimated_amount), 0) as amount
      FROM pipelines WHERE status = '洽談中' AND deleted_at IS NULL
    `).get();

    const wonPending = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(estimated_amount), 0) as amount
      FROM pipelines WHERE status = '已成交' AND converted_project_id IS NULL AND deleted_at IS NULL
    `).get();

    return {
      open_count: open.count || 0,
      open_amount: open.amount || 0,
      won_pending_count: wonPending.count || 0,
      won_pending_amount: wonPending.amount || 0
    };
  }
};

module.exports = SalesPerformanceService;
