/**
 * 通知中心：Email / LINE 發送管道。
 *
 * - users 新增 email、line_user_id 兩個選填欄位（發送對象需要）
 * - system_settings 新增 SMTP 與 LINE Messaging API 相關設定（管理員於系統設定頁面填寫）
 *
 * 僅「重要事件」類型的通知（審核送出/核准/駁回）會嘗試透過 Email/LINE 發送，
 * 一般系統提醒（客戶追蹤、開票提醒）不發送，避免訊息轟炸。
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

  console.log('開始執行通知發送管道遷移...');

  const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);

  if (!userColumns.includes('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    console.log('✓ users.email 欄位已添加');
  } else {
    console.log('✓ users.email 欄位已存在，略過');
  }

  if (!userColumns.includes('line_user_id')) {
    db.exec('ALTER TABLE users ADD COLUMN line_user_id TEXT');
    console.log('✓ users.line_user_id 欄位已添加');
  } else {
    console.log('✓ users.line_user_id 欄位已存在，略過');
  }

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `);

  insertSetting.run('email_notification_enabled', 'false', 'boolean', '是否啟用 Email 通知（僅重要事件：審核送出/核准/駁回）');
  insertSetting.run('smtp_host', '', 'string', 'SMTP 伺服器主機');
  insertSetting.run('smtp_port', '587', 'number', 'SMTP 伺服器埠號');
  insertSetting.run('smtp_secure', 'false', 'boolean', '是否使用 SSL（465 埠通常為 true，587/25 通常為 false + STARTTLS）');
  insertSetting.run('smtp_user', '', 'string', 'SMTP 登入帳號');
  insertSetting.run('smtp_password', '', 'string', 'SMTP 登入密碼或應用程式密碼');
  insertSetting.run('smtp_from', '', 'string', '寄件人顯示位址，例如 "業績獎金系統 <noreply@example.com>"');

  insertSetting.run('line_notification_enabled', 'false', 'boolean', '是否啟用 LINE 通知（僅重要事件：審核送出/核准/駁回）');
  insertSetting.run('line_channel_access_token', '', 'string', 'LINE Messaging API Channel Access Token');
  insertSetting.run('line_channel_secret', '', 'string', 'LINE Messaging API Channel Secret（用於驗證 Webhook 簽章）');

  console.log('✓ 插入 Email/LINE 通知相關系統設定');
  console.log('✓ 通知發送管道遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
