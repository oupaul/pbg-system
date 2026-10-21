// 金額處理：資料庫的金額欄位是 REAL（浮點數），0.1 + 0.2 會得到 0.30000000000000004。
// 為避免「已收齊」被誤判成「未收 $0」、小計差一點點之類的問題：
//   - 寫入前用 toMoney() 轉成最多 2 位小數的數字
//   - 加總、相減後用 round2() 收斂，再拿去比較大於／小於零
// 百分比、機率之類不是金額的欄位不要用這裡的函式。

const round2 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // 先轉成 12 位有效數字再取整，避開 1.005 * 100 = 100.49999999999999 這類邊界誤差
  return Math.round(Number((v * 100).toPrecision(12))) / 100;
};

/** 解析使用者輸入的金額；空白或非數字回傳 fallback（預設 0） */
function toMoney(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const v = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(v) ? round2(v) : fallback;
}

/** 加總一串金額（可傳入取值函式） */
function sumMoney(list, pick = (x) => x) {
  return round2(list.reduce((s, x) => s + (Number(pick(x)) || 0), 0));
}

// 視圖（v_project_summary、v_invoice_summary）在 SQL 裡加減金額，結果會帶浮點誤差。
// 把查詢結果裡「看起來是金額」的數字欄位收斂到 2 位小數（百分比、比率、筆數不動）。
const MONEY_KEY = /(amount|price|invoiced|received|unpaid|cost|profit|discount)/i;
const NOT_MONEY_KEY = /(percent|rate|ratio|margin|count|_id$|^id$)/i;
function roundMoneyFields(row) {
  if (!row || typeof row !== 'object') return row;
  for (const key of Object.keys(row)) {
    if (typeof row[key] === 'number' && MONEY_KEY.test(key) && !NOT_MONEY_KEY.test(key)) row[key] = round2(row[key]);
  }
  return row;
}

module.exports = { round2, toMoney, sumMoney, roundMoneyFields };
