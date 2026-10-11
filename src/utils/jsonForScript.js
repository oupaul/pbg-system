// 把資料序列化成可以安全嵌入 <script> 區塊或 HTML 屬性（例如 onclick='fn(${...})'）的 JSON。
// 一般 JSON.stringify 不會跳脫 "</script>"、"&"、"'"、U+2028/2029，值裡含這些字元會跳出 script 或屬性而執行任意程式。
function jsonForScript(value) {
  const json = JSON.stringify(value === undefined ? null : value);
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = jsonForScript;
