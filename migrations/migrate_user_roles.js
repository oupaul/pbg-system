const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrateUserRoles() {
  console.log('開始執行使用者角色遷移...');

  if (!fs.existsSync(dbPath)) {
    console.log('❌ 資料庫文件不存在，請先執行基礎遷移');
    return;
  }

  let db;
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = OFF'); // 暫時關閉外鍵約束以便重建表

    // 檢查 salesperson_id 欄位是否已存在
    const tableInfo = db.pragma('table_info(users)');
    const columns = tableInfo.map(col => col.name);
    
    if (!columns.includes('salesperson_id')) {
      console.log('添加 salesperson_id 欄位...');
      db.exec('ALTER TABLE users ADD COLUMN salesperson_id INTEGER REFERENCES salespeople(id)');
      console.log('✓ salesperson_id 欄位已添加');
    } else {
      console.log('✓ salesperson_id 欄位已存在');
    }

    // 檢查是否需要移除舊的 role CHECK 約束（僅允許 admin/user）。
    // 角色本身改由 roles 表管理（含後續新增的自訂角色），users.role 不應再用寫死的清單限制，
    // 否則遇到既有資料已有 CHECK 清單以外角色值（例如透過角色管理新增的自訂角色）時，遷移會直接失敗。
    const schemaResult = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    const currentSchema = schemaResult?.sql || '';
    const hasRestrictiveCheck = currentSchema.includes('CHECK') && currentSchema.includes('role IN');

    if (hasRestrictiveCheck) {
      console.log('偵測到舊的 role CHECK 約束，更新 users 表結構...');
      
      // 開始事務
      db.exec('BEGIN TRANSACTION');
      
      try {
        // 1. 創建新表
        db.exec(`
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            salesperson_id INTEGER,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            last_login TEXT,
            FOREIGN KEY (salesperson_id) REFERENCES salespeople(id)
          )
        `);
        console.log('✓ 新表 users_new 已創建');

        // 2. 複製資料
        if (columns.includes('salesperson_id')) {
          db.exec(`
            INSERT INTO users_new (id, username, password_hash, name, role, salesperson_id, is_active, created_at, updated_at, last_login)
            SELECT id, username, password_hash, name, role, salesperson_id, is_active, created_at, updated_at, last_login
            FROM users
          `);
        } else {
          db.exec(`
            INSERT INTO users_new (id, username, password_hash, name, role, is_active, created_at, updated_at, last_login)
            SELECT id, username, password_hash, name, role, is_active, created_at, updated_at, last_login
            FROM users
          `);
        }
        console.log('✓ 資料已複製');

        // 3. 刪除舊表
        db.exec('DROP TABLE users');
        console.log('✓ 舊表已刪除');

        // 4. 重命名新表
        db.exec('ALTER TABLE users_new RENAME TO users');
        console.log('✓ 新表已重命名');

        // 5. 重新創建索引
        db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
        console.log('✓ 索引已重新創建');

        // 提交事務
        db.exec('COMMIT');
      } catch (err) {
        // 回滾事務
        db.exec('ROLLBACK');
        throw err;
      }
    } else {
      console.log('✓ users.role 已無限制性 CHECK 約束，無需遷移');
    }

    // 重新啟用外鍵約束
    db.pragma('foreign_keys = ON');
    
    db.close();
    
    console.log('✅ 使用者角色遷移完成！');
    console.log('\n新增角色：');
    console.log('  - salesperson (業務員): 只能查看自己負責的專案，無編輯權限');
    console.log('  - boss (老闆): 可查看所有專案，無編輯權限');
    console.log('  - admin (管理員): 完整權限');
    console.log('  - user (專案管理員): 可以編輯專案、客戶、業務、發票、收款等所有專案相關資料');
    
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    if (db) {
      try {
        db.pragma('foreign_keys = ON');
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
  migrateUserRoles();
}

module.exports = migrateUserRoles;
