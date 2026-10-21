// 特權輔助程式（scripts/pbg-privileged.js）的輸入驗證與信任檢查。
// 這支程式會以 root 執行、呼叫者（服務帳號）不可信，所以所有參數都必須被嚴格限制。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseInvocation, assertTrustedInstall, resolveBackupFile, UsageError } = require('../scripts/pbg-privileged');
const PrivilegedClient = require('../src/services/PrivilegedClient');

describe('parseInvocation', () => {
  test('合法的呼叫', () => {
    expect(parseInvocation(['backup'])).toEqual({ action: 'backup', args: [] });
    expect(parseInvocation(['nas-test'])).toEqual({ action: 'nas-test', args: [] });
    expect(parseInvocation(['delete-backup', 'backup_20261021_120000.tar.gz'])).toEqual({ action: 'delete-backup', args: ['backup_20261021_120000.tar.gz'] });
    expect(parseInvocation(['restore', 'uninstall_backup_20261021_120000.tar.gz', 'op_123-abc'])).toEqual({
      action: 'restore', args: ['uninstall_backup_20261021_120000.tar.gz', 'op_123-abc']
    });
  });

  test.each([
    [[]],
    [['unknown']],
    [['backup', 'extra']],
    [['nas-test', '--flag']],
    [['rm', '-rf', '/']],
    [['BACKUP']],
    [['delete-backup']],
    [['delete-backup', '../../etc/passwd']],
    [['delete-backup', 'backup_1.tar.gz; rm -rf /']],
    [['delete-backup', 'backup_1.tar.gz', 'extra']],
    [['delete-backup', '/etc/shadow']],
    [['delete-backup', 'evil.tar.gz']],
    [['restore', 'backup_1.tar.gz']],
    [['restore', 'backup_1.tar.gz', '../x']],
    [['restore', 'backup_1.tar.gz', 'a b']],
    [['restore', 'backup_1.tar.gz', 'x'.repeat(65)]],
    [['restore', 'backup_1.tar.gz', '']],
    [['restore', '../backup_1.tar.gz', 'op1']],
    [['restore', 'backup_1.tar.gz', 'op1', 'extra']]
  ])('拒絕 %j', (argv) => {
    expect(() => parseInvocation(argv)).toThrow(UsageError);
  });
});

describe('assertTrustedInstall', () => {
  let root;
  const uid = process.getuid();
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'a.js'), 'x');
    fs.chmodSync(root, 0o755);
    fs.chmodSync(path.join(root, 'scripts'), 0o755);
    fs.chmodSync(path.join(root, 'scripts', 'a.js'), 0o644);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const check = (rels = ['.', 'scripts', 'scripts/a.js'], opts = { expectedUid: uid }) => assertTrustedInstall(root, rels, opts);

  test('擁有者正確且不可被 group/其他人寫入時通過', () => {
    expect(() => check()).not.toThrow();
  });
  test('不是 root 擁有（這裡模擬擁有者不符）時拒絕', () => {
    expect(() => assertTrustedInstall(root, ['.'], { expectedUid: 0 })).toThrow(/不是 root 擁有/);
  });
  test('group 可寫或其他人可寫時拒絕', () => {
    fs.chmodSync(path.join(root, 'scripts', 'a.js'), 0o664);
    expect(() => check()).toThrow(/可被 group 或其他人寫入/);
    fs.chmodSync(path.join(root, 'scripts', 'a.js'), 0o646);
    expect(() => check()).toThrow(/可被 group 或其他人寫入/);
    fs.chmodSync(path.join(root, 'scripts', 'a.js'), 0o644);
    fs.chmodSync(path.join(root, 'scripts'), 0o775);
    expect(() => check()).toThrow(/可被 group 或其他人寫入/);
  });
  test('符號連結一律拒絕（避免把受信任的路徑換成別處）', () => {
    fs.symlinkSync('/etc/hosts', path.join(root, 'scripts', 'link.js'));
    expect(() => check(['scripts/link.js'])).toThrow(/符號連結/);
  });
  test('必要檔案不存在時拒絕；deploy.config.sh 例外（舊安裝可能沒有）', () => {
    expect(() => check(['scripts/missing.js'])).toThrow(/不存在/);
    expect(() => check(['deploy.config.sh'])).not.toThrow();
  });
});

describe('resolveBackupFile', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('一般檔案可解析', () => {
    fs.writeFileSync(path.join(dir, 'backup_1.tar.gz'), 'x');
    expect(resolveBackupFile('backup_1.tar.gz', dir)).toBe(path.join(dir, 'backup_1.tar.gz'));
  });
  test('找不到、符號連結、目錄都拒絕', () => {
    expect(() => resolveBackupFile('backup_missing.tar.gz', dir)).toThrow(/找不到/);
    fs.symlinkSync('/etc/hosts', path.join(dir, 'backup_link.tar.gz'));
    expect(() => resolveBackupFile('backup_link.tar.gz', dir)).toThrow(/不是一般檔案/);
    fs.mkdirSync(path.join(dir, 'backup_dir.tar.gz'));
    expect(() => resolveBackupFile('backup_dir.tar.gz', dir)).toThrow(/不是一般檔案/);
  });
});

describe('PrivilegedClient', () => {
  const realGetuid = process.getuid;
  afterEach(() => { process.getuid = realGetuid; });

  test('已安裝且非 root 才走輔助程式', () => {
    process.getuid = () => 1000;
    expect(PrivilegedClient.needsHelper(true)).toBe(true);
    expect(PrivilegedClient.needsHelper(false)).toBe(false);
    process.getuid = () => 0;
    expect(PrivilegedClient.needsHelper(true)).toBe(false);
  });

  test('指令形式：sudo -n <node> <輔助程式> <動作> <參數…>，不帶 -E', () => {
    const [cmd, args] = PrivilegedClient.helperCommand('/opt/app', 'restore', ['backup_1.tar.gz', 'op1']);
    expect(cmd).toBe('sudo');
    expect(args).toEqual(['-n', process.execPath, '/opt/app/scripts/pbg-privileged.js', 'restore', 'backup_1.tar.gz', 'op1']);
    expect(args).not.toContain('-E');
  });
});
