/**
 * 金額顯示幣別符號改為可設定：新增 currency_symbol 系統設定。
 *
 * 全站上百處畫面用字面 '$' 拼接金額顯示，對非台幣計價的公司沒有意義。這裡新增一個
 * 設定值，預設 '$'（沿用既有安裝的行為不變），可在系統設定頁改成其他符號（例如
 * NT$、¥、€ 等）。金額本身的數字格式（千分位）不受影響，僅改變前綴符號。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  const db = new Database(dbPath);

  console.log('開始執行幣別符號設定遷移...');

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
  if (!table) {
    console.log('⚠️ 找不到 system_settings 表，跳過遷移');
    db.close();
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES ('currency_symbol', '$', 'string', '畫面上金額顯示的幣別符號前綴（例如 $、NT$、¥）')
  `).run();
  console.log('✓ 插入設定：currency_symbol（預設 $，維持既有安裝行為不變）');

  console.log('✓ 幣別符號設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
