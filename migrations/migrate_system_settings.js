const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

// 確保資料目錄存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  let db;
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行系統設定資料表遷移...');

  // 建立系統設定表
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      setting_type TEXT DEFAULT 'string' CHECK(setting_type IN ('string', 'number', 'boolean', 'json')),
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 system_settings 表');

  // 插入預設設定值
  const settings = [
    {
      key: 'invoice_notification_days_before_month_end',
      value: '6',
      type: 'number',
      description: '開票提醒通知提前天數（當月剩餘天數少於或等於此值時開始顯示通知，預設6天即倒數第7天）'
    },
    {
      key: 'invoice_notification_enabled',
      value: 'true',
      type: 'boolean',
      description: '是否啟用開票提醒通知功能'
    },
    {
      key: 'idle_timeout_minutes',
      value: '30',
      type: 'number',
      description: '使用者閒置自動登出時間（分鐘），0 表示停用閒置登出功能'
    },
    {
      key: 'idle_warning_minutes',
      value: '2',
      type: 'number',
      description: '閒置登出前的警告時間（分鐘），在達到閒置時間前多久顯示警告'
    }
  ];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `);

  for (const setting of settings) {
    insertStmt.run(setting.key, setting.value, setting.type, setting.description);
    console.log(`✓ 插入設定：${setting.key} = ${setting.value}`);
  }

  console.log('✓ 系統設定資料表遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };

