/**
 * CRM 模組：客戶/廠商「接洽人員」改為指向 users（公司使用者帳號），
 * 不再侷限於 salespeople（業務員）。
 *
 * customers.owner_salesperson_id 原本是 INTEGER REFERENCES salespeople(id)，
 * 改為不帶外鍵約束的一般 INTEGER 欄位（比照下方 findAll() 只在應用層挑選
 * is_active = 1 的使用者），並將既有資料依「業務員姓名 = 使用者姓名」
 * 對應改指向 users.id；找不到對應使用者的則清空。
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

  const schemaResult = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'").get();
  const currentSchema = schemaResult?.sql || '';

  if (!currentSchema.includes('owner_salesperson_id INTEGER REFERENCES salespeople')) {
    console.log('✓ customers.owner_salesperson_id 已無 salespeople 外鍵約束，無需遷移');
    db.close();
    return;
  }

  console.log('開始執行客戶/廠商接洽人員改指向 users 遷移...');

  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');

  try {
    // 0. customers 表被 v_project_summary 檢視表引用，SQLite 重建表格（DROP + RENAME）
    //    期間該檢視表會暫時失效，需先記錄其定義、刪除，重建表格完成後再重新建立
    const dependentViews = db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='view' AND sql LIKE '%customers%'`
    ).all();
    dependentViews.forEach(v => db.exec(`DROP VIEW IF EXISTS ${v.name}`));

    // 1. 建立新表結構（owner_salesperson_id 移除 REFERENCES salespeople 約束）
    db.exec(`
      CREATE TABLE customers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_code TEXT NOT NULL UNIQUE,
        tax_id TEXT,
        company_name TEXT NOT NULL,
        is_new_customer INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        contact_name TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        owner_salesperson_id INTEGER,
        customer_level TEXT CHECK(customer_level IS NULL OR customer_level IN ('A', 'B', 'C')),
        industry TEXT,
        status TEXT NOT NULL DEFAULT '往來中' CHECK(status IN ('往來中', '暫停往來', '已流失')),
        party_type TEXT NOT NULL DEFAULT '客戶' CHECK(party_type IN ('客戶', '廠商', '兩者皆是')),
        vendor_type TEXT CHECK(vendor_type IS NULL OR vendor_type IN ('個人', '公司')),
        bank_name TEXT,
        bank_account TEXT,
        address TEXT
      )
    `);

    // 2. 複製資料，owner_salesperson_id 依「業務員姓名 = 使用者姓名（啟用中）」重新對應
    //    SELECT 的欄位順序必須與 customers 原本的欄位順序完全一致，
    //    只將 owner_salesperson_id 替換成重新對應的子查詢，其餘欄位原樣複製。
    const columns = db.pragma('table_info(customers)').map(c => c.name);
    const columnList = columns.join(', ');
    const remapExpr = `(
          SELECT u.id FROM users u
          JOIN salespeople s ON s.name = u.name
          WHERE s.id = customers.owner_salesperson_id AND u.is_active = 1
          LIMIT 1
        )`;
    const selectList = columns
      .map(c => (c === 'owner_salesperson_id' ? `${remapExpr} AS owner_salesperson_id` : c))
      .join(', ');

    db.exec(`
      INSERT INTO customers_new (${columnList})
      SELECT ${selectList}
      FROM customers
    `);

    // 3. 刪除舊表並改名
    db.exec('DROP TABLE customers');
    db.exec('ALTER TABLE customers_new RENAME TO customers');

    // 4. 重建索引
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_owner_salesperson ON customers(owner_salesperson_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type)');

    // 5. 重新建立依賴 customers 的檢視表
    dependentViews.forEach(v => db.exec(v.sql));

    db.exec('COMMIT');
    console.log('✓ customers.owner_salesperson_id 已改為指向 users(id)');
  } catch (err) {
    db.exec('ROLLBACK');
    db.pragma('foreign_keys = ON');
    db.close();
    throw err;
  }

  db.pragma('foreign_keys = ON');
  db.close();
  console.log('✓ 客戶/廠商接洽人員遷移完成');
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
