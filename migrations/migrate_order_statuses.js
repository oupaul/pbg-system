/**
 * 成本明細新增「下單狀態」欄位（報價回簽/簽約用印），並建立可自訂的選項表。
 *
 * 全新欄位無歷史資料可同步，兩種安裝都直接塞入常見的兩個下單審核階段當
 * 預設值，公司可自行在後台修改成自己實際的採購簽核流程說法。
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

  console.log('開始執行成本下單狀態遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 order_statuses 表');

  const defaults = [['報價回簽', 'info', 1], ['簽約用印', 'success', 2]];
  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO order_statuses (status_name, badge_color, display_order) VALUES (?, ?, ?)
  `);
  defaults.forEach(([name, color, order]) => seedStmt.run(name, color, order));
  console.log('✓ 種入預設下單狀態（報價回簽/簽約用印）');

  const cols = db.prepare('PRAGMA table_info(costs)').all();
  if (!cols.some(c => c.name === 'order_status')) {
    db.exec('ALTER TABLE costs ADD COLUMN order_status TEXT');
    console.log('✓ costs.order_status 新增完成');
  } else {
    console.log('  costs.order_status 已存在，略過');
  }

  console.log('✓ 成本下單狀態遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
