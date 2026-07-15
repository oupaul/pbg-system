const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const exists = db.prepare(
      "SELECT 1 FROM system_settings WHERE setting_key = 'attachment_cleanup_retention_days'"
    ).get();
    if (exists) {
      console.log('✓ attachment_cleanup_retention_days 已存在，跳過');
      db.close();
      return;
    }
    db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, setting_type, description)
      VALUES ('attachment_cleanup_retention_days', '30', 'number', '專案附件軟刪除後保留天數，超過後由清理腳本永久刪除（0=不自動清理）')
    `).run();
    console.log('✓ 新增系統設定 attachment_cleanup_retention_days = 30');
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
