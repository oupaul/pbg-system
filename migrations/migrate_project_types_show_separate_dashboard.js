/**
 * 儀表板獨立加總改為依「專案類型」
 * 新增 project_types.show_separate_dashboard（1=在儀表板顯示獨立加總區塊）
 * 原 salespeople.show_separate_dashboard 仍保留欄位但不作為儀表板獨立加總依據
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
    const cols = db.prepare('PRAGMA table_info(project_types)').all();
    const hasCol = cols.some(c => c.name === 'show_separate_dashboard');
    if (hasCol) {
      console.log('  project_types.show_separate_dashboard 已存在，略過');
      db.close();
      return;
    }

    db.prepare('ALTER TABLE project_types ADD COLUMN show_separate_dashboard INTEGER DEFAULT 0').run();
    console.log('✓ project_types 已新增 show_separate_dashboard 欄位');
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
