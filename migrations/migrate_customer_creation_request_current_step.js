const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  const db = new Database(dbPath);
  console.log('開始執行 customer_creation_requests 簽核進度欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(customer_creation_requests)').all();
  const hasCol = tableInfo.some(c => c.name === 'current_step');

  if (!hasCol) {
    db.exec(`ALTER TABLE customer_creation_requests ADD COLUMN current_step INTEGER DEFAULT 1`);
    console.log('✓ customer_creation_requests 已新增 current_step 欄位（預設 1）');
  } else {
    console.log('  customer_creation_requests.current_step 已存在，略過');
  }

  console.log('✓ customer_creation_requests 簽核進度欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
