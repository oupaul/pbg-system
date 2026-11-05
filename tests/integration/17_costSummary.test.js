// 專案頁側欄的「預估成本」「總成本」必須等於成本明細表「預估金額」「實際金額」兩欄的加總；
// 新增、修改、刪除成本、小數與負數、其他專案的成本，都不能讓兩者不一致。
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

// 側欄金額：<span>標籤</span> 後面第一個 <span ...>$金額</span>
const sidebar = (html, label) => {
  const m = new RegExp(`<span>${label}</span>\\s*<span[^>]*>[^0-9\\-<]*(-?[\\d,.]+)</span>`).exec(html);
  return m ? num(m[1]) : null;
};
// 成本明細表每一列的 [預估, 實際]
const costRows = (html) => {
  const pane = html.slice(html.indexOf('id="pane-costs"'), html.indexOf('id="pane-bonuses"'));
  return [...pane.matchAll(/<td class="text-end text-secondary">[^0-9\-<]*(-?[\d,.]+)<\/td>\s*<td class="text-end text-danger">[^0-9\-<]*(-?[\d,.]+)<\/td>/g)]
    .map(m => [num(m[1]), num(m[2])]);
};
const sumCol = (rows, i) => rows.reduce((s, r) => s + cents(r[i]), 0) / 100;

describeIntegration('專案成本：預估成本與總成本加總', () => {
  let admin; let P; let other;
  const mkProject = (code) => withDb(db => Number(db.prepare(`
    INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
    VALUES (?, 2026, 10, 'A類', ?, ?, ?, 100000, 95238)
  `).run(code, `成本加總 ${code}`, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
  const addCost = (project, name, est, act) => admin.post('/costs/', { form: { project_id: String(project), cost_date: '2026-10-10', item_name: name, estimated_amount: String(est), actual_amount: String(act) } });
  const costId = (name) => withDb(db => db.prepare('SELECT id FROM costs WHERE item_name = ?').get(name).id);
  const check = async (project, expectedEst, expectedAct) => {
    const html = (await admin.get(`/projects/${project}`)).text;
    const rows = costRows(html);
    // 明細表自己的加總
    expect(sumCol(rows, 0)).toBe(expectedEst);
    expect(sumCol(rows, 1)).toBe(expectedAct);
    // 側欄與明細表一致
    expect(sidebar(html, '總成本')).toBe(expectedAct);
    if (expectedEst !== 0) expect(sidebar(html, '預估成本')).toBe(expectedEst);
    return html;
  };

  beforeAll(async () => {
    admin = await as('admin');
    P = mkProject('COSTSUM-1');
    other = mkProject('COSTSUM-2');
  });

  test('新增多筆（含小數、預估為 0、實際為 0）：側欄等於明細加總', async () => {
    await addCost(P, 'CS-A', '1,000', '900');
    await addCost(P, 'CS-B', '2500.5', '2600.25');
    await addCost(P, 'CS-C', '0.1', '0');
    await addCost(P, 'CS-D', '0.2', '0');
    await addCost(P, 'CS-E', '0', '300'); // 舊資料常見型態：只有實際金額
    await check(P, 3500.8, 3800.25);
  });

  test('其他專案的成本不會算進來', async () => {
    await addCost(other, 'CS-OTHER', '99999', '88888');
    await check(P, 3500.8, 3800.25);
    await check(other, 99999, 88888);
  });

  test('修改金額後立即反映（舊值不殘留）', async () => {
    await admin.post(`/costs/${costId('CS-A')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-A', estimated_amount: '1200', actual_amount: '950' } });
    await check(P, 3700.8, 3850.25);
  });

  test('預估改為 0、實際保留：只影響預估，不影響總成本', async () => {
    await admin.post(`/costs/${costId('CS-B')}`, { form: { cost_date: '2026-10-10', item_name: 'CS-B', estimated_amount: '0', actual_amount: '2600.25' } });
    await check(P, 1200.3, 3850.25);
  });

  test('刪除後立即反映', async () => {
    await admin.post(`/costs/${costId('CS-A')}/delete`, { form: {} });
    await check(P, 0.3, 2900.25);
  });

  test('負數金額（沖銷、退貨）也照加總', async () => {
    await addCost(P, 'CS-NEG', '-50', '-25.5');
    await check(P, -49.7, 2874.75);
  });

  test('側欄與成本明細表「預估金額」欄的加總一致，也等於資料庫加總', async () => {
    const db = withDb(d => d.prepare('SELECT ROUND(SUM(estimated_amount), 2) e, ROUND(SUM(actual_amount), 2) a FROM costs WHERE project_id = ?').get(P));
    expect(db).toEqual({ e: -49.7, a: 2874.75 });
  });
});
