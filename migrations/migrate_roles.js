const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrateRoles() {
  console.log('開始執行角色管理資料表遷移...');

  if (!fs.existsSync(dbPath)) {
    console.log('❌ 資料庫文件不存在，請先執行基礎遷移');
    return;
  }

  let db;
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    // 創建角色表
    db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_key TEXT NOT NULL UNIQUE,
        role_name TEXT NOT NULL,
        description TEXT,
        can_edit INTEGER DEFAULT 0 CHECK(can_edit IN (0, 1)),
        can_delete INTEGER DEFAULT 0 CHECK(can_delete IN (0, 1)),
        can_manage_users INTEGER DEFAULT 0 CHECK(can_manage_users IN (0, 1)),
        can_manage_roles INTEGER DEFAULT 0 CHECK(can_manage_roles IN (0, 1)),
        can_manage_settings INTEGER DEFAULT 0 CHECK(can_manage_settings IN (0, 1)),
        can_backup_restore INTEGER DEFAULT 0 CHECK(can_backup_restore IN (0, 1)),
        can_view_all_projects INTEGER DEFAULT 1 CHECK(can_view_all_projects IN (0, 1)),
        can_view_own_projects INTEGER DEFAULT 1 CHECK(can_view_own_projects IN (0, 1)),
        is_system_role INTEGER DEFAULT 0 CHECK(is_system_role IN (0, 1)),
        is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
        display_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✓ 建立 roles 表');

    // 檢查是否已有預設角色
    const existingRoles = db.prepare('SELECT COUNT(*) as count FROM roles').get();
    
    if (existingRoles.count === 0) {
      console.log('插入預設角色...');
      
      const insertRole = db.prepare(`
        INSERT INTO roles (
          role_key, role_name, description, 
          can_edit, can_delete, can_manage_users, can_manage_roles, 
          can_manage_settings, can_backup_restore, 
          can_view_all_projects, can_view_own_projects,
          is_system_role, is_active, display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // 管理員角色（完整權限）
      insertRole.run(
        'admin', '系統管理員', '擁有系統最高權限，可以管理所有功能',
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
      );

      // 一般使用者角色（編輯權限）
      insertRole.run(
        'user', '一般使用者', '可以編輯專案、發票、收款等資料',
        1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 2
      );

      // 業務員角色（只能查看自己的專案）
      insertRole.run(
        'salesperson', '業務員', '只能查看自己負責的專案，無法編輯',
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3
      );

      // 老闆角色（可查看所有專案，無編輯權限）
      insertRole.run(
        'boss', '老闆', '可查看所有專案和報表，無法編輯資料',
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4
      );

      console.log('✓ 插入 4 個預設角色');
    } else {
      console.log('✓ 角色資料已存在，跳過插入');
    }

    // 創建索引
    db.exec('CREATE INDEX IF NOT EXISTS idx_roles_key ON roles(role_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(is_active)');
    console.log('✓ 創建索引');

    db.close();
    
    console.log('✅ 角色管理資料表遷移完成！');
    console.log('\n系統角色說明：');
    console.log('  - admin (系統管理員): 完整權限');
    console.log('  - user (一般使用者): 可編輯資料');
    console.log('  - salesperson (業務員): 只能查看自己的專案');
    console.log('  - boss (老闆): 可查看所有資料，無編輯權限');
    
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    if (db) {
      try {
        db.close();
      } catch (closeErr) {
        // 忽略關閉錯誤
      }
    }
    throw err;
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  migrateRoles();
}

module.exports = migrateRoles;
