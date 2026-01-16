const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 資料庫路徑
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    
    console.log('開始執行成本明細表遷移...');
    
    // 檢查表是否已存在
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='costs'
    `).get();
    
    if (tableCheck) {
      console.log('✓ costs 表已存在，跳過遷移');
      db.close();
      return;
    }
    
    // 建立成本明細表
    console.log('建立 costs 表...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        cost_date TEXT,
        cost_type TEXT,
        amount REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);
    
    console.log('✓ 建立 costs 表');
    
    // 建立索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_costs_project_id ON costs(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_costs_cost_date ON costs(cost_date)`);
    
    console.log('✓ 建立索引');
    console.log('✅ 成本明細表遷移完成');
    
    db.close();
  } catch (error) {
    console.error('遷移失敗:', error);
    if (db) db.close();
    process.exit(1);
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;

