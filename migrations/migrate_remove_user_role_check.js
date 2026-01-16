const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrateRemoveUserRoleCheck() {
  console.log('開始執行移除 users.role CHECK 約束遷移...');

  if (!fs.existsSync(dbPath)) {
    console.log('❌ 資料庫文件不存在');
    return;
  }

  let db;
  try {
    db = new Database(dbPath);
    
    // 檢查當前表結構
    const schemaResult = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    const currentSchema = schemaResult?.sql || '';
    
    // 如果包含 CHECK 約束，則需要移除
    if (currentSchema.includes('CHECK') && currentSchema.includes('role IN')) {
      console.log('檢測到舊的 role CHECK 約束，開始移除...');
      
      // 暫時禁用外鍵約束（保護相關資料）
      console.log('暫時禁用外鍵約束（保護相關資料）...');
      db.pragma('foreign_keys = OFF');
      
      // 開始事務
      db.exec('BEGIN TRANSACTION');
      
      try {
        // 獲取當前資料
        const tableInfo = db.pragma('table_info(users)');
        
        // 1. 創建新表結構（移除 CHECK 約束）
        console.log('創建新表結構（移除 CHECK 約束）...');
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

        // 2. 複製資料
        console.log('複製資料...');
        const columns = tableInfo.map(col => col.name);
        const columnList = columns.join(', ');
        db.exec(`
          INSERT INTO users_new (${columnList})
          SELECT ${columnList}
          FROM users
        `);

        // 3. 刪除舊表
        console.log('刪除舊表...');
        db.exec('DROP TABLE users');

        // 4. 重新命名表
        console.log('重新命名表...');
        db.exec('ALTER TABLE users_new RENAME TO users');

        // 5. 重新創建索引
        console.log('重新創建索引...');
        db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');

        // 提交事務
        db.exec('COMMIT');
        console.log('✓ role CHECK 約束移除完成');
      } catch (err) {
        // 回滾事務
        db.exec('ROLLBACK');
        throw err;
      }
      
      // 重新啟用外鍵約束
      console.log('重新啟用外鍵約束...');
      db.pragma('foreign_keys = ON');
    } else {
      console.log('✓ users.role 欄位沒有 CHECK 約束限制，無需遷移');
    }
    
    db.close();
    console.log('✅ 遷移完成！現在可以使用自訂角色了。');
    
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
  migrateRemoveUserRoleCheck();
}

module.exports = migrateRemoveUserRoleCheck;
