// 整合測試的全域準備：把程式複製到暫存目錄（絕不碰真實的 data/、uploads/），在那裡建立全新資料庫、
// 灌入種子資料並啟動一份真正的伺服器，測試再用 HTTP 打它。結束時關閉並刪除暫存目錄。
// better-sqlite3 是原生模組，需要與編譯時相同的 Node 主版本（見 .nvmrc，目前為 22）；
// 目前的 Node 載入不了時整個整合測試略過並印出警告，不會讓 npm test 失敗。
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync, spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');

function sqliteUsable() {
  try {
    execFileSync(process.execPath, ['-e', "const D=require('better-sqlite3');new D(':memory:').close()"], { cwd: REPO, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitForHealth(baseUrl, child, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`測試伺服器提前結束（exit ${child.exitCode}）`);
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch { /* 還沒啟動 */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('等待測試伺服器啟動逾時');
}

async function setup() {
  if (!sqliteUsable()) {
    process.env.PBG_INTEGRATION_SKIP = '1';
    console.warn(`\n[整合測試] 已略過：目前的 Node（${process.version}）無法載入 better-sqlite3。請改用 .nvmrc 指定的 Node 版本（nvm use）後再執行。\n`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbg-integration-'));
  process.env.PBG_TEST_TMP_PARTIAL = tmp; // 準備失敗時供清理使用
  for (const dir of ['src', 'migrations', 'scripts', 'public']) {
    fs.cpSync(path.join(REPO, dir), path.join(tmp, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(tmp, 'package.json'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'uploads'), { recursive: true });

  // 只在「複製出來的」app.js 裡加一支列出所有路由的端點（供「每條路由都要驗證登入」的掃描測試使用）；
  // 真正的程式碼完全不受影響
  const appPath = path.join(tmp, 'src', 'app.js');
  const marker = '// 404處理';
  let appSource = fs.readFileSync(appPath, 'utf8');
  if (!appSource.includes(marker)) throw new Error(`找不到「${marker}」標記，無法注入路由列表（app.js 結構已改變，請更新 tests/integration/setup/globalSetup.js）`);
  const snippet = fs.readFileSync(path.join(__dirname, 'routeDump.snippet.js'), 'utf8');
  // 用函式當替換內容：snippet 內含 $ 字元，字串形式的替換內容會把 $' $/ 之類當成特殊樣式
  appSource = appSource.replace(marker, () => `${snippet}\n${marker}`);
  fs.writeFileSync(appPath, appSource);

  const env = { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'integration-test-secret', BIND_HOST: '127.0.0.1' };
  const run = (script) => execFileSync(process.execPath, [script], { cwd: tmp, env, stdio: 'pipe' });
  try {
    run(path.join(tmp, 'migrations', 'migrate.js'));
    run(path.join(tmp, 'migrations', 'runner.js'));
    run(path.join(REPO, 'tests', 'integration', 'setup', 'seed.js'));
  } catch (err) {
    throw new Error(`建立測試資料庫失敗：${(err.stderr || err.stdout || err.message).toString().slice(-1500)}`);
  }

  const port = await freePort();
  const logPath = path.join(tmp, 'server.log');
  const logFd = fs.openSync(logPath, 'w');
  const child = spawn(process.execPath, [path.join(tmp, 'src', 'app.js')], {
    cwd: tmp, env: { ...env, PORT: String(port) }, stdio: ['ignore', logFd, logFd]
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${err.message}\n--- server.log ---\n${fs.readFileSync(logPath, 'utf8').slice(-2000)}`);
  }

  process.env.PBG_TEST_BASE_URL = baseUrl;
  process.env.PBG_TEST_IDS = fs.readFileSync(path.join(tmp, 'seed-ids.json'), 'utf8');
  process.env.PBG_TEST_TMP = tmp;
  globalThis.__PBG_INTEGRATION__ = { tmp, child };
}

module.exports = async () => {
  try {
    await setup();
  } catch (err) {
    // 準備到一半失敗：關掉伺服器、刪掉暫存目錄，避免留下殘骸
    const state = globalThis.__PBG_INTEGRATION__;
    if (state) { try { state.child.kill('SIGKILL'); } catch { /* 已結束 */ } }
    const tmp = (state && state.tmp) || process.env.PBG_TEST_TMP_PARTIAL;
    if (tmp && /pbg-integration-[A-Za-z0-9]+$/.test(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
};
