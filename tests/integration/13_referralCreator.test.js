// 轉介紹獎勵的「建立者」：由伺服器依登入者帶入、不信任表單、舊資料沒有建立者時顯示「-」。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

const withDb = (fn, { readonly = true } = {}) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
};
// 取出總覽頁中含某金額那一列
const rowOf = (html, amount) => (html.split('<tr').find(r => r.includes(amount)) || '');

describeIntegration('轉介紹獎勵：建立者', () => {
  test('新增時記錄登入者為建立者，總覽頁與客戶詳情頁都顯示姓名', async () => {
    const admin = await as('admin');
    const r = await admin.post('/referral-rewards/', { form: { referring_customer_id: String(ids.A.customer), recipient_type: 'customer', reward_amount: '7777', status: '待發放' } });
    expect(r.status).toBe(302);
    const row = withDb(db => db.prepare('SELECT id, created_by_user_id FROM referral_rewards WHERE reward_amount = 7777').get());
    expect(row.created_by_user_id).toBe(ids.users.admin);
    const name = withDb(db => db.prepare('SELECT name FROM users WHERE id = ?').get(ids.users.admin).name);
    const overview = (await admin.get('/referral-rewards/')).text;
    expect(rowOf(overview, '7,777')).toContain(name);
    const detail = (await admin.get(`/customers/${ids.A.customer}`)).text;
    expect(rowOf(detail, '7,777')).toContain(name);
  });

  test('表單送來的 created_by_user_id 會被忽略，一律是登入者', async () => {
    const admin = await as('admin');
    await admin.post('/referral-rewards/', { form: { referring_customer_id: String(ids.A.customer), recipient_type: 'customer', reward_amount: '8888', created_by_user_id: String(ids.users.u_boss) } });
    const row = withDb(db => db.prepare('SELECT created_by_user_id FROM referral_rewards WHERE reward_amount = 8888').get());
    expect(row.created_by_user_id).toBe(ids.users.admin);
  });

  // 不依賴種子獎勵：別的測試檔（06）的更新請求會改動它們（例如沒帶 project_id 的更新會清掉專案關聯），
  // 所以這裡自己建立資料。「舊資料」用直接寫入資料庫（沒有建立者欄位值）來模擬。
  test('沒有建立者的舊資料顯示「-」，頁面正常', async () => {
    const admin = await as('admin');
    withDb(db => db.prepare("INSERT INTO referral_rewards (referring_customer_id, recipient_type, reward_amount, status) VALUES (?, 'customer', 5151, '待發放')").run(ids.A.customer), { readonly: false });
    const r = await admin.get('/referral-rewards/');
    expect(r.status).toBe(200);
    expect(withDb(db => db.prepare('SELECT created_by_user_id FROM referral_rewards WHERE reward_amount = 5151').get().created_by_user_id)).toBeNull();
    expect(rowOf(r.text, '5,151')).toContain('text-muted">-</span>');
  });

  test('範圍較小的角色只看得到自己範圍內那筆的建立者資訊（不因此多看到其他獎勵）', async () => {
    const admin = await as('admin');
    // 關聯業務 A 專案的獎勵：u_ownedit（範圍「自己」、綁業務 A）看得到；客戶 A 層級（沒有專案、不是負責人）那筆看不到（7,777）
    await admin.post('/referral-rewards/', { form: { referring_customer_id: String(ids.A.customer), project_id: String(ids.A.project), recipient_type: 'customer', reward_amount: '6666' } });
    const c = await as('u_ownedit');
    const html = (await c.get('/referral-rewards/')).text;
    expect(html).toContain('6,666');
    expect(rowOf(html, '6,666')).toContain('系統管理員');
    expect(html).not.toContain('7,777');
  });
});
