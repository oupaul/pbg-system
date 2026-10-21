// 雙因素驗證（TOTP）的資料存取與驗證邏輯。
// 密鑰以 secretBox（AES-256-GCM，金鑰由 SESSION_SECRET 衍生）加密後存入 users.totp_secret；
// 復原碼只存帶金鑰的雜湊，產生時只顯示一次。
const crypto = require('crypto');
const db = require('./db');
const totp = require('../utils/totp');
const secretBox = require('../utils/secretBox');
const AuditLogService = require('../services/AuditLogService');

const RECOVERY_CODE_COUNT = 10;
// 復原碼字母表：去掉容易混淆的 I、O、0、1
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRecoveryCode() {
  const bytes = crypto.randomBytes(10);
  let raw = '';
  for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeRecoveryCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function looksLikeRecoveryCode(input) {
  return /^[A-Z2-9]{10}$/.test(normalizeRecoveryCode(input)) && !/^\d{6}$/.test(String(input || '').replace(/\s+/g, ''));
}

const TwoFactor = {
  RECOVERY_CODE_COUNT,
  normalizeRecoveryCode,
  looksLikeRecoveryCode,

  /** 目前狀態（不含任何密鑰內容） */
  getStatus(userId) {
    const row = db.prepare('SELECT totp_enabled, totp_enabled_at, recovery_codes FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    let remaining = 0;
    try { remaining = row.recovery_codes ? JSON.parse(row.recovery_codes).length : 0; } catch { remaining = 0; }
    return { enabled: !!row.totp_enabled, enabledAt: row.totp_enabled_at, recoveryCodesRemaining: remaining };
  },

  newSecret() {
    return totp.generateSecret();
  },

  /** 以暫存在 session 內（已加密）的密鑰驗證第一次輸入的驗證碼，通過才正式啟用。回傳復原碼（明碼，只這一次）或 null */
  enable(userId, secret, code, nowMs = Date.now()) {
    const step = totp.verifyTotp(secret, code, { nowMs });
    if (step === null) return null;
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
    const hashes = codes.map(c => secretBox.keyedHash(normalizeRecoveryCode(c)));
    db.prepare(`
      UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_last_step = ?, totp_enabled_at = datetime('now', 'localtime'),
        recovery_codes = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(secretBox.encrypt(secret), step, JSON.stringify(hashes), userId);
    return codes;
  },

  /**
   * 驗證登入時（或停用、重新產生復原碼前）輸入的 TOTP 驗證碼。
   * @returns {'ok'|'invalid'|'unavailable'}  unavailable：密鑰無法解開（例如 SESSION_SECRET 已更換），必須由管理員重設
   */
  verifyCode(userId, code, nowMs = Date.now()) {
    const row = db.prepare('SELECT totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?').get(userId);
    if (!row || !row.totp_enabled || !row.totp_secret) return 'invalid';
    let secret;
    try { secret = secretBox.decrypt(row.totp_secret); } catch { return 'unavailable'; }
    const step = totp.verifyTotp(secret, code, { nowMs, lastStep: row.totp_last_step || 0 });
    if (step === null) return 'invalid';
    // 只接受比上次更新的時間步，並以條件式更新確保兩個同時送出的請求只有一個成功（防重放）
    const r = db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, userId, step);
    return r.changes === 1 ? 'ok' : 'invalid';
  },

  /** 使用復原碼（每個只能用一次）。成功回傳剩餘數量，失敗回傳 null */
  useRecoveryCode(userId, input) {
    if (!looksLikeRecoveryCode(input)) return null;
    const hash = secretBox.keyedHash(normalizeRecoveryCode(input));
    const row = db.prepare('SELECT recovery_codes FROM users WHERE id = ? AND totp_enabled = 1').get(userId);
    if (!row || !row.recovery_codes) return null;
    let list;
    try { list = JSON.parse(row.recovery_codes); } catch { return null; }
    // 比較每一個雜湊（不提早結束）
    let idx = -1;
    list.forEach((h, i) => { if (totp.safeEqual(h, hash)) idx = i; });
    if (idx === -1) return null;
    const next = list.filter((_, i) => i !== idx);
    // 條件式更新（內容沒被別的請求改過才成功），避免同一個復原碼被並行使用兩次
    const r = db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ? AND recovery_codes = ?').run(JSON.stringify(next), userId, row.recovery_codes);
    return r.changes === 1 ? next.length : null;
  },

  /** 重新產生一組復原碼（舊的全部失效）；呼叫端必須先驗證過密碼與驗證碼 */
  regenerateRecoveryCodes(userId) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
    const hashes = codes.map(c => secretBox.keyedHash(normalizeRecoveryCode(c)));
    db.prepare("UPDATE users SET recovery_codes = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND totp_enabled = 1").run(JSON.stringify(hashes), userId);
    return codes;
  },

  /** 清除雙因素驗證（本人停用，或管理員/命令列重設） */
  clear(userId) {
    db.prepare(`
      UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, totp_enabled_at = NULL,
        recovery_codes = NULL, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(userId);
  },

  audit(action, userId, userInfo, detail = null) {
    AuditLogService.log(action, 'users', userId, null, detail, userInfo);
  }
};

module.exports = TwoFactor;
