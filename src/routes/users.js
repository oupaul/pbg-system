const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Salesperson = require('../models/Salesperson');
const { requireAuth } = require('../middleware/auth');
const { getUserInfo } = require('../utils/authHelper');
const AuditLogService = require('../services/AuditLogService');
const db = require('../models/db');

// 輔助函數：檢查是否為管理員
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '權限不足',
      message: '只有管理員可以訪問此頁面',
      error: {}
    });
  }
  next();
}

// 使用者列表（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = User.findAll();
  
  // 取得所有角色資訊（用於顯示角色名稱）
  let rolesMap = {};
  try {
    const roles = db.prepare('SELECT role_key, role_name FROM roles').all();
    roles.forEach(role => {
      rolesMap[role.role_key] = role.role_name;
    });
  } catch (err) {
    console.warn('無法讀取角色列表:', err.message);
    // 使用預設角色名稱
    rolesMap = {
      'admin': '管理員',
      'user': '一般使用者',
      'salesperson': '業務員',
      'boss': '老闆'
    };
  }
  
  res.render('users/index', {
    title: '使用者管理',
    users,
    rolesMap,
    currentUserId: req.user.id,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 新增使用者表單（僅管理員）
router.get('/new', requireAuth, requireAdmin, (req, res) => {
  const salespeople = Salesperson.findAll(true); // 只取得在職的業務員
  
  // 取得所有啟用的角色
  let roles = [];
  try {
    roles = db.prepare('SELECT role_key, role_name FROM roles WHERE is_active = 1 ORDER BY display_order ASC, role_name ASC').all();
  } catch (err) {
    console.warn('無法讀取角色列表，使用預設角色:', err.message);
    // 如果讀取失敗，使用預設角色
    roles = [
      { role_key: 'admin', role_name: '管理員' },
      { role_key: 'user', role_name: '一般使用者' },
      { role_key: 'salesperson', role_name: '業務員' },
      { role_key: 'boss', role_name: '老闆' }
    ];
  }
  
  res.render('users/form', {
    title: '新增使用者',
    user: null,
    salespeople,
    roles,
    action: '/users',
    error: req.query.error || ''
  });
});

// 建立使用者（僅管理員）
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role, salesperson_id } = req.body;

  if (!username || !password || !name) {
    return res.redirect('/users/new?error=' + encodeURIComponent('請填寫所有必填欄位'));
  }

  if (password.length < 6) {
    return res.redirect('/users/new?error=' + encodeURIComponent('密碼長度至少需要 6 個字元'));
  }

  // 如果角色是業務員，必須選擇業務人員
  if (role === 'salesperson' && !salesperson_id) {
    return res.redirect('/users/new?error=' + encodeURIComponent('業務員角色必須關聯一位業務人員'));
  }

  try {
    // 檢查用戶名是否已存在
    const existingUser = User.findByUsername(username);
    if (existingUser) {
      return res.redirect('/users/new?error=' + encodeURIComponent('使用者名稱已存在'));
    }

    const userId = await User.create({
      username,
      password,
      name,
      role: role || 'user',
      salesperson_id: role === 'salesperson' ? salesperson_id : null,
      is_active: 1
    });

    // 記錄新增操作
    AuditLogService.logCreate('users', userId, {
      username,
      name,
      role: role || 'user',
      salesperson_id: role === 'salesperson' ? salesperson_id : null,
      is_active: 1
    }, getUserInfo(req));

    res.redirect('/users?success=' + encodeURIComponent(`使用者 ${name} 已成功建立`));
  } catch (err) {
    console.error('建立使用者失敗:', err);
    res.redirect('/users/new?error=' + encodeURIComponent('建立使用者失敗：' + err.message));
  }
});

