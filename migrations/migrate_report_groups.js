/**
 * 報表群組：建立 report_groups 表，並在 projects 表新增 report_group_id 欄位
 * 用於毛利分析「依群組彙總」及專案歸屬群組。
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

  console.log('開始執行報表群組遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 report_groups 表');

  const tableInfo = db.prepare('PRAGMA table_info(projects)').all();
  const hasReportGroupId = tableInfo.some(col => col.name === 'report_group_id');
  if (!hasReportGroupId) {
    db.exec('ALTER TABLE projects ADD COLUMN report_group_id INTEGER REFERENCES report_groups(id) ON DELETE SET NULL');
    console.log('✓ projects 表已新增 report_group_id 欄位');
  } else {
    console.log('  projects.report_group_id 已存在，略過');
  }

  console.log('✓ 報表群組遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
