/**
 * 儀表板「本月概況」：本月 vs 上月的開票／收款／新簽專案、近 12 個月開票與收款趨勢、進行中的銷售機會。
 * 範圍規則與儀表板其他區塊一致（業務員僅見自己、排除「獨立加總」專案類型）。
 */
// 延遲載入資料庫：純日期運算（lastMonths／shiftMonth）可在不開資料庫的情況下使用與測試
const db = { prepare: (sql) => require('../models/db').prepare(sql) };

// 實際收款金額與 Payment.calculateActualReceived 一致：只有差異類型為「匯費」才把差異金額算進去
const RECEIVED_EXPR = `(COALESCE(pm.bank_deposit_amount, 0) + CASE WHEN pm.difference_type = '匯費' THEN COALESCE(pm.payment_difference, 0) ELSE 0 END)`;
const INVOICED_EXPR = `(COALESCE(i.amount_with_tax, 0) - COALESCE(i.allowance_amount, 0))`;

function pad2(n) { return String(n).padStart(2, '0'); }
function ymOf(year, month) { return `${year}-${pad2(month)}`; }

// 從 (year, month) 往前推 n 個月（n 可為 0）
function shiftMonth(year, month, n) {
  const idx = year * 12 + (month - 1) - n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// 近 N 個月的 YYYY-MM 清單（舊→新）
function lastMonths(now, count) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const list = [];
  for (let i = count - 1; i >= 0; i--) {
    const s = shiftMonth(y, m, i);
    list.push(ymOf(s.year, s.month));
  }
  return list;
}

function scopeSql({ salespersonId, excludeTypeNames }) {
  let sql = '';
  const params = [];
  if (salespersonId) {
    sql += ' AND p.salesperson_id = ?';
    params.push(salespersonId);
  }
  if (excludeTypeNames && excludeTypeNames.length > 0) {
    sql += ` AND (p.project_type IS NULL OR p.project_type NOT IN (${excludeTypeNames.map(() => '?').join(',')}))`;
    params.push(...excludeTypeNames);
  }
  return { sql, params };
}

const DashboardSummaryService = {
  lastMonths,
  shiftMonth,

  /**
   * 近 N 個月每月開票／收款金額
   * @returns {Array<{ym: string, invoiced: number, received: number}>}
   */
  getMonthlyTrend({ salespersonId = null, excludeTypeNames = null, now = new Date(), months = 12 } = {}) {
    const list = lastMonths(now, months);
    const startYm = list[0];
    const scope = scopeSql({ salespersonId, excludeTypeNames });

    const invoiced = db.prepare(`
      SELECT substr(i.invoice_date, 1, 7) AS ym, COALESCE(SUM(${INVOICED_EXPR}), 0) AS amount
      FROM invoices i JOIN projects p ON i.project_id = p.id
      WHERE (i.status IS NULL OR i.status = '有效') AND i.deleted_at IS NULL
        AND i.invoice_date IS NOT NULL AND substr(i.invoice_date, 1, 7) >= ?${scope.sql}
      GROUP BY ym
    `).all(startYm, ...scope.params);

    const received = db.prepare(`
      SELECT substr(pm.payment_date, 1, 7) AS ym, COALESCE(SUM(${RECEIVED_EXPR}), 0) AS amount
      FROM payments pm JOIN projects p ON pm.project_id = p.id
      WHERE pm.deleted_at IS NULL
        AND pm.payment_date IS NOT NULL AND substr(pm.payment_date, 1, 7) >= ?${scope.sql}
      GROUP BY ym
    `).all(startYm, ...scope.params);

    const invMap = new Map(invoiced.map(r => [r.ym, r.amount]));
    const recMap = new Map(received.map(r => [r.ym, r.amount]));
    return list.map(ym => ({ ym, invoiced: invMap.get(ym) || 0, received: recMap.get(ym) || 0 }));
  },

  /**
   * 本月新簽專案（依簽約年度／月）：件數與含稅金額，另附上月供比較
   */
  getSignedProjects({ salespersonId = null, excludeTypeNames = null, now = new Date() } = {}) {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const prev = shiftMonth(y, m, 1);
    const scope = scopeSql({ salespersonId, excludeTypeNames });
    const stmt = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(p.price_with_tax), 0) AS amount
      FROM projects p
      WHERE p.contract_year = ? AND p.contract_month = ?${scope.sql}
    `);
    const cur = stmt.get(y, m, ...scope.params);
    const last = stmt.get(prev.year, prev.month, ...scope.params);
    return { current: cur, previous: last };
  },

  /**
   * 進行中的銷售機會（狀態不是成交也不是流失）：件數、預估金額、加權金額（預估 × 成交機率），
   * 以及預計本月內成交的件數
   * @param {Object} opts
   * @param {number|null} opts.ownerUserId   限定負責人（業務員角色）；null 為不限制
   * @param {number|null} opts.salespersonId 限定業務（與 ownerUserId 是 OR 關係）
   */
  getOpenPipelines({ ownerUserId = null, salespersonId = null, now = new Date() } = {}) {
    const currentYm = ymOf(now.getFullYear(), now.getMonth() + 1);
    let scopeSqlStr = '';
    const params = [];
    if (ownerUserId || salespersonId) {
      scopeSqlStr = ' AND (p.owner_user_id = ? OR p.salesperson_id = ?)';
      params.push(ownerUserId || -1, salespersonId || -1);
    }
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count,
          COALESCE(SUM(p.estimated_amount), 0) AS estimated,
          COALESCE(SUM(p.estimated_amount * COALESCE(p.win_probability, 0) / 100.0), 0) AS weighted,
          COALESCE(SUM(CASE WHEN p.expected_close_year_month = ? THEN 1 ELSE 0 END), 0) AS closing_this_month
        FROM pipelines p
        WHERE p.deleted_at IS NULL
          AND p.status NOT IN (SELECT status_name FROM pipeline_statuses WHERE is_won = 1 OR is_lost = 1)${scopeSqlStr}
      `).get(currentYm, ...params);
      return row;
    } catch (err) {
      // 舊資料庫沒有 pipelines／pipeline_statuses 時不影響儀表板
      return null;
    }
  },

  /**
   * 組出儀表板「本月概況」需要的全部資料
   */
  getMonthlySummary({ salespersonId = null, excludeTypeNames = null, pipelineScope = undefined, now = new Date() } = {}) {
    const trend = this.getMonthlyTrend({ salespersonId, excludeTypeNames, now });
    const cur = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    const signed = this.getSignedProjects({ salespersonId, excludeTypeNames, now });
    const pipelines = pipelineScope === undefined ? null : this.getOpenPipelines({ ...pipelineScope, now });
    return {
      currentYm: cur.ym,
      previousYm: prev.ym,
      invoiced: { current: cur.invoiced, previous: prev.invoiced },
      received: { current: cur.received, previous: prev.received },
      signed,
      pipelines,
      trend
    };
  }
};

module.exports = DashboardSummaryService;
