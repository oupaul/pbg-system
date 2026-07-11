/**
 * CRM 模組：客戶/廠商主檔新增銀行帳戶資訊欄位（付款/匯款用）。
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

  console.log('開始執行客戶/廠商銀行帳戶欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  if (!existingCols.has('bank_name')) {
    db.exec(`ALTER TABLE customers ADD COLUMN bank_name TEXT`);
    console.log('✓ customers 已新增 bank_name');
  } else {
    console.log('  customers.bank_name 已存在，略過');
  }

  if (!existingCols.has('bank_account')) {
    db.exec(`ALTER TABLE customers ADD COLUMN bank_account TEXT`);
    console.log('✓ customers 已新增 bank_account');
  } else {
    console.log('  customers.bank_account 已存在，略過');
  }

  console.log('✓ 客戶/廠商銀行帳戶欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
