/**
 * 系統網址設定：讓 Email / LINE 通知內容可以組出完整可點擊的網址，
 * 而不是只顯示相對路徑（例如 /pipelines/5）。
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

  console.log('開始執行系統網址設定遷移...');

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `).run(
    'system_base_url',
    '',
    'string',
    '系統對外網址（例如 https://pbg.example.com，結尾不要加斜線），用於組出 Email/LINE 通知中的完整連結，以及 LINE Webhook URL 提示'
  );

  console.log('✓ 插入設定：system_base_url');
  console.log('✓ 系統網址設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
