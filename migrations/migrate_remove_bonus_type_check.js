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

  console.log('開始執行移除 bonus_type CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='bonus_calculations'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 bonus_calculations 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    const hasOldCheckConstraint = createTableSql.includes(
      "CHECK(bonus_type IN ('食驗室獎金', '純廣獎金', '專案簽約獎金', '專案結案獎金', '開發獎金'))"
    );

    if (!hasOldCheckConstraint) {
      console.log('✓ bonus_type CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 bonus_type CHECK 約束，開始移除...');

    // 取得目前 bonus_calculations 的完整欄位清單（不依賴硬編碼）
    const currentColumns = db.prepare('PRAGMA table_info(bonus_calculations)').all().map(c => c.name);

    // 從現有 CREATE SQL 移除 CHECK 約束並改名為 bonus_calculations_new
    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*bonus_type\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+(?:"bonus_calculations"|bonus_calculations)\b/, 'CREATE TABLE IF NOT EXISTS bonus_calculations_new');

    // 暫時禁用外鍵約束（bonus_calculations 本身有指向 projects/salespeople 的 FK，
    // 沒有其他表反過來參照 bonus_calculations，但比照既有先例一併停用比較保險）
    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction(() => {
      // 0. 先移除依賴舊表的檢視表（只有 v_bonus_summary 會用到 bonus_calculations，
      //    v_project_summary 不會參照這張表，不用動）
      console.log('移除舊的檢視表...');
      db.exec(`DROP VIEW IF EXISTS v_bonus_summary`);

      // 1. 用現有結構建立 bonus_calculations_new（只移除 CHECK，保留所有欄位）
      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      // 2. 用明確欄位名複製資料
      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO bonus_calculations_new (${colList}) SELECT ${colList} FROM bonus_calculations`);

      // 3. 刪除舊表
      console.log('刪除舊表...');
      db.exec(`DROP TABLE bonus_calculations`);

      // 4. 重新命名新表
      console.log('重新命名表...');
      db.exec(`ALTER TABLE bonus_calculations_new RENAME TO bonus_calculations`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    // 5. 重建索引（表重建後全部消失，原本有 4 個，兩組同用途但不同名字都要補回）
    console.log('重建索引...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_project ON bonus_calculations(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_salesperson ON bonus_calculations(salesperson_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_calcs_salesperson ON bonus_calculations(salesperson_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_calcs_project ON bonus_calculations(project_id)`);

    // 6. 重建 v_bonus_summary 檢視表（SQL 內容不變，純粹因為表被重建過要重新指向）
    console.log('重建檢視表...');
    db.exec(`
      CREATE VIEW v_bonus_summary AS
      SELECT
        bc.id,
        bc.project_id,
        p.project_code,
        p.project_name,
        p.project_type,
        bc.salesperson_id,
        s.name as salesperson_name,
        bc.bonus_type,
        bc.base_amount,
        bc.bonus_percentage,
        bc.bonus_amount,
        bc.payment_date,
        bc.status,
        bc.forfeiture_reason
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      JOIN salespeople s ON bc.salesperson_id = s.id
    `);

    console.log('✓ bonus_type CHECK 約束移除完成');
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
