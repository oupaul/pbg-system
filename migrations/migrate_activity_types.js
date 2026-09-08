/**
 * 活動紀錄類型改為可自訂：建立 activity_types 表。
 *
 * activities.activity_type 目前用 CHECK 約束寫死成「拜訪/電話/客訴/其他」四種
 * 固定值，不同公司對客戶互動的分類方式可能不同。這裡先建表；種子資料改為
 * 同步 activities 裡實際已使用過的類型（比照 migrate_bonus_types.js／
 * migrate_customer_levels.js 的做法），讓既有安裝升級後行為與顏色完全不變，
 * 但全新安裝不會被硬塞一份不屬於自己的分類清單。
 * CHECK 約束的移除交給下一支 migration（migrate_remove_activity_type_check）處理。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  const db = new Database(dbPath);

  console.log('開始執行活動紀錄類型可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 activity_types 表');

  // 舊 CHECK 約束只允許這 4 個值，既有安裝實際出現的類型必定是這四個的子集
  const knownTypes = [
    ['拜訪', 'primary', 1],
    ['電話', 'info', 2],
    ['客訴', 'danger', 3],
    ['其他', 'secondary', 4]
  ];

  try {
    const usedTypes = db.prepare(`
      SELECT DISTINCT activity_type FROM activities
      WHERE activity_type IS NOT NULL AND activity_type != ''
    `).all().map(r => r.activity_type);

    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO activity_types (type_name, badge_color, display_order) VALUES (?, ?, ?)
    `);
    let syncedCount = 0;
    knownTypes.forEach(([typeName, color, order]) => {
      if (usedTypes.includes(typeName)) {
        seedStmt.run(typeName, color, order);
        syncedCount++;
      }
    });
    console.log(syncedCount > 0
      ? `✓ 同步 ${syncedCount} 個既有安裝已使用過的活動類型`
      : '✓ 尚無已使用過的活動類型，activity_types 保持空白，請於「活動類型管理」自行新增');
  } catch (err) {
    console.warn('⚠️ 無法同步既有活動類型（可能 activities 表不存在）:', err.message);
  }

  console.log('✓ 活動紀錄類型可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
