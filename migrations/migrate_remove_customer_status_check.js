const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行移除 customers.status CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='customers'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 customers 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    // 只鎖定 status 欄位本身的 CHECK，customers 表上還有 party_type/vendor_type/
    // customer_level 等其他 CHECK，正則要求緊接在 "CHECK(" 後面就是 "status"，
    // 不會誤動其他欄位
    const hasOldCheckConstraint = /CHECK\s*\(\s*status\s+IN\s*\(/.test(createTableSql);

    if (!hasOldCheckConstraint) {
      console.log('✓ customers.status CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 status CHECK 約束，開始移除...');

    const currentColumns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);

    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*status\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?customers"?\s*\(/, 'CREATE TABLE IF NOT EXISTS customers_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    // customers 被 v_project_summary 等視圖引用，動態抓出來，重建完成後復原
    const dependentViews = db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='view' AND sql LIKE '%customers%'`
    ).all();

    const transaction = db.transaction(() => {
      console.log('移除依賴 customers 的檢視表...');
      dependentViews.forEach(v => db.exec(`DROP VIEW IF EXISTS ${v.name}`));

      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO customers_new (${colList}) SELECT ${colList} FROM customers`);

      console.log('刪除舊表...');
      db.exec(`DROP TABLE customers`);

      console.log('重新命名表...');
      db.exec(`ALTER TABLE customers_new RENAME TO customers`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    console.log('重建索引...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_owner_salesperson ON customers(owner_salesperson_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type)`);

    console.log('重建檢視表...');
    dependentViews.forEach(v => db.exec(v.sql));

    console.log('✓ customers.status CHECK 約束移除完成');
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
