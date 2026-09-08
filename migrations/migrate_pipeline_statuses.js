/**
 * 銷售機會狀態改為可自訂：建立 pipeline_statuses 表。
 *
 * pipelines.status 目前用 CHECK 約束寫死成「洽談中/已成交/已流失」三種固定值，
 * 且「已成交」在程式邏輯裡有特殊意義（唯有這個狀態的商機才能轉入專案），
 * 「已流失」也有特殊意義（記錄流失原因）。不同公司對銷售流程階段的命名可能不同，
 * 但「這個狀態算不算贏單/輸單」這個語意還是要保留，所以這裡用 is_won/is_lost
 * 兩個旗標取代原本寫死判斷字串是否等於「已成交」/「已流失」，讓自訂狀態名稱
 * 也能正確驅動「轉入專案」等既有邏輯。
 *
 * 種子資料這裡跟 bonus_types/customer_levels/customer_statuses 等「公司自訂業務標籤」
 * 不同：洽談中/已成交/已流失是幾乎任何銷售流程都會用到的通用階段（而非特定公司的業務假設），
 * 且 pipelines.status 是必填欄位、銷售機會又是常態性的新增操作，全新安裝如果不給預設值，
 * 會連第一筆銷售機會都建不起來。因此不論新舊安裝一律種入這三個預設值（INSERT OR IGNORE，
 * 既有安裝已有相同名稱不會重複），管理員之後仍可自由改名、調整顏色、新增其他階段。
 * CHECK 約束的移除交給下一支 migration（migrate_remove_pipeline_status_check）處理。
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

  console.log('開始執行銷售機會狀態可自訂遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_name TEXT NOT NULL UNIQUE,
      is_won INTEGER DEFAULT 0 CHECK(is_won IN (0, 1)),
      is_lost INTEGER DEFAULT 0 CHECK(is_lost IN (0, 1)),
      badge_color TEXT DEFAULT 'secondary' CHECK(badge_color IN ('primary','secondary','success','danger','warning','info','light','dark')),
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 pipeline_statuses 表');

  const defaultStatuses = [
    ['洽談中', 0, 0, 'warning', 1],
    ['已成交', 1, 0, 'success', 2],
    ['已流失', 0, 1, 'secondary', 3]
  ];

  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO pipeline_statuses (status_name, is_won, is_lost, badge_color, display_order) VALUES (?, ?, ?, ?, ?)
  `);
  defaultStatuses.forEach(([statusName, isWon, isLost, color, order]) => {
    seedStmt.run(statusName, isWon, isLost, color, order);
  });
  console.log('✓ 寫入預設銷售機會狀態（洽談中/已成交/已流失，之後可於「銷售機會狀態管理」自由調整）');

  console.log('✓ 銷售機會狀態可自訂遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
