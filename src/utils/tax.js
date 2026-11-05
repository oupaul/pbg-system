// 成本的含稅／未稅換算。
// 規則：成本金額（預估、實際）依「稅別」輸入——含稅（預設）或免稅／未稅（金額原樣當未稅，不換算）。
// 系統一律用未稅金額計算毛利，所以寫入時依「當時」的營業稅率算好未稅金額一起存，
// 之後改稅率不會讓歷史成本的數字跟著變動。
const { round2 } = require('./money');

const DEFAULT_TAX_RATE = 5;

/** 目前的營業稅率（%，系統設定 tax_rate）；讀不到或不合法（不是 0–100 的數字）一律用 5 */
function getTaxRate() {
  try {
    const db = require('../models/db');
    const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'tax_rate'").get();
    const v = row ? Number(row.setting_value) : NaN;
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_TAX_RATE;
  } catch (e) {
    return DEFAULT_TAX_RATE;
  }
}

/** 含稅金額換算成未稅；includesTax 為 false（免稅／未稅）時原金額就是未稅 */
function toExTax(amount, includesTax, ratePercent = DEFAULT_TAX_RATE) {
  const v = Number(amount);
  if (!Number.isFinite(v)) return 0;
  if (!includesTax) return round2(v);
  return round2(v / (1 + Number(ratePercent) / 100));
}

/** 把表單／Excel 的稅別值整理成 1（含稅）或 0（免稅／未稅）；空白＝含稅；認不得的值回傳 null */
function parseTaxIncluded(value) {
  if (value === undefined || value === null) return 1;
  const s = String(value).trim();
  if (s === '' || s === '1' || s === 'true' || s === '含稅') return 1;
  if (s === '0' || s === 'false' || /^(免稅|未稅|零稅率|免稅[\/／]未稅|未稅[\/／]免稅)$/.test(s)) return 0;
  return null;
}

module.exports = { DEFAULT_TAX_RATE, getTaxRate, toExTax, parseTaxIncluded };
