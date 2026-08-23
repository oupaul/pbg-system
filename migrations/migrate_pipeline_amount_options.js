/**
 * 銷售機會「預估金額」下拉選項改由管理者自訂，取代原本寫死在
 * src/views/pipelines/form.ejs 的 [100000, 300000, 500000]。
 *
 * pipelines.estimated_amount 本身是自由數值欄位，不會參照這張表，
 * 所以刪除／停用選項不影響既有銷售機會的金額。
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
  db.pragma('foreign_keys = ON');

  console.log('開始執行銷售機會金額選項遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_amount_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 pipeline_amount_options 表');

  // 沿用原本寫死的三個選項作為預設值，讓既有安裝升級後行為不變
  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO pipeline_amount_options (amount, display_order) VALUES (?, ?)
  `);
  [[100000, 1], [300000, 2], [500000, 3]].forEach(([amount, order]) => seedStmt.run(amount, order));
  console.log('✓ 寫入預設金額選項（10萬／30萬／50萬）');

  console.log('✓ 銷售機會金額選項遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
