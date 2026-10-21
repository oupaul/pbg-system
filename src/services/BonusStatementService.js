// 獎金對帳單：取出單一業務在某期間的獎金，分成「本期已發放／待發放／本期充公」後輸出 PDF。
// 分組規則與純邏輯在 utils/bonusStatement.js，版面在 utils/bonusStatementPdf.js。
const db = require('../models/db');
const Salesperson = require('../models/Salesperson');
const { resolvePeriod, partitionBonuses, totalsOf, statementId, statementFileName } = require('../utils/bonusStatement');
const { renderStatementPdf } = require('../utils/bonusStatementPdf');

function getSetting(key, fallback) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row && row.setting_value ? row.setting_value : fallback;
  } catch {
    return fallback;
  }
}

function formatDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const BonusStatementService = {
  /**
   * @param {Object} opts
   * @param {number} opts.salespersonId
   * @param {number|string} opts.year
   * @param {string} opts.period   'year' | 'q1'..'q4' | 'm1'..'m12'
   * @param {string} opts.generatedBy  產出人名稱
   * @param {Date} [opts.now]
   * @returns {Promise<{buffer: Buffer, fileName: string, statementId: string, counts: Object, totals: Object}|null>}
   *          業務或期間不存在／不合法時回傳 null
   */
  async generate({ salespersonId, year, period, generatedBy, now = new Date() }) {
    const salesperson = Salesperson.findById(salespersonId);
    const range = resolvePeriod(year, period);
    if (!salesperson || !range) return null;

    const rows = db.prepare(`
      SELECT b.id, b.project_id, b.bonus_type, b.base_amount, b.bonus_percentage, b.bonus_amount,
             b.payment_date, b.status, b.forfeiture_reason, b.updated_at,
             p.project_code, p.project_name, c.company_name AS customer_name
      FROM bonus_calculations b
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN customers c ON p.customer_id = c.id
      WHERE b.salesperson_id = ?
    `).all(salesperson.id);

    const groups = partitionBonuses(rows, range);
    const totals = totalsOf(groups);
    const id = statementId({ salespersonId: salesperson.id, periodCode: range.code, now });
    const { getChineseFontPath, formatROCDate } = require('./PdfExportService').helpers;

    const buffer = await renderStatementPdf({
      company: getSetting('company_name', ''),
      salespersonName: salesperson.name,
      periodLabel: range.label,
      statementId: id,
      generatedAt: formatDateTime(now),
      generatedBy: generatedBy || '',
      groups,
      totals
    }, {
      fontPath: getChineseFontPath(),
      symbol: getSetting('currency_symbol', '$'),
      formatDate: formatROCDate
    });

    return {
      buffer,
      fileName: statementFileName(salesperson.name, range.code),
      statementId: id,
      salesperson,
      period: range,
      counts: { paid: groups.paid.length, pending: groups.pending.length, forfeited: groups.forfeited.length },
      totals
    };
  }
};

module.exports = BonusStatementService;
