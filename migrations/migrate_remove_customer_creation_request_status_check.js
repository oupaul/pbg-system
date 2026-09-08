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

  console.log('開始執行移除 customer_creation_requests.status CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='customer_creation_requests'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 customer_creation_requests 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    // 只鎖定 status 欄位本身的 CHECK，這張表另外還有 request_status/party_type/
    // vendor_type/customer_level 的 CHECK，正則要求緊接在 "CHECK(" 後面就是
    // "status"，不會誤動 request_status 或其他欄位
    const hasOldCheckConstraint = /CHECK\s*\(\s*status\s+IN\s*\(/.test(createTableSql);

    if (!hasOldCheckConstraint) {
      console.log('✓ customer_creation_requests.status CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 status CHECK 約束，開始移除...');

    const currentColumns = db.prepare('PRAGMA table_info(customer_creation_requests)').all().map(c => c.name);

    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*status\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?customer_creation_requests"?\s*\(/, 'CREATE TABLE IF NOT EXISTS customer_creation_requests_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction(() => {
      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO customer_creation_requests_new (${colList}) SELECT ${colList} FROM customer_creation_requests`);

      console.log('刪除舊表...');
      db.exec(`DROP TABLE customer_creation_requests`);

      console.log('重新命名表...');
      db.exec(`ALTER TABLE customer_creation_requests_new RENAME TO customer_creation_requests`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    console.log('重建索引...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_creation_requests_status ON customer_creation_requests(request_status)`);

    console.log('✓ customer_creation_requests.status CHECK 約束移除完成');
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
