/**
 * 客戶等級改為可自訂：建立 customer_levels 表。
 *
 * customers.customer_level 與 customer_creation_requests.customer_level 目前都用
 * CHECK 約束寫死成 A/B/C 三種固定值，不同公司裝上這套系統後沒辦法自行調整
 * 名稱或顏色。這裡先建表；種子資料改為同步 customers／customer_creation_requests
 * 裡實際已使用過的等級（不直接塞入 A/B/C），讓既有安裝（本來就只能用這三個值，
 * CHECK 約束還沒移除）升級後視覺完全不變，但全新安裝的公司不會被硬塞一份
 * 不屬於自己的等級清單。CHECK 約束的移除交給接下來兩支 migration
 * （migrate_remove_customer_level_check、
 * migrate_remove_customer_creation_request_level_check）分別處理。
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

  console.log('開始執行客戶等級可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 customer_levels 表');

  // 舊 CHECK 約束只允許 A/B/C，所以既有安裝實際出現的等級必定是這三個的子集——
  // 沿用相同的顏色，只同步真正被用過的等級
  const knownLevels = [
    ['A', 'success', 1],
    ['B', 'warning', 2],
    ['C', 'secondary', 3]
  ];

  try {
    const usedLevels = db.prepare(`
      SELECT DISTINCT customer_level AS v FROM customers
      WHERE customer_level IS NOT NULL AND customer_level != ''
      UNION
      SELECT DISTINCT customer_level AS v FROM customer_creation_requests
      WHERE customer_level IS NOT NULL AND customer_level != ''
    `).all().map(r => r.v);

    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO customer_levels (level_name, badge_color, display_order) VALUES (?, ?, ?)
    `);
    let syncedCount = 0;
    knownLevels.forEach(([levelName, color, order]) => {
      if (usedLevels.includes(levelName)) {
        seedStmt.run(levelName, color, order);
        syncedCount++;
      }
    });
    console.log(syncedCount > 0
      ? `✓ 同步 ${syncedCount} 個既有安裝已使用過的客戶等級`
      : '✓ 尚無已使用過的客戶等級，customer_levels 保持空白，請於「客戶等級管理」自行新增');
  } catch (err) {
    // customers/customer_creation_requests 表不存在或查詢失敗，只記錄警告，不中斷遷移
    console.warn('⚠️ 無法同步既有客戶等級：', err.message);
  }

  console.log('✓ 客戶等級可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
