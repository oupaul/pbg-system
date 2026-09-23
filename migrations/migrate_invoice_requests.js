/**
 * 發票開立申請單：業務先送出申請（含逐項明細），經審核後財務才依現有「新增發票」
 * 流程手動輸入真正的發票號碼/日期——申請單跟正式發票是兩筆獨立紀錄，只靠
 * project_id 互相參照，核准不會自動建立 invoices 紀錄。
 *
 * 審核機制比照 customer_creation_requests / deletion_requests，共用
 * approval_chain_steps（approval_type = 'invoice_request'），current_step
 * 直接建在初版欄位裡（不像前兩者是後補的獨立 migration，因為這張表本身就是
 * 全新建立，沒有既有資料需要相容）。
 *
 * 「申請類型」刻意不做成可自訂選項表，先用自由文字——目前只有「勞務收入」
 * 一個已知值，沒有明確跡象顯示需要大量自訂，避免多開一張目前看不出需求的
 * 管理表。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  console.log('開始執行發票開立申請單遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request_type TEXT,
      quote_number TEXT,
      recipient_name TEXT,
      recipient_address TEXT,
      recipient_phone TEXT,
      subtotal_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      request_status TEXT NOT NULL DEFAULT 'pending' CHECK(request_status IN ('pending', 'approved', 'rejected')),
      current_step INTEGER DEFAULT 1,
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_by_name TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 invoice_requests 表');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_invoice_requests_project ON invoice_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_requests_status ON invoice_requests(request_status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_request_id INTEGER NOT NULL REFERENCES invoice_requests(id) ON DELETE CASCADE,
      item_order INTEGER DEFAULT 0,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 invoice_request_items 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_request_items_request ON invoice_request_items(invoice_request_id)`);

  console.log('✓ 發票開立申請單遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
