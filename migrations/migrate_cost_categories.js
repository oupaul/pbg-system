/**
 * 成本明細新增「費用類別」欄位（既有/追加），並建立可自訂的選項表。
 *
 * 這是全新欄位，既有安裝沒有任何歷史資料可同步，所以兩種安裝都直接塞入
 * 「既有/追加」這組近乎通用的專案成本分類（原始 vs 變更/追加項目），
 * 公司可自行在後台修改或停用。
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

  console.log('開始執行成本費用類別遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 cost_categories 表');

  db.prepare(`
    INSERT OR IGNORE INTO cost_categories (category_name, badge_color, display_order) VALUES (?, ?, ?)
  `).run('既有', 'primary', 1);
  db.prepare(`
    INSERT OR IGNORE INTO cost_categories (category_name, badge_color, display_order) VALUES (?, ?, ?)
  `).run('追加', 'warning', 2);
  console.log('✓ 種入預設費用類別（既有/追加）');

  const cols = db.prepare('PRAGMA table_info(costs)').all();
  if (!cols.some(c => c.name === 'cost_category')) {
    db.exec('ALTER TABLE costs ADD COLUMN cost_category TEXT');
    console.log('✓ costs.cost_category 新增完成');
  } else {
    console.log('  costs.cost_category 已存在，略過');
  }

  console.log('✓ 成本費用類別遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
