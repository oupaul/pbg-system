/**
 * 全系統搜尋的「搜尋範圍設定」：建立 search_field_settings 表。
 *
 * 搜尋會自動掃描所有資料表的文字欄位（見 SearchService），這張表只記錄管理者
 * 對「特定欄位/整張表」的取捨（column_name = '*' 代表整張表）：
 *   is_searchable：是否納入搜尋
 *   is_confirmed ：管理者是否已確認過這個欄位
 * 沒有紀錄的欄位 = 預設納入搜尋，並在設定頁標示為「新出現」提醒管理者檢視。
 *
 * 本 migration 排在目前所有 migration 之後執行，因此會把「當下已存在的文字欄位」
 * 全部記為已確認，避免升級後設定頁一次出現上百個「新出現」；之後新增的資料表/欄位
 * 才會被標示。預設排除：customers 的銀行資訊、customer_creation_requests 整表
 * （與 customers 內容重複）。
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

  console.log('開始執行搜尋範圍設定遷移...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS search_field_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      is_searchable INTEGER NOT NULL DEFAULT 1 CHECK(is_searchable IN (0, 1)),
      is_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(is_confirmed IN (0, 1)),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(table_name, column_name)
    )
  `);
  console.log('✓ 建立 search_field_settings 表');

  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map(r => r.name);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO search_field_settings (table_name, column_name, is_searchable, is_confirmed)
    VALUES (?, ?, ?, 1)
  `);

  const defaultExcluded = new Set(['customers.bank_name', 'customers.bank_account']);
  let seeded = 0;
  tables.forEach(table => {
    if (table === 'search_field_settings') return;
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
    cols.filter(c => !c.pk && /CHAR|TEXT|CLOB/i.test(c.type || '')).forEach(c => {
      const excluded = defaultExcluded.has(`${table}.${c.name}`);
      const r = insert.run(table, c.name, excluded ? 0 : 1);
      seeded += r.changes;
    });
  });
  insert.run('customer_creation_requests', '*', 0);
  console.log(`✓ 已將現有 ${seeded} 個文字欄位記為已確認（預設排除：客戶銀行資訊、customer_creation_requests）`);

  console.log('✓ 搜尋範圍設定遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
