const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Salesperson = require('../models/Salesperson');
const { requireAuth } = require('../middleware/auth');
const { getUserInfo } = require('../utils/authHelper');
const AuditLogService = require('../services/AuditLogService');
const db = require('../models/db');
const { PROJECT_VIEW_SCOPE } = require('../constants');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function getRoles() {
  try {
    return db.prepare(
      'SELECT role_key, role_name, project_view_scope FROM roles WHERE is_active = 1 ORDER BY display_order ASC, role_name ASC'
    ).all();
  } catch {
    return [
      { role_key: 'admin',       role_name: '管理員',     project_view_scope: 'all' },
      { role_key: 'user',        role_name: '專案管理員', project_view_scope: 'all' },
      { role_key: 'salesperson', role_name: '業務員',     project_view_scope: 'own' },
      { role_key: 'boss',        role_name: '老闆',       project_view_scope: 'all' }
    ];
  }
}

function getAssignedSalespersonIds(userId) {
  try {
    const rows = db.prepare(
      'SELECT salesperson_id FROM user_salesperson_access WHERE user_id = ?'
    ).all(userId);
    return rows.map(r => r.salesperson_id);
  } catch {
    return [];
  }
}

function saveAssignedSalespersonIds(userId, ids) {
  const del = db.prepare('DELETE FROM user_salesperson_access WHERE user_id = ?');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO user_salesperson_access (user_id, salesperson_id) VALUES (?, ?)'
  );
  db.transaction(() => {
    del.run(userId);
    for (const spId of ids) ins.run(userId, spId);
  })();
}

// ── Routes ───────────────────────────────────────────────────────────────────

// 使用者列表（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = User.findAll();
  let rolesMap = {};
  try {
    db.prepare('SELECT role_key, role_name FROM roles').all()
      .forEach(r => { rolesMap[r.role_key] = r.role_name; });
  } catch {
    rolesMap = { admin: '管理員', user: '專案管理員', salesperson: '業務員', boss: '老闆' };
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
  res.render('users/form', {
    title: '新增使用者',
    user: null,
    salespeople: Salesperson.findAll(true),
    roles: getRoles(),
    assignedSalespersonIds: [],
    action: '/users',
    error: req.query.error || ''
  });
});

// 建立使用者（僅管理員）
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role, salesperson_id, email, line_user_id } = req.body;
  // assigned_salespeople may be a single value or array from multiselect
  const assignedRaw = req.body.assigned_salespeople;
  const assignedIds = assignedRaw
    ? (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw]).map(Number).filter(Boolean)
    : [];

  if (!username || !password || !name) {
    return res.redirect('/users/new?error=' + encodeURIComponent('請填寫所有必填欄位'));
  }
  if (password.length < 6) {
    return res.redirect('/users/new?error=' + encodeURIComponent('密碼長度至少需要 6 個字元'));
  }
  if (role === 'salesperson' && !salesperson_id) {
    return res.redirect('/users/new?error=' + encodeURIComponent('業務員角色必須關聯一位業務人員'));
  }

  try {
    if (User.findByUsername(username)) {
      return res.redirect('/users/new?error=' + encodeURIComponent('使用者名稱已存在'));
    }

    const userId = await User.create({
      username,
      password,
      name,
      role: role || 'user',
      salesperson_id: role === 'salesperson' ? salesperson_id : null,
      is_active: 1,
      email: email || null,
      line_user_id: line_user_id || null
    });

    // Save assigned-salesperson access if the role uses 'assigned' scope
    const roleRecord = getRoles().find(r => r.role_key === role);
    if (roleRecord && roleRecord.project_view_scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
      saveAssignedSalespersonIds(userId, assignedIds);
    }

    AuditLogService.logCreate('users', userId, {
      username, name, role: role || 'user',
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
    return res.status(404).render('error', { title: '找不到使用者', message: '找不到使用者', error: {} });
  }

  res.render('users/form', {
    title: '編輯使用者',
    user,
    salespeople: Salesperson.findAll(true),
    roles: getRoles(),
    assignedSalespersonIds: getAssignedSalespersonIds(user.id),
    action: `/users/${user.id}`,
    error: req.query.error || ''
  });
});

// 更新使用者（僅管理員）
router.post('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, role, password, is_active, salesperson_id, email, line_user_id } = req.body;
  const assignedRaw = req.body.assigned_salespeople;
  const assignedIds = assignedRaw
    ? (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw]).map(Number).filter(Boolean)
    : [];

  const userId = parseInt(req.params.id);
  const user = User.findById(userId);
  if (!user) {
    return res.status(404).render('error', { title: '找不到使用者', message: '找不到使用者', error: {} });
  }

  if (role === 'salesperson' && !salesperson_id) {
    return res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('業務員角色必須關聯一位業務人員'));
  }

  const updateData = {
    name,
    role: role || 'user',
    salesperson_id: role === 'salesperson' ? salesperson_id : null,
    is_active: is_active === '1' ? 1 : 0,
    email: email || null,
    line_user_id: line_user_id || null
  };

  try {
    const oldUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (password && password.length > 0) {
      if (password.length < 6) {
        return res.redirect(`/users/${userId}/edit?error=` + encodeURIComponent('密碼長度至少需要 6 個字元'));
      }
      await User.updatePassword(userId, password);
    }

    const updateSuccess = await User.update(userId, updateData);

    // Update assigned-salesperson access when role uses 'assigned' scope
    const roleRecord = getRoles().find(r => r.role_key === role);
    if (roleRecord && roleRecord.project_view_scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
      saveAssignedSalespersonIds(userId, assignedIds);
    } else {
      // Clear access entries when role no longer uses assigned scope
      try {
        db.prepare('DELETE FROM user_salesperson_access WHERE user_id = ?').run(userId);
      } catch { /* table may not exist yet */ }
    }

    if (updateSuccess) {
      const newUser = db.prepare('SELECT id, username, name, role, is_active FROM users WHERE id = ?').get(userId);
      const newDataForLog = { name: newUser.name, role: newUser.role, is_active: newUser.is_active };
      if (password && password.length > 0) newDataForLog.password = '[已更新]';

      AuditLogService.logUpdate('users', userId, {
        name: oldUser.name, role: oldUser.role, is_active: oldUser.is_active
      }, newDataForLog, getUserInfo(req));

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
    return res.status(404).render('error', { title: '找不到使用者', message: '找不到使用者', error: {} });
  }
  if (user.id === req.user.id) {
    return res.redirect('/users?error=' + encodeURIComponent('無法停用自己的帳號'));
  }

  const newStatus = user.is_active ? 0 : 1;
  await User.update(userId, { is_active: newStatus });

  const action = newStatus ? '啟用' : '停用';
  res.redirect('/users?success=' + encodeURIComponent(`使用者 ${user.name} 已成功${action}`));
});

module.exports = router;
