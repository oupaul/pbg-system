/**
 * 多層簽核：建立 approval_chain_steps 表。
 *
 * customer_creation_requests（新客戶/廠商審核）與 deletion_requests（刪除審核）
 * 原本都只有單一層審核（一位具備對應權限旗標的人核准即定案）。這裡新增一張
 * 「簽核關卡設定」表，讓公司可以自行設定每種申請類型要依序經過哪些角色審核
 * （例如先主管、後總經理）。
 *
 * 種子資料刻意留空：多層簽核是否需要、需要幾關、由哪些角色審核，完全是每家
 * 公司自己的組織流程，沒有通用預設值可套。留空時，兩種申請類型都維持原本的
 * 單層審核行為（走 roles.can_approve_customer / roles.can_delete 旗標），
 * 既有安裝升級後行為完全不變；公司可到「簽核關卡設定」頁面自行新增關卡。
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

  console.log('開始執行多層簽核關卡設定遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_chain_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_type TEXT NOT NULL CHECK(approval_type IN ('customer_creation', 'deletion')),
      step_order INTEGER NOT NULL,
      role_key TEXT NOT NULL,
      step_name TEXT,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(approval_type, step_order)
    )
  `);
  console.log('✓ 建立 approval_chain_steps 表（未種入任何關卡，維持既有安裝的單層審核行為）');

  console.log('✓ 多層簽核關卡設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
