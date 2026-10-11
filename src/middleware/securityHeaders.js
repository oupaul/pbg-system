// 基本安全標頭（不使用 helmet，避免新增依賴）。
// 暫不設定 Content-Security-Policy：現有頁面大量使用 inline script/onclick，貿然加 CSP 會讓功能失效，
// 待逐步移除 inline 程式後再以 report-only 方式導入。
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');           // 禁止瀏覽器猜測內容類型
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');               // 防止被其他網站以 iframe 嵌入（點擊劫持）
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // 只在 HTTPS 連線（經 Nginx 並設定 trust proxy 後 req.secure 才會為 true）時送 HSTS
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

module.exports = securityHeaders;
