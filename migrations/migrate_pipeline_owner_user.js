/**
 * CRM 模組：潛在商機新增「負責人員」欄位（可指派任一啟用中的公司使用者），
 * 與原本用於獎金/業績計算的「業務人員」(salesperson_id，仍指向 salespeople) 分開，
 * 純粹作為 CRM 追蹤用途，不影響獎金計算、業績報表與角色權限範圍過濾。
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

  console.log('開始執行潛在商機負責人員欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(pipelines)').all();
  const existingCols = new Set(tableInfo.map(c => c.name));

  if (!existingCols.has('owner_user_id')) {
    db.exec(`ALTER TABLE pipelines ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_owner_user ON pipelines(owner_user_id)`);
    console.log('✓ pipelines 已新增 owner_user_id');
  } else {
    console.log('  pipelines.owner_user_id 已存在，略過');
  }

  console.log('✓ 潛在商機負責人員欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
