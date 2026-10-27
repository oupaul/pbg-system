/**
 * 密碼規則：新增系統設定 password_complexity_enabled（是否要求密碼複雜度），預設關閉。
 * 最短長度固定 6 個字元（程式內固定，不是設定）。升級後行為只有一個變化：最短長度由 10 降為 6（依需求）；
 * 既有密碼不受影響。可重複執行。
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
    const hasSettings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
    if (!hasSettings) {
      console.log('⚠️ 找不到 system_settings 表，跳過遷移');
      return;
    }
    db.prepare(`
      INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
      VALUES ('password_complexity_enabled', 'false', 'boolean', '是否要求密碼複雜度（需包含大寫、小寫、數字、符號中的至少 3 種，且不可包含使用者名稱）；最短長度固定 6 個字元')
    `).run();
    console.log('✓ 設定 password_complexity_enabled 已就緒（預設關閉）');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
