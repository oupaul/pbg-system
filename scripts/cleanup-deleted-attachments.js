/**
 * 定期清理已軟刪除的專案附件
 * 會永久刪除「刪除時間超過保留天數」的附件檔案與資料庫記錄
 * 建議以 cron 每日執行，例如：0 2 * * * cd /opt/xxx && node scripts/cleanup-deleted-attachments.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'uploads', 'attachments');

const DEFAULT_RETENTION_DAYS = 30;

function getRetentionDays(db) {
  try {
    const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'attachment_cleanup_retention_days'").get();
    if (row && row.setting_value) {
      const n = parseInt(row.setting_value, 10);
      if (!isNaN(n) && n >= 0) return n;
    }
  } catch (e) {}
  return DEFAULT_RETENTION_DAYS;
}

function ensureSetting(db) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
      VALUES ('attachment_cleanup_retention_days', ?, 'number', '專案附件軟刪除後保留天數，超過後由清理腳本永久刪除檔案與記錄（0=不自動清理）')
    `).run(String(DEFAULT_RETENTION_DAYS));
  } catch (e) {
    // 表可能不存在
  }
}

function run() {
  let db;
  try {
    db = new Database(DB_PATH);
    ensureSetting(db);

    const retentionDays = getRetentionDays(db);
    if (retentionDays <= 0) {
      console.log('attachment_cleanup_retention_days 為 0，跳過清理');
      db.close();
      return;
    }

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_attachments'").get();
    if (!table) {
      console.log('project_attachments 表不存在，跳過清理');
      db.close();
      return;
    }

    const cols = db.prepare('PRAGMA table_info(project_attachments)').all();
    if (!cols.some(c => c.name === 'deleted_at')) {
      console.log('project_attachments 尚無 deleted_at 欄位，跳過清理');
      db.close();
      return;
    }

    // deleted_at 小於 (今天 - retentionDays) 的記錄
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT id, project_id, stored_filename, original_filename, deleted_at
      FROM project_attachments
      WHERE deleted_at IS NOT NULL AND date(deleted_at) <= date(?)
      ORDER BY id
    `).all(cutoffStr);

    if (rows.length === 0) {
      console.log('無需清理的已刪除附件');
      db.close();
      return;
    }

    let deletedFiles = 0;
    let failedFiles = 0;
    for (const row of rows) {
      const filePath = path.join(ATTACHMENTS_DIR, row.stored_filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          deletedFiles++;
        } catch (err) {
          console.error('刪除檔案失敗:', row.stored_filename, err.message);
          failedFiles++;
        }
      }
      db.prepare('DELETE FROM project_attachments WHERE id = ?').run(row.id);
    }

    console.log(`清理完成：永久刪除 ${rows.length} 筆記錄，其中 ${deletedFiles} 個檔案已從磁碟移除${failedFiles > 0 ? `，${failedFiles} 個檔案刪除失敗` : ''}`);
    db.close();
  } catch (err) {
    console.error('清理腳本錯誤:', err);
    if (db) db.close();
    process.exit(1);
  }
}

run();
