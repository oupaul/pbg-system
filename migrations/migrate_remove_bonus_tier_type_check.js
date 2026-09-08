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

  console.log('開始執行移除 bonus_tiers.project_type CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='bonus_tiers'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 bonus_tiers 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    const hasOldCheckConstraint = /CHECK\s*\(\s*project_type\s+IN\s*\(/.test(createTableSql);

    if (!hasOldCheckConstraint) {
      console.log('✓ bonus_tiers.project_type CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 project_type CHECK 約束，開始移除...');

    // 這張表目前沒有其他表用 FK 參照它、也沒有視圖依賴（獎金級距設定純粹是給
    // 後台管理與新增獎金表單參考用），重建步驟不用處理視圖或索引
    const currentColumns = db.prepare('PRAGMA table_info(bonus_tiers)').all().map(c => c.name);

    // 表名可能帶雙引號（見 migrate_remove_customer_level_check.js 的說明：SQLite 的
    // ALTER TABLE RENAME 會把表名正規化成加引號的形式），用明確處理可能的引號取代 \b
    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*project_type\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?bonus_tiers"?\s*\(/, 'CREATE TABLE IF NOT EXISTS bonus_tiers_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction(() => {
      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO bonus_tiers_new (${colList}) SELECT ${colList} FROM bonus_tiers`);

      console.log('刪除舊表...');
      db.exec(`DROP TABLE bonus_tiers`);

      console.log('重新命名表...');
      db.exec(`ALTER TABLE bonus_tiers_new RENAME TO bonus_tiers`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    console.log('✓ bonus_tiers.project_type CHECK 約束移除完成');
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
