/**
 * CRM 模組：新客戶/廠商審核機制。
 *
 * 非「系統管理員」「專案管理員」角色（例如業務員、自訂角色）新增客戶/廠商時，
 * 不會直接寫入 customers 表，而是先建立一筆待審核的申請，記錄完整的送審資料；
 * 由系統管理員或專案管理員核准後，才會真正呼叫 Customer.create() 讓資料進入系統，
 * 駁回則不會建立客戶資料。
 *
 * 這裡選擇獨立建表（而非沿用 deletion_requests 的通用 target_type/target_id 設計），
 * 是因為刪除審核只需要引用「已存在資料的 id」，但新增審核當下客戶資料尚不存在，
 * 必須完整保存送審時填寫的所有欄位，核准當下才真正建立 customers 資料列。
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

  console.log('開始執行新客戶/廠商審核機制遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_creation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL,
      tax_id TEXT,
      company_name TEXT NOT NULL,
      party_type TEXT NOT NULL DEFAULT '客戶' CHECK(party_type IN ('客戶', '廠商', '兩者皆是')),
      vendor_type TEXT CHECK(vendor_type IS NULL OR vendor_type IN ('個人', '公司')),
      owner_salesperson_id INTEGER REFERENCES users(id),
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      bank_name TEXT,
      bank_account TEXT,
      address TEXT,
      customer_level TEXT CHECK(customer_level IS NULL OR customer_level IN ('A', 'B', 'C')),
      industry TEXT,
      status TEXT NOT NULL DEFAULT '往來中' CHECK(status IN ('往來中', '暫停往來', '已流失')),
      is_new_customer INTEGER DEFAULT 0,
      request_status TEXT NOT NULL DEFAULT 'pending' CHECK(request_status IN ('pending', 'approved', 'rejected')),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_by_name TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_note TEXT,
      created_customer_id INTEGER REFERENCES customers(id)
    )
  `);
  console.log('✓ 建立 customer_creation_requests 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_creation_requests_status ON customer_creation_requests(request_status)`);
  console.log('✓ 建立 customer_creation_requests 索引');

  console.log('✓ 新客戶/廠商審核機制遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
