/**
 * 銷售機會/活動紀錄異動通知：新增/編輯/狀態變更/轉入專案/客戶活動紀錄新增，
 * 都會通知一組可由管理員指定的收件人（站內通知 + 若對方有填 Email 且已啟用 Email 通知，也會寄信）。
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

  console.log('開始執行業務異動通知收件人遷移...');

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `).run(
    'business_event_notify_user_ids',
    '',
    'string',
    '銷售機會新增/編輯/狀態變更/轉入專案、客戶活動紀錄新增時，要通知的使用者 ID 清單（逗號分隔）'
  );

  console.log('✓ 插入設定：business_event_notify_user_ids');
  console.log('✓ 業務異動通知收件人遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
