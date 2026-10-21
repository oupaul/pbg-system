#!/usr/bin/env node
// 特權輔助程式：讓「非 root 的服務帳號」只能做少數幾件需要 root 的事（備份、還原、刪除備份、測試 NAS 連線）。
//
// 用法（由網頁服務透過 sudo 呼叫，sudoers 只允許執行這支腳本，見 deploy.sh）：
//   sudo -n <node> <安裝目錄>/scripts/pbg-privileged.js backup
//   sudo -n <node> <安裝目錄>/scripts/pbg-privileged.js restore <備份檔名> <操作ID>
//   sudo -n <node> <安裝目錄>/scripts/pbg-privileged.js delete-backup <備份檔名>
//   sudo -n <node> <安裝目錄>/scripts/pbg-privileged.js nas-test        （設定以 JSON 從 stdin 傳入）
//
// 安全設計：
//   - 呼叫者（服務帳號）完全不可信：所有參數都以白名單嚴格驗證，不經過 shell，不信任環境變數
//   - 腳本與安裝目錄必須是 root 擁有且不可被 group/其他人寫入，否則拒絕執行
//     （否則服務帳號可以改掉這支腳本或 backup.sh/restore.sh 再借 root 權限執行）
//   - 本檔只載入不會開啟資料庫的模組（以 root 開資料庫會產生 root 擁有的 -wal/-shm，讓服務帳號無法寫入）
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const INSTALL_DIR = path.resolve(__dirname, '..');
// 先驗證安裝目錄可信，才載入 src 底下的任何程式碼（見 main）
const backupPaths = () => require('../src/utils/backupPaths');
const OP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_STDIN_BYTES = 4096;

class UsageError extends Error {}

/** 解析並驗證命令列；回傳 { action, args }，不合法一律丟出 UsageError */
function parseInvocation(argv) {
  const [action, ...args] = argv;
  switch (action) {
    case 'backup':
    case 'nas-test':
      if (args.length !== 0) throw new UsageError(`${action} 不接受參數`);
      return { action, args };
    case 'delete-backup':
      if (args.length !== 1 || !backupPaths().isValidBackupFileName(args[0])) throw new UsageError('備份檔名不合法');
      return { action, args };
    case 'restore':
      if (args.length !== 2 || !backupPaths().isValidBackupFileName(args[0])) throw new UsageError('備份檔名不合法');
      if (!OP_ID_PATTERN.test(args[1])) throw new UsageError('操作 ID 不合法');
      return { action, args };
    default:
      throw new UsageError('不支援的動作');
  }
}

// 會被 root 載入或執行的檔案與其所在目錄，都必須是 root 擁有、且 group/其他人不可寫；
// 否則服務帳號可以改掉它們，再借這支腳本的 root 權限執行任意程式
const TRUSTED_PATHS = [
  '.', 'scripts', 'src', 'src/utils', 'src/services',
  'scripts/pbg-privileged.js', 'backup.sh', 'restore.sh', 'deploy.config.sh',
  'src/utils/backupPaths.js', 'src/services/NasConfigService.js'
];
function assertTrustedInstall(root = INSTALL_DIR, relPaths = TRUSTED_PATHS, { expectedUid = 0 } = {}) {
  for (const rel of relPaths) {
    const p = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(p); } catch (err) {
      if (err.code === 'ENOENT' && rel === 'deploy.config.sh') continue; // 舊安裝可能沒有此檔
      throw new Error(`${p} 不存在`);
    }
    if (st.isSymbolicLink()) throw new Error(`${p} 是符號連結，拒絕執行`);
    if (st.uid !== expectedUid) throw new Error(`${p} 不是 root 擁有，拒絕執行`);
    if (st.mode & 0o022) throw new Error(`${p} 可被 group 或其他人寫入，拒絕執行`);
  }
}

