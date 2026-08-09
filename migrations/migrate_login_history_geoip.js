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
  const cols = db.prepare('PRAGMA table_info(login_history)').all();
  const hasCountryCode = cols.some(c => c.name === 'country_code');

  if (hasCountryCode) {
    console.log('✓ login_history.country_code 已存在，跳過遷移');
    db.close();
    return;
  }

  console.log('為 login_history 新增地區欄位...');
  db.exec('ALTER TABLE login_history ADD COLUMN country_code TEXT');
  console.log('✓ login_history 地區欄位新增完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
