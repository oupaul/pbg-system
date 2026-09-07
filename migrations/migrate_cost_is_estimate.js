/**
 * 成本明細新增 is_estimate 欄位，區分「預估成本」與「實際成本」
 * （原本只有單一 amount 欄位，無法在同一張成本明細表裡分辨預估與已發生的支出）。
 * 預設 0（實際），既有資料本來就是已發生的成本，語意不變。
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const cols = db.prepare('PRAGMA table_info(costs)').all();
    const hasIsEstimate = cols.some(c => c.name === 'is_estimate');
    if (hasIsEstimate) {
      console.log('✓ costs.is_estimate 已存在，跳過遷移');
      db.close();
      return;
    }
    console.log('為 costs 新增 is_estimate 欄位...');
    db.exec('ALTER TABLE costs ADD COLUMN is_estimate INTEGER NOT NULL DEFAULT 0');
    console.log('✓ costs 預估/實際欄位新增完成');
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
