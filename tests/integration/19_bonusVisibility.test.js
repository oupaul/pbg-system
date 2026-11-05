// 角色旗標 can_view_bonus（可檢視獎金）：所有顯示獎金金額的地方都必須遵守，沒有旗標的角色連資料都拿不到。
const path = require('path');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids, BASE, isDenied } = require('./helpers');

function withDb(fn, { readonly = true } = {}) {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}
const download = async (client, url) => {
  const res = await fetch(BASE + url, { headers: { Cookie: client.cookie, 'X-Forwarded-For': client.ip } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
};
const workbook = async (client, url) => {
  const r = await download(client, url);
  expect(r.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buf);
  return wb;
};

describeIntegration('檢視獎金權限：資料庫與角色管理', () => {
  test('升級後既有角色全部預設可檢視獎金（權限不變）；只有測試刻意關掉的角色是 0', () => {
    const off = withDb(db => db.prepare('SELECT role_key FROM roles WHERE can_view_bonus = 0 ORDER BY role_key').all().map(r => r.role_key));
    expect(off).toEqual(['admin_no_bonus', 'no_bonus']);
    const builtin = withDb(db => db.prepare("SELECT role_key, can_view_bonus FROM roles WHERE role_key IN ('admin','user','boss','salesperson')").all());
    expect(builtin.length).toBe(4);
    for (const r of builtin) expect([r.role_key, r.can_view_bonus]).toEqual([r.role_key, 1]);
  });

  test('在角色管理關掉／打開旗標會立即生效；編輯表單與詳情頁正確顯示', async () => {
    const admin = await as('admin');
    const tg = await as('u_togglebonus');
    const roleId = withDb(db => db.prepare("SELECT id FROM roles WHERE role_key = 'toggle_bonus'").get().id);
    expect((await tg.get('/bonuses/')).status).toBe(200);
    expect(/name="can_view_bonus"\s*checked/.test((await admin.get(`/roles/${roleId}/edit`)).text)).toBe(true);

    const base = { role_key: 'toggle_bonus', role_name: 'toggle_bonus', can_edit: 'on', can_edit_crm: 'on', project_view_scope: 'all', is_active: 'on' };
    const off = await admin.request('PUT', `/roles/${roleId}`, { json: base }); // 沒帶 can_view_bonus ＝ 取消勾選
    expect(off.status).toBe(200);
    expect(withDb(db => db.prepare('SELECT can_view_bonus FROM roles WHERE id = ?').get(roleId).can_view_bonus)).toBe(0);
    expect(/name="can_view_bonus"\s*checked/.test((await admin.get(`/roles/${roleId}/edit`)).text)).toBe(false);
    expect(isDenied(await tg.get('/bonuses/'))).toBe(true);

    const on = await admin.request('PUT', `/roles/${roleId}`, { json: { ...base, can_view_bonus: 'on' } });
    expect(on.status).toBe(200);
    expect((await tg.get('/bonuses/')).status).toBe(200);
  });
});

describeIntegration('檢視獎金權限：沒有旗標的角色看不到任何獎金', () => {
  let admin; let editor; let nb; let adminNb;
  const P = ids.A.project;
  beforeAll(async () => {
    admin = await as('admin'); editor = await as('u_edit'); nb = await as('u_nobonus'); adminNb = await as('u_adminnb');
  });

  test('獎金管理頁、對帳單與所有獎金寫入端點：沒有旗標 403（即使有編輯權限）；有旗標的正常', async () => {
    expect((await editor.get('/bonuses/')).status).toBe(200);
    for (const url of ['/bonuses/', `/bonuses/statement?salesperson_id=${ids.spA}&year=2026&period=year`]) {
      expect([url, isDenied(await nb.get(url))]).toEqual([url, true]);
    }
    for (const url of ['/bonuses/', '/bonuses/batch-update', '/bonuses/batch-delete', `/bonuses/${ids.A.bonus}`, `/bonuses/${ids.A.bonus}/delete`]) {
      const r = await nb.post(url, { form: { project_id: String(P), ids: String(ids.A.bonus), bonus_amount: '1' } });
      expect([url, isDenied(r)]).toEqual([url, true]);
    }
    expect(withDb(db => db.prepare('SELECT bonus_amount FROM bonus_calculations WHERE id = ?').get(ids.A.bonus).bonus_amount)).toBe(5000);
  });

  test('專案頁：有旗標看得到獎金分頁與合計；沒有旗標連分頁、合計、新增／編輯視窗都不輸出', async () => {
    const withBonus = (await editor.get(`/projects/${P}`)).text;
    expect(withBonus).toContain('pane-bonuses');
    expect(withBonus).toContain('獎金合計');
    const without = (await nb.get(`/projects/${P}`)).text;
    expect(without).toContain('發票明細'); // 頁面本身正常
    for (const s of ['pane-bonuses', '獎金合計', 'bonusModal', 'editBonusModal', '/bonuses']) expect([s, without.includes(s)]).toEqual([s, false]);
  });

  test('專案時間軸：沒有旗標看不到獎金事件，也不能用 kind=bonus 篩', async () => {
    const withBonus = (await editor.get(`/projects/${P}/timeline`)).text;
    expect(withBonus).toContain('新增獎金');
    for (const q of ['', '?kind=bonus']) {
      const html = (await nb.get(`/projects/${P}/timeline${q}`)).text;
      expect([q, html.includes('獎金')]).toEqual([q, false]);
    }
  });

  test('業務詳情頁：沒有旗標沒有總獎金卡片與獎金列表', async () => {
    const withBonus = (await editor.get(`/salespeople/${ids.spA}`)).text;
    expect(withBonus).toContain('獎金列表');
    const without = await nb.get(`/salespeople/${ids.spA}`);
    expect(without.status).toBe(200);
    for (const s of ['獎金列表', '總獎金']) expect([s, without.text.includes(s)]).toEqual([s, false]);
  });

  test('業務績效頁與匯出：沒有旗標沒有獎金欄位、圖表與資料', async () => {
    const withBonus = (await editor.get('/sales-performance/')).text;
    expect(withBonus).toContain('總獎金');
    expect(withBonus).toContain('chartBonus');
    const html = (await nb.get('/sales-performance/')).text;
    expect(html).toContain('專案金額'); // 頁面本身正常
    for (const s of ['總獎金', 'chartBonus', 'total_bonus', 'paid_bonus']) expect([s, html.includes(s)]).toEqual([s, false]);

    // 欄位標題列（前面可能有標題文字列）：找出含「專案數」的那一列
    const header = async (client) => {
      const ws = (await workbook(client, '/sales-performance/export?year=2026')).worksheets[0];
      let found = null;
      ws.eachRow(r => { const v = r.values.slice(1); if (!found && v.includes('專案數')) found = v; });
      return found;
    };
    expect(await header(editor)).toContain('總獎金');
    const h = await header(nb);
    expect(h.length).toBeGreaterThan(5); // 其他欄位還在
    for (const s of ['總獎金', '已發放', '待發放']) expect([s, h.includes(s)]).toEqual([s, false]);
    expect(h.length).toBe((await header(editor)).length - 3);
  });

  test('獎金報表匯出（Excel／PDF）：沒有旗標被擋；專案總表匯出不含「獎金明細」工作表', async () => {
    for (const url of ['/import-export/export/bonuses/2026', '/import-export/export/pdf/bonuses/2026']) {
      expect([url, (await download(editor, url)).status]).toEqual([url, 200]);
      expect([url, (await download(nb, url)).status]).toEqual([url, 403]);
    }
    const names = async (client) => (await workbook(client, '/import-export/export/projects/2026')).worksheets.map(w => w.name);
    expect(await names(editor)).toContain('獎金明細');
    expect(await names(nb)).not.toContain('獎金明細');
  });

  test('匯入匯出頁：沒有旗標沒有獎金報表區塊', async () => {
    expect((await editor.get('/import-export/')).text).toContain('獎金報表');
    expect((await nb.get('/import-export/')).text).not.toContain('獎金報表');
  });

  test('儀表板：有使用者管理權限但沒有檢視獎金的角色，看不到總獎金卡片', async () => {
    expect((await admin.get('/')).text).toContain('總獎金');
    const html = (await adminNb.get('/')).text;
    expect(html.length).toBeGreaterThan(1000); // 有成功載入
    expect(html).not.toContain('總獎金');
  });

  test('全系統搜尋：沒有旗標搜不到獎金記錄', async () => {
    const hits = (client, q) => client.get(`/search/?q=${encodeURIComponent(q)}`).then(r => r.text);
    expect(await hits(editor, '業績獎金')).toContain('獎金');
    const nbHtml = await hits(nb, '業績獎金');
    expect(nbHtml).not.toContain('bonus_calculations');
    expect(nbHtml).not.toMatch(/業績獎金<\/mark>|<mark>業績獎金/);
  });
});
