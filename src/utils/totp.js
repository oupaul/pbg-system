// TOTP（RFC 6238）與 HOTP（RFC 4226）：只用 Node 內建的 crypto，不加任何依賴。
// 預設參數與 Google Authenticator、Microsoft Authenticator、1Password 等相容：SHA-1、6 位數、30 秒一個時間步。
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('不是有效的 Base32 字串');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 產生新的密鑰（20 位元組 = 160 位元，RFC 4226 建議長度），以 Base32 表示 */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32, counter, digits = DIGITS) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % Math.pow(10, digits)).padStart(digits, '0');
}

function timeStep(nowMs = Date.now(), period = PERIOD_SECONDS) {
  return Math.floor(nowMs / 1000 / period);
}

function totp(secretBase32, nowMs = Date.now(), { period = PERIOD_SECONDS, digits = DIGITS } = {}) {
  return hotp(secretBase32, timeStep(nowMs, period), digits);
}

// 以固定時間比較兩個字串，避免從回應時間差猜出驗證碼
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 驗證使用者輸入的驗證碼。
 * @param {string} secretBase32
 * @param {string} code      使用者輸入（會去掉空白）
 * @param {Object} [opts]
 * @param {number} [opts.nowMs]
 * @param {number} [opts.window=1]    容許前後各幾個時間步（處理手機與伺服器時鐘的小誤差）
 * @param {number} [opts.lastStep=0]  這個帳號上一次成功驗證的時間步；只接受比它更新的步（防止同一組驗證碼被重複使用）
 * @returns {number|null} 命中的時間步（呼叫端要記錄下來當作新的 lastStep）；驗證失敗回傳 null
 */
function verifyTotp(secretBase32, code, { nowMs = Date.now(), window = 1, lastStep = 0 } = {}) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = timeStep(nowMs);
  let matched = null;
  // 每個時間步都要比較（不提早結束），固定執行時間
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step <= 0) continue;
    if (safeEqual(hotp(secretBase32, step), clean) && step > lastStep) {
      if (matched === null || step > matched) matched = step;
    }
  }
  return matched;
}

/** 提供給驗證器 App 的 otpauth 網址（掃描 QR code 或手動匯入） */
function otpauthUri({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, timeStep, verifyTotp, otpauthUri, safeEqual, PERIOD_SECONDS, DIGITS };
