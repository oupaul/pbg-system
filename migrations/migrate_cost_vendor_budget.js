/**
 * 成本明細新增「廠商」與「預估／實際」兩個獨立金額欄位。
 *
 * 原本每筆成本只有單一 amount 欄位，且不知道是付給哪個廠商。改成每筆成本
 * 都可以綁定客戶/廠商表裡的廠商（vendor_id），並同時記錄 estimated_amount
 * （預估金額）與 actual_amount（實際金額），同一列就能直接看出預估與實際
 * 的落差，不用像單純用狀態欄位標記那樣還要自己對應是哪兩筆。
 *
 * 既有資料的 amount 一律視為已發生的實際支出，回填進 actual_amount；
 * estimated_amount 預設 0（既有資料本來就沒有估算過，不會失真）。
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const cols = db.prepare('PRAGMA table_info(costs)').all();
    const colNames = new Set(cols.map(c => c.name));

    if (!colNames.has('vendor_id')) {
      console.log('為 costs 新增 vendor_id 欄位...');
      db.exec('ALTER TABLE costs ADD COLUMN vendor_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
      console.log('✓ costs.vendor_id 新增完成');
    } else {
      console.log('  costs.vendor_id 已存在，略過');
    }

    if (!colNames.has('estimated_amount')) {
      console.log('為 costs 新增 estimated_amount 欄位...');
      db.exec('ALTER TABLE costs ADD COLUMN estimated_amount REAL NOT NULL DEFAULT 0');
      console.log('✓ costs.estimated_amount 新增完成');
    } else {
      console.log('  costs.estimated_amount 已存在，略過');
    }

    if (!colNames.has('actual_amount')) {
      console.log('為 costs 新增 actual_amount 欄位...');
      db.exec('ALTER TABLE costs ADD COLUMN actual_amount REAL NOT NULL DEFAULT 0');
      console.log('✓ costs.actual_amount 新增完成');

      console.log('回填既有成本資料的實際金額（amount → actual_amount）...');
      const result = db.prepare('UPDATE costs SET actual_amount = amount WHERE actual_amount = 0').run();
      console.log(`✓ 已回填 ${result.changes} 筆既有成本資料`);
    } else {
      console.log('  costs.actual_amount 已存在，略過（不重複回填，避免覆蓋已手動調整過的資料）');
    }

    console.log('✓ 成本明細廠商/預估實際金額遷移完成');
    db.close();
  } catch (err) {
    console.error('遷移失敗:', err);
    if (db) db.close();
    throw err;
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
