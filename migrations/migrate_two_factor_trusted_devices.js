/**
 * 雙因素驗證「信任此裝置」：
 *  - trusted_devices：裝置憑證只存帶金鑰的雜湊（沒有 SESSION_SECRET 就無法由資料庫反推憑證），綁定使用者，有到期時間
 *  - system_settings.two_factor_trust_days：信任天數，預設 30，0 表示停用此功能
 * 升級後沒有任何已信任的裝置，行為與升級前完全相同，使用者在登入第二步自行勾選才會建立。可重複執行。
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
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        last_used_at TEXT,
        expires_at TEXT NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id)');
    console.log('✓ trusted_devices 表與索引已就緒');

    const hasSettings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
    if (hasSettings) {
      db.prepare(`
        INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
        VALUES ('two_factor_trust_days', '30', 'number', '雙因素驗證「信任此裝置」的天數（0-90），0 表示停用此功能，每次登入都要輸入驗證碼')
      `).run();
      console.log('✓ 設定 two_factor_trust_days 已就緒（預設 30 天）');
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
