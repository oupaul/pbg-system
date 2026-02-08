/**
 * 專案範本：建立 project_templates 表
 */
const db = require('../src/models/db');

function migrate() {
  console.log('開始專案範本遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      project_type TEXT,
      salesperson_id INTEGER,
      customer_id INTEGER,
      project_name TEXT,
      price_with_tax REAL DEFAULT 0,
      price_without_tax REAL DEFAULT 0,
      is_new_customer INTEGER DEFAULT 0,
      expected_invoice_year_month TEXT,
      sales_discount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (salesperson_id) REFERENCES salespeople(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);
  console.log('✓ project_templates 表已建立');

  console.log('✓ 專案範本遷移完成');
}

migrate();
