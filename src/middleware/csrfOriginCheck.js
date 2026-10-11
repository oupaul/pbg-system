// CSRF 防護：驗證改變資料的請求（POST/PUT/PATCH/DELETE）來自本站。
// 瀏覽器對跨站的 POST 一律帶 Origin（或至少帶 Referer）標頭，且網頁腳本無法偽造；
// 比對失敗就拒絕。搭配 session cookie 的 SameSite=Lax 形成雙重防護，而且不用修改每一個表單。
//
// 允許的來源：請求的 Host（含反向代理轉送的 X-Forwarded-Host）、系統設定的 system_base_url、
// 環境變數 ALLOWED_ORIGINS（逗號分隔的完整網址）。Origin 與 Referer 都沒帶時放行（非瀏覽器客戶端，
// 例如指令列工具；瀏覽器的跨站 POST 一定會帶其中之一）。
// LINE Webhook 由平台呼叫、已有簽章驗證，不在檢查範圍。
// 緊急關閉：環境變數 CSRF_ORIGIN_CHECK=off。
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PREFIXES = ['/webhooks/line'];

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

function allowedHosts(req) {
  const hosts = new Set();
  const add = (h) => { if (h) hosts.add(String(h).split(',')[0].trim().toLowerCase()); };
  add(req.get('host'));
  add(req.get('x-forwarded-host'));
  try {
    const db = require('../models/db');
    const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'system_base_url'").get();
    if (row && row.setting_value) add(hostOf(row.setting_value));
  } catch { /* 忽略 */ }
  (process.env.ALLOWED_ORIGINS || '').split(',').forEach(o => add(hostOf(o.trim())));
  return hosts;
}

function csrfOriginCheck(req, res, next) {
  if (process.env.CSRF_ORIGIN_CHECK === 'off') return next();
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  let sourceHost = null;
  if (origin !== undefined) {
    sourceHost = origin === 'null' ? '' : hostOf(origin);   // Origin: null（沙盒 iframe、跨站轉址）一律視為不可信
  } else if (referer) {
    sourceHost = hostOf(referer);
  } else {
    return next();
  }

  if (sourceHost && allowedHosts(req).has(sourceHost)) return next();

  console.warn('[CSRF] 拒絕來源不符的請求:', req.method, req.originalUrl, 'origin=', origin, 'referer=', referer);
  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '請求被拒絕', message: '請求來源不符，已拒絕（可能是跨站請求）。請回到系統頁面重新操作。', error: {} });
  }
  return res.status(403).json({ error: '請求來源不符' });
}

module.exports = csrfOriginCheck;
