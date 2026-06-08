const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Role = {
  // 取得所有角色
  findAll(includeInactive = false) {
    let sql = 'SELECT * FROM roles';
    if (!includeInactive) {
      sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY display_order ASC, role_name ASC';
    
    try {
      return db.prepare(sql).all();
    } catch (err) {
      console.error('[Role.findAll] 查詢錯誤:', err);
      return [];
    }
  },

  // 根據 role_key 取得角色
  findByKey(roleKey) {
    try {
      return db.prepare('SELECT * FROM roles WHERE role_key = ?').get(roleKey);
    } catch (err) {
      console.error('[Role.findByKey] 查詢錯誤:', err);
      return null;
    }
  },

  // 根據 ID 取得角色
  findById(id) {
    try {
      return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
    } catch (err) {
      console.error('[Role.findById] 查詢錯誤:', err);
      return null;
    }
  },

  // 創建角色
  create(data, userId = null) {
    try {
      const dashboardMode = ['all_and_separate', 'exclude_separate', 'none'].includes(data.dashboard_view_mode)
        ? data.dashboard_view_mode : 'all_and_separate';
      const validScopes = ['all', 'assigned', 'own', 'none'];
      const scopeValue = validScopes.includes(data.project_view_scope)
        ? data.project_view_scope : 'all';

      const result = db.prepare(`
        INSERT INTO roles (
          role_key, role_name, description,
          can_edit, can_delete, can_manage_users, can_manage_roles,
          can_manage_settings, can_backup_restore,
          can_view_all_projects, can_view_own_projects,
          project_view_scope,
          dashboard_view_mode,
          is_system_role, is_active, display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.role_key,
        data.role_name,
        data.description || null,
        data.can_edit || 0,
        data.can_delete || 0,
        data.can_manage_users || 0,
        data.can_manage_roles || 0,
        data.can_manage_settings || 0,
        data.can_backup_restore || 0,
        data.can_view_all_projects !== undefined ? data.can_view_all_projects : 1,
        data.can_view_own_projects !== undefined ? data.can_view_own_projects : 1,
        scopeValue,
        dashboardMode,
        data.is_system_role || 0,
        data.is_active !== undefined ? data.is_active : 1,
        data.display_order || 0
      );

      const roleId = result.lastInsertRowid;

      // 記錄審計日誌
      if (userId) {
        const newRole = this.findById(roleId);
        AuditLogService.log('roles', roleId, 'create', userId, null, newRole);
      }

      return roleId;
    } catch (err) {
      console.error('[Role.create] 創建錯誤:', err);
      throw err;
    }
  },

  // 更新角色
  update(id, data, userId = null) {
    try {
      // 檢查是否為系統角色
      const role = this.findById(id);
      if (!role) {
        throw new Error('角色不存在');
      }

      if (role.is_system_role && data.role_key && data.role_key !== role.role_key) {
        throw new Error('系統角色的 role_key 不能修改');
      }

      // 記錄修改前的資料
      const oldData = { ...role };

      const fields = [];
      const values = [];

      if (data.role_key !== undefined && !role.is_system_role) {
        fields.push('role_key = ?');
        values.push(data.role_key);
      }
      if (data.role_name !== undefined) {
        fields.push('role_name = ?');
        values.push(data.role_name);
      }
      if (data.description !== undefined) {
        fields.push('description = ?');
        values.push(data.description);
      }
      if (data.can_edit !== undefined) {
        fields.push('can_edit = ?');
        values.push(data.can_edit);
      }
      if (data.can_delete !== undefined) {
        fields.push('can_delete = ?');
        values.push(data.can_delete);
      }
      if (data.can_manage_users !== undefined) {
        fields.push('can_manage_users = ?');
        values.push(data.can_manage_users);
      }
      if (data.can_manage_roles !== undefined) {
        fields.push('can_manage_roles = ?');
        values.push(data.can_manage_roles);
      }
      if (data.can_manage_settings !== undefined) {
        fields.push('can_manage_settings = ?');
        values.push(data.can_manage_settings);
      }
      if (data.can_backup_restore !== undefined) {
        fields.push('can_backup_restore = ?');
        values.push(data.can_backup_restore);
      }
      if (data.can_view_all_projects !== undefined) {
        fields.push('can_view_all_projects = ?');
        values.push(data.can_view_all_projects);
      }
      if (data.can_view_own_projects !== undefined) {
        fields.push('can_view_own_projects = ?');
        values.push(data.can_view_own_projects);
      }
      if (data.is_active !== undefined) {
        fields.push('is_active = ?');
        values.push(data.is_active);
      }
      if (data.display_order !== undefined) {
        fields.push('display_order = ?');
        values.push(data.display_order);
      }
      if (data.dashboard_view_mode !== undefined) {
        const valid = ['all_and_separate', 'exclude_separate', 'none'].includes(data.dashboard_view_mode)
          ? data.dashboard_view_mode : 'all_and_separate';
        fields.push('dashboard_view_mode = ?');
        values.push(valid);
      }
      if (data.project_view_scope !== undefined) {
        const validScopes = ['all', 'assigned', 'own', 'none'];
        const scope = validScopes.includes(data.project_view_scope)
          ? data.project_view_scope : 'all';
        fields.push('project_view_scope = ?');
        values.push(scope);
      }

      if (fields.length === 0) {
        return false;
      }

      fields.push(`updated_at = datetime('now', 'localtime')`);
      values.push(id);

      const sql = `UPDATE roles SET ${fields.join(', ')} WHERE id = ?`;
      const result = db.prepare(sql).run(...values);

      // 記錄審計日誌
      if (userId && result.changes > 0) {
        const newData = this.findById(id);
        AuditLogService.log('roles', id, 'update', userId, oldData, newData);
      }

      return result.changes > 0;
    } catch (err) {
      console.error('[Role.update] 更新錯誤:', err);
      throw err;
    }
  },

  // 刪除角色（軟刪除）
  delete(id, userId = null) {
    try {
      // 檢查是否為系統角色
      const role = this.findById(id);
      if (!role) {
        throw new Error('角色不存在');
      }

      if (role.is_system_role) {
        throw new Error('系統角色不能刪除');
      }

      // 檢查是否有使用者正在使用此角色
      const usersCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get(role.role_key);
      if (usersCount.count > 0) {
        throw new Error(`此角色正被 ${usersCount.count} 位使用者使用，無法刪除`);
      }

      // 記錄修改前的資料
      const oldData = { ...role };

      const result = db.prepare(`
        UPDATE roles 
        SET is_active = 0, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(id);

      // 記錄審計日誌
      if (userId && result.changes > 0) {
        AuditLogService.log('roles', id, 'delete', userId, oldData, null);
      }

      return result.changes > 0;
    } catch (err) {
      console.error('[Role.delete] 刪除錯誤:', err);
      throw err;
    }
  },

  // 硬刪除角色（謹慎使用）
  hardDelete(id, userId = null) {
    try {
      // 檢查是否為系統角色
      const role = this.findById(id);
      if (!role) {
        throw new Error('角色不存在');
      }

      if (role.is_system_role) {
        throw new Error('系統角色不能刪除');
      }

      // 檢查是否有使用者正在使用此角色
      const usersCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get(role.role_key);
      if (usersCount.count > 0) {
        throw new Error(`此角色正被 ${usersCount.count} 位使用者使用，無法刪除`);
      }

      // 記錄修改前的資料
      const oldData = { ...role };

      const result = db.prepare('DELETE FROM roles WHERE id = ?').run(id);

      // 記錄審計日誌
      if (userId && result.changes > 0) {
        AuditLogService.log('roles', id, 'hard_delete', userId, oldData, null);
      }

      return result.changes > 0;
    } catch (err) {
      console.error('[Role.hardDelete] 刪除錯誤:', err);
      throw err;
    }
  },

  // 取得角色的權限資訊
  getPermissions(roleKey) {
    const role = this.findByKey(roleKey);
    if (!role) {
      return null;
    }

    return {
      can_edit: role.can_edit === 1,
      can_delete: role.can_delete === 1,
      can_manage_users: role.can_manage_users === 1,
      can_manage_roles: role.can_manage_roles === 1,
      can_manage_settings: role.can_manage_settings === 1,
      can_backup_restore: role.can_backup_restore === 1,
      can_view_all_projects: role.can_view_all_projects === 1,
      can_view_own_projects: role.can_view_own_projects === 1
    };
  },

  // 檢查角色 key 是否已存在
  isKeyExists(roleKey, excludeId = null) {
    try {
      let sql = 'SELECT COUNT(*) as count FROM roles WHERE role_key = ?';
      const params = [roleKey];
      
      if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
      }
      
      const result = db.prepare(sql).get(...params);
      return result.count > 0;
    } catch (err) {
      console.error('[Role.isKeyExists] 查詢錯誤:', err);
      return false;
    }
  }
};

module.exports = Role;
