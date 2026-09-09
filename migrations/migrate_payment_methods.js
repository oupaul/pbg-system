/**
 * 成本明細新增「付款辦法」欄位（一次/二次/三次付款），並建立可自訂的選項表。
 *
 * 使用者確認做成下拉選單管理表而非純數字欄位，讓不同公司可以自訂自己的
 * 分期付款方式說法。全新欄位無歷史資料可同步，兩種安裝都直接塞入
 * 「一次/二次/三次」預設值。
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

  console.log('開始執行成本付款辦法遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 payment_methods 表');

  const defaults = [['一次', 'secondary', 1], ['二次', 'info', 2], ['三次', 'primary', 3]];
  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO payment_methods (method_name, badge_color, display_order) VALUES (?, ?, ?)
  `);
  defaults.forEach(([name, color, order]) => seedStmt.run(name, color, order));
  console.log('✓ 種入預設付款辦法（一次/二次/三次）');

  const cols = db.prepare('PRAGMA table_info(costs)').all();
  if (!cols.some(c => c.name === 'payment_method')) {
    db.exec('ALTER TABLE costs ADD COLUMN payment_method TEXT');
    console.log('✓ costs.payment_method 新增完成');
  } else {
    console.log('  costs.payment_method 已存在，略過');
  }

  console.log('✓ 成本付款辦法遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
