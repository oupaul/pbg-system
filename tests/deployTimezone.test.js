// deploy.sh 的 set_default_timezone：用假的 timedatectl 驗證各種情況（不會動到本機時區）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const deploySh = fs.readFileSync(path.join(__dirname, '..', 'deploy.sh'), 'utf8');
const start = deploySh.indexOf('set_default_timezone() {');
const end = deploySh.indexOf('\n}\n', start) + 3;
const FUNC = deploySh.slice(start, end);

let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-test-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// 假的 timedatectl：show 回傳 FAKE_TZ；set-timezone 把參數寫進 CALLS 檔（FAKE_FAIL=1 時失敗）
function fakeBin(name) {
  const bin = path.join(dir, name);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'timedatectl'), `#!/bin/bash
if [ "$1" = "show" ]; then printf '%s\\n' "$FAKE_TZ"; exit 0; fi
if [ "$1" = "set-timezone" ]; then
  [ "$FAKE_FAIL" = "1" ] && exit 1
  echo "$2" >> "$CALLS"; exit 0
fi
exit 0
`, { mode: 0o755 });
  return bin;
}

function run({ current, env = {}, withTimedatectl = true }) {
  const calls = path.join(dir, `calls-${Math.random().toString(36).slice(2)}`);
  let bin;
  let basePath = ':/usr/bin:/bin';
  if (withTimedatectl) {
    bin = fakeBin(`bin-${Math.random().toString(36).slice(2)}`);
  } else {
    // 沒有 timedatectl 的主機：PATH 只放 grep（Linux 的 /usr/bin 本來就有 timedatectl，不能直接沿用）
    bin = fs.mkdtempSync(path.join(dir, 'empty-'));
    fs.symlinkSync(['/usr/bin/grep', '/bin/grep'].find(f => fs.existsSync(f)), path.join(bin, 'grep'));
    basePath = '';
  }
  const script = `
    info() { echo "INFO: $1"; }
    warning() { echo "WARN: $1"; }
    log() { echo "LOG: $1"; }
    ${FUNC}
    set_default_timezone
    echo "EXIT:$?"
  `;
  // PATH 只放假的 bin 與系統基本工具（找不到 timedatectl 的情況用空目錄）
  const r = spawnSync('/bin/bash', ['-c', script], {
    env: { PATH: `${bin}${basePath}`, FAKE_TZ: current, CALLS: calls, ...env },
    encoding: 'utf8'
  });
  return { out: r.stdout, called: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] };
}

describe('deploy.sh 首次安裝的時區設定', () => {
  test('找得到函式', () => { expect(FUNC).toContain('set_default_timezone'); });

  test('主機是 UTC：預設改成 Asia/Taipei', () => {
    const r = run({ current: 'Etc/UTC' });
    expect(r.called).toEqual(['Asia/Taipei']);
    expect(r.out).toContain('已由 Etc/UTC 改為 Asia/Taipei');
    expect(r.out).toContain('EXIT:0');
  });

  test('主機是 UTC（寫成 UTC）也會改', () => {
    expect(run({ current: 'UTC' }).called).toEqual(['Asia/Taipei']);
  });

  test('已經是目標時區：不重複設定', () => {
    const r = run({ current: 'Asia/Taipei' });
    expect(r.called).toEqual([]);
    expect(r.out).toContain('已是 Asia/Taipei');
  });

  test('管理員已設成其他時區：保留不動，只提示', () => {
    const r = run({ current: 'Europe/London' });
    expect(r.called).toEqual([]);
    expect(r.out).toContain('保留不變');
    expect(r.out).toContain('EXIT:0');
  });

  test('DEPLOY_TIMEZONE 指定其他時區', () => {
    expect(run({ current: 'Etc/UTC', env: { DEPLOY_TIMEZONE: 'Europe/London' } }).called).toEqual(['Europe/London']);
  });

  test('DEPLOY_TIMEZONE=skip 完全不處理', () => {
    const r = run({ current: 'Etc/UTC', env: { DEPLOY_TIMEZONE: 'skip' } });
    expect(r.called).toEqual([]);
    expect(r.out).toContain('略過時區設定');
  });

  test('不存在或不合法的時區名稱一律拒絕（含路徑穿越）', () => {
    for (const bad of ['Not/AZone', '../../etc/passwd', 'Asia/Taipei; touch /tmp/x', '$(id)', 'Asia/../Asia/Taipei']) {
      const r = run({ current: 'Etc/UTC', env: { DEPLOY_TIMEZONE: bad } });
      expect([bad, r.called]).toEqual([bad, []]);
      expect(r.out).toContain('EXIT:0');
    }
  });

  test('設定失敗只警告，不讓部署中斷', () => {
    const r = run({ current: 'Etc/UTC', env: { FAKE_FAIL: '1' } });
    expect(r.out).toContain('設定時區失敗');
    expect(r.out).toContain('EXIT:0');
  });

  test('主機沒有 timedatectl：略過', () => {
    const r = run({ current: 'Etc/UTC', withTimedatectl: false });
    expect(r.called).toEqual([]);
    expect(r.out).toContain('找不到 timedatectl');
    expect(r.out).toContain('EXIT:0');
  });
});
