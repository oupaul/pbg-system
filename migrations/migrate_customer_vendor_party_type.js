/**
 * CRM 模組：客戶管理擴充為「客戶與廠商管理」。
 *
 * 沿用既有的 customers 資料表與 customer_id 外鍵（projects/pipelines/activities
 * 都是靠這個關聯），不重新建表，只新增身份分類欄位：
 *  - party_type：這筆資料是「客戶」「廠商」還是「兩者皆是」，預設「客戶」以相容既有資料。
 *  - vendor_type：僅在具備廠商身份時才有意義，區分「個人」或「公司」。
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

  console.log('開始執行客戶/廠商身份分類欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  if (!existingCols.has('party_type')) {
    db.exec(`ALTER TABLE customers ADD COLUMN party_type TEXT NOT NULL DEFAULT '客戶' CHECK(party_type IN ('客戶', '廠商', '兩者皆是'))`);
    console.log('✓ customers 已新增 party_type（預設「客戶」，相容既有資料）');
  } else {
    console.log('  customers.party_type 已存在，略過');
  }

  if (!existingCols.has('vendor_type')) {
    db.exec(`ALTER TABLE customers ADD COLUMN vendor_type TEXT CHECK(vendor_type IS NULL OR vendor_type IN ('個人', '公司'))`);
    console.log('✓ customers 已新增 vendor_type（僅廠商身份適用）');
  } else {
    console.log('  customers.vendor_type 已存在，略過');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type)`);
  console.log('✓ 建立 idx_customers_party_type 索引');

  console.log('✓ 客戶/廠商身份分類欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
