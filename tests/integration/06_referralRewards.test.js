// 轉介紹獎勵的可見範圍：獎勵金額是財務資料，不能讓專案檢視範圍之外的人看到或修改。
// 種子資料（金額用來辨識是哪一筆）：
//   1,111 業務 A 專案　2,222 業務 B 專案　3,333 客戶 B（無專案，負責人 u_salesB）
//   4,444 客戶 A（無專案，負責人 u_salesA）　5,555 業務 B 專案、領取人是 u_salesA
const { describeIntegration, as, ids, isDenied } = require('./helpers');

const R = ids.rewards;
const AMOUNT = { aProject: '1,111', bProject: '2,222', bCustomerLevel: '3,333', aCustomerLevel: '4,444', staffForSalesA: '5,555' };
const seen = (html) => Object.entries(AMOUNT).filter(([, a]) => html.includes(a)).map(([k]) => k).sort();

// 各使用者在「轉介紹獎勵」總覽頁應該看到哪幾筆
const EXPECTED = {
  admin: ['aCustomerLevel', 'aProject', 'bCustomerLevel', 'bProject', 'staffForSalesA'],
  u_boss: ['aCustomerLevel', 'aProject', 'bCustomerLevel', 'bProject', 'staffForSalesA'],
  u_user: ['aCustomerLevel', 'aProject', 'bCustomerLevel', 'bProject', 'staffForSalesA'],
  u_salesA: ['aCustomerLevel', 'aProject', 'staffForSalesA'], // 自己專案、自己負責的客戶、自己是領取人
  u_salesB: ['bCustomerLevel', 'bProject', 'staffForSalesA'], // 5,555 關聯的是業務 B 的專案，所以 B 看得到
  u_ownedit: ['aProject'],                                    // 範圍「自己」，但不是客戶 A 的負責人
  u_assigned: ['aProject'],
  u_none: []
};

describeIntegration('轉介紹獎勵：總覽頁依專案檢視範圍過濾', () => {
  test.each(Object.entries(EXPECTED))('%s 看到的獎勵', async (username, expected) => {
    const c = await as(username);
    const r = await c.get('/referral-rewards/');
    expect(r.status).toBe(200);
    expect(seen(r.text)).toEqual([...expected].sort());
  });
});

describeIntegration('轉介紹獎勵：因「領取人是自己」而看得到的獎勵，不洩漏範圍外專案的資訊', () => {
  test('u_salesA 看得到 5,555，但總覽頁看不到它關聯的業務 B 專案編號與名稱', async () => {
    // （客戶詳情頁的「專案」分頁本來就會列出該客戶的所有專案基本資訊，金額鎖定，所以這裡只檢查總覽頁）
    const c = await as('u_salesA');
    const r = await c.get('/referral-rewards/');
    expect(r.text).toContain('5,555');
    expect(/專案B|P-B/.test(r.text)).toBe(false);
  });
});

describeIntegration('轉介紹獎勵：客戶詳情頁的轉介紹分頁', () => {
  test('業務 A 看客戶 B 的詳情頁，只看得到領取人是自己的那筆', async () => {
    const c = await as('u_salesA');
    const r = await c.get(`/customers/${ids.B.customer}`);
    expect(r.status).toBe(200);
    expect(seen(r.text)).toEqual(['staffForSalesA']);
  });

  test('業務 B 看客戶 B 的詳情頁，看得到自己專案與客戶層級的全部獎勵', async () => {
    const c = await as('u_salesB');
    const r = await c.get(`/customers/${ids.B.customer}`);
    expect(seen(r.text)).toEqual(['bCustomerLevel', 'bProject', 'staffForSalesA']);
  });

  test('管理員看得到客戶 B 的全部獎勵', async () => {
    const c = await as('admin');
    expect(seen((await c.get(`/customers/${ids.B.customer}`)).text)).toEqual(['bCustomerLevel', 'bProject', 'staffForSalesA']);
  });
});

describeIntegration('轉介紹獎勵：不能修改或刪除範圍外的獎勵', () => {
  test('u_salesA 不能修改或刪除業務 B 的獎勵（專案、客戶層級）', async () => {
    const c = await as('u_salesA');
    const attempts = [];
    for (const key of ['bProject', 'bCustomerLevel']) {
      for (const suffix of ['', '/delete']) {
        const r = await c.post(`/referral-rewards/${R[key]}${suffix}`, { form: { reward_amount: '1', status: '已發放' } });
        if (!isDenied(r)) attempts.push(`${key}${suffix} -> ${r.status}`);
      }
    }
    expect(attempts).toEqual([]);
    // 資料沒被動到
    expect(seen((await (await as('u_salesB')).get('/referral-rewards/')).text)).toEqual(['bCustomerLevel', 'bProject', 'staffForSalesA']);
  });

  test('範圍「自己」的編輯者（u_ownedit）不能動別人負責客戶的客戶層級獎勵', async () => {
    const c = await as('u_ownedit');
    const r = await c.post(`/referral-rewards/${R.aCustomerLevel}/delete`, { form: {} });
    expect(isDenied(r)).toBe(true);
    expect(seen((await (await as('admin')).get('/referral-rewards/')).text)).toContain('aCustomerLevel');
  });

  test('不能新增或改成關聯範圍外專案的獎勵', async () => {
    const c = await as('u_salesA');
    const create = await c.post('/referral-rewards/', { form: { referring_customer_id: String(ids.A.customer), project_id: String(ids.B.project), recipient_type: 'customer', reward_amount: '9999' } });
    expect(isDenied(create)).toBe(true);
    const update = await c.post(`/referral-rewards/${R.aProject}`, { form: { project_id: String(ids.B.project), reward_amount: '1111', status: '待發放', recipient_type: 'customer' } });
    expect(isDenied(update)).toBe(true);
    expect((await (await as('admin')).get('/referral-rewards/')).text).not.toContain('9,999');
  });

  test('可以操作自己範圍內的獎勵（範圍檢查沒有誤擋）', async () => {
    const c = await as('u_salesA');
    const r = await c.post(`/referral-rewards/${R.aProject}`, { form: { reward_amount: '1111', status: '已發放', recipient_type: 'customer' } });
    expect(isDenied(r)).toBe(false);
  });
});

describeIntegration('轉介紹獎勵：搜尋不洩漏範圍外的獎勵', () => {
  test('範圍受限的編輯者搜尋客戶 B 的內容，找不到 B 專案的獎勵', async () => {
    const c = await as('u_ownedit');
    const r = await c.get(`/search/?q=${encodeURIComponent('B 專案')}`);
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/2,222/);
  });
});
