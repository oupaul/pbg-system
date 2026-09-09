/**
 * 成本明細新增「進項編號」與「成本名稱」兩個純文字欄位。
 *
 * item_code（進項編號）比照 projects.project_code 本來就是自由文字、無格式
 * 驗證的既有慣例，不強制編碼規則或自動產生，因為不同公司的採購編號慣例
 * 差異很大。item_name（成本名稱）是這筆成本的主要標籤，跟原本純粹備註用
 * 的 notes 語意不同，新增/編輯表單會要求必填，但既有資料不回填、維持空白
 * 直到使用者手動編輯。
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

  console.log('開始執行成本明細進項編號/名稱欄位遷移...');

  const cols = db.prepare('PRAGMA table_info(costs)').all();
  const colNames = new Set(cols.map(c => c.name));

  if (!colNames.has('item_code')) {
    db.exec('ALTER TABLE costs ADD COLUMN item_code TEXT');
    console.log('✓ costs.item_code 新增完成');
  } else {
    console.log('  costs.item_code 已存在，略過');
  }

  if (!colNames.has('item_name')) {
    db.exec('ALTER TABLE costs ADD COLUMN item_name TEXT');
    console.log('✓ costs.item_name 新增完成');
  } else {
    console.log('  costs.item_name 已存在，略過');
  }

  console.log('✓ 成本明細進項編號/名稱欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
