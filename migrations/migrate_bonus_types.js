/**
 * 獎金類型改為可自訂：建立 bonus_types 表。
 *
 * 這套系統是同一份程式碼分別部署給不同客戶各自獨立安裝，不同公司可能要用
 * 不同的獎金類型名稱，原本 bonus_calculations.bonus_type 用 CHECK 約束寫死
 * 5 種固定值，裝好之後沒辦法自行調整。這裡先建表；種子資料改為同步
 * bonus_calculations 裡實際已使用過的類型（不直接塞入原公司的 5 個固定值），
 * 讓既有安裝（本來就只能用這 5 種值，CHECK 約束還沒移除）升級後行為完全不變，
 * 但全新安裝的公司不會被硬塞一份不屬於自己的獎金類型清單。
 * CHECK 約束的移除交給下一支 migration（migrate_remove_bonus_type_check）處理。
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

  console.log('開始執行獎金類型可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 bonus_types 表');

  // 舊 CHECK 約束只允許這 5 個值，所以既有安裝的 bonus_calculations 裡實際出現的
  // 類型必定是這 5 個的子集——沿用相同的顯示順序，只同步真正被用過的類型
  const knownTypes = [
    ['食驗室獎金', 1],
    ['純廣獎金', 2],
    ['專案簽約獎金', 3],
    ['專案結案獎金', 4],
    ['開發獎金', 5]
  ];

  try {
    const usedTypes = db.prepare(`
      SELECT DISTINCT bonus_type FROM bonus_calculations
      WHERE bonus_type IS NOT NULL AND bonus_type != ''
    `).all().map(r => r.bonus_type);

    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO bonus_types (type_name, display_order) VALUES (?, ?)
    `);
    let syncedCount = 0;
    knownTypes.forEach(([typeName, order]) => {
      if (usedTypes.includes(typeName)) {
        seedStmt.run(typeName, order);
        syncedCount++;
      }
    });
    console.log(syncedCount > 0
      ? `✓ 同步 ${syncedCount} 個既有安裝已使用過的獎金類型`
      : '✓ 尚無已使用過的獎金類型，bonus_types 保持空白，請於「獎金類型管理」自行新增');
  } catch (err) {
    // bonus_calculations 表不存在或查詢失敗，只記錄警告，不中斷遷移
    console.warn('⚠️ 無法同步既有獎金類型（可能 bonus_calculations 表不存在）:', err.message);
  }

  console.log('✓ 獎金類型可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
