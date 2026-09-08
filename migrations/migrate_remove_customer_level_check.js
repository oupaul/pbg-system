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

  console.log('開始執行移除 customers.customer_level CHECK 約束遷移...');

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
    const hasOldCheckConstraint = createTableSql.includes(
      "CHECK(customer_level IS NULL OR customer_level IN ('A', 'B', 'C'))"
    );

    if (!hasOldCheckConstraint) {
      console.log('✓ customers.customer_level CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 customer_level CHECK 約束，開始移除...');

    // 取得目前 customers 的完整欄位清單（不依賴硬編碼，涵蓋所有歷史 migration 加過的欄位）
    const currentColumns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);

    // 從現有 CREATE SQL 移除 CHECK 約束並改名為 customers_new
    // 表名可能帶雙引號（SQLite 的 ALTER TABLE RENAME 會把表名正規化成加引號的形式，
    // customers 先前已被 migrate_customer_owner_to_user 重新命名過一次，此時已是 "customers"），
    // 用 \b 在引號後面不會匹配，改成明確處理可能的引號
    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*customer_level\s+IS\s+NULL\s+OR\s+customer_level\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?customers"?\s*\(/, 'CREATE TABLE IF NOT EXISTS customers_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    // customers 被 v_project_summary 等視圖引用，DROP+RENAME 期間視圖會暫時失效，
    // 動態抓出所有引用 customers 的視圖記錄其定義，重建完成後用原始 SQL 復原
    // （不寫死視圖名稱，以後多了新視圖也會自動涵蓋到）
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

    // 重建索引（表重建後全部消失）
    console.log('重建索引...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_owner_salesperson ON customers(owner_salesperson_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type)`);

    // 重建依賴 customers 的檢視表（用步驟前抓到的原始 SQL，內容不變，純粹因為表被重建過要重新指向）
    console.log('重建檢視表...');
    dependentViews.forEach(v => db.exec(v.sql));

    console.log('✓ customers.customer_level CHECK 約束移除完成');
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
