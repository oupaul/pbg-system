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

    const sql = `
      SELECT 
        s.id,
        s.name,
        COUNT(DISTINCT p.id) as project_count,
        COALESCE(SUM(p.price_with_tax), 0) as total_price,
        COALESCE(SUM(v.total_invoiced), 0) as total_invoiced,
        COALESCE(SUM(v.total_received), 0) as total_received,
        COALESCE(SUM(p.sales_discount), 0) as total_sales_discount
      FROM salespeople s
      LEFT JOIN projects p ON s.id = p.salesperson_id ${yearCondition}
      LEFT JOIN v_project_summary v ON p.id = v.id
      WHERE s.status = 'active' OR p.id IS NOT NULL
      GROUP BY s.id
      HAVING project_count > 0 OR total_price > 0
      ORDER BY total_invoiced DESC, total_price DESC
    `;

    const rows = db.prepare(sql).all(...params);

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
        ...bonus
      };
    });
  }
};

module.exports = SalesPerformanceService;
