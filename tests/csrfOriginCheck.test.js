// 不碰真實資料庫：csrfOriginCheck 只在讀取 system_base_url 設定時才用到 db
jest.mock('../src/models/db', () => ({ prepare: () => ({ get: () => null }) }));
const csrfOriginCheck = require('../src/middleware/csrfOriginCheck');

function run(req) {
  const res = {
    statusCode: null,
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
    render() { return this; },
  };
  let nextCalled = false;
  const fullReq = {
    method: 'POST', path: '/payments', originalUrl: '/payments',
    get(name) { return this.headers[name.toLowerCase()]; },
    accepts() { return false; },
    headers: {},
    ...req,
  };
  fullReq.headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  csrfOriginCheck(fullReq, res, () => { nextCalled = true; });
  return { nextCalled, status: res.statusCode };
}

describe('csrfOriginCheck', () => {
  const host = 'app.example.com';
  test('GET 不檢查', () => {
    expect(run({ method: 'GET', headers: { host, origin: 'http://evil.example' } }).nextCalled).toBe(true);
  });
  test('同源 POST 放行', () => {
    expect(run({ headers: { host, origin: 'https://app.example.com' } }).nextCalled).toBe(true);
  });
  test('跨站 Origin 拒絕', () => {
    const r = run({ headers: { host, origin: 'https://evil.example' } });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });
  test('Origin: null 拒絕', () => {
    expect(run({ headers: { host, origin: 'null' } }).status).toBe(403);
  });
  test('沒有 Origin 時看 Referer：惡意 Referer 拒絕、同源放行', () => {
    expect(run({ headers: { host, referer: 'https://evil.example/x' } }).status).toBe(403);
    expect(run({ headers: { host, referer: 'https://app.example.com/page' } }).nextCalled).toBe(true);
  });
  test('Origin 與 Referer 都沒有（非瀏覽器）放行', () => {
    expect(run({ headers: { host } }).nextCalled).toBe(true);
  });
  test('LINE webhook 不在檢查範圍', () => {
    expect(run({ path: '/webhooks/line/callback', headers: { host, origin: 'https://line.example' } }).nextCalled).toBe(true);
  });
  test('反向代理轉送的 X-Forwarded-Host 也算本站', () => {
    expect(run({ headers: { host: 'localhost:3000', 'x-forwarded-host': 'app.example.com', origin: 'https://app.example.com' } }).nextCalled).toBe(true);
  });
});
