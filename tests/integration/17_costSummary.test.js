// 專案頁側欄的「預估成本」「總成本」（未稅）必須等於成本明細表「預估(未稅)」「實際(未稅)」兩欄的加總，
// 「含稅金額合計」等於「預估金額」「實際金額」兩欄的加總；稅別、新增、修改、刪除、小數、負數、其他專案都不能讓它們不一致。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

function withDb(fn, { readonly = true } = {}) {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}

const num = (s) => Number(String(s).replace(/,/g, ''));
const cents = (n) => Math.round(n * 100);
const N = '(-?[\\d,.]+)';
const MONEY = '[^0-9\\-<]*';

// 側欄金額：<span>標籤（可帶「（未稅）」小字）</span> 後面第一個 <span ...>$金額</span>
const sidebar = (html, label) => {
  const m = new RegExp(`<span>${label}(?:<small[^>]*>[^<]*</small>)?</span>\\s*<span[^>]*>${MONEY}${N}</span>`).exec(html);
  return m ? num(m[1]) : null;
};
// 側欄「含稅金額合計」：緊接在總成本／預估成本那一列後面
const sidebarWithTax = (html, label) => {
  const m = new RegExp(`<span>${label}(?:<small[^>]*>[^<]*</small>)?</span>\\s*<span[^>]*>${MONEY}${N}</span>\\s*</div>\\s*<div[^>]*>\\s*<span>[^<]*含稅金額合計</span>\\s*<span>${MONEY}${N}</span>`).exec(html);
  return m ? num(m[2]) : null;
};
// 成本明細表每一列：[預估, 實際, 稅別, 預估未稅, 實際未稅]
const costRows = (html) => {
  const pane = html.slice(html.indexOf('id="pane-costs"'), html.indexOf('id="pane-bonuses"'));
  const re = new RegExp(`<td class="text-end text-secondary">${MONEY}${N}</td>\\s*<td class="text-end text-danger">${MONEY}${N}</td>\\s*<td>(?:<span[^>]*>)?(含稅|免稅)(?:</span>)?</td>\\s*<td class="text-end text-secondary">${MONEY}${N}</td>\\s*<td class="text-end text-danger">${MONEY}${N}</td>`, 'g');
  return [...pane.matchAll(re)].map(m => [num(m[1]), num(m[2]), m[3], num(m[4]), num(m[5])]);
};
const sumCol = (rows, i) => rows.reduce((s, r) => s + cents(r[i]), 0) / 100;

