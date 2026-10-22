// restore.sh / backup.sh / deploy.sh 的還原安全：在沙盒目錄跑真正的 restore.sh（不碰任何真實主機）。
// 對應備份還原演練找到的缺口：損壞的備份不能換掉現有資料庫、沒有資料庫的備份要中止、
// 還原後檢查失敗要自動換回、SESSION_SECRET 指紋比對、安全副本要有保留上限。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

let Database = null;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); } catch { Database = null; }
const describeSb = Database ? describe : describe.skip;

const ROOT = path.join(__dirname, '..');
const RESTORE_SH = fs.readFileSync(path.join(ROOT, 'restore.sh'), 'utf8');
const BACKUP_SH = fs.readFileSync(path.join(ROOT, 'backup.sh'), 'utf8');
const DEPLOY_SH = fs.readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');
const SQLITE_CLI = (() => { const r = spawnSync('which', ['sqlite3'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; })();

// 從腳本原始碼取出一個 shell 函式（從 "name() {" 到單獨一行的 "}"）
const extractFn = (src, name) => {
  const start = src.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`找不到函式 ${name}`);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
};

let base;
beforeAll(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-safety-')); });
afterAll(() => { fs.rmSync(base, { recursive: true, force: true }); });

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tmpRestoreDirs = () => fs.readdirSync('/tmp') /* restore.sh 寫死 /tmp（macOS 的 os.tmpdir() 不是 /tmp） */.filter(n => n.startsWith('invoice_bonus_restore_'));

// 建立一個小資料庫：users 帶 totp_enabled，另有 restore.sh 會統計的幾張表。marker 用來辨識是哪一份資料
function makeDb(file, { marker, totpUsers = 0 }) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, totp_enabled INTEGER DEFAULT 0);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, n TEXT);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, n TEXT);
    CREATE TABLE filler (id INTEGER PRIMARY KEY, blob TEXT);
  `);
  db.prepare('INSERT INTO projects (name) VALUES (?)').run(marker);
  for (let i = 0; i < totpUsers; i++) db.prepare('INSERT INTO users (username, totp_enabled) VALUES (?, 1)').run(`u${i}`);
  db.prepare('INSERT INTO users (username, totp_enabled) VALUES (?, 0)').run('plain');
  const ins = db.prepare('INSERT INTO filler (blob) VALUES (?)');
  for (let i = 0; i < 400; i++) ins.run(crypto.randomBytes(200).toString('hex'));
  db.pragma('journal_mode = DELETE');
  db.close();
}
const marker = (file) => { const db = new Database(file, { readonly: true }); try { return db.prepare('SELECT name FROM projects').get().name; } finally { db.close(); } };

// 沙盒：app/（含 restore.sh、scripts）、backups/、一個「現有」資料庫與一個上傳標記檔
function makeSandbox(name, { serviceName = '', systemdDir = null } = {}) {
  const dir = path.join(base, name);
  const app = path.join(dir, 'app');
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.mkdirSync(path.join(app, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'restore.sh'), path.join(app, 'restore.sh'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(app, 'scripts'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'));
  fs.writeFileSync(path.join(app, 'deploy.config.sh'), [
    `SERVICE_NAME="${serviceName}"`, 'SERVICE_RUN_AS="root"', 'SERVICE_USER=""', 'PORT=3999',
    `INSTALL_DIR="${app}"`, `BACKUP_DIR="${path.join(dir, 'backups')}"`
  ].join('\n') + '\n');
  makeDb(path.join(app, 'data', 'invoice_bonus.db'), { marker: 'LIVE' });
  fs.writeFileSync(path.join(app, 'uploads', 'live_marker.txt'), 'live-upload');
  return { dir, app, backups: path.join(dir, 'backups'), live: path.join(app, 'data', 'invoice_bonus.db'), systemdDir };
}

// 做一份備份檔（backup_<name>.tar.gz）：資料庫由 dbBuilder 產生，可選 backup_info 與上傳檔
function makeBackup(sb, name, { marker: m = 'BACKUP', totpUsers = 0, withDb = true, info = null, corrupt = false } = {}) {
  const work = path.join(sb.dir, `work-${name}`);
  const inner = path.join(work, `backup_${name}`);
  fs.mkdirSync(path.join(inner, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(inner, 'uploads', 'from_backup.txt'), 'backup-upload');
  if (info !== null) fs.writeFileSync(path.join(inner, 'backup_info.txt'), info);
  if (withDb) {
    const dbFile = path.join(inner, 'invoice_bonus.db');
    makeDb(dbFile, { marker: m, totpUsers });
    if (corrupt) {
      // 只破壞資料頁（表結構頁完好）：找一頁，讓「讀得到資料表」但 integrity_check 失敗
      const orig = fs.readFileSync(dbFile);
      for (let page = Math.floor(orig.length / 4096) - 1; page > 5; page--) {
        const buf = Buffer.from(orig);
        crypto.randomBytes(4096).copy(buf, page * 4096);
        const probe = path.join(work, 'probe.db');
        fs.writeFileSync(probe, buf);
        let tables = 0; let integrity = 'ok';
        try {
          const d = new Database(probe, { readonly: true });
          tables = d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
          try { integrity = String(d.pragma('integrity_check')[0].integrity_check); } catch (e) { integrity = e.message; }
          d.close();
        } catch { tables = 0; }
        if (tables > 0 && integrity !== 'ok') { fs.writeFileSync(dbFile, buf); break; }
      }
    }
  }
  const tarPath = path.join(sb.backups, `backup_${name}.tar.gz`);
  execFileSync('tar', ['-czf', tarPath, '-C', work, `backup_${name}`]);
  return tarPath;
}

function runRestore(sb, tarPath, { env = {}, pathPrefix = '' } = {}) {
  const r = spawnSync('/bin/bash', [path.join(sb.app, 'restore.sh'), tarPath], {
    cwd: sb.app, encoding: 'utf8',
    env: { ...process.env, NON_INTERACTIVE: '1', ...(sb.systemdDir ? { PBG_SYSTEMD_DIR: sb.systemdDir } : {}), ...env, PATH: `${pathPrefix}${process.env.PATH}` }
  });
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '') };
}

describeSb('restore.sh：備份檔不可用時不能動到現有資料', () => {
  test('壓縮檔被截斷：中止，現有資料庫與上傳檔都沒動，暫存目錄清乾淨', () => {
    const sb = makeSandbox('truncated');
    const good = makeBackup(sb, 'good');
    const tarPath = path.join(sb.backups, 'backup_truncated.tar.gz');
    fs.writeFileSync(tarPath, fs.readFileSync(good).subarray(0, 300));
    const before = sha(sb.live); const tmpBefore = tmpRestoreDirs().length;
    const r = runRestore(sb, tarPath);
    expect(r.code).not.toBe(0);
    expect(sha(sb.live)).toBe(before);
    expect(fs.existsSync(path.join(sb.app, 'uploads', 'live_marker.txt'))).toBe(true);
    expect(tmpRestoreDirs().length).toBe(tmpBefore);
  });

  test('備份裡沒有資料庫：中止（不再回報「還原完成」），上傳檔不會被換掉', () => {
    const sb = makeSandbox('nodb');
    const tarPath = makeBackup(sb, 'nodb', { withDb: false });
    const before = sha(sb.live); const tmpBefore = tmpRestoreDirs().length;
    const r = runRestore(sb, tarPath);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('找不到資料庫');
    expect(r.out).not.toContain('還原完成');
    expect(sha(sb.live)).toBe(before);
    expect(fs.existsSync(path.join(sb.app, 'uploads', 'live_marker.txt'))).toBe(true);
    expect(fs.readdirSync(sb.app).filter(n => n.startsWith('uploads.backup_'))).toEqual([]);
    expect(tmpRestoreDirs().length).toBe(tmpBefore);
  });

  test('資料庫部分損壞（讀得到資料表、完整性檢查失敗）：在動現有資料之前就中止', () => {
    const sb = makeSandbox('corrupt');
    const tarPath = makeBackup(sb, 'corrupt', { corrupt: true });
    const before = sha(sb.live); const tmpBefore = tmpRestoreDirs().length;
    const r = runRestore(sb, tarPath);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('未通過完整性檢查');
    expect(r.out).toContain('沒有被更動');
    expect(sha(sb.live)).toBe(before);
    expect(marker(sb.live)).toBe('LIVE');
    expect(fs.readdirSync(path.join(sb.app, 'data')).filter(n => n.includes('.backup_'))).toEqual([]); // 根本沒走到「改名保留」
    expect(fs.existsSync(path.join(sb.app, 'uploads', 'live_marker.txt'))).toBe(true);
    expect(tmpRestoreDirs().length).toBe(tmpBefore);
  });

  test('正常的備份：還原成功，資料庫與上傳檔換成備份內容，暫存目錄清乾淨', () => {
    const sb = makeSandbox('good');
    const tarPath = makeBackup(sb, 'good', { marker: 'RESTORED' });
    const tmpBefore = tmpRestoreDirs().length;
    const r = runRestore(sb, tarPath);
    expect(r.code).toBe(0);
    expect(r.out).toContain('通過完整性檢查');
    expect(marker(sb.live)).toBe('RESTORED');
    expect(fs.existsSync(path.join(sb.app, 'uploads', 'from_backup.txt'))).toBe(true);
    expect(fs.existsSync(path.join(sb.app, 'uploads', 'live_marker.txt'))).toBe(false);
    // 還原前的資料庫與上傳檔仍保留一份
    expect(fs.readdirSync(path.join(sb.app, 'data')).filter(n => /^invoice_bonus\.db\.backup_\d{8}_\d{6}$/.test(n)).length).toBe(1);
    expect(tmpRestoreDirs().length).toBe(tmpBefore);
  });
});

const describeCli = Database && SQLITE_CLI ? describe : describe.skip;
describeCli('restore.sh：還原後檢查失敗要自動換回還原前的資料庫', () => {
  test('完整性檢查在「還原後」失敗（模擬）：換回原資料庫、不留下壞檔', () => {
    const sb = makeSandbox('rollback');
    const tarPath = makeBackup(sb, 'rb', { marker: 'WOULD-BE-RESTORED' });
    // 假的 sqlite3：只有對「現有資料庫路徑」做 integrity_check 時回報損壞（還原後的檢查），其他一律交給真的
    const binDir = path.join(sb.dir, 'fakebin'); fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'sqlite3'), `#!/bin/bash
