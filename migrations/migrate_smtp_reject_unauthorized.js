/**
 * Email 通知：SMTP 憑證驗證開關。
 *
 * 部分內部/自架郵件伺服器使用自簽憑證或憑證鏈不完整，寄信時會出現
 * "unable to get local issuer certificate" 錯誤。預設仍保持驗證憑證（安全預設值），
 * 管理員可在系統設定明確關閉，僅在確認該內部郵件伺服器可信任時才停用。
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

  console.log('開始執行 SMTP 憑證驗證開關遷移...');

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
    VALUES (?, ?, ?, ?)
  `).run(
    'smtp_reject_unauthorized',
    'true',
    'boolean',
    '是否驗證 SMTP 伺服器憑證。內部/自架郵件伺服器若為自簽憑證造成寄信失敗（unable to get local issuer certificate），可關閉此選項；一般公開 SMTP 服務建議保持開啟'
  );

  console.log('✓ 插入設定：smtp_reject_unauthorized = true');
  console.log('✓ SMTP 憑證驗證開關遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
