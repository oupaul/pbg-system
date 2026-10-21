#!/usr/bin/env node
// 緊急用：從伺服器上重設某位使用者的雙因素驗證（清除密鑰與復原碼）。
// 適用於「所有管理員都無法登入」（例如唯一的管理員遺失手機又沒有復原碼，或還原備份到新主機後 SESSION_SECRET
// 不同、已加密的密鑰無法解開）這種網頁上無法處理的情況。需要有主機的 shell 權限。
//
// 用法：  sudo -u <服務帳號> node scripts/reset-2fa.js <使用者名稱>
//   ※ 請用服務帳號執行（預設帳號名稱見 deploy.config.sh 的 SERVICE_USER），不要直接用 root：
//     root 開啟資料庫可能產生 root 擁有的 -wal/-shm 檔案，讓服務之後無法寫入。
// 預設使用 data/invoice_bonus.db；可用 DB_PATH 環境變數指定其他檔案。
const path = require('path');
const Database = require('better-sqlite3');

const username = process.argv[2];
if (!username) {
  console.error('用法: node scripts/reset-2fa.js <使用者名稱>');
  process.exit(2);
}
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const db = new Database(dbPath, { fileMustExist: true });
db.pragma('busy_timeout = 5000');
try {
  const user = db.prepare('SELECT id, username, name, totp_enabled FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error(`找不到使用者：${username}`);
    process.exit(1);
  }
  db.prepare(`
    UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, totp_enabled_at = NULL, recovery_codes = NULL,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(user.id);
  db.prepare(`
    INSERT INTO system_logs (action, table_name, record_id, new_value, user_info)
    VALUES ('2fa_reset_by_cli', 'users', ?, ?, ?)
  `).run(user.id, JSON.stringify({ target: user.username }), `主機命令列（${process.env.SUDO_USER || process.env.USER || 'unknown'}）`);
  console.log(`✓ 已重設 ${user.username}（${user.name}）的雙因素驗證${user.totp_enabled ? '' : '（原本就沒有啟用）'}。`);
  console.log('  該使用者下次登入只需密碼；若其角色強制雙因素驗證，登入後必須重新設定。');
} finally {
  db.close();
}