// 備份檔必須直接位在備份目錄下、是一般檔案（不是符號連結）
function resolveBackupFile(name, dir = backupPaths().detectBackupDir(INSTALL_DIR)) {
  const full = path.join(dir, name);
  if (path.dirname(full) !== dir) throw new UsageError('備份檔名不合法');
  let st;
  try { st = fs.lstatSync(full); } catch { throw new UsageError(`找不到備份檔案: ${name}`); }
  if (!st.isFile()) throw new UsageError('備份檔案不是一般檔案');
  return full;
}

// 子程序使用的最小環境：不繼承呼叫者的環境變數
function childEnv(extra = {}) {
  const nodeDir = path.dirname(process.execPath);
  return {
    PATH: `${nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    HOME: require('os').userInfo().homedir || '/root',
    LANG: process.env.LANG || 'C.UTF-8',
    ...extra
  };
}

function runBackup() {
  const script = path.join(INSTALL_DIR, 'backup.sh');
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [script], { cwd: INSTALL_DIR, env: childEnv({ NON_INTERACTIVE: '1' }), stdio: 'inherit' });
    child.on('error', (err) => { console.error('無法執行備份腳本:', err.message); resolve(1); });
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

function runRestore(name, opId) {
  const backupPath = resolveBackupFile(name);
  const script = path.join(INSTALL_DIR, 'restore.sh');
  if (!fs.existsSync(script)) throw new UsageError('找不到還原腳本');

  // 日誌檔由 root 建立（O_EXCL＋不跟隨符號連結）：/tmp 有 sticky bit，其他使用者無法替換 root 擁有的檔案，
  // 避免服務帳號預先放符號連結讓 root 去覆寫任意檔案；網頁端只讀取這個檔案顯示進度
  const logFile = `/tmp/pbg-restore-${opId}.log`;
  const fd = fs.openSync(logFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
  fs.closeSync(fd);

  const unit = `pbg-restore-${Date.now()}`;
  const args = [
    '--unit', unit, '--collect', '--no-block', '--quiet',
    '--setenv=NON_INTERACTIVE=1', `--setenv=BACKUP_FILE=${backupPath}`,
    '-p', `StandardOutput=append:${logFile}`, '-p', `StandardError=append:${logFile}`,
    `--working-directory=${INSTALL_DIR}`,
    '/bin/bash', script, backupPath
  ];
  execFileSync('systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
  process.stdout.write(JSON.stringify({ unit, logFile }) + '\n');
  return 0;
}

function runDeleteBackup(name) {
  fs.unlinkSync(resolveBackupFile(name));
  process.stdout.write(JSON.stringify({ success: true }) + '\n');
  return 0;
}

async function runNasTest() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) throw new UsageError('輸入過大');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UsageError('輸入不是有效的 JSON'); }
  const NasConfigService = require('../src/services/NasConfigService');
  const result = await NasConfigService.testConnection(input); // 內部會先驗證設定欄位
  process.stdout.write(JSON.stringify(result) + '\n');
  return 0;
}

async function main(argv) {
  let invocation;
  try {
    assertTrustedInstall(); // 必須在載入 src 之前
    invocation = parseInvocation(argv);
  } catch (err) {
    console.error(`[pbg-privileged] ${err.message}`);
    return err instanceof UsageError ? 2 : 3;
  }
  try {
    const { action, args } = invocation;
    console.error(`[pbg-privileged] 執行 ${action}${args.length ? ' ' + args[0] : ''}（呼叫者 uid=${process.env.SUDO_UID || '?'}）`);
    if (action === 'backup') return await runBackup();
    if (action === 'restore') return runRestore(args[0], args[1]);
    if (action === 'delete-backup') return runDeleteBackup(args[0]);
    if (action === 'nas-test') return await runNasTest();
    return 2;
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString().trim() : err.message;
    console.error(`[pbg-privileged] 失敗: ${detail}`);
    return err instanceof UsageError ? 2 : 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { parseInvocation, assertTrustedInstall, resolveBackupFile, UsageError, OP_ID_PATTERN };
