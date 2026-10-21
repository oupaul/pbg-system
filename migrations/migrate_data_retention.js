/**
 * 資料保留與自動清理的系統設定：修改記錄、登入紀錄、已讀通知可以設定保留天數，超過的由系統每天自動清理。
 *
 * 全部預設為 0（不清理）：修改記錄是稽核證據、登入紀錄是資安紀錄，刪除前應由管理員依公司規定決定保留多久，
 * 升級後不會自動刪除任何資料。可重複執行（INSERT OR IGNORE）。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get()) {
    console.log('system_settings 資料表不存在，略過');
    db.close();
    return;
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `);
  insert.run('retention_system_logs_days', '0', 'number', '修改記錄保留天數（0 = 不自動清理；超過天數的記錄每天自動永久刪除，最少 30 天）');
  insert.run('retention_login_history_days', '0', 'number', '登入紀錄保留天數（0 = 不自動清理；最少 30 天）');
  insert.run('retention_read_notifications_days', '0', 'number', '已讀通知保留天數（0 = 不自動清理；最少 7 天；未讀通知不會被清理）');
  insert.run('retention_last_run_date', '', 'string', '資料保留清理最近一次自動執行的日期（系統內部使用，請勿修改）');
  console.log('✓ 資料保留與自動清理設定已建立（預設全部不清理）');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
