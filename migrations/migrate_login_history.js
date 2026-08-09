const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  const db = new Database(dbPath);
  const existing = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='login_history'`).get();

  if (existing) {
    console.log('✓ login_history 表已存在，跳過遷移');
    db.close();
    return;
  }

  console.log('建立 login_history 表（登入紀錄）...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      ip_address TEXT,
      user_agent TEXT,
      logged_in_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_logged_in_at ON login_history(logged_in_at)`);
  console.log('✓ login_history 表建立完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
