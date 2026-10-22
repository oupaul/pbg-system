// 時間顯示：作廢時間（自動帶入時以 UTC 儲存）在修改記錄頁轉成伺服器本地時間顯示；日期輸入預設值是本地日期。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

const withDb = (fn, { readonly = true } = {}) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
};
const pad = (n) => String(n).padStart(2, '0');
// 測試程序與測試伺服器在同一台機器、同一個時區，所以可以用同樣的規則算出預期值
const toLocal = (utc) => {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

describeIntegration('時間顯示', () => {
  let admin; let projectId; let invoiceId;
  beforeAll(async () => {
    admin = await as('admin');
    projectId = withDb(db => Number(db.prepare(`
      INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
      VALUES ('TIME-1', 2026, 10, 'A類', '時間顯示專案', ?, ?, 1000000, 952381)
    `).run(ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
    await admin.post('/invoices/', { form: { project_id: String(projectId), invoice_number: 'TM00000001', invoice_date: '2026-10-01', amount_with_tax: '100' } });
    invoiceId = withDb(db => db.prepare("SELECT id FROM invoices WHERE invoice_number = 'TM00000001'").get().id);
  });

  test('作廢時沒填日期，系統存 UTC；修改記錄頁顯示的是轉成本地時間後的值', async () => {
    await admin.post(`/invoices/${invoiceId}/void`, { form: { void_reason: '測試' } });
    const stored = withDb(db => db.prepare('SELECT voided_at FROM invoices WHERE id = ?').get(invoiceId).voided_at);
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const html = (await admin.get(`/audit-logs?table_name=invoices&record_id=${invoiceId}`)).text;
    // 只看「作廢/折讓日期」這一欄的值（頁面其他地方可能剛好有同樣的時間字串，不能用整頁比對）
    const shown = [...html.matchAll(/作廢[^\n]{0,12}日期[^\n]{0,12}?(?:<[^>]*>)*[^\n]{0,12}?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g)].map(m => m[1]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toContain(toLocal(stored));
    if (toLocal(stored) !== stored) expect(shown).not.toContain(stored); // 時區不是 UTC 時，原始 UTC 字串不該出現在這一欄
  });

  test('使用者選的作廢日期（純日期）原樣顯示，不被位移', async () => {
    await admin.post('/invoices/', { form: { project_id: String(projectId), invoice_number: 'TM00000002', invoice_date: '2026-10-02', amount_with_tax: '100' } });
    const id2 = withDb(db => db.prepare("SELECT id FROM invoices WHERE invoice_number = 'TM00000002'").get().id);
    await admin.post(`/invoices/${id2}/void`, { form: { voided_at: '2026-09-15', void_reason: '日期' } });
    expect(withDb(db => db.prepare('SELECT voided_at FROM invoices WHERE id = ?').get(id2).voided_at)).toBe('2026-09-15');
    const html = (await admin.get(`/audit-logs?table_name=invoices&record_id=${id2}`)).text;
    expect(html).toContain('2026-09-15');
    expect(html).not.toContain('2026-09-14');
  });

  test('專案頁作廢／折讓對話框的日期預設值是本地日期', async () => {
    await admin.post('/invoices/', { form: { project_id: String(projectId), invoice_number: 'TM00000003', invoice_date: '2026-10-03', amount_with_tax: '100' } });
    const html = (await admin.get(`/projects/${projectId}`)).text;
    const defaults = [...html.matchAll(/name="voided_at" class="form-control" value="([^"]*)"/g)].map(m => m[1]);
    expect(defaults.length).toBeGreaterThanOrEqual(3);
    for (const v of defaults) expect(v).toBe(todayLocal());
  });
});
