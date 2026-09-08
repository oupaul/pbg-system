/**
 * 客戶往來狀態改為可自訂：建立 customer_statuses 表。
 *
 * customers.status 與 customer_creation_requests.status 目前都用 CHECK 約束
 * 寫死成「往來中/暫停往來/已流失」三種固定值。這裡先建表；種子資料改為
 * 同步既有資料裡實際用過的值（比照 migrate_customer_levels.js 的做法），
 * 讓既有安裝升級後行為與顏色完全不變，全新安裝不會被硬塞不屬於自己的清單。
 * CHECK 約束的移除交給接下來兩支 migration
 * （migrate_remove_customer_status_check、
 * migrate_remove_customer_creation_request_status_check）分別處理。
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

  console.log('開始執行客戶往來狀態可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_name TEXT NOT NULL UNIQUE,
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 customer_statuses 表');

  // 舊 CHECK 約束只允許這三個值，既有安裝實際出現的狀態必定是這三個的子集
  const knownStatuses = [
    ['往來中', 'success', 1],
    ['暫停往來', 'warning', 2],
    ['已流失', 'secondary', 3]
  ];

  try {
    const usedStatuses = db.prepare(`
      SELECT DISTINCT status AS v FROM customers
      WHERE status IS NOT NULL AND status != ''
      UNION
      SELECT DISTINCT status AS v FROM customer_creation_requests
      WHERE status IS NOT NULL AND status != ''
    `).all().map(r => r.v);

    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO customer_statuses (status_name, badge_color, display_order) VALUES (?, ?, ?)
    `);
    let syncedCount = 0;
    knownStatuses.forEach(([statusName, color, order]) => {
      if (usedStatuses.includes(statusName)) {
        seedStmt.run(statusName, color, order);
        syncedCount++;
      }
    });
    console.log(syncedCount > 0
      ? `✓ 同步 ${syncedCount} 個既有安裝已使用過的客戶往來狀態`
      : '✓ 尚無已使用過的客戶往來狀態，customer_statuses 保持空白，請於「客戶狀態管理」自行新增');
  } catch (err) {
    console.warn('⚠️ 無法同步既有客戶往來狀態：', err.message);
  }

  console.log('✓ 客戶往來狀態可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
