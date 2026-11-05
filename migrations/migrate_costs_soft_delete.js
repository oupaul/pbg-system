/**
 * 成本明細軟刪除：costs 新增 deleted_at（UTC 字串，與發票／收款一致），刪除改為標記、可還原。
 * 既有資料 deleted_at 皆為 NULL（全部視為有效）；不改任何既有資料。可重複執行。
 * 另建部分索引加速「某專案的有效成本」查詢。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  try {
    const cols = db.prepare('PRAGMA table_info(costs)').all().map(c => c.name);
    if (cols.length === 0) {
      console.log('⚠️ 找不到 costs 表，跳過遷移');
      return;
    }
    if (!cols.includes('deleted_at')) {
      db.prepare('ALTER TABLE costs ADD COLUMN deleted_at TEXT').run();
      console.log('✓ costs 已新增 deleted_at');
    } else {
      console.log('  costs.deleted_at 已存在，略過');
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_costs_project_active ON costs(project_id) WHERE deleted_at IS NULL').run();
    console.log('✓ 索引 idx_costs_project_active 已就緒');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
