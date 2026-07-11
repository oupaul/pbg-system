/**
 * CRM 模組：刪除審核機制。
 *
 * 沒有 can_delete 權限的角色（例如業務員）執行刪除動作時，不直接刪除資料，
 * 而是建立一筆待審核的刪除申請；由具備 can_delete 權限的角色（專案管理員／
 * 系統管理員）核准後才會真正執行刪除，駁回則資料維持不變。
 *
 * target_type/target_id 採通用設計，目前用於 pipeline、activity，未來可延伸
 * 至其他實體而不需要另外建表。
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

  console.log('開始執行刪除審核機制遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('pipeline', 'activity')),
      target_id INTEGER NOT NULL,
      target_summary TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_by_name TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_note TEXT
    )
  `);
  console.log('✓ 建立 deletion_requests 表');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_requests_target ON deletion_requests(target_type, target_id)`);
  console.log('✓ 建立 deletion_requests 索引');

  console.log('✓ 刪除審核機制遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
