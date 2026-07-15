/**
 * CRM 模組：客戶主檔新增等級、產業別、往來狀態欄位。
 *
 * - customer_level：業務分級（A/B/C），可搭配 Pipeline 預估金額篩選高價值客戶。
 * - industry：產業別自由文字，供之後依產業分析商機轉換率。
 * - status：往來狀態（往來中/暫停往來/已流失），預設「往來中」。
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

  console.log('開始執行客戶等級／產業別／狀態欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  if (!existingCols.has('customer_level')) {
    db.exec(`ALTER TABLE customers ADD COLUMN customer_level TEXT CHECK(customer_level IS NULL OR customer_level IN ('A', 'B', 'C'))`);
    console.log('✓ customers 已新增 customer_level');
  } else {
    console.log('  customers.customer_level 已存在，略過');
  }

  if (!existingCols.has('industry')) {
    db.exec(`ALTER TABLE customers ADD COLUMN industry TEXT`);
    console.log('✓ customers 已新增 industry');
  } else {
    console.log('  customers.industry 已存在，略過');
  }

  if (!existingCols.has('status')) {
    db.exec(`ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT '往來中' CHECK(status IN ('往來中', '暫停往來', '已流失'))`);
    console.log('✓ customers 已新增 status（預設「往來中」）');
  } else {
    console.log('  customers.status 已存在，略過');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)`);
  console.log('✓ 建立 idx_customers_status 索引');

  console.log('✓ 客戶等級／產業別／狀態欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
