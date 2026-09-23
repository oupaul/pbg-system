/**
 * 移除 approval_chain_steps.approval_type 的 CHECK 約束。
 *
 * 原本建表時只寫死允許 'customer_creation'/'deletion' 兩種（見
 * migrate_approval_chains.js），這次要新增第三種 'invoice_request'（發票開立
 * 申請審核）。比照 CLAUDE.md 對新 migration 的既有告誡（避免對欄位下死值
 * CHECK 約束清單），這裡選擇直接移除 CHECK，而不是改成三選一——之後若還要
 * 加第四種申請類型，不用再動一次表結構。這張表沒有視圖依賴、體積小，風險低。
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

  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行移除 approval_chain_steps.approval_type CHECK 約束遷移...');

  try {
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='approval_chain_steps'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 approval_chain_steps 表，跳過遷移');
      db.close();
      return;
    }

    const createTableSql = tableInfo.sql;
    const hasOldCheckConstraint = /CHECK\s*\(\s*approval_type\s+IN\s*\(/.test(createTableSql);

    if (!hasOldCheckConstraint) {
      console.log('✓ approval_chain_steps.approval_type CHECK 約束已不存在，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 approval_type CHECK 約束，開始移除...');

    const currentColumns = db.prepare('PRAGMA table_info(approval_chain_steps)').all().map(c => c.name);

    const newTableSql = createTableSql
      .replace(/CHECK\s*\(\s*approval_type\s+IN\s*\([^)]+\)\s*\)/g, '')
      .replace(/^CREATE TABLE\s+"?approval_chain_steps"?\s*\(/, 'CREATE TABLE IF NOT EXISTS approval_chain_steps_new (');

    console.log('暫時禁用外鍵約束...');
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction(() => {
      console.log('創建新表結構（移除 CHECK 約束）...');
      db.exec(newTableSql);

      console.log('複製資料...');
      const colList = currentColumns.join(', ');
      db.exec(`INSERT INTO approval_chain_steps_new (${colList}) SELECT ${colList} FROM approval_chain_steps`);

      console.log('刪除舊表...');
      db.exec(`DROP TABLE approval_chain_steps`);

      console.log('重新命名表...');
      db.exec(`ALTER TABLE approval_chain_steps_new RENAME TO approval_chain_steps`);
    });

    transaction();

    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    console.log('✓ approval_chain_steps.approval_type CHECK 約束移除完成');
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
