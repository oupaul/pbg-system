// 備份檔名驗證與備份目錄偵測。網頁端（BackupRestoreService）與以 root 執行的特權輔助程式
// （scripts/pbg-privileged.js）共用，確保兩邊用同一套規則；本檔不可載入資料庫或任何會開檔的模組
// （輔助程式以 root 執行，載入資料庫會產生 root 擁有的 -wal/-shm 檔案）。
const fs = require('fs');
const path = require('path');

// 備份檔名白名單：只接受純檔名（不含路徑字元），避免用 ../ 指到備份目錄外的任意檔案
const BACKUP_FILE_NAME_PATTERN = /^(backup_|uninstall_backup_)[A-Za-z0-9._-]+\.tar\.gz$/;

function isValidBackupFileName(name) {
  return typeof name === 'string' && BACKUP_FILE_NAME_PATTERN.test(name) && !name.includes('..');
}

// 從 deploy.config.sh 讀出 BACKUP_DIR（備份/還原/更新腳本都以它為準）
function readConfiguredBackupDir(installDir) {
  try {
    const configPath = path.join(installDir, 'deploy.config.sh');
    if (fs.existsSync(configPath)) {
      const match = fs.readFileSync(configPath, 'utf8').match(/^BACKUP_DIR="?([^"\n]+)"?\s*$/m);
      if (match && match[1] && path.isAbsolute(match[1])) return match[1];
    }
  } catch { /* 讀不到設定檔就用呼叫端的猜測邏輯 */ }
  return null;
}

// 動態偵測備份目錄。projectDir 為目前的工作目錄（沒有安裝目錄時使用其下的 backups）
function detectBackupDir(installDir, projectDir = process.cwd()) {
  if (!installDir) return path.join(projectDir, 'backups');

  // 優先使用 deploy.config.sh 的 BACKUP_DIR：deploy.sh 預設的備份目錄名稱是 invoice-bonus-backups，
  // 不是「<安裝目錄名稱>-backups」；只靠目錄名稱猜測會在兩者並存時選錯、找不到備份
  const configured = readConfiguredBackupDir(installDir);
  if (configured) return configured;

  const installDirName = path.basename(installDir);
  const backupDir = `/opt/${installDirName}-backups`;
  if (fs.existsSync(backupDir)) return backupDir;

  const possibleBackupDirs = [
    `/opt/${installDirName}-backups`,
    '/opt/project-system-backups',
    '/opt/invoice-bonus-backups',
    '/opt/fund-weekly-backups'
  ];
  for (const dir of possibleBackupDirs) {
    if (fs.existsSync(dir)) return dir;
  }
  return backupDir;
}

module.exports = { BACKUP_FILE_NAME_PATTERN, isValidBackupFileName, readConfiguredBackupDir, detectBackupDir };
