// 帳號安全：雙因素驗證（TOTP）的啟用、停用與復原碼管理。掛載在 /account，需要登入。
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const User = require('../models/User');
const Role = require('../models/Role');
const TwoFactor = require('../models/TwoFactor');
const TrustedDevice = require('../models/TrustedDevice');
const totp = require('../utils/totp');
const secretBox = require('../utils/secretBox');
const { getUserInfo } = require('../utils/authHelper');
const { twoFactorLockedMinutes, recordTwoFactorFailure, clearTwoFactorFailures } = require('../middleware/rateLimiter');

const SETUP_TTL_MS = 10 * 60 * 1000;

// 驗證器 App 裡顯示的發行者名稱（網站名稱；沒設定時用預設）
function siteName() {
  try { return require('../config/deploy').siteName || '業績獎金系統'; } catch { return '業績獎金系統'; }
}

function roleRequires2fa(roleKey) {
  const role = Role.findByKey(roleKey);
  return !!(role && role.require_2fa);
}

const securityUrl = (query) => '/account/security' + (query ? `?${query}` : '');
const redirectWithError = (res, message, base = securityUrl()) => res.redirect(`${base}${base.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);

// 停用、重新產生復原碼前的身分確認：目前密碼 ＋ 驗證碼（或復原碼）。失敗次數與登入的驗證碼共用鎖定。
async function confirmIdentity(req) {
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return { ok: false, message: '找不到使用者' };
  const locked = twoFactorLockedMinutes(user.username);
  if (locked > 0) return { ok: false, message: `驗證失敗次數過多，已暫時鎖定，請 ${locked} 分鐘後再試` };

  const password = String(req.body.password || '');
  const code = String(req.body.code || '').trim();
  const passwordOk = password ? await User.verifyPassword(password, user.password_hash) : false;
  let codeOk = false;
  if (passwordOk) {
    if (TwoFactor.looksLikeRecoveryCode(code)) codeOk = TwoFactor.useRecoveryCode(user.id, code) !== null;
    else codeOk = TwoFactor.verifyCode(user.id, code) === 'ok';
  }
  if (!passwordOk || !codeOk) {
    recordTwoFactorFailure(user.username);
    return { ok: false, message: '密碼或驗證碼錯誤' };
  }
  clearTwoFactorFailures(user.username);
  return { ok: true, user };
}

// 帳號安全總覽
router.get('/security', (req, res) => {
  const status = TwoFactor.getStatus(req.user.id) || { enabled: false, recoveryCodesRemaining: 0 };
  res.set('Cache-Control', 'no-store');
  res.render('account/security', {
    title: '帳號安全',
    status,
    required: roleRequires2fa(req.user.role),
    trustDays: TrustedDevice.getTrustDays(),
    devices: TrustedDevice.list(req.user.id).map(d => ({ ...d, label: TrustedDevice.describe(d.user_agent) })),
    currentDeviceId: TrustedDevice.currentId(req.user.id, req),
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 啟用：顯示 QR code 與密鑰（密鑰暫存在 session，已加密；通過第一次驗證碼才寫入資料庫）
router.get('/security/2fa/setup', (req, res) => {
  const status = TwoFactor.getStatus(req.user.id);
  if (status && status.enabled) return res.redirect(securityUrl());

  let secret = null;
  const pending = req.session.twoFactorSetup;
  if (pending && pending.expiresAt > Date.now()) {
    try { secret = secretBox.decrypt(pending.enc); } catch { secret = null; }
  }
  if (!secret) {
    secret = TwoFactor.newSecret();
    req.session.twoFactorSetup = { enc: secretBox.encrypt(secret), expiresAt: Date.now() + SETUP_TTL_MS };
  }
  const otpauth = totp.otpauthUri({ secret, account: req.user.username, issuer: siteName() });
  res.set('Cache-Control', 'no-store');
  res.render('account/two-factor-setup', {
    title: '啟用雙因素驗證',
    secret,
    secretGrouped: secret.match(/.{1,4}/g).join(' '),
    otpauth,
    forced: !!req.user.must_setup_2fa,
    error: req.query.error || ''
  });
});

router.post('/security/2fa/enable', async (req, res) => {
  const setupUrl = '/account/security/2fa/setup';
  const user = db.prepare('SELECT username, name FROM users WHERE id = ?').get(req.user.id);
  const locked = twoFactorLockedMinutes(user.username);
  if (locked > 0) return redirectWithError(res, `驗證失敗次數過多，已暫時鎖定，請 ${locked} 分鐘後再試`, setupUrl);

  const pending = req.session.twoFactorSetup;
  let secret = null;
  if (pending && pending.expiresAt > Date.now()) {
    try { secret = secretBox.decrypt(pending.enc); } catch { secret = null; }
  }
  if (!secret) return redirectWithError(res, '設定已逾時，請重新開始', setupUrl);

  const codes = TwoFactor.enable(req.user.id, secret, req.body.code);
  if (!codes) {
    recordTwoFactorFailure(user.username);
    return redirectWithError(res, '驗證碼不正確，請確認手機上的驗證器顯示的是這個帳號的最新驗證碼', setupUrl);
  }
  clearTwoFactorFailures(user.username);
  delete req.session.twoFactorSetup;
  TwoFactor.audit('2fa_enabled', req.user.id, getUserInfo(req));
  // 復原碼只在這個回應顯示一次（不放在網址或 session）
  res.set('Cache-Control', 'no-store');
  res.render('account/recovery-codes', { title: '復原碼', codes, firstTime: true });
});

// 停用（角色強制要求時不可停用）
router.post('/security/2fa/disable', async (req, res) => {
  if (roleRequires2fa(req.user.role)) return redirectWithError(res, '您的角色要求啟用雙因素驗證，無法停用');
  const check = await confirmIdentity(req);
  if (!check.ok) return redirectWithError(res, check.message);
  TwoFactor.clear(req.user.id);
  TwoFactor.audit('2fa_disabled', req.user.id, getUserInfo(req));
  res.redirect(securityUrl('success=' + encodeURIComponent('已停用雙因素驗證')));
});

// 重新產生復原碼（舊的全部失效）
router.post('/security/2fa/recovery-codes', async (req, res) => {
  const check = await confirmIdentity(req);
  if (!check.ok) return redirectWithError(res, check.message);
  const codes = TwoFactor.regenerateRecoveryCodes(req.user.id);
  TwoFactor.audit('2fa_recovery_codes_regenerated', req.user.id, getUserInfo(req));
  res.set('Cache-Control', 'no-store');
  res.render('account/recovery-codes', { title: '復原碼', codes, firstTime: false });
});

// 撤銷單一信任裝置（必須是自己的）；撤銷的是目前這台時一併清掉 cookie
router.post('/security/devices/:id/revoke', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return redirectWithError(res, '無效的裝置');
  const id = parseInt(req.params.id, 10);
  const isCurrent = TrustedDevice.currentId(req.user.id, req) === id;
  if (!TrustedDevice.revoke(req.user.id, id)) return redirectWithError(res, '找不到這台裝置');
  if (isCurrent) res.clearCookie(TrustedDevice.COOKIE_NAME, { path: '/' });
  TwoFactor.audit('2fa_device_revoked', req.user.id, getUserInfo(req), { device_id: id });
  res.redirect(securityUrl('success=' + encodeURIComponent('已撤銷這台裝置的信任')));
});

// 撤銷全部信任裝置
router.post('/security/devices/revoke-all', (req, res) => {
  const count = TrustedDevice.revokeAll(req.user.id);
  res.clearCookie(TrustedDevice.COOKIE_NAME, { path: '/' });
  TwoFactor.audit('2fa_devices_revoked_all', req.user.id, getUserInfo(req), { count });
  res.redirect(securityUrl('success=' + encodeURIComponent(`已撤銷全部信任裝置（${count} 台）`)));
});

module.exports = router;
