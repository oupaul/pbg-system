// 只允許站內相對路徑重新導向（防止 open redirect）。
// 拒絕 "//host"、"/\host"（瀏覽器會把反斜線當成斜線）、含控制字元的值，不合格就用 fallback。
function safeRedirect(target, fallback = '/') {
  if (typeof target === 'string' && /^\/(?![\/\\])/.test(target) && !/[\u0000-\u001f]/.test(target)) {
    return target;
  }
  return fallback;
}

module.exports = safeRedirect;
