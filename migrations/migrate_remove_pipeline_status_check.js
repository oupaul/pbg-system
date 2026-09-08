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

  console.log('開始執行移除 pipelines.status CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='pipelines'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 pipelines 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    const hasOldCheckConstraint = /CHECK\s*\(\s*status\s+IN\s*\(/.test(createTableSql);

    if (!hasOldCheckConstraint) {
      console.log('✓ pipelines.status CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 status CHECK 約束，開始移除...');

    // 這張表沒有視圖依賴，但有 activities.pipeline_id 這個 FK 參照它
    const currentColumns = db.prepare('PRAGMA table_info(pipelines)').all().map(c => c.name);

    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*status\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?pipelines"?\s*\(/, 'CREATE TABLE IF NOT EXISTS pipelines_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction(() => {
      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO pipelines_new (${colList}) SELECT ${colList} FROM pipelines`);

      console.log('刪除舊表...');
      db.exec(`DROP TABLE pipelines`);

      console.log('重新命名表...');
      db.exec(`ALTER TABLE pipelines_new RENAME TO pipelines`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    console.log('重建索引...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_customer ON pipelines(customer_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_salesperson ON pipelines(salesperson_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipelines_owner_user ON pipelines(owner_user_id)`);

    console.log('✓ pipelines.status CHECK 約束移除完成');
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
