/**
 * 成本類型（設備/施工/控制/...）改為可自訂：建立 cost_types 表。
 *
 * costs.cost_type 目前是自由文字輸入框（無 CHECK 約束），但完全沒有後台管理、
 * 不同筆資料容易打成不一致的字（例如「設備」「設備費」都存在）。這裡建表，
 * 種子資料改為同步 costs 裡實際已使用過的類型（比照 migrate_activity_types.js
 * 的做法），讓既有安裝升級後既有資料的分類不變，但全新安裝不會被硬塞一份
 * 不屬於自己的分類清單。
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

  console.log('開始執行成本類型可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 cost_types 表');

  try {
    const usedTypes = db.prepare(`
      SELECT DISTINCT cost_type FROM costs
      WHERE cost_type IS NOT NULL AND cost_type != ''
    `).all().map(r => r.cost_type);

    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO cost_types (type_name, display_order) VALUES (?, ?)
    `);
    usedTypes.forEach((typeName, idx) => {
      seedStmt.run(typeName, idx + 1);
    });
    console.log(usedTypes.length > 0
      ? `✓ 同步 ${usedTypes.length} 個既有安裝已使用過的成本類型`
      : '✓ 尚無已使用過的成本類型，cost_types 保持空白，請於「成本類型管理」自行新增');
  } catch (err) {
    console.warn('⚠️ 無法同步既有成本類型（可能 costs 表不存在）:', err.message);
  }

  console.log('✓ 成本類型可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
