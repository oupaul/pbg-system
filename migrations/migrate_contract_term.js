/**
 * 專案新增 contract_term 欄位，記錄合約年限（例如「1年」「3年」）。
 * 純顯示/查詢用的自由文字欄位，不牽涉續約提醒或營收分期認列邏輯，
 * 因此不加 CHECK 約束、不影響匯出/儀表板/列表頁。
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const cols = db.prepare('PRAGMA table_info(projects)').all();
    const hasContractTerm = cols.some(c => c.name === 'contract_term');
    if (hasContractTerm) {
      console.log('✓ projects.contract_term 已存在，跳過遷移');
      db.close();
      return;
    }
    console.log('為 projects 新增 contract_term 欄位...');
    db.exec('ALTER TABLE projects ADD COLUMN contract_term TEXT');
    console.log('✓ projects.contract_term 新增完成');
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
