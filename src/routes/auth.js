const express = require('express');
const router = express.Router();
const User = require('../models/User');
const LoginHistory = require('../models/LoginHistory');
const GeoIpService = require('../services/GeoIpService');
const AuditLogService = require('../services/AuditLogService');
const { getUserInfo } = require('../utils/authHelper');
const { loginRateLimiter, resetOnSuccess, accountLockedMinutes, recordAccountFailure, clearAccountFailures, twoFactorLockedMinutes, recordTwoFactorFailure, clearTwoFactorFailures } = require('../middleware/rateLimiter');
const { passwordFingerprint } = require('../middleware/auth');
const TwoFactor = require('../models/TwoFactor');

// 帳號不存在時也做一次等量的雜湊運算，避免從回應時間差判斷帳號是否存在
let dummyHashPromise = null;
function burnPasswordCheck(password) {
  if (!dummyHashPromise) dummyHashPromise = User.hashPassword('timing-equalizer-not-a-real-password');
  return dummyHashPromise.then(hash => User.verifyPassword(password, hash)).catch(() => false);
}
const LOGIN_FAIL_MESSAGE = '帳號或密碼錯誤';
const PASSWORD_MIN_LENGTH = 10;

// 只允許相對路徑重新導向，防止 open redirect
function safeRedirect(redirect) {
  if (typeof redirect === 'string' && /^\/(?![\/\\])/.test(redirect) && !/[\u0000-\u001f]/.test(redirect)) return redirect;
  return '/';
}

// 登入頁面
router.get('/login', (req, res, next) => {
  try {
    console.log('[登入] GET /login 請求');
    console.log('[登入] Session:', req.session ? '存在' : '不存在');
    console.log('[登入] User:', req.session?.user ? '已登入' : '未登入');
    console.log('[登入] Query:', req.query);
    
    // 如果已經登入，重定向到首頁或原始請求的頁面
    if (req.session && req.session.user) {
      const redirect = safeRedirect(req.query.redirect);
      console.log('[登入] 已登入，重定向到:', redirect);
      return res.redirect(redirect);
    }
    
    const loginData = {
      title: '登入',
      error: req.query.error || '',
      redirect: req.query.redirect || '/'
    };
    console.log('[登入] 準備渲染登入頁面，資料:', loginData);
    console.log('[登入] 模板路徑: auth/login');
    
    try {
      res.render('auth/login', loginData);
      console.log('[登入] 登入頁面渲染完成');
    } catch (renderErr) {
      console.error('[登入錯誤] 渲染時發生錯誤:', renderErr.message);
      console.error('[登入錯誤] 錯誤堆疊:', renderErr.stack);
      throw renderErr;
    }
  } catch (err) {
    console.error('[登入錯誤] 渲染登入頁面時發生錯誤:', err);
    console.error('[登入錯誤] 錯誤堆疊:', err.stack);
    next(err);
  }
});

