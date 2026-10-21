// 最小的 Cookie 工具（專案沒有用 cookie-parser；session cookie 由 express-session 自己處理）。

/** 解析請求的 Cookie 標頭；重複的名稱以第一個為準，壞掉的編碼略過 */
function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out[name] = decodeURIComponent(value); } catch { /* 編碼壞掉的略過 */ }
  }
  return out;
}

module.exports = { parseCookies };
