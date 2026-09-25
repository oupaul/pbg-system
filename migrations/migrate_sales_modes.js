/**
 * 專案「銷售模式」（直接銷售/經銷/代理/政府標案等）：建立可自訂的 sales_modes 選項表，
 * 並在 projects 新增 sales_mode 欄位。
 *
 * 純標籤欄位，不驅動任何計算或流程。選項清單不預設塞任何值，由各公司到
 * 「銷售模式管理」自行建立，避免把特定公司的分類硬塞給其他公司。
 * v_project_summary 視圖刻意不含此欄位（讀取時另行補查），所以新增欄位不會影響視圖。
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

  console.log('開始執行專案銷售模式遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 sales_modes 表（不預設任何選項，請於「銷售模式管理」自行新增）');

  const cols = db.prepare('PRAGMA table_info(projects)').all();
  if (!cols.some(c => c.name === 'sales_mode')) {
    db.exec('ALTER TABLE projects ADD COLUMN sales_mode TEXT');
    console.log('✓ projects.sales_mode 新增完成');
  } else {
    console.log('  projects.sales_mode 已存在，略過');
  }

  console.log('✓ 專案銷售模式遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
