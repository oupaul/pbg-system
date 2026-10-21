// 專案範圍（IDOR）測試：範圍為「自己／指派／無」的使用者，不能透過猜 id 讀取或修改他人（業務 B）的專案、
// 發票、收款、成本、獎金與附件，列表與匯出也不能夾帶他人資料。
// 資料：業務 A 與 B 各有一套完整資料（見 setup/seed.js）；攻擊者是只該看到 A 的帳號。
const ExcelJS = require('exceljs');
const { describeIntegration, as, ids, isDenied, postFile, BASE } = require('./helpers');

const B = ids.B;
const A = ids.A;
const notFoundOrDenied = (r) => isDenied(r) || r.status === 404;

// 只該看到業務 A 資料的使用者：業務員（無編輯權限）、範圍「自己」的編輯者、範圍「指派」的編輯者
const ATTACKERS = ['u_salesA', 'u_ownedit', 'u_assigned'];

describeIntegration('專案範圍：不能存取他人專案', () => {
  describe.each(ATTACKERS)('攻擊者 %s', (username) => {
    let c;
    beforeAll(async () => { c = await as(username); });

    test('不能讀取業務 B 的專案詳情與編輯頁', async () => {
      expect(notFoundOrDenied(await c.get(`/projects/${B.project}`))).toBe(true);
      expect(notFoundOrDenied(await c.get(`/projects/${B.project}/edit`))).toBe(true);
    });

    test('不能讀取業務 B 專案的附件（下載／預覽／文字／Office）', async () => {
      for (const kind of ['download', 'preview', 'text', 'office']) {
        const r = await c.get(`/projects/${B.project}/attachments/${B.attachment}/${kind}`);
        expect([kind, notFoundOrDenied(r)]).toEqual([kind, true]);
      }
    });

    test('不能對業務 B 的專案新增發票、收款、成本、獎金或上傳附件', async () => {
      const results = {
        invoice: await c.post('/invoices/', { form: { project_id: String(B.project) } }),
        payment: await c.post('/payments/', { form: { project_id: String(B.project) } }),
        cost: await c.post('/costs/', { form: { project_id: String(B.project) } }),
        bonus: await c.post('/bonuses/', { form: { project_id: String(B.project) } }),
        attachment: await postFile(c, `/projects/${B.project}/attachments`, { filename: 'x.pdf', content: '%PDF-1.4\nx', type: 'application/pdf' })
      };
      const allowed = Object.entries(results).filter(([, r]) => !notFoundOrDenied(r)).map(([k, r]) => `${k}:${r.status}`);
      expect(allowed).toEqual([]);
    });

    test('不能修改或刪除業務 B 的專案、發票、收款、成本、獎金、附件', async () => {
      const attempts = [
        ['POST', `/projects/${B.project}`], ['POST', `/projects/${B.project}/delete`], ['POST', `/projects/${B.project}/update-expected-invoice`],
        ['POST', `/projects/${B.project}/attachments/${B.attachment}/delete`], ['POST', `/projects/${B.project}/attachments/${B.attachment}/restore`],
        ['POST', `/invoices/${B.invoice}`], ['POST', `/invoices/${B.invoice}/delete`], ['POST', `/invoices/${B.invoice}/void`],
        ['POST', `/invoices/${B.invoice}/allowance`], ['POST', `/invoices/${B.invoice}/partial-allowance`], ['POST', `/invoices/${B.invoice}/restore`],
        ['POST', `/payments/${B.payment}`], ['POST', `/payments/${B.payment}/delete`], ['POST', `/payments/${B.payment}/restore`],
        ['POST', `/costs/${B.cost}`], ['POST', `/costs/${B.cost}/delete`],
        ['POST', `/bonuses/${B.bonus}`], ['POST', `/bonuses/${B.bonus}/delete`]
      ];
      const allowed = [];
      for (const [method, path] of attempts) {
        const r = await c.request(method, path, { form: { status: '已發放', amount_with_tax: '1' } });
        if (!notFoundOrDenied(r)) allowed.push(`${method} ${path} -> ${r.status}`);
      }
      expect(allowed).toEqual([]);

      // 批次刪除獎金：夾帶他人的獎金 id 不能刪到
      await c.post('/bonuses/batch-delete', { form: { 'bonus_ids[]': String(B.bonus) } });
      await c.post('/bonuses/batch-update', { form: { 'ids': String(B.bonus), status: '已發放', year: '2026' } });
    });

    test('列表只看得到自己範圍內的專案', async () => {
      const list = (await c.get('/projects/')).text;
      expect(list).toContain('P-A');
      expect(list).not.toContain('P-B');
      expect(list).not.toContain('專案B');
    });

    test('獎金、收款、搜尋、毛利、儀表板都不洩漏業務 B 的資料', async () => {
      // 搜尋頁會把查詢字串回顯在輸入框，所以搜尋結果改檢查「有沒有連到業務 B 專案的連結」
      const pages = ['/bonuses/', '/recent-payments/', '/gross-profit/', '/', '/projects/invoice-detail', '/referral-rewards/', '/salespeople/', `/salespeople/${ids.spB}`];
      const leaks = [];
      for (const p of pages) {
        const r = await c.get(p);
        if (r.status === 200 && /專案B|P-B|INV-B|業務B/.test(r.text)) leaks.push(p);
      }
      for (const q of ['專案B', 'P-B', 'INV-B', '客戶B']) {
        const r = await c.get(`/search/?q=${encodeURIComponent(q)}`);
        if (r.status === 200 && new RegExp(`/projects/${B.project}\\b`).test(r.text)) leaks.push(`search ${q}`);
      }
      expect(leaks).toEqual([]);
    });
  });

  test('範圍「無」的使用者看不到任何專案，也進不去詳情', async () => {
    const c = await as('u_none');
    const list = (await c.get('/projects/')).text;
    expect(list).not.toMatch(/P-A|P-B/);
    expect(notFoundOrDenied(await c.get(`/projects/${A.project}`))).toBe(true);
    expect(notFoundOrDenied(await c.get(`/projects/${B.project}`))).toBe(true);
  });

  test('自己的專案仍然看得到（範圍檢查沒有誤擋）', async () => {
    expect((await (await as('u_salesA')).get(`/projects/${A.project}`)).status).toBe(200);
    expect((await (await as('u_salesB')).get(`/projects/${B.project}`)).status).toBe(200);
    expect((await (await as('u_assigned')).get(`/projects/${A.project}`)).status).toBe(200);
    expect((await (await as('u_ownedit')).get(`/projects/${A.project}`)).status).toBe(200);
  });
});

