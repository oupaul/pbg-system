const express = require('express');
const router = express.Router();
const Role = require('../models/Role');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 所有路由都需要管理員權限
router.use(requireAuth);
router.use(requireAdmin);

// 角色列表
router.get('/', (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const roles = Role.findAll(includeInactive);
    
    // 統計每個角色的使用者數量
    const db = require('../models/db');
    roles.forEach(role => {
      const count = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get(role.role_key);
      role.users_count = count.count;
    });

    res.render('roles/index', {
      title: '角色管理',
      roles,
      includeInactive,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('[角色列表] 錯誤:', err);
    res.render('roles/index', {
      title: '角色管理',
      roles: [],
      includeInactive: false,
      success: '',
      error: '載入角色列表失敗：' + err.message
    });
  }
});

// 新增角色表單
router.get('/new', (req, res) => {
  res.render('roles/form', {
    title: '新增角色',
    role: null,
    isEdit: false
  });
});

// 編輯角色表單
router.get('/:id/edit', (req, res) => {
  try {
    const role = Role.findById(req.params.id);
    if (!role) {
      return res.redirect('/roles?error=' + encodeURIComponent('角色不存在'));
    }

    res.render('roles/form', {
      title: '編輯角色',
      role,
      isEdit: true
    });
  } catch (err) {
    console.error('[編輯角色] 錯誤:', err);
    res.redirect('/roles?error=' + encodeURIComponent('載入角色失敗：' + err.message));
  }
});

// 創建角色
router.post('/', async (req, res) => {
  try {
    const { role_key, role_name, description, display_order, is_active } = req.body;
    
    // 驗證必填欄位
    if (!role_key || !role_name) {
      return res.status(400).json({ 
        error: '角色代碼和角色名稱為必填欄位' 
      });
    }

    // 檢查 role_key 是否已存在
    if (Role.isKeyExists(role_key)) {
      return res.status(400).json({ 
        error: '角色代碼已存在，請使用其他代碼' 
      });
    }

    // 收集權限設定
    const dashboardMode = ['all_and_separate', 'exclude_separate', 'none'].includes(req.body.dashboard_view_mode)
      ? req.body.dashboard_view_mode : 'all_and_separate';
    const validScopes = ['all', 'assigned', 'own', 'none'];
    const projectViewScope = validScopes.includes(req.body.project_view_scope)
      ? req.body.project_view_scope : 'all';
    const permissions = {
      role_key,
      role_name,
      description: description || null,
      can_edit: req.body.can_edit === 'on' ? 1 : 0,
      can_delete: req.body.can_delete === 'on' ? 1 : 0,
      can_manage_users: req.body.can_manage_users === 'on' ? 1 : 0,
      can_manage_roles: req.body.can_manage_roles === 'on' ? 1 : 0,
      can_manage_settings: req.body.can_manage_settings === 'on' ? 1 : 0,
      can_backup_restore: req.body.can_backup_restore === 'on' ? 1 : 0,
      can_view_all_projects: projectViewScope === 'all' ? 1 : 0,
      can_view_own_projects: (projectViewScope === 'own' || projectViewScope === 'assigned') ? 1 : 0,
      project_view_scope: projectViewScope,
      dashboard_view_mode: dashboardMode,
      is_system_role: 0,
      is_active: is_active === 'on' ? 1 : 0,
      display_order: parseInt(display_order) || 0
    };

    const roleId = Role.create(permissions, req.user.id);
    
    res.json({ 
      success: true, 
      message: '角色創建成功',
      roleId
    });
  } catch (err) {
    console.error('[創建角色] 錯誤:', err);
    res.status(500).json({ 
      error: '創建角色失敗：' + err.message 
    });
  }
});

// 更新角色的共用處理函數
async function handleRoleUpdate(req, res) {
  try {
    console.log('[更新角色] 收到請求，方法:', req.method, ' ID:', req.params.id);
    console.log('[更新角色] 請求 body:', req.body);
    console.log('[更新角色] Content-Type:', req.headers['content-type']);
    
    const roleId = parseInt(req.params.id);
    const { role_key, role_name, description, display_order, is_active } = req.body;
    
    // 驗證必填欄位
    if (!role_name) {
      console.log('[更新角色] 驗證失敗：缺少角色名稱');
      return res.status(400).json({ 
        error: '角色名稱為必填欄位' 
      });
    }

    // 檢查角色是否存在
    const existingRole = Role.findById(roleId);
    if (!existingRole) {
      return res.status(404).json({ 
        error: '角色不存在' 
      });
    }

    // 檢查 role_key 是否已被其他角色使用
    if (role_key && role_key !== existingRole.role_key) {
      if (Role.isKeyExists(role_key, roleId)) {
        return res.status(400).json({ 
          error: '角色代碼已存在，請使用其他代碼' 
        });
      }
    }

    const dashboardMode = ['all_and_separate', 'exclude_separate', 'none'].includes(req.body.dashboard_view_mode)
      ? req.body.dashboard_view_mode : 'all_and_separate';
    const validScopes = ['all', 'assigned', 'own', 'none'];
    const projectViewScope = validScopes.includes(req.body.project_view_scope)
      ? req.body.project_view_scope : 'all';
    // 收集更新資料
    const updateData = {
      role_name,
      description: description || null,
      can_edit: req.body.can_edit === 'on' ? 1 : 0,
      can_delete: req.body.can_delete === 'on' ? 1 : 0,
      can_manage_users: req.body.can_manage_users === 'on' ? 1 : 0,
      can_manage_roles: req.body.can_manage_roles === 'on' ? 1 : 0,
      can_manage_settings: req.body.can_manage_settings === 'on' ? 1 : 0,
      can_backup_restore: req.body.can_backup_restore === 'on' ? 1 : 0,
      can_view_all_projects: projectViewScope === 'all' ? 1 : 0,
      can_view_own_projects: (projectViewScope === 'own' || projectViewScope === 'assigned') ? 1 : 0,
      project_view_scope: projectViewScope,
      dashboard_view_mode: dashboardMode,
      is_active: is_active === 'on' ? 1 : 0,
      display_order: parseInt(display_order) || 0
    };

    // 如果不是系統角色，允許修改 role_key
    if (!existingRole.is_system_role && role_key) {
      updateData.role_key = role_key;
    }

    console.log('[更新角色] 更新資料:', updateData);
    const success = Role.update(roleId, updateData, req.user.id);
    console.log('[更新角色] 更新結果:', success);
    
    if (success) {
      console.log('[更新角色] 成功，返回成功響應');
      return res.json({ 
        success: true, 
        message: '角色更新成功' 
      });
    } else {
      console.log('[更新角色] 失敗，返回錯誤響應');
      return res.status(500).json({ 
        error: '角色更新失敗' 
      });
    }
  } catch (err) {
    console.error('[更新角色] 錯誤:', err);
    console.error('[更新角色] 錯誤堆疊:', err.stack);
    return res.status(500).json({ 
      error: '更新角色失敗：' + err.message 
    });
  }
}

// 更新角色 - PUT 方法
router.put('/:id', handleRoleUpdate);

// 更新角色 - POST 方法（作為備選）
router.post('/:id', handleRoleUpdate);

// 刪除角色
router.delete('/:id', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    
    const success = Role.delete(roleId, req.user.id);
    
    if (success) {
      res.json({ 
        success: true, 
        message: '角色刪除成功' 
      });
    } else {
      res.status(500).json({ 
        error: '角色刪除失敗' 
      });
    }
  } catch (err) {
    console.error('[刪除角色] 錯誤:', err);
    res.status(500).json({ 
      error: '刪除角色失敗：' + err.message 
    });
  }
});

// 查看角色詳情
router.get('/:id', (req, res) => {
  try {
    const role = Role.findById(req.params.id);
    if (!role) {
      return res.redirect('/roles?error=' + encodeURIComponent('角色不存在'));
    }

    // 統計使用此角色的使用者
    const db = require('../models/db');
    const users = db.prepare(`
      SELECT id, username, name, is_active, last_login
      FROM users 
      WHERE role = ?
      ORDER BY name ASC
    `).all(role.role_key);

    res.render('roles/show', {
      title: role.role_name,
      role,
      users
    });
  } catch (err) {
    console.error('[角色詳情] 錯誤:', err);
    res.redirect('/roles?error=' + encodeURIComponent('載入角色詳情失敗：' + err.message));
  }
});

module.exports = router;
