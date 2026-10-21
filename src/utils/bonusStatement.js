// 獎金對帳單的純邏輯（不碰資料庫）：期間解析、依狀態與日期分組、合計、對帳單編號、檔名。
//
// 分組規則（也印在對帳單的說明裡）：
//   本期已發放：狀態「已發放」且發放日在期間內
//   本期充公：  狀態「充公」且（發放日，沒有發放日時用最後更新日）在期間內
//   待發放：    狀態「待發放」的全部獎金，不受期間限制（發放前讓業務確認「還有哪些沒發」）
// 其餘（其他期間已發放/充公的）不列入這份對帳單。

const PERIOD_LABELS = { year: '全年' };

function pad2(n) { return String(n).padStart(2, '0'); }

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * @param {number|string} year
 * @param {string} period  'year' | 'q1'..'q4' | 'm1'..'m12'
 * @returns {{code: string, label: string, start: string, end: string}|null}  不合法回傳 null
 */
function resolvePeriod(year, period = 'year') {
  const y = parseInt(year, 10);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  const p = String(period || 'year').toLowerCase();
  if (p === 'year') return { code: `${y}`, label: `${y} 年度（全年）`, start: `${y}-01-01`, end: `${y}-12-31` };
  let m = /^q([1-4])$/.exec(p);
  if (m) {
    const q = parseInt(m[1], 10);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return { code: `${y}Q${q}`, label: `${y} 年第 ${q} 季（${startMonth}～${endMonth} 月）`, start: `${y}-${pad2(startMonth)}-01`, end: `${y}-${pad2(endMonth)}-${pad2(lastDayOfMonth(y, endMonth))}` };
  }
  m = /^m(\d{1,2})$/.exec(p);
  if (m) {
    const month = parseInt(m[1], 10);
    if (month < 1 || month > 12) return null;
    return { code: `${y}${pad2(month)}`, label: `${y} 年 ${month} 月`, start: `${y}-${pad2(month)}-01`, end: `${y}-${pad2(month)}-${pad2(lastDayOfMonth(y, month))}` };
  }
  return null;
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
const inRange = (date, start, end) => !!date && date >= start && date <= end;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 把某位業務的全部獎金分成「本期已發放／待發放／本期充公」三組，並排序 */
function partitionBonuses(rows, period) {
  const paid = [];
  const pending = [];
  const forfeited = [];
  for (const r of rows) {
    if (r.status === '已發放' && inRange(dateOnly(r.payment_date), period.start, period.end)) paid.push(r);
    else if (r.status === '待發放') pending.push(r);
    else if (r.status === '充公' && inRange(dateOnly(r.payment_date) || dateOnly(r.updated_at), period.start, period.end)) forfeited.push(r);
  }
  const byDateThenProject = (a, b) =>
    (dateOnly(a.payment_date) || '9999').localeCompare(dateOnly(b.payment_date) || '9999') ||
    String(a.project_code || '').localeCompare(String(b.project_code || '')) ||
    String(a.bonus_type || '').localeCompare(String(b.bonus_type || ''));
  paid.sort(byDateThenProject);
  forfeited.sort(byDateThenProject);
  pending.sort((a, b) => String(a.project_code || '').localeCompare(String(b.project_code || '')) || String(a.bonus_type || '').localeCompare(String(b.bonus_type || '')));
  return { paid, pending, forfeited };
}

function sumAmount(list) {
  return round2(list.reduce((s, r) => s + (Number(r.bonus_amount) || 0), 0));
}

function totalsOf(groups) {
  return { paid: sumAmount(groups.paid), pending: sumAmount(groups.pending), forfeited: sumAmount(groups.forfeited) };
}

/** 對帳單編號：BS-<業務ID>-<期間代碼>-<產出時間>，同一份資料在不同時間產出會有不同編號（對帳時可追溯是哪一版） */
function statementId({ salespersonId, periodCode, now = new Date() }) {
  const d = now;
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `BS-${salespersonId}-${periodCode}-${stamp}`;
}

/** 下載檔名：移除檔案系統不允許與容易出問題的字元 */
function statementFileName(salespersonName, periodCode) {
  const safe = String(salespersonName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').slice(0, 40) || '業務';
  return `獎金對帳單_${safe}_${periodCode}.pdf`;
}

module.exports = { resolvePeriod, partitionBonuses, totalsOf, sumAmount, statementId, statementFileName, round2, dateOnly, PERIOD_LABELS };
