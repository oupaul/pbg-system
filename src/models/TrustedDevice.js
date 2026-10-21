// 雙因素驗證的「信任此裝置」。
// 裝置憑證是 32 位元組的隨機值，只存在使用者瀏覽器的 HttpOnly cookie；資料庫只存帶金鑰的雜湊。
// 憑證綁定使用者（拿 A 的憑證登入 B 無效）、有固定到期日（不會因使用而延長）。
// 改密碼、停用／重設／重新啟用 2FA、帳號被停用時，該使用者所有信任裝置一律失效（見 revokeAll 的呼叫處）。
const crypto = require('crypto');
const db = require('./db');
const secretBox = require('../utils/secretBox');
const { parseCookies } = require('../utils/cookies');

const COOKIE_NAME = 'pbg_td';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_DEVICES_PER_USER = 10;

const hashToken = (token) => secretBox.keyedHash(token, 'trusted-device');

const TrustedDevice = {
  COOKIE_NAME,
  MAX_DAYS,

  /** 信任天數（系統設定）；0 表示停用。不經快取，每次直接讀。 */
  getTrustDays() {
    try {
      const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'two_factor_trust_days'").get();
      if (!row) return DEFAULT_DAYS;
      const n = parseInt(row.setting_value, 10);
      if (!Number.isInteger(n) || n < 0) return DEFAULT_DAYS;
      return Math.min(n, MAX_DAYS);
    } catch {
      return DEFAULT_DAYS;
    }
  },

  /** 建立信任裝置，回傳 { token, maxAgeMs }；功能停用（0 天）時回傳 null */
  create(userId, { userAgent = '', ip = '' } = {}) {
    const days = this.getTrustDays();
    if (days <= 0) return null;
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("DELETE FROM trusted_devices WHERE expires_at <= datetime('now', 'localtime')").run();
    db.prepare(`
      INSERT INTO trusted_devices (user_id, token_hash, user_agent, ip, expires_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime', ?))
    `).run(userId, hashToken(token), String(userAgent || '').slice(0, 300), String(ip || '').slice(0, 64), `+${days} days`);
    // 每個使用者最多保留最近 10 台，超過的刪掉最舊的
    db.prepare(`
      DELETE FROM trusted_devices WHERE user_id = ? AND id NOT IN (
        SELECT id FROM trusted_devices WHERE user_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(userId, userId, MAX_DEVICES_PER_USER);
    return { token, maxAgeMs: days * 24 * 60 * 60 * 1000 };
  },

  /** 驗證請求帶的憑證是否為該使用者有效的信任裝置；有效時更新最後使用時間並回傳裝置列，否則 null */
  verify(userId, req) {
    if (this.getTrustDays() <= 0) return null;
    const token = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare(`
      SELECT * FROM trusted_devices
      WHERE token_hash = ? AND user_id = ? AND expires_at > datetime('now', 'localtime')
    `).get(hashToken(token), userId);
    if (!row) return null;
    db.prepare("UPDATE trusted_devices SET last_used_at = datetime('now', 'localtime'), ip = ? WHERE id = ?")
      .run(String(req.ip || '').slice(0, 64), row.id);
    return row;
  },

  /** 這個請求帶的憑證對應哪一筆（用於在清單中標出「目前這台」）；不要求有效期內 */
  currentId(userId, req) {
    const token = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare('SELECT id FROM trusted_devices WHERE token_hash = ? AND user_id = ?').get(hashToken(token), userId);
    return row ? row.id : null;
  },

  list(userId) {
    return db.prepare(`
      SELECT id, user_agent, ip, created_at, last_used_at, expires_at
      FROM trusted_devices
      WHERE user_id = ? AND expires_at > datetime('now', 'localtime')
      ORDER BY id DESC
    `).all(userId);
  },

  /** 撤銷單一裝置（必須是該使用者自己的） */
  revoke(userId, id) {
    return db.prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },

  /** 撤銷該使用者全部信任裝置；資料表尚未建立（未跑 migration）時不影響主流程 */
  revokeAll(userId) {
    try {
      return db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId).changes;
    } catch {
      return 0;
    }
  },

  /** 使用者代理字串簡化成「瀏覽器 / 系統」顯示用 */
  describe(userAgent) {
    const ua = String(userAgent || '');
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '瀏覽器';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '未知系統';
    return `${browser} / ${os}`;
  }
};

module.exports = TrustedDevice;
