const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

// 確保資料目錄存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  let db;
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行專案類型資料表遷移...');

  // 建立專案類型表
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'info' CHECK(badge_color IN ('primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 project_types 表');

  // 不再插入預設類型，改為只同步專案中實際使用的類型
  // 同步專案中實際使用的類型到 project_types 表（如果不存在）
  try {
    const usedTypes = db.prepare(`
      SELECT DISTINCT project_type 
      FROM projects 
      WHERE project_type IS NOT NULL AND project_type != ''
    `).all();
    
    if (usedTypes.length > 0) {
      const syncStmt = db.prepare(`
        INSERT OR IGNORE INTO project_types (type_name, badge_color, display_order, is_active)
        VALUES (?, 'info', 999, 1)
      `);
      
      let syncedCount = 0;
      for (const usedType of usedTypes) {
        const exists = db.prepare('SELECT COUNT(*) as count FROM project_types WHERE type_name = ?').get(usedType.project_type);
        if (exists.count === 0) {
          syncStmt.run(usedType.project_type);
          syncedCount++;
          console.log(`✓ 同步類型：${usedType.project_type} (使用預設顏色: info)`);
        }
      }
      
      if (syncedCount > 0) {
        console.log(`✓ 已同步 ${syncedCount} 個專案中使用的類型到 project_types 表`);
      }
    }
  } catch (err) {
    // 如果 projects 表不存在或查詢失敗，只記錄警告，不中斷遷移
    console.warn('⚠️ 無法同步專案類型（可能 projects 表不存在）:', err.message);
  }

  console.log('✓ 專案類型資料表遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };

