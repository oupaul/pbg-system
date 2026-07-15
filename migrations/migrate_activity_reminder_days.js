/**
 * CRM 模組：新增「客戶追蹤提醒天數」系統設定。
 * 用於首頁儀表板提醒業務「超過 N 天沒有活動紀錄」的客戶，預設 14 天。
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
  db.pragma('foreign_keys = ON');

  console.log('開始執行客戶追蹤提醒天數設定遷移...');

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `).run(
    'activity_reminder_days',
    '14',
    'number',
    '客戶追蹤提醒天數（有負責業務的客戶，超過此天數沒有新增活動紀錄時，於首頁提醒業務盡快追蹤）'
  );

  console.log('✓ 插入設定：activity_reminder_days = 14');
  console.log('✓ 客戶追蹤提醒天數設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
