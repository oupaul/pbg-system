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
  const cols = db.prepare('PRAGMA table_info(users)').all();
  const hasLastActive = cols.some(c => c.name === 'last_active_at');

  if (hasLastActive) {
    console.log('✓ users.last_active_at 已存在，跳過遷移');
    db.close();
    return;
  }

  console.log('為 users 新增 last_active_at 欄位...');
  db.exec('ALTER TABLE users ADD COLUMN last_active_at TEXT');
  console.log('✓ users 線上狀態欄位新增完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
