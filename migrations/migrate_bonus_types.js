/**
 * 獎金類型改為可自訂：建立 bonus_types 表。
 *
 * 這套系統是同一份程式碼分別部署給不同客戶各自獨立安裝，不同公司可能要用
 * 不同的獎金類型名稱，原本 bonus_calculations.bonus_type 用 CHECK 約束寫死
 * 5 種固定值，裝好之後沒辦法自行調整。這裡先建表、種子資料沿用原本寫死的
 * 5 個值（讓既有安裝升級後行為不變），CHECK 約束的移除交給下一支 migration
 * （migrate_remove_bonus_type_check）處理。
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

  console.log('開始執行獎金類型可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 bonus_types 表');

  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO bonus_types (type_name, display_order) VALUES (?, ?)
  `);
  [
    ['食驗室獎金', 1],
    ['純廣獎金', 2],
    ['專案簽約獎金', 3],
    ['專案結案獎金', 4],
    ['開發獎金', 5]
  ].forEach(([typeName, order]) => seedStmt.run(typeName, order));
  console.log('✓ 寫入預設獎金類型（沿用原本寫死的 5 種）');

  console.log('✓ 獎金類型可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
