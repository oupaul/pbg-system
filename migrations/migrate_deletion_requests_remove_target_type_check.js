/**
 * deletion_requests.target_type 原本被 CHECK 寫死限制在 ('pipeline', 'activity')，
 * 與建表時本身註明的「通用設計，未來可延伸至其他實體」互相矛盾——
 * 新增客戶/廠商刪除審核（target_type = 'customer'）時就直接撞到這個 CHECK 約束失敗。
 * 移除這個限制性 CHECK，是否支援某個 target_type 交由應用層的 DELETE_HANDLERS 判斷即可。
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
  db.pragma('foreign_keys = OFF');

  console.log('開始執行移除 deletion_requests.target_type CHECK 約束遷移...');

  const schemaResult = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='deletion_requests'`).get();
  const currentSchema = schemaResult?.sql || '';
  const hasRestrictiveCheck = currentSchema.includes('target_type') && currentSchema.includes("CHECK(target_type IN");

  if (!hasRestrictiveCheck) {
    console.log('✓ deletion_requests.target_type 已無限制性 CHECK 約束，無需遷移');
    db.pragma('foreign_keys = ON');
    db.close();
    return;
  }

  db.exec('BEGIN TRANSACTION');
  try {
    db.exec(`
      CREATE TABLE deletion_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL,
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

    db.exec(`
      INSERT INTO deletion_requests_new (
        id, target_type, target_id, target_summary, reason, status,
        requested_by, requested_by_name, requested_at,
        reviewed_by, reviewed_by_name, reviewed_at, review_note
      )
      SELECT
        id, target_type, target_id, target_summary, reason, status,
        requested_by, requested_by_name, requested_at,
        reviewed_by, reviewed_by_name, reviewed_at, review_note
      FROM deletion_requests
    `);

    db.exec('DROP TABLE deletion_requests');
    db.exec('ALTER TABLE deletion_requests_new RENAME TO deletion_requests');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_requests_target ON deletion_requests(target_type, target_id)`);

    db.exec('COMMIT');
    console.log('✓ deletion_requests.target_type CHECK 約束移除完成');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  db.pragma('foreign_keys = ON');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
