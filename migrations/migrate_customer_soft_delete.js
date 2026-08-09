/**
 * 客戶/廠商軟刪除：新增 deleted_at 欄位，讓有刪除權限的角色可以刪除客戶/廠商資料
 * （原本完全沒有刪除功能，管理者也無法刪除測試資料）。
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const cols = db.prepare('PRAGMA table_info(customers)').all();
    const hasDeletedAt = cols.some(c => c.name === 'deleted_at');
    if (hasDeletedAt) {
      console.log('✓ customers.deleted_at 已存在，跳過遷移');
      db.close();
      return;
    }
    console.log('為 customers 新增 deleted_at 欄位...');
    db.exec('ALTER TABLE customers ADD COLUMN deleted_at TEXT');
    console.log('✓ customers 軟刪除欄位新增完成');
    db.close();
  } catch (err) {
    console.error('遷移失敗:', err);
    if (db) db.close();
    throw err;
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
