// 網頁服務（非 root）呼叫特權輔助程式 scripts/pbg-privileged.js 的方式。
// 服務以專用的非 root 帳號執行時，備份、還原、刪除備份、測試 NAS 連線這些需要 root 的動作，
// 一律透過 sudo 呼叫這支輔助程式（sudoers 只允許這一條指令，見 deploy.sh）；參數由輔助程式再用白名單驗證。
// 服務若是以 root 執行（舊安裝或明確指定），則維持原本直接執行的方式。
const path = require('path');

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

// 需要走輔助程式：已安裝（有安裝目錄）且目前不是 root
function needsHelper(installed) {
  return !!installed && !isRoot();
}

function helperScript(installDir) {
  return path.join(installDir, 'scripts', 'pbg-privileged.js');
}

// 回傳可交給 spawn/execFile 的 [command, args]
function helperCommand(installDir, action, args = []) {
  // 不用 -E：不把服務的環境變數帶給 root，輔助程式自己建立最小環境
  return ['sudo', ['-n', process.execPath, helperScript(installDir), action, ...args]];
}

module.exports = { isRoot, needsHelper, helperScript, helperCommand };
