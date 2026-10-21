// 轉介紹獎勵的「建立者」：由伺服器依登入者帶入、不信任表單、舊資料沒有建立者時顯示「-」。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

const withDb = (fn) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly: true });
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

  test('沒有建立者的舊資料顯示「-」，頁面正常', async () => {
    const admin = await as('admin');
    const r = await admin.get('/referral-rewards/');
    expect(r.status).toBe(200);
    expect(rowOf(r.text, '1,111')).toContain('text-muted">-</span>');
    expect(withDb(db => db.prepare('SELECT created_by_user_id FROM referral_rewards WHERE reward_amount = 1111').get().created_by_user_id)).toBeNull();
  });

  test('範圍較小的角色只看得到自己範圍內那筆的建立者資訊（不因此多看到其他獎勵）', async () => {
    const c = await as('u_ownedit'); // 看得到 1,111（自己專案），看不到 7,777（客戶 A 層級、不是負責人）
    const html = (await c.get('/referral-rewards/')).text;
    expect(html).toContain('1,111');
    expect(html).not.toContain('7,777');
  });
});