describeIntegration('匯出不夾帶範圍外的資料', () => {
  async function sheetText(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const parts = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => parts.push(String(cell.text || cell.value || '')))));
    return parts.join('\n');
  }
  async function download(c, path) {
    const headers = { 'X-Forwarded-For': c.ip, Cookie: c.cookie };
    const res = await fetch(BASE + path, { headers, redirect: 'manual' });
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  }
  const EXPORTS = ['/import-export/export/projects/2026', '/import-export/export/invoices/all', '/import-export/export/costs/all',
    '/import-export/export/bonuses/2026', '/import-export/export/aging', '/import-export/export/pdf/projects/2026'];

  // 這些匯出都是全公司範圍的報表，範圍為「自己／指派」的編輯者不能用（過去會把其他業務的專案與獎金一併匯出）
  test.each(['u_ownedit', 'u_assigned', 'u_none'])('%s 不能匯出全公司報表', async (username) => {
    const c = await as(username);
    const allowed = [];
    for (const path of EXPORTS) {
      const r = await download(c, path);
      if (r.status !== 403) allowed.push(`${path} -> ${r.status}`);
    }
    expect(allowed).toEqual([]);
  });

  test('管理員匯出則包含兩邊的資料（確認上面不是因為匯出本來就是空的）', async () => {
    const admin = await as('admin');
    const r = await download(admin, '/import-export/export/projects/2026');
    expect(r.status).toBe(200);
    const text = await sheetText(r.buffer);
    expect(text).toMatch(/P-A/);
    expect(text).toMatch(/P-B/);
  });
});

describeIntegration('攻擊嘗試沒有改到資料', () => {
  test('業務 B 的發票、附件、獎金、收款都還在', async () => {
    const admin = await as('admin');
    const page = (await admin.get(`/projects/${B.project}`)).text;
    expect(page).toContain('INV-B');
    expect(page).toContain('附件B.pdf');
    const bonuses = (await admin.get('/bonuses/?year=2026')).text;
    expect(bonuses).toContain('業務B');
  });
});
