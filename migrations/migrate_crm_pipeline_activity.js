/**
 * CRM 模組：建立 pipelines（潛在商機）與 activities（客戶活動紀錄）兩張表。
 *
 * 設計重點：
 *  - pipelines 不直接持有 project_code，成交後由財務人員在「轉入專案」表單
 *    補上專案編號，才會真正寫入 projects 表（projects.project_code 為 NOT NULL
 *    且與 project_type、customer_id 有唯一約束，無法由系統自動產生）。
 *  - converted_project_id 記錄轉換後對應的 projects.id，避免重複轉換。
 *  - activities 記錄業務對客戶的拜訪/電話/客訴等紀錄，與稽核用的 system_logs
 *    是不同概念，故獨立建表。
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

  console.log('開始執行 CRM（潛在商機／活動紀錄）遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      salesperson_id INTEGER REFERENCES salespeople(id),
      opportunity_name TEXT NOT NULL,
      project_type TEXT,
      estimated_amount REAL DEFAULT 0,
      win_probability INTEGER CHECK(win_probability IS NULL OR (win_probability >= 0 AND win_probability <= 100)),
      expected_close_year_month TEXT,
      status TEXT NOT NULL DEFAULT '洽談中' CHECK(status IN ('洽談中', '已成交', '已流失')),
      lost_reason TEXT,
      notes TEXT,
      converted_project_id INTEGER REFERENCES projects(id),
      converted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      deleted_at TEXT
    )
  `);
  console.log('✓ 建立 pipelines 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_customer ON pipelines(customer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_salesperson ON pipelines(salesperson_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status)`);
  console.log('✓ 建立 pipelines 索引');

  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      pipeline_id INTEGER REFERENCES pipelines(id),
      activity_type TEXT NOT NULL DEFAULT '其他' CHECK(activity_type IN ('拜訪', '電話', '客訴', '其他')),
      content TEXT NOT NULL,
      activity_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      deleted_at TEXT
    )
  `);
  console.log('✓ 建立 activities 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_pipeline ON activities(pipeline_id)`);
  console.log('✓ 建立 activities 索引');

  console.log('✓ CRM 遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