// 處理登入
router.post('/login', loginRateLimiter, async (req, res) => {
  console.log('[登入] POST /login 請求');
  console.log('[登入] Request body:', { username: req.body.username, password: '[已隱藏]', redirect: req.body.redirect });
  console.log('[登入] Session ID:', req.sessionID);
  
  const { username, password } = req.body;
  const redirect = safeRedirect(req.body.redirect);

  if (!username || !password) {
    console.log('[登入] 驗證失敗: 帳號或密碼為空');
    return res.redirect(`/login?error=${encodeURIComponent('請輸入帳號和密碼')}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 帳號層級的失敗鎖定（連續失敗多次後暫時鎖定，不論帳號是否存在）
  const lockedMinutes = accountLockedMinutes(username);
  if (lockedMinutes > 0) {
    return res.redirect(`/login?error=${encodeURIComponent(`登入失敗次數過多，此帳號已暫時鎖定，請 ${lockedMinutes} 分鐘後再試`)}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 查找用戶
  const user = User.findByUsername(username);
  
  if (!user) {
    await burnPasswordCheck(password);
    recordAccountFailure(username);
    return res.redirect(`/login?error=${encodeURIComponent(LOGIN_FAIL_MESSAGE)}&redirect=${encodeURIComponent(redirect)}`);
  }

  console.log('[登入] 用戶找到，ID:', user.id, '啟用狀態:', user.is_active);

  // 驗證密碼
  const passwordValid = await User.verifyPassword(password, user.password_hash);
  console.log('[登入] 密碼驗證結果:', passwordValid);
  
  if (!passwordValid) {
    console.log('[登入] 密碼驗證失敗');
    recordAccountFailure(username);
    return res.redirect(`/login?error=${encodeURIComponent(LOGIN_FAIL_MESSAGE)}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 檢查帳號是否啟用
  if (!user.is_active) {
    console.log('[登入] 帳號已被停用');
    return res.redirect(`/login?error=${encodeURIComponent('帳號已被停用')}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 密碼驗證通過 — 清除速率限制計數
  resetOnSuccess(req.ip || req.connection.remoteAddress || 'unknown');
  clearAccountFailures(username);

  // 如果密碼是舊的 SHA256 格式，自動升級為 argon2id（要在建立 session 前完成，session 內的密碼指紋才會是最終版本）
  const isOldSHA256 = user.password_hash && user.password_hash.length === 64 && /^[a-f0-9]{64}$/i.test(user.password_hash);

  if (isOldSHA256) {
    console.log('[登入] 檢測到舊的 SHA256 密碼格式，正在升級為 argon2id...');
    try {
      await User.updatePassword(user.id, password);
      console.log(`[登入] 密碼已成功升級為 argon2id`);
    } catch (err) {
      console.error('[登入] 密碼升級失敗:', err);
      // 不影響登入流程，繼續執行
    }
  }

  // 已啟用雙因素驗證：密碼通過還不算登入成功，建立「等待第二步驗證」的暫時狀態（沒有 session.user，
  // 所以任何需要登入的頁面都進不去），驗證碼通過後才完成登入
  if (user.totp_enabled) {
    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[登入] 重新產生 session 失敗:', regenErr);
        return res.redirect(`/login?error=${encodeURIComponent('登入失敗，請稍後再試')}`);
      }
      req.session.pending2fa = { userId: user.id, redirect, expiresAt: Date.now() + PENDING_2FA_TTL_MS };
      req.session.save(() => res.redirect('/login/2fa'));
    });
  }

  return finishLogin(req, res, user, redirect);
});

// 登入的最後一步：記錄登入紀錄、換發新的 session 並寫入使用者資料
async function finishLogin(req, res, user, redirect) {
  // 記錄登入紀錄（失敗不影響登入流程本身）
  try {
    const loginIp = req.ip || req.connection.remoteAddress || 'unknown';
    const countryCode = await GeoIpService.lookupCountryCode(loginIp);
    LoginHistory.record(user.id, loginIp, req.get('User-Agent'), countryCode);
  } catch (err) {
    console.error('[登入] 記錄登入紀錄失敗:', err);
  }

  // 獲取完整的用戶資訊（包含 salesperson_id）與最新的密碼雜湊（用來產生 session 的密碼指紋）
  const fullUser = User.findById(user.id);
  const freshHash = require('../models/db').prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);

  // 登入成功：換發新的 session ID（防止 session fixation），再寫入使用者資料
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      console.error('[登入] 重新產生 session 失敗:', regenErr);
      return res.redirect(`/login?error=${encodeURIComponent('登入失敗，請稍後再試')}`);
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      salesperson_id: fullUser?.salesperson_id || null,
      must_change_password: !!fullUser?.must_change_password,
      pwv: passwordFingerprint(freshHash ? freshHash.password_hash : user.password_hash)
    };
    req.session.lastActivity = Date.now();

    // 更新最後登入時間
    User.updateLastLogin(user.id);

    // 確保 session 已寫入再導向（已驗證為站內相對路徑）
    req.session.save(() => res.redirect(redirect));
  });
}

// ---- 第二步：雙因素驗證碼 ----
const PENDING_2FA_TTL_MS = 5 * 60 * 1000;

function getPending2fa(req) {
  const pending = req.session && req.session.pending2fa;
  if (!pending || !pending.userId || pending.expiresAt < Date.now()) return null;
  return pending;
}

router.get('/login/2fa', (req, res) => {
  if (!getPending2fa(req)) {
    return res.redirect(`/login?error=${encodeURIComponent('登入已逾時，請重新輸入帳號密碼')}`);
  }
  res.set('Cache-Control', 'no-store');
  res.render('auth/two-factor', { title: '雙因素驗證', error: req.query.error || '' });
});

