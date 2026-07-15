const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuditLogService = require('../services/AuditLogService');
const { getUserInfo } = require('../utils/authHelper');
const { loginRateLimiter, resetOnSuccess } = require('../middleware/rateLimiter');

// 只允許相對路徑重新導向，防止 open redirect
function safeRedirect(redirect) {
  if (typeof redirect === 'string' && /^\/(?!\/)/.test(redirect)) return redirect;
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

  // 查找用戶
  console.log('[登入] 查找用戶:', username);
  const user = User.findByUsername(username);
  
  if (!user) {
    console.log('[登入] 用戶不存在:', username);
    return res.redirect(`/login?error=${encodeURIComponent('帳號或密碼錯誤')}&redirect=${encodeURIComponent(redirect)}`);
  }

  console.log('[登入] 用戶找到，ID:', user.id, '啟用狀態:', user.is_active);

  // 驗證密碼
  const passwordValid = await User.verifyPassword(password, user.password_hash);
  console.log('[登入] 密碼驗證結果:', passwordValid);
  
  if (!passwordValid) {
    console.log('[登入] 密碼驗證失敗');
    return res.redirect(`/login?error=${encodeURIComponent('帳號或密碼錯誤')}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 檢查帳號是否啟用
  if (!user.is_active) {
    console.log('[登入] 帳號已被停用');
    return res.redirect(`/login?error=${encodeURIComponent('帳號已被停用')}&redirect=${encodeURIComponent(redirect)}`);
  }

  // 登入成功 — 清除速率限制計數
  resetOnSuccess(req.ip || req.connection.remoteAddress || 'unknown');

  // 登入成功，設置 session
  console.log('[登入] 登入成功，設置 session');
  
  // 獲取完整的用戶資訊（包含 salesperson_id）
  // User 已經在檔案開頭引入，不需要重複引入
  const fullUser = User.findById(user.id);
  
  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    salesperson_id: fullUser?.salesperson_id || null
  };
  
  console.log('[登入] Session 設置完成，用戶:', req.session.user);

  // 如果密碼是舊的 SHA256 或 bcrypt 格式，自動升級為 argon2id
  const isOldSHA256 = user.password_hash && user.password_hash.length === 64 && /^[a-f0-9]{64}$/i.test(user.password_hash);
  const isOldBcrypt = user.password_hash && (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2y$'));
  
  if (isOldSHA256 || isOldBcrypt) {
    const formatName = isOldSHA256 ? 'SHA256' : 'bcrypt';
    console.log(`[登入] 檢測到舊的 ${formatName} 密碼格式，正在升級為 argon2id...`);
    try {
      await User.updatePassword(user.id, password);
      console.log(`[登入] 密碼已成功升級為 argon2id`);
    } catch (err) {
      console.error('[登入] 密碼升級失敗:', err);
      // 不影響登入流程，繼續執行
    }
  }

  // 更新最後登入時間
  User.updateLastLogin(user.id);
  
  console.log('[登入] 最後登入時間已更新');
  console.log('[登入] 重定向到:', redirect);
  console.log('[登入] Session 最終狀態:', req.session.user);

  // 重定向到原始請求的頁面或首頁（已驗證為相對路徑）
  res.redirect(redirect);
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

// 登出（GET 請求也支援）
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('登出時發生錯誤:', err);
    }
    res.redirect('/login');
  });
});

// 修改密碼頁面（需要登入）
router.get('/change-password', require('../middleware/auth').requireAuth, (req, res) => {
  res.render('auth/change-password', {
    title: '修改密碼',
    error: req.query.error || '',
    success: req.query.success || ''
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

  if (newPassword.length < 6) {
    return res.redirect('/change-password?error=' + encodeURIComponent('新密碼長度至少需要 6 個字元'));
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

