const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='project_attachments'
    `).get();
    if (tableCheck) {
      console.log('✓ project_attachments 表已存在，跳過遷移');
      db.close();
      return;
    }
    console.log('建立 project_attachments 表...');
    db.exec(`
      CREATE TABLE project_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_project_attachments_project_id ON project_attachments(project_id)`);
    console.log('✓ project_attachments 表建立完成');
    db.close();
  } catch (err) {
    console.error('遷移失敗:', err);
    if (db) db.close();
    throw err;
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
