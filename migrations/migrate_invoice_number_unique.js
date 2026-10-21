/**
 * 發票號碼唯一索引：同一個號碼同時只能有一張「有效」發票（忽略大小寫；已作廢、已刪除的不佔用）。
 *
 * 既有資料裡如果已經有重複的發票號碼，索引無法建立。這種情況「不中斷部署、也不自動改資料」
 * （哪一張才是對的只有人能判斷）：這裡只列出重複清單並略過建立索引，應用程式層的檢查
 * （Invoice.create/update/restore）仍會擋下新的重複。人工處理完重複資料後，執行：
 *   node scripts/check-invoice-duplicates.js --create-index
 * 可重複執行。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { createIndexIfClean, formatDuplicates } = require('../src/utils/invoiceNumberIndex');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  try {
    const result = createIndexIfClean(db);
    if (result.status === 'created') console.log('✓ 已建立發票號碼唯一索引');
    else if (result.status === 'exists') console.log('✓ 發票號碼唯一索引已存在，略過');
    else if (result.status === 'no-table') console.log('invoices 資料表不存在，略過');
    else {
      console.log(`⚠ 發現 ${result.duplicates.length} 組重複的有效發票號碼，未建立唯一索引（新資料仍由應用程式檢查，不會再產生重複）：`);
      console.log(formatDuplicates(result.duplicates));
      console.log('  請人工處理重複資料（作廢或刪除多出來的那幾張）後執行：node scripts/check-invoice-duplicates.js --create-index');
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
