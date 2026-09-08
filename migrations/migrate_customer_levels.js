/**
 * 客戶等級改為可自訂：建立 customer_levels 表。
 *
 * customers.customer_level 與 customer_creation_requests.customer_level 目前都用
 * CHECK 約束寫死成 A/B/C 三種固定值，不同公司裝上這套系統後沒辦法自行調整
 * 名稱或顏色。這裡先建表、種子資料沿用現有畫面上的顏色（A=success/B=warning/
 * C=secondary），讓既有安裝升級後視覺完全不變；CHECK 約束的移除交給接下來
 * 兩支 migration（migrate_remove_customer_level_check、
 * migrate_remove_customer_creation_request_level_check）分別處理。
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

  console.log('開始執行客戶等級可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 customer_levels 表');

  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO customer_levels (level_name, badge_color, display_order) VALUES (?, ?, ?)
  `);
  [
    ['A', 'success', 1],
    ['B', 'warning', 2],
    ['C', 'secondary', 3]
  ].forEach(([levelName, color, order]) => seedStmt.run(levelName, color, order));
  console.log('✓ 寫入預設客戶等級（沿用原本寫死的 A/B/C，顏色與既有畫面一致）');

  console.log('✓ 客戶等級可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
