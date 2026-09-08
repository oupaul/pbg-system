/**
 * 報表日期曆法改為可設定：新增 date_calendar_system 系統設定。
 *
 * PdfExportService.formatROCDate() 目前寫死用民國年（year - 1911）格式化報表日期，
 * 對非台灣公司沒有意義。這裡新增一個設定值，預設 'roc'（沿用既有安裝的行為不變），
 * 可在系統設定頁切換成 'gregorian'（西元年）。
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

  console.log('開始執行報表曆法設定遷移...');

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
  if (!table) {
    console.log('⚠️ 找不到 system_settings 表，跳過遷移');
    db.close();
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES ('date_calendar_system', 'roc', 'string', '報表日期使用的曆法：roc（民國曆）或 gregorian（西元曆）')
  `).run();
  console.log('✓ 插入設定：date_calendar_system（預設 roc，維持既有安裝行為不變）');

  console.log('✓ 報表曆法設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
