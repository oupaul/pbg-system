// 敏感欄位（雙因素驗證密鑰）的加密儲存：AES-256-GCM，金鑰由 SESSION_SECRET 以 HKDF 衍生。
// 目的：資料庫檔案或備份檔外流時，攻擊者光有資料庫還不能產生驗證碼（還需要伺服器上的 SESSION_SECRET）。
// SESSION_SECRET 由 deploy.sh 產生並寫在 systemd unit 中，更新/重新部署時會保留；
// 在「沒有保留 SESSION_SECRET 的新主機」上還原備份後，已加密的密鑰會無法解開，
// 此時相關使用者必須由管理員重設雙因素驗證（見 scripts/reset-2fa.js），系統不會因此放行登入。
const crypto = require('crypto');

const VERSION = 'v1';

function deriveKey(info) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET 未設定，無法加解密敏感欄位');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'pbg-secret-box', info, 32));
}

/** 加密，回傳 "v1.<iv>.<tag>.<密文>"（皆為 base64url） */
function encrypt(plaintext, info = 'totp-secret') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(info), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** 解密；格式不對、金鑰不同或被竄改都會丟出錯誤 */
function decrypt(payload, info = 'totp-secret') {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('加密資料格式不正確');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(info), Buffer.from(parts[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

/** 帶金鑰的雜湊（用於復原碼：資料庫只存雜湊，沒有 SESSION_SECRET 就無法離線猜解） */
function keyedHash(value, info = 'recovery-code') {
  return crypto.createHmac('sha256', deriveKey(info)).update(String(value)).digest('hex');
}

module.exports = { encrypt, decrypt, keyedHash };
