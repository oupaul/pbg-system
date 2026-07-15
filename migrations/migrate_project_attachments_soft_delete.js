const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const cols = db.prepare('PRAGMA table_info(project_attachments)').all();
    const hasDeletedAt = cols.some(c => c.name === 'deleted_at');
    if (hasDeletedAt) {
      console.log('✓ project_attachments.deleted_at 已存在，跳過遷移');
      db.close();
      return;
    }
    console.log('為 project_attachments 新增 deleted_at 欄位...');
    db.exec('ALTER TABLE project_attachments ADD COLUMN deleted_at TEXT');
    console.log('✓ project_attachments 軟刪除欄位新增完成');
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
