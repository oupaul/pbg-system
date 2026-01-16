const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  let db;
  try {
    db = new Database(dbPath);
    
    console.log('檢查專案編號+客戶唯一約束...');
    
    // 檢查表的 schema
    const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get();
    
    if (tableSchema && tableSchema.sql) {
      // 檢查是否有任何唯一約束
      if (tableSchema.sql.includes('UNIQUE')) {
        console.log('✓ 專案唯一約束已存在');
      } else {
        console.log('⚠️  專案唯一約束不存在，建議重新執行基礎遷移');
      }
    }
    
    db.close();
  } catch (err) {
    console.error('檢查失敗:', err.message);
    if (db) db.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
