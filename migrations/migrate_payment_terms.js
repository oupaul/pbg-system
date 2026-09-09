/**
 * 成本明細新增「付款條件」欄位（即時/月結30/月結60），並建立可自訂的選項表。
 *
 * 全新欄位無歷史資料可同步，兩種安裝都直接塞入常見的三種付款條件當預設值，
 * 公司可自行在後台修改為自己實際採用的條件（例如月結90、預付等）。
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

  console.log('開始執行成本付款條件遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 payment_terms 表');

  const defaults = [['即時', 'success', 1], ['月結30', 'info', 2], ['月結60', 'warning', 3]];
  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO payment_terms (term_name, badge_color, display_order) VALUES (?, ?, ?)
  `);
  defaults.forEach(([name, color, order]) => seedStmt.run(name, color, order));
  console.log('✓ 種入預設付款條件（即時/月結30/月結60）');

  const cols = db.prepare('PRAGMA table_info(costs)').all();
  if (!cols.some(c => c.name === 'payment_term')) {
    db.exec('ALTER TABLE costs ADD COLUMN payment_term TEXT');
    console.log('✓ costs.payment_term 新增完成');
  } else {
    console.log('  costs.payment_term 已存在，略過');
  }

  console.log('✓ 成本付款條件遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
