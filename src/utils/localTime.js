// 時間處理。系統裡有兩種時間字串：
//   - 本地時間：SQLite 的 datetime('now', 'localtime')（created_at、updated_at、修改記錄時間…），伺服器所在時區
//   - UTC：程式用 new Date().toISOString() 寫入的 voided_at（自動帶入時）、deleted_at（軟刪除時間）
// 為了不改動既有資料，UTC 欄位維持原樣儲存，只在「顯示」時用 utcToLocal 轉成伺服器本地時間。
// 日期輸入的預設值、逾期天數的「今天」一律用 localDate（不能用 toISOString，台灣 00:00–08:00 會是前一天）。

const pad = (n) => String(n).padStart(2, '0');

/** 伺服器本地的 YYYY-MM-DD */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 伺服器本地的 YYYY-MM-DD HH:MM:SS */
function localDateTime(d = new Date()) {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 以 UTC 儲存的欄位（只有「含時間」的值是自動產生的 UTC；使用者在表單選的作廢日期是純日期，不用轉）
const UTC_STORED_FIELDS = new Set(['voided_at', 'deleted_at']);
const UTC_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** 把 UTC 時間字串（YYYY-MM-DD HH:MM:SS）轉成伺服器本地時間字串；格式不符（含純日期）原樣回傳 */
function utcToLocal(value) {
  if (typeof value !== 'string') return value;
  const m = UTC_DATETIME.exec(value.trim());
  if (!m) return value;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? value : localDateTime(d);
}

/** 依欄位名稱決定顯示值：UTC 儲存的欄位轉本地時間，其他欄位原樣 */
function displayTimeField(field, value) {
  return UTC_STORED_FIELDS.has(field) ? utcToLocal(value) : value;
}

module.exports = { localDate, localDateTime, utcToLocal, displayTimeField, UTC_STORED_FIELDS };