// 編輯使用者表單（僅管理員）
router.get('/:id/edit', requireAuth, requireAdmin, (req, res) => {
  const user = User.findById(req.params.id);
  if (!user) {
    return res.status(404).render('error', {
      title: '找不到使用者',
      message: '找不到使用者',
      error: {}
    });
  }

  const salespeople = Salesperson.findAll(true); // 只取得在職的業務員
  
  // 取得所有啟用的角色
  let roles = [];
  try {
    roles = db.prepare('SELECT role_key, role_name FROM roles WHERE is_active = 1 ORDER BY display_order ASC, role_name ASC').all();
  } catch (err) {
    console.warn('無法讀取角色列表，使用預設角色:', err.message);
    // 如果讀取失敗，使用預設角色
    roles = [
      { role_key: 'admin', role_name: '管理員' },
      { role_key: 'user', role_name: '一般使用者' },
      { role_key: 'salesperson', role_name: '業務員' },
      { role_key: 'boss', role_name: '老闆' }
    ];
  }
  
  res.render('users/form', {
    title: '編輯使用者',
    user,
    salespeople,
    roles,
    action: `/users/${user.id}`,
    error: req.query.error || ''
  });
});

// 更新使用者（僅管理員）
router.post('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, role, password, is_active, salesperson_id } = req.body;
  const userId = parseInt(req.params.id);

  const user = User.findById(userId);
  if (!user) {
    return res.status(404).render('error', {
      title: '找不到使用者',
      message: '找不到使用者',
      error: {}
    });
  }

  // 如果角色是業務員，必須選擇業務人員
  if (role === 'salesperson' && !salesperson_id) {
    return res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('業務員角色必須關聯一位業務人員'));
  }

  const updateData = {
    name,
    role: role || 'user',
    salesperson_id: role === 'salesperson' ? salesperson_id : null,
    is_active: is_active === '1' ? 1 : 0
  };

  try {
    // 取得舊值用於審計日誌
    const oldUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!oldUser) {
      return res.status(404).render('error', {
        title: '找不到使用者',
        message: '找不到使用者',
        error: {}
      });
    }

    // 如果有提供新密碼，使用 updatePassword 方法
    if (password && password.length > 0) {
      if (password.length < 6) {
        return res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('密碼長度至少需要 6 個字元'));
      }
      await User.updatePassword(userId, password);
      // 從 updateData 中移除 password，因為已經用 updatePassword 處理了
      delete updateData.password;
    }

    // 執行更新（不包含密碼）
    const updateSuccess = await User.update(userId, updateData);
    
    if (updateSuccess) {
      // 取得新值用於審計日誌（排除密碼雜湊）
      const newUser = db.prepare(`SELECT id, username, name, role, is_active FROM users WHERE id = ?`).get(userId);
      const newDataForLog = {
        name: newUser.name,
        role: newUser.role,
        is_active: newUser.is_active
      };
      
      // 如果有更新密碼，只記錄 "密碼已更新" 而不記錄實際密碼
      if (password && password.length > 0) {
        newDataForLog.password = '[已更新]';
      }
      
      const oldDataForLog = {
        name: oldUser.name,
        role: oldUser.role,
        is_active: oldUser.is_active
      };
      
      // 記錄更新操作
      AuditLogService.logUpdate('users', userId, oldDataForLog, newDataForLog, getUserInfo(req));
      
      res.redirect('/users?success=' + encodeURIComponent(`使用者 ${name} 已成功更新`));
    } else {
      res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('更新失敗，請確認資料是否正確'));
    }
  } catch (err) {
    console.error('更新使用者失敗:', err);
    res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('更新使用者失敗：' + err.message));
  }
});

// 停用/啟用使用者（僅管理員）
router.post('/:id/toggle-active', requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = User.findById(userId);

  if (!user) {
    return res.status(404).render('error', {
      title: '找不到使用者',
      message: '找不到使用者',
      error: {}
    });
  }

  // 防止停用自己
  if (user.id === req.user.id) {
    return res.redirect('/users?error=' + encodeURIComponent('無法停用自己的帳號'));
  }

  const newStatus = user.is_active ? 0 : 1;
  await User.update(userId, { is_active: newStatus });

  const action = newStatus ? '啟用' : '停用';
  res.redirect('/users?success=' + encodeURIComponent(`使用者 ${user.name} 已成功${action}`));
});

module.exports = router;

