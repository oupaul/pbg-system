// 路由登入驗證掃描：沒登入時，除了明確列出的公開路由以外，每一條路由都必須被擋下。
// 新增路由時如果忘了掛 requireAuth（過去 /api 就出過這種問題），這個測試會立刻失敗；
// 確實要公開的路由必須在下面的 PUBLIC 清單明確加上，等於逼著開發者做一次有意識的決定。
const { describeIntegration, getRoutes, anonymous, isDenied } = require('./helpers');

const PUBLIC = new Set([
  'GET /healthz',                          // 監控用，只回 ok
  'GET /vendor/exceljs/exceljs.min.js',    // 附件預覽用的前端函式庫（公開檔案）
  'GET /favicon.ico',
  'GET /branding/favicon',
  'GET /login',
  'POST /login',
  'GET /logout',
  'POST /logout',
  'POST /webhooks/line/'                   // LINE 平台呼叫，靠簽章驗證（見下方獨立測試）
]);

describeIntegration('未登入存取', () => {
  let routes;
  beforeAll(async () => { routes = await getRoutes(); });

  test('公開路由清單沒有過期（列出的路由都還存在）', () => {
    const keys = new Set(routes.map(r => r.key));
    const stale = [...PUBLIC].filter(k => !keys.has(k));
    expect(stale).toEqual([]);
  });

  test('除公開路由外，每條路由未登入都被擋下', async () => {
    const anon = anonymous();
    const leaked = [];
    for (const r of routes) {
      if (PUBLIC.has(r.key)) continue;
      const res = await anon.request(r.method, r.url, { form: {} });
      if (!isDenied(res)) leaked.push(`${r.key} -> ${res.status}`);
    }
    expect(leaked).toEqual([]);
  });

  test('LINE Webhook 沒有正確簽章一律 401（即使帶了惡意 Origin）', async () => {
    const anon = anonymous();
    const noSig = await anon.post('/webhooks/line/', { json: { events: [] } });
    expect(noSig.status).toBe(401);
    const badSig = await anon.post('/webhooks/line/', { json: { events: [] }, headers: { 'X-Line-Signature': 'bogus' }, origin: 'http://evil.example' });
    expect(badSig.status).toBe(401);
  });

  test('公開的登入頁與健康檢查可以正常讀取', async () => {
    const anon = anonymous();
    expect((await anon.get('/login')).status).toBe(200);
    const health = await anon.get('/healthz');
    expect(health.status).toBe(200);
    expect(health.text.trim()).toBe('ok'); // 不洩漏任何其他資訊
  });
});
