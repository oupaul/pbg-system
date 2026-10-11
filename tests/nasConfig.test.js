const fs = require('fs');
const os = require('os');
const path = require('path');
const NasConfigService = require('../src/services/NasConfigService');

// 若本機已是正式安裝環境（/opt/invoice-bonus-system 存在），NasConfigService 會把設定寫進安裝目錄，測試一律略過避免動到正式設定
const describeIfDev = fs.existsSync('/opt/invoice-bonus-system') ? describe.skip : describe;

describeIfDev('NAS 設定驗證（防參數注入）', () => {
  const original = process.cwd();
  let tmp;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-test-')); process.chdir(tmp); });
  afterAll(() => { process.chdir(original); fs.rmSync(tmp, { recursive: true, force: true }); });

  const base = { enabled: true, host: 'nas.local', port: 22, username: 'backup', path: '/volume1/backup', protocol: 'rsync' };
  test('正常設定可儲存', () => {
    expect(NasConfigService.saveConfig(base).success).toBe(true);
  });
  test.each([
    ['host 以 - 開頭（-oProxyCommand）', { host: '-oProxyCommand=touch /tmp/x' }],
    ['host 含空白', { host: 'nas local' }],
    ['username 以 - 開頭', { username: '-oProxyCommand=x' }],
    ['path 含 ..', { path: '/volume1/../etc' }],
    ['path 不是絕對路徑', { path: 'volume1/backup' }],
    ['port 超出範圍', { port: 70000 }],
    ['protocol 不支援', { protocol: 'ftp' }],
  ])('拒絕：%s', (_label, override) => {
    expect(NasConfigService.saveConfig({ ...base, ...override }).success).toBe(false);
  });
});
