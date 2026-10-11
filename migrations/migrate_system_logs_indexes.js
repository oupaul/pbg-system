/**
 * 為修改記錄資料表 system_logs 補上索引。
 *
 * 之前的 migration（migrate_permission_scope）把索引建在不存在的 audit_logs 資料表上，
 * 錯誤被吞掉只留下警告，所以真正在用的 system_logs 一直沒有索引；修改記錄頁面依
 * created_at 排序、依 table_name/record_id/action 篩選，資料量大時會愈來愈慢。
 * CREATE INDEX IF NOT EXISTS 可重複執行。
 */
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
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_logs'").get();
  if (!exists) {
    console.log('system_logs 資料表不存在，略過');
    db.close();
    return;
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_system_logs_table_record ON system_logs(table_name, record_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action)');
  console.log('✓ system_logs 索引建立完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
