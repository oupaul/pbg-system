/**
 * CRM 模組：客戶/廠商主檔新增地址欄位。
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

  console.log('開始執行客戶/廠商地址欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  if (!existingCols.has('address')) {
    db.exec(`ALTER TABLE customers ADD COLUMN address TEXT`);
    console.log('✓ customers 已新增 address');
  } else {
    console.log('  customers.address 已存在，略過');
  }

  console.log('✓ 客戶/廠商地址欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
