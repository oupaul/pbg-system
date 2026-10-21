/**
 * 逾期收款自動提醒：新增系統設定。
 *
 * 預設「停用」：升級後不會突然對業務與財務發送訊息，由管理員到「系統設定」確認收件人與頻率後自行啟用。
 * 可重複執行（INSERT OR IGNORE）。
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
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
  if (!exists) {
    console.log('system_settings 資料表不存在，略過');
    db.close();
    return;
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `);
  insert.run('overdue_reminder_enabled', 'false', 'boolean', '是否啟用逾期收款自動提醒（以站內通知＋已啟用的 Email/LINE 發送給負責業務與指定收件人）');
  insert.run('overdue_reminder_frequency', 'weekly', 'string', '逾期收款提醒頻率：weekly（每週一）或 daily（每天）');
  insert.run('overdue_reminder_time', '09:00', 'string', '逾期收款提醒的發送時間（24 小時制 HH:MM，伺服器本地時間）');
  insert.run('overdue_reminder_include_upcoming', 'true', 'boolean', '提醒內容是否同時列出「即將到期」的發票（天數沿用收款提醒天數設定）');
  insert.run('overdue_reminder_notify_user_ids', '', 'string', '逾期收款提醒的彙總收件人（財務/主管）使用者 ID 清單（逗號分隔），會收到全公司彙總');
  insert.run('overdue_reminder_last_run_date', '', 'string', '逾期收款提醒最近一次自動執行的日期（系統內部使用，請勿修改）');
  console.log('✓ 逾期收款自動提醒設定已建立（預設停用）');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
