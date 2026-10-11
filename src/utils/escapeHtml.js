// HTML 跳脫（& < > " '）：多數 view 用 template literal 拼 HTML，${...} 不會自動跳脫，
// 輸出使用者可控的資料（客戶/業務/專案名稱、備註、查詢參數等）前必須經過這個函式。
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = escapeHtml;

// 放進「HTML 屬性中、單引號 JS 字串」的值（例如 onclick="fn('${jsAttr(name)}')"）：
// 先做 JS 字串跳脫（\ ' 與換行），再做 HTML 跳脫；瀏覽器解析屬性時會把 HTML 實體還原成
// 已跳脫的 JS 字串，所以不會跳出字串。順序不能顛倒（先 HTML 跳脫會讓 &#39; 還原成裸引號）。
function jsAttr(value) {
  const js = String(value === null || value === undefined ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return escapeHtml(js);
}

module.exports.jsAttr = jsAttr;