router.post('/login/2fa', loginRateLimiter, async (req, res) => {
  const pending = getPending2fa(req);
  const backToLogin = (message) => req.session.destroy(() => res.redirect(`/login?error=${encodeURIComponent(message)}`));
  if (!pending) return backToLogin('登入已逾時，請重新輸入帳號密碼');

  const db = require('../models/db');
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(pending.userId);
  if (!user || !user.totp_enabled) return backToLogin('登入已逾時，請重新輸入帳號密碼');

  // 驗證碼的失敗次數另外計算（與密碼失敗分開），連續失敗會暫時鎖定，避免有人拿到密碼後暴力猜驗證碼
  const lockKey = user.username;
  const locked = twoFactorLockedMinutes(lockKey);
  if (locked > 0) return backToLogin(`驗證失敗次數過多，此帳號已暫時鎖定，請 ${locked} 分鐘後再試`);

  const input = String(req.body.code || '').trim();
  let result = 'invalid';
  let usedRecoveryCode = false;
  if (TwoFactor.looksLikeRecoveryCode(input)) {
    if (TwoFactor.useRecoveryCode(user.id, input) !== null) { result = 'ok'; usedRecoveryCode = true; }
  } else {
    result = TwoFactor.verifyCode(user.id, input);
  }

  if (result === 'unavailable') {
    console.error(`[登入] 使用者 ${user.username} 的雙因素驗證密鑰無法解開（SESSION_SECRET 可能已更換），已拒絕登入，需由管理員重設`);
    return backToLogin('雙因素驗證設定無法使用，請聯絡管理員重設');
  }
  if (result !== 'ok') {
    recordTwoFactorFailure(lockKey);
    return res.redirect(`/login/2fa?error=${encodeURIComponent('驗證碼錯誤，請重新輸入')}`);
  }

  clearTwoFactorFailures(lockKey);
  if (usedRecoveryCode) {
    TwoFactor.audit('2fa_recovery_code_used', user.id, user.name || user.username, { remaining: (TwoFactor.getStatus(user.id) || {}).recoveryCodesRemaining });
  }
  return finishLogin(req, res, user, pending.redirect);
});

// 登出
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('登出時發生錯誤:', err);
    }
    res.redirect('/login');
  });
});

// 登出只接受 POST（GET 登出可被任意網頁用 <img src="/logout"> 強迫登出）；GET 一律導回首頁
router.get('/logout', (req, res) => {
  res.redirect('/');
});

// 修改密碼頁面（需要登入）
router.get('/change-password', require('../middleware/auth').requireAuth, (req, res) => {
  res.render('auth/change-password', {
    title: '修改密碼',
    error: req.query.error || '',
    success: req.query.success || '',
    forced: !!req.session.user?.must_change_password
  });
});

// 處理修改密碼（需要登入）
router.post('/change-password', require('../middleware/auth').requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.session.user.id;

  // 驗證輸入
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.redirect('/change-password?error=' + encodeURIComponent('請填寫所有欄位'));
  }

  if (newPassword !== confirmPassword) {
    return res.redirect('/change-password?error=' + encodeURIComponent('新密碼與確認密碼不一致'));
  }

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.redirect('/change-password?error=' + encodeURIComponent(`新密碼長度至少需要 ${PASSWORD_MIN_LENGTH} 個字元`));
  }

  // 取得當前用戶（使用原始查詢，不檢查 is_active）
  const db = require('../models/db');
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user) {
    return res.redirect('/change-password?error=' + encodeURIComponent('找不到用戶'));
  }

  // 驗證當前密碼
  const passwordValid = await User.verifyPassword(currentPassword, user.password_hash);
  if (!passwordValid) {
    return res.redirect('/change-password?error=' + encodeURIComponent('當前密碼錯誤'));
  }

  // 更新密碼
  try {
    console.log(`[修改密碼] 用戶 ID: ${userId}, 準備更新密碼`);
    
    // 取得舊值用於審計日誌
    const oldUser = db.prepare(`SELECT id, username, name FROM users WHERE id = ?`).get(userId);
    
    const success = await User.updatePassword(userId, newPassword);
    console.log(`[修改密碼] 更新結果: ${success}`);

    if (success) {
      // 清除強制變更密碼旗標（若有的話），避免改完密碼還被導回這頁
      User.clearMustChangePassword(userId);
      if (req.session.user) {
        req.session.user.must_change_password = false;
        // 密碼雜湊已變，更新本 session 的密碼指紋（其他裝置的舊 session 會因指紋不符而失效）
        const updated = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
        if (updated) req.session.user.pwv = passwordFingerprint(updated.password_hash);
      }

      // 記錄密碼變更到審計日誌
      if (oldUser) {
        AuditLogService.logUpdate('users', userId,
          { password: '[舊密碼]' },
          { password: '[已更新]' },
          getUserInfo(req));
      }

      res.redirect('/change-password?success=' + encodeURIComponent('密碼修改成功'));
    } else {
      // 如果 changes 為 0，可能是用戶不存在或 ID 不匹配
      console.error(`[修改密碼] 更新失敗，用戶 ID: ${userId}`);
      res.redirect('/change-password?error=' + encodeURIComponent('密碼修改失敗，請確認用戶 ID 是否正確'));
    }
  } catch (err) {
    console.error('[修改密碼] 錯誤:', err);
    console.error('[修改密碼] 錯誤堆疊:', err.stack);
    res.redirect('/change-password?error=' + encodeURIComponent('密碼修改失敗：' + (err.message || '未知錯誤')));
  }
});

module.exports = router;

