// 專案時間軸：內容正確、依專案範圍與角色過濾、分頁、跳脫。
const { describeIntegration, as, ids, postFile, isDenied } = require('./helpers');

const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };
const timeline = async (client, projectId, query = '') => client.get(`/projects/${projectId}/timeline${query}`);
const titles = (html) => [...html.matchAll(/<div class="tl-title">([^<]*)<\/div>/g)].map(m => m[1]);
const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describeIntegration('專案時間軸：內容', () => {
  let admin;
  const P = ids.C.project;
  beforeAll(async () => {
    admin = await as('admin');
    // 在專案 C 上做一連串操作，每一步都會產生修改記錄
    await admin.post('/invoices/', { form: { project_id: String(P), invoice_number: 'TL00000001', invoice_date: '2026-10-05', amount_with_tax: '3000' } });
    await admin.post('/invoices/', { form: { project_id: String(P), invoice_number: 'TL00000002', invoice_date: '2026-10-06', amount_with_tax: '2000' } });
  });
  const invoiceId = (n) => {
    const Database = require('better-sqlite3');
    const db = new Database(require('path').join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly: true });
    try { return db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(n).id; } finally { db.close(); }
  };

  test('新增、修改、作廢、刪除與還原都出現在時間軸，最新的在最上面，並顯示操作人', async () => {
    const id1 = invoiceId('TL00000001');
    const id2 = invoiceId('TL00000002');
    await admin.post(`/invoices/${id1}`, { form: { invoice_number: 'TL00000001', invoice_date: '2026-10-09', amount_with_tax: '3000' } });
    await admin.post(`/invoices/${id2}/void`, { form: { void_reason: '開錯' } });
    await admin.post(`/invoices/${id1}/delete`, { form: {} });
    await admin.post(`/invoices/${id1}/restore`, { form: {} });

    const r = await timeline(admin, P);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    const t = titles(r.text);
    // 新 → 舊
    expect(t.indexOf('還原發票 TL00000001')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('還原發票 TL00000001')).toBeLessThan(t.indexOf('刪除發票 TL00000001'));
    expect(t.indexOf('刪除發票 TL00000001')).toBeLessThan(t.indexOf('作廢發票 TL00000002'));
    expect(t.indexOf('作廢發票 TL00000002')).toBeLessThan(t.indexOf('修改發票 TL00000001'));
    expect(t.indexOf('修改發票 TL00000001')).toBeLessThan(t.indexOf('新增發票 TL00000002'));
    expect(t.indexOf('新增發票 TL00000002')).toBeLessThan(t.indexOf('新增發票 TL00000001'));
    expect(r.text).toContain('發票日期：<span class="tl-from">2026-10-05</span> → <span>2026-10-09</span>');
    expect(r.text).toContain('金額(含稅)：<span>$3,000</span>');
    expect(r.text).toContain('系統管理員'); // 操作人
  });

  test('收款、成本、獎金、附件、專案資料的變更也在時間軸', async () => {
    const id1 = invoiceId('TL00000001');
    await admin.post('/payments/', { form: { project_id: String(P), invoice_id: String(id1), payment_date: '2026-10-12', bank_deposit_amount: '1500' } });
    await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2026-10-10', item_name: '機櫃', estimated_amount: '800', actual_amount: '700' } });
    await admin.post('/bonuses/', { form: { project_id: String(P), salesperson_id: String(ids.spA), bonus_type: '業績獎金', base_amount: '1000', bonus_percentage: '5', bonus_amount: '50' } });
    await postFile(admin, `/projects/${P}/attachments`, { filename: '驗收單.pdf', content: '%PDF-1.4\nx', type: 'application/pdf' });
    await admin.post(`/projects/${P}`, { form: { project_name: '專案C（改名）', project_code: 'P-C', contract_year: '2026', contract_month: '10', project_type: 'A類', status: '未結案', price_with_tax: '10000000', price_without_tax: '9523810', salesperson_id: String(ids.spA), customer_id: String(ids.A.customer) } });

    const t = titles((await timeline(admin, P)).text);
    for (const expected of ['新增收款 2026-10-12 $1,500', '新增成本 機櫃', '新增獎金 業績獎金', '新增附件 驗收單.pdf', '修改專案資料']) {
      expect([expected, t.includes(expected)]).toEqual([expected, true]);
    }
  });

  test('沒有實際變動的儲存不會出現在時間軸', async () => {
    const id1 = invoiceId('TL00000001');
    const before = titles((await timeline(admin, P)).text).filter(x => x.startsWith('修改發票')).length;
    await admin.post(`/invoices/${id1}`, { form: { invoice_number: 'TL00000001', invoice_date: '2026-10-09', amount_with_tax: '3000' } }); // 與目前內容完全相同
    const after = titles((await timeline(admin, P)).text).filter(x => x.startsWith('修改發票')).length;
    expect(after).toBe(before);
  });

  test('依種類篩選；不認得的種類與壞掉的游標會被忽略', async () => {
    const only = titles((await timeline(admin, P, '?kind=invoice')).text);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every(x => /發票/.test(x))).toBe(true);
    const bogus = await timeline(admin, P, '?kind=not_a_kind&cursor=%27%20OR%201%3D1--');
    expect(bogus.status).toBe(200);
    expect(titles(bogus.text).length).toBeGreaterThan(0);
  });

  test('記錄功能之前就存在的資料（沒有修改記錄）也會補上「新增」事件', async () => {
    const r = await timeline(admin, ids.A.project);
    expect(titles(r.text)).toEqual(expect.arrayContaining(['新增發票 INV-A', '建立專案「專案A」']));
    expect(r.text).toContain('記錄功能啟用前的資料');
  });

  test('發票號碼等使用者輸入的內容會被跳脫，不會變成可執行的 HTML', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    await admin.post('/invoices/', { form: { project_id: String(ids.D.project), invoice_number: evil, invoice_date: '2026-10-05', amount_with_tax: '10' } });
    const r = await timeline(admin, ids.D.project);
    expect(r.text).not.toContain('<img src=x');
    expect(r.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describeIntegration('專案時間軸：權限與可見範圍', () => {
  test('只能看自己範圍內專案的時間軸；範圍外或沒有權限的一律 403', async () => {
    const salesA = await as('u_salesA');
    expect((await timeline(salesA, ids.A.project)).status).toBe(200);
    expect(isDenied(await timeline(salesA, ids.B.project))).toBe(true);
    for (const user of ['u_ownedit', 'u_assigned', 'u_none']) {
      const c = await as(user);
      expect([user, isDenied(await timeline(c, ids.B.project))]).toEqual([user, true]);
    }
    expect(isDenied(await timeline(await as('u_none'), ids.A.project))).toBe(true);
  });

  test('獎金事件只有可編輯的角色看得到（與專案頁的獎金分頁一致），篩選按鈕也沒有獎金', async () => {
    const admin = await as('admin');
    const salesA = await as('u_salesA');
    const adminHtml = (await timeline(admin, ids.A.project)).text;
    const salesHtml = (await timeline(salesA, ids.A.project)).text;
    expect(adminHtml).toContain('新增獎金 業績獎金');
    expect(adminHtml).toContain('data-timeline-kind="bonus"');
    expect(salesHtml).not.toContain('獎金');
    expect(salesHtml).not.toContain('data-timeline-kind="bonus"');
    // 即使直接指定種類也看不到
    expect(titles((await timeline(salesA, ids.A.project, '?kind=bonus')).text).some(x => /獎金/.test(x))).toBe(false);
  });

  test('專案頁有「時間軸」分頁', async () => {
    const page = (await (await as('u_salesA')).get(`/projects/${ids.A.project}`)).text;
    expect(page).toContain('data-bs-target="#pane-timeline"');
    expect(page).toContain(`data-url="/projects/${ids.A.project}/timeline"`);
  });
});

describeIntegration('專案時間軸：分頁', () => {
  test('事件超過一頁時以游標分頁，不重複、不遺漏，最後一頁沒有「載入更多」', async () => {
    const admin = await as('admin');
    const project = ids.D.project;
    for (let i = 1; i <= 36; i++) {
      await admin.post('/invoices/', { form: { project_id: String(project), invoice_number: `PG${String(i).padStart(8, '0')}`, invoice_date: '2026-10-05', amount_with_tax: '1' } });
    }
    const seen = [];
    let query = '';
    let pages = 0;
    for (;;) {
      const r = await timeline(admin, project, query);
      expect(r.status).toBe(200);
      seen.push(...titles(r.text));
      pages++;
      const next = decodeEntities(r.text).match(/data-timeline-cursor="([^"]+)"/);
      if (!next) break;
      query = `?cursor=${encodeURIComponent(next[1])}`;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBeGreaterThanOrEqual(2);
    const created = seen.filter(x => /^新增發票 PG/.test(x));
    expect(created).toHaveLength(36);
    expect(new Set(created).size).toBe(36);
  });
});
