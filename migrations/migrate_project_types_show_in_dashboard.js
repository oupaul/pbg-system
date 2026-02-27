/**
 * 新增 project_types.show_in_dashboard 欄位
 * 用於控制儀表板「專案類型分布」要顯示哪些類型（1=顯示，0=不顯示）
 */
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，跳過遷移');
    return;
  }

  const db = require('better-sqlite3')(dbPath);
  db.pragma('foreign_keys = ON');

  try {
    const cols = db.prepare("PRAGMA table_info(project_types)").all();
    const hasShowInDashboard = cols.some(c => c.name === 'show_in_dashboard');
    if (hasShowInDashboard) {
      console.log('show_in_dashboard 欄位已存在，跳過');
      db.close();
      return;
    }

    db.exec(`ALTER TABLE project_types ADD COLUMN show_in_dashboard INTEGER DEFAULT 1`);
    console.log('✓ 已新增 project_types.show_in_dashboard 欄位');
  } catch (err) {
    console.error('遷移失敗:', err.message);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
