/**
 * 新客戶/廠商審核機制：支援與新增銷售機會綁定送審。
 *
 * 非管理員/專案管理員在「新增銷售機會」表單中若使用「快速新增客戶/廠商」，
 * 新客戶尚未核准前無法選用，因此該筆銷售機會的內容一併存入同一筆
 * customer_creation_requests，待核准客戶時一併建立銷售機會（同一個審核動作）。
 * pipeline_opportunity_name 是否有值，用來判斷這筆申請是否綁定了銷售機會。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  console.log('開始執行客戶審核綁定銷售機會遷移...');

  const columns = db.prepare(`PRAGMA table_info(customer_creation_requests)`).all().map(c => c.name);

  const newColumns = [
    ['pipeline_opportunity_name', 'TEXT'],
    ['pipeline_project_type', 'TEXT'],
    ['pipeline_estimated_amount', 'REAL'],
    ['pipeline_win_probability', 'INTEGER'],
    ['pipeline_expected_close_year_month', 'TEXT'],
    ['pipeline_salesperson_id', 'INTEGER'],
    ['pipeline_notes', 'TEXT'],
    ['created_pipeline_id', 'INTEGER']
  ];

  newColumns.forEach(([name, type]) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE customer_creation_requests ADD COLUMN ${name} ${type}`);
      console.log(`✓ customer_creation_requests.${name} 欄位已添加`);
    } else {
      console.log(`✓ customer_creation_requests.${name} 欄位已存在，略過`);
    }
  });

  console.log('✓ 客戶審核綁定銷售機會遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
