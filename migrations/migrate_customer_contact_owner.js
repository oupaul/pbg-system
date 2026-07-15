/**
 * CRM 模組：客戶主檔新增聯絡人資訊與負責業務欄位。
 *
 * - contact_name / contact_phone / contact_email：客戶窗口聯絡方式，
 *   業務在活動紀錄中拜訪/致電前可直接於客戶頁查詢。
 * - owner_salesperson_id：客戶層級的負責業務（區別於 projects/pipelines
 *   上各自的 salesperson_id，用於「這個業務手上有哪些客戶」的歸屬管理）。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  console.log('開始執行客戶聯絡人／負責業務欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  const columnsToAdd = [
    ['contact_name', 'TEXT'],
    ['contact_phone', 'TEXT'],
    ['contact_email', 'TEXT'],
    ['owner_salesperson_id', 'INTEGER REFERENCES salespeople(id) ON DELETE SET NULL']
  ];

  for (const [name, def] of columnsToAdd) {
    if (!existingCols.has(name)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${def}`);
      console.log(`✓ customers 已新增 ${name}`);
    } else {
      console.log(`  customers.${name} 已存在，略過`);
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_owner_salesperson ON customers(owner_salesperson_id)`);
  console.log('✓ 建立 idx_customers_owner_salesperson 索引');

  console.log('✓ 客戶聯絡人／負責業務欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