describeIntegration('專案成本：含稅／未稅與加總', () => {
  let admin; let P; let other;
  const mkProject = (code) => withDb(db => Number(db.prepare(`
    INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
    VALUES (?, 2026, 10, 'A類', ?, ?, ?, 100000, 95238)
  `).run(code, `成本加總 ${code}`, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
  const addCost = (project, name, est, act, tax) => admin.post('/costs/', { form: { project_id: String(project), cost_date: '2026-10-10', item_name: name, estimated_amount: String(est), actual_amount: String(act), ...(tax === undefined ? {} : { tax_included: tax }) } });
  const costId = (name) => withDb(db => db.prepare('SELECT id FROM costs WHERE item_name = ?').get(name).id);
  const row = (name) => withDb(db => db.prepare('SELECT * FROM costs WHERE item_name = ?').get(name));
  // 預期值：{ est, act, estEx, actEx }（含稅合計與未稅合計）
  const check = async (project, e) => {
    const html = (await admin.get(`/projects/${project}`)).text;
    const rows = costRows(html);
    expect(sumCol(rows, 0)).toBe(e.est);
    expect(sumCol(rows, 1)).toBe(e.act);
    expect(sumCol(rows, 3)).toBe(e.estEx);
    expect(sumCol(rows, 4)).toBe(e.actEx);
    expect(sidebar(html, '總成本')).toBe(e.actEx);
    expect(sidebarWithTax(html, '總成本')).toBe(e.act);
    if (e.estEx !== 0) {
      expect(sidebar(html, '預估成本')).toBe(e.estEx);
      expect(sidebarWithTax(html, '預估成本')).toBe(e.est);
    }
    return html;
  };

  beforeAll(async () => {
    admin = await as('admin');
    P = mkProject('COSTSUM-1');
    other = mkProject('COSTSUM-2');
  });

  test('沒指定稅別＝含稅：依 5% 換算未稅，原輸入金額不變，並記下當時稅率', async () => {
    await addCost(P, 'CS-A', '1,050', '945');
    const r = row('CS-A');
    expect(r).toMatchObject({ tax_included: 1, tax_rate: 5, estimated_amount: 1050, actual_amount: 945, estimated_amount_ex_tax: 1000, actual_amount_ex_tax: 900 });
    await check(P, { est: 1050, act: 945, estEx: 1000, actEx: 900 });
  });

  test('免稅：金額不換算；含稅與免稅混合加總', async () => {
    await addCost(P, 'CS-B', '2500.5', '2600.25', '0');
    const r = row('CS-B');
    expect(r).toMatchObject({ tax_included: 0, estimated_amount_ex_tax: 2500.5, actual_amount_ex_tax: 2600.25 });
    await addCost(P, 'CS-C', '0.1', '0'); // 含稅小金額：0.1 / 1.05 = 0.095 → 0.1
    await addCost(P, 'CS-D', '0', '300'); // 只有實際金額（舊資料常見型態）
    await check(P, { est: 3550.6, act: 3845.25, estEx: 3500.6, actEx: 3785.96 });
  });

  test('其他專案的成本不會算進來', async () => {
    await addCost(other, 'CS-OTHER', '999', '888', '0');
    await check(P, { est: 3550.6, act: 3845.25, estEx: 3500.6, actEx: 3785.96 });
    await check(other, { est: 999, act: 888, estEx: 999, actEx: 888 });
  });

  test('修改金額後立即反映並重算未稅（舊值不殘留）', async () => {
    await admin.post(`/costs/${costId('CS-A')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-A', estimated_amount: '2100', actual_amount: '1050', tax_included: '1' } });
    expect(row('CS-A')).toMatchObject({ estimated_amount_ex_tax: 2000, actual_amount_ex_tax: 1000 });
    await check(P, { est: 4600.6, act: 3950.25, estEx: 4500.6, actEx: 3885.96 });
  });

  test('改稅別：含稅 → 免稅，未稅金額隨之重算（金額本身不變）', async () => {
    await admin.post(`/costs/${costId('CS-A')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-A', estimated_amount: '2100', actual_amount: '1050', tax_included: '0' } });
    expect(row('CS-A')).toMatchObject({ tax_included: 0, estimated_amount: 2100, estimated_amount_ex_tax: 2100, actual_amount_ex_tax: 1050 });
    await check(P, { est: 4600.6, act: 3950.25, estEx: 4600.6, actEx: 3935.96 });
    await admin.post(`/costs/${costId('CS-A')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-A', estimated_amount: '2100', actual_amount: '1050', tax_included: '1' } });
    expect(row('CS-A')).toMatchObject({ tax_included: 1, estimated_amount_ex_tax: 2000, actual_amount_ex_tax: 1000 });
  });

  test('編輯表單沒帶稅別欄位（舊頁面）時，稅別不變', async () => {
    await admin.post(`/costs/${costId('CS-B')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-B', estimated_amount: '2500.5', actual_amount: '2600.25', notes: '只改備註' } });
    expect(row('CS-B')).toMatchObject({ tax_included: 0, estimated_amount_ex_tax: 2500.5, notes: '只改備註' });
  });

  test('不合法的稅別被拒絕，什麼都不寫入', async () => {
    const before = withDb(db => db.prepare('SELECT COUNT(*) n FROM costs').get().n);
    const r = await addCost(P, 'CS-BAD', '100', '100', '亂填');
    expect(r.status).toBe(302);
    expect(withDb(db => db.prepare('SELECT COUNT(*) n FROM costs').get().n)).toBe(before);
  });

  test('刪除後立即反映', async () => {
    await admin.post(`/costs/${costId('CS-A')}/delete`, { form: {} });
    await check(P, { est: 2500.6, act: 2900.25, estEx: 2500.6, actEx: 2885.96 });
  });

  test('負數金額（沖銷、退貨）也照加總與換算', async () => {
    await addCost(P, 'CS-NEG', '-105', '-52.5'); // 含稅 → 未稅 -100 / -50
    expect(row('CS-NEG')).toMatchObject({ estimated_amount_ex_tax: -100, actual_amount_ex_tax: -50 });
    await check(P, { est: 2395.6, act: 2847.75, estEx: 2400.6, actEx: 2835.96 });
  });

  test('側欄與資料庫加總一致（不含已刪除）', async () => {
    const db = withDb(d => d.prepare('SELECT ROUND(SUM(estimated_amount_ex_tax), 2) e, ROUND(SUM(actual_amount_ex_tax), 2) a FROM costs WHERE project_id = ? AND deleted_at IS NULL').get(P));
    expect(db).toEqual({ e: 2400.6, a: 2835.96 });
  });
});
