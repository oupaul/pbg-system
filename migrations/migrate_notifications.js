/**
 * 通知中心：站內通知資料表。
 *
 * 每則通知只屬於單一收件者（user_id），由 NotificationService 在特定事件發生時建立
 * （例如送出審核申請、審核結果、客戶追蹤逾期、開票提醒）。is_read 標記是否已讀，
 * 供導覽列鈴鐺徽章數字與 /notifications 通知中心頁面使用。
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

  console.log('開始執行通知中心遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,
      related_type TEXT,
      related_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 notifications 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(user_id, type, related_type, related_id, is_read)`);
  console.log('✓ 建立 notifications 索引');

  console.log('✓ 通知中心遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