for a in "$@"; do
  if [ "$a" = "PRAGMA integrity_check;" ]; then
    for b in "$@"; do if [ "$b" = "${sb.live}" ]; then echo "database disk image is malformed (simulated)"; exit 0; fi; done
  fi
done
exec "${SQLITE_CLI}" "$@"
`, { mode: 0o755 });
    const before = sha(sb.live);
    const r = runRestore(sb, tarPath, { pathPrefix: `${binDir}:` });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('自動換回還原前的資料庫');
    expect(sha(sb.live)).toBe(before);
    expect(marker(sb.live)).toBe('LIVE');
    expect(fs.readdirSync(path.join(sb.app, 'data')).filter(n => n.includes('.backup_'))).toEqual([]); // 已被換回，沒有殘留
  });
});

describeSb('SESSION_SECRET 指紋：還原時提示雙因素驗證金鑰是否相同', () => {
  const fp = (secret) => crypto.createHash('sha256').update(`pbg-session-secret:${secret}`).digest('hex').slice(0, 16);
  const SECRET_A = 'a'.repeat(64);
  const SECRET_B = 'b'.repeat(64);
  const unitDir = (name, secret) => {
    const d = path.join(base, `units-${name}`); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'drillsvc.service'), `[Service]\nEnvironment=NODE_ENV=production\nEnvironment=SESSION_SECRET=${secret}\n`);
    return d;
  };
  const info = (fingerprint) => `備份時間: x\nSESSION_SECRET 指紋: ${fingerprint}\n（說明）\n`;

  test('指紋相同：不警告', () => {
    const sb = makeSandbox('fp-same', { serviceName: 'drillsvc', systemdDir: unitDir('same', SECRET_A) });
    const r = runRestore(sb, makeBackup(sb, 'x', { totpUsers: 2, info: info(fp(SECRET_A)) }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('與製作這份備份的主機相同');
    expect(r.out).not.toContain('【不同】');
  });

  test('指紋不同且有使用者啟用雙因素驗證：明確警告，列出處理方式與人數', () => {
    const sb = makeSandbox('fp-diff', { serviceName: 'drillsvc', systemdDir: unitDir('diff', SECRET_B) });
    const r = runRestore(sb, makeBackup(sb, 'x', { totpUsers: 3, info: info(fp(SECRET_A)) }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('【不同】');
    expect(r.out).toContain('3 位使用者');
    expect(r.out).toContain('reset-2fa.js');
    expect(r.out).toContain('Environment=SESSION_SECRET');
    expect(r.out).not.toContain(SECRET_A);
    expect(r.out).not.toContain(SECRET_B); // 絕不印出密鑰本身
  });

  test('指紋不同但沒有人啟用雙因素驗證：不打擾', () => {
    const sb = makeSandbox('fp-none', { serviceName: 'drillsvc', systemdDir: unitDir('none', SECRET_B) });
    const r = runRestore(sb, makeBackup(sb, 'x', { totpUsers: 0, info: info(fp(SECRET_A)) }));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('【不同】');
    expect(r.out).not.toContain('無法確認');
  });

  test('舊備份沒有指紋、且有人啟用雙因素驗證：提示「無法確認」', () => {
    const sb = makeSandbox('fp-old', { serviceName: 'drillsvc', systemdDir: unitDir('old', SECRET_A) });
    const r = runRestore(sb, makeBackup(sb, 'x', { totpUsers: 1, info: '備份時間: x\n' }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('無法確認');
    expect(r.out).toContain('reset-2fa.js');
  });

  test('備份記錄的指紋是「未知」（製作備份的主機讀不到密鑰）：視同無法確認', () => {
    const sb = makeSandbox('fp-unknown', { serviceName: 'drillsvc', systemdDir: unitDir('unknown', SECRET_A) });
    const r = runRestore(sb, makeBackup(sb, 'x', { totpUsers: 1, info: info('未知') }));
    expect(r.out).toContain('無法確認');
  });
});

describe('backup.sh：記錄 SESSION_SECRET 指紋（不含密鑰本身）', () => {
  const fnSrc = `${extractFn(BACKUP_SH, 'sha256_text')}\n${extractFn(BACKUP_SH, 'session_secret_fingerprint')}`;
  const run = (env, serviceName) => spawnSync('/bin/bash', ['-c', `${fnSrc}\nSERVICE_NAME="${serviceName}"\nsession_secret_fingerprint`], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout.trim();

  test('指紋是 SHA-256 前 16 碼，不含密鑰', () => {
    const d = fs.mkdtempSync(path.join(base, 'fp-')); const secret = 'c'.repeat(64);
    fs.writeFileSync(path.join(d, 'svc.service'), `[Service]\nEnvironment=SESSION_SECRET=${secret}\n`);
    const out = run({ PBG_SYSTEMD_DIR: d }, 'svc');
    expect(out).toBe(crypto.createHash('sha256').update(`pbg-session-secret:${secret}`).digest('hex').slice(0, 16));
    expect(out).not.toContain(secret.slice(0, 8));
  });
  test('讀不到服務設定或沒有密鑰：輸出空字串（備份記為「未知」）', () => {
    const d = fs.mkdtempSync(path.join(base, 'fp-'));
    expect(run({ PBG_SYSTEMD_DIR: d }, 'nope')).toBe('');
    fs.writeFileSync(path.join(d, 'svc.service'), '[Service]\nEnvironment=NODE_ENV=production\n');
    expect(run({ PBG_SYSTEMD_DIR: d }, 'svc')).toBe('');
  });
  test('backup.sh 與 restore.sh 的指紋函式一致（不會一邊改了另一邊沒改）', () => {
    expect(extractFn(BACKUP_SH, 'session_secret_fingerprint')).toBe(extractFn(RESTORE_SH, 'session_secret_fingerprint'));
    expect(extractFn(BACKUP_SH, 'sha256_text')).toBe(extractFn(RESTORE_SH, 'sha256_text'));
  });
  test('backup_info.txt 寫入指紋行，格式能被 restore.sh 解析', () => {
    expect(BACKUP_SH).toContain('SESSION_SECRET 指紋: ${SECRET_FP:-未知}');
    expect(RESTORE_SH).toContain("grep -E '^SESSION_SECRET 指紋:'");
  });
});

describe('prune_keep_latest：安全副本的保留上限', () => {
  const prune = extractFn(RESTORE_SH, 'prune_keep_latest');
  const runPrune = (dir, prefix, keep, env = {}) => spawnSync('/bin/bash', ['-c', `${prune}\nprune_keep_latest "$1" "$2" $3`, 'x', dir, prefix, keep === undefined ? '' : String(keep)], { encoding: 'utf8', env: { ...process.env, ...env } });
  const touch = (file, ageMin, isDir = false) => {
    if (isDir) { fs.mkdirSync(file, { recursive: true }); fs.writeFileSync(path.join(file, 'x.txt'), 'x'); } else fs.writeFileSync(file, 'x');
    const t = new Date(Date.now() - ageMin * 60000); fs.utimesSync(file, t, t);
  };

  test('只留最近 N 份，舊的連同 -wal／-shm 一起刪，其他檔案不動', () => {
    const d = fs.mkdtempSync(path.join(base, 'prune-'));
    for (let i = 1; i <= 8; i++) {
      const f = path.join(d, `invoice_bonus.db.backup_2026102${i}_000000`);
      touch(f, 100 - i); touch(`${f}-wal`, 100 - i); touch(`${f}-shm`, 100 - i);
    }
    touch(path.join(d, 'invoice_bonus.db'), 500);
    touch(path.join(d, 'invoice_bonus.db.pre-migrate-1'), 500);
    runPrune(d, 'invoice_bonus.db.backup_', 5);
    const left = fs.readdirSync(d).sort();
    const mains = left.filter(n => /backup_\d{8}_\d{6}$/.test(n));
    expect(mains).toEqual([4, 5, 6, 7, 8].map(i => `invoice_bonus.db.backup_2026102${i}_000000`));
    expect(left.filter(n => n.endsWith('-wal')).length).toBe(5);   // 被留下的主檔，旁邊的 -wal／-shm 也在
    expect(left.filter(n => n.endsWith('-shm')).length).toBe(5);
    expect(left).toContain('invoice_bonus.db');
    expect(left).toContain('invoice_bonus.db.pre-migrate-1');
  });

  test('目錄型的副本（uploads.backup_*）也能清；最新的永遠保留', () => {
    const d = fs.mkdtempSync(path.join(base, 'prune-'));
    for (let i = 1; i <= 5; i++) touch(path.join(d, `uploads.backup_${i}`), 100 - i, true);
    touch(path.join(d, 'uploads'), 1, true);
    runPrune(d, 'uploads.backup_', 2);
    expect(fs.readdirSync(d).sort()).toEqual(['uploads', 'uploads.backup_4', 'uploads.backup_5']);
  });

  test('份數不足上限時什麼都不刪；保留份數不合法時改用預設 5，最少 1', () => {
    const d = fs.mkdtempSync(path.join(base, 'prune-'));
    for (let i = 1; i <= 3; i++) touch(path.join(d, `temp_backup_before_restore_${i}.tar.gz`), 100 - i);
    runPrune(d, 'temp_backup_before_restore_', 5);
    expect(fs.readdirSync(d).length).toBe(3);
    runPrune(d, 'temp_backup_before_restore_', 'abc');
    expect(fs.readdirSync(d).length).toBe(3);
    runPrune(d, 'temp_backup_before_restore_', 0);
    expect(fs.readdirSync(d).length).toBe(1); // 0 視為 1：永遠不會把全部刪光
  });

  test('防呆：相對路徑、不存在的目錄、空前綴一律什麼都不做', () => {
    const d = fs.mkdtempSync(path.join(base, 'prune-'));
    touch(path.join(d, 'a_1'), 10); touch(path.join(d, 'a_2'), 5);
    runPrune(path.relative(process.cwd(), d), 'a_', 1);
    runPrune(path.join(d, 'nope'), 'a_', 1);
    runPrune(d, '', 1);
    expect(fs.readdirSync(d).sort()).toEqual(['a_1', 'a_2']);
  });

  test('環境變數 PBG_KEEP_SAFETY_COPIES 可調整預設份數', () => {
    const d = fs.mkdtempSync(path.join(base, 'prune-'));
    for (let i = 1; i <= 6; i++) touch(path.join(d, `t_${i}`), 100 - i);
    runPrune(d, 't_', undefined, { PBG_KEEP_SAFETY_COPIES: '2' });
    expect(fs.readdirSync(d).sort()).toEqual(['t_5', 't_6']);
  });

  test('deploy.sh 與 restore.sh 的 prune_keep_latest 完全一致；兩邊都有實際呼叫', () => {
    expect(extractFn(DEPLOY_SH, 'prune_keep_latest')).toBe(prune);
    expect(DEPLOY_SH).toContain('prune_keep_latest "${PROJECT_DIR}/data" "invoice_bonus.db.backup-"');
    expect(RESTORE_SH).toContain('prune_keep_latest "${BACKUP_DIR}" "temp_backup_before_restore_"');
    expect(RESTORE_SH).toContain('prune_keep_latest "${PROJECT_DIR}/data" "invoice_bonus.db.backup_"');
    expect(RESTORE_SH).toContain('prune_keep_latest "${PROJECT_DIR}" "uploads.backup_"');
  });
});

describe('deploy.sh：首次安裝可指定 SESSION_SECRET（把備份還原到新主機時沿用原主機的密鑰）', () => {
  const start = DEPLOY_SH.indexOf('    EXISTING_SECRET=$(grep "^Environment=SESSION_SECRET="');
  const end = DEPLOY_SH.indexOf('\n\n    # 專用帳號時加上基本的 systemd 防護', start);
  const block = DEPLOY_SH.slice(start, end);
  const run = ({ unit = null, env = {} }) => {
    const d = fs.mkdtempSync(path.join(base, 'dep-')); const f = path.join(d, 'svc.service');
    if (unit !== null) fs.writeFileSync(f, unit);
    const script = `log() { echo "LOG: $1"; }\nwarning() { echo "WARN: $1"; }\nerror() { echo "ERR: $1"; exit 1; }\nSERVICE_FILE="${f}"\n${block}\necho "SECRET=$EXISTING_SECRET"`;
    const r = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, DEPLOY_SESSION_SECRET: '', ...env } });
    return { code: r.status, out: r.stdout + r.stderr, secret: (/SECRET=(.*)/.exec(r.stdout) || [])[1] };
  };

  test('找得到要測的程式區塊', () => { expect(block).toContain('DEPLOY_SESSION_SECRET'); });
  test('首次安裝且指定了合法的密鑰：使用它，且不印出內容', () => {
    const s = 'd'.repeat(64);
    const r = run({ env: { DEPLOY_SESSION_SECRET: s } });
    expect(r.code).toBe(0);
    expect(r.secret).toBe(s);
    expect(r.out.split('\n').filter(l => !l.startsWith('SECRET=')).join('\n')).not.toContain(s);
  });
  test('不合法的密鑰（太短、含特殊字元、含空白／換行／分號）一律拒絕', () => {
    for (const bad of ['short', 'x'.repeat(31), 'x'.repeat(129), 'a'.repeat(40) + ';rm -rf /', 'a'.repeat(40) + ' b', 'a'.repeat(40) + '\nExecStartPre=/bin/evil', '$(id)' + 'a'.repeat(40)]) {
      const r = run({ env: { DEPLOY_SESSION_SECRET: bad } });
      expect([bad, r.code]).toEqual([bad, 1]);
      expect(r.out).toContain('格式不正確');
    }
  });
  test('沒有指定：產生 64 位十六進位的隨機密鑰', () => {
    const r = run({});
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/);
  });
  test('本機已有密鑰：維持不變，忽略 DEPLOY_SESSION_SECRET 並警告', () => {
    const existing = 'e'.repeat(64);
    const r = run({ unit: `[Service]\nEnvironment=SESSION_SECRET=${existing}\n`, env: { DEPLOY_SESSION_SECRET: 'f'.repeat(64) } });
    expect(r.secret).toBe(existing);
    expect(r.out).toContain('忽略 DEPLOY_SESSION_SECRET');
  });
});
