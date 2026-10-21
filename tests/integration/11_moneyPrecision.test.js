// 金額精度：小數金額寫入時收斂到 2 位、分次收款加總不因浮點誤差被誤判成「未收齊」。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

const dbPath = () => path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db');
function withDb(fn, { readonly = true } = {}) {
  const db = new Database(dbPath(), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}

describeIntegration('金額精度', () => {
  let admin; let projectId; let invoiceId;
  const code = 'MONEY-1';

  beforeAll(async () => {
    admin = await as('admin');
    // 合約 1000.10 的專案：發票 1000.10，分兩次收 600.05 + 400.05（浮點相加會是 1000.0999999999999 或 1000.1000000000001）
    projectId = withDb(db => Number(db.prepare(`
      INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
      VALUES (?, 2026, 10, 'A類', '金額精度專案', ?, ?, 1000.1, 952.48)
    `).run(code, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
    await admin.post('/invoices/', { form: { project_id: String(projectId), invoice_number: 'MN00000001', invoice_date: '2026-10-01', amount_with_tax: '1,000.10' } });
    invoiceId = withDb(db => db.prepare("SELECT id FROM invoices WHERE invoice_number = 'MN00000001'").get().id);
  });

  test('寫入前把金額收斂到 2 位小數、去掉千分位逗號', async () => {
    await admin.post('/payments/', { form: { project_id: String(projectId), invoice_id: String(invoiceId), payment_date: '2026-10-10', bank_deposit_amount: '600.05' } });
    await admin.post('/payments/', { form: { project_id: String(projectId), invoice_id: String(invoiceId), payment_date: '2026-10-11', bank_deposit_amount: '400.045' } }); // 400.045 → 400.05
    const rows = withDb(db => db.prepare('SELECT bank_deposit_amount FROM payments WHERE invoice_id = ? ORDER BY id').all(invoiceId).map(r => r.bank_deposit_amount));
    expect(rows).toEqual([600.05, 400.05]);
    expect(withDb(db => db.prepare('SELECT amount_with_tax FROM invoices WHERE id = ?').get(invoiceId).amount_with_tax)).toBe(1000.1);
  });

  test('分次收款加總剛好等於發票金額時顯示已收齊，不是「未收 $0」', async () => {
    const page = (await admin.get(`/projects/${projectId}`)).text;
    expect(page).toContain('已收齊');
    const m = /未收[^\n]{0,80}/.exec(page.replace(/<script[\s\S]*?<\/script>/g, ''));
    expect(m && m[0]).toBeNull();
  });

  test('已收齊的專案不出現在「未收款」篩選，出現在「已完成」篩選', async () => {
    const unpaid = (await admin.get('/projects/?unpaid=true&year=2026')).text;
    expect(unpaid).not.toContain(code);
    const done = (await admin.get('/projects/?completed=true&year=2026')).text;
    expect(done).toContain(code);
  });

  test('帳齡分析不把已收齊的發票列為未收', async () => {
    const r = await admin.get('/receivables-aging/');
    if (r.status === 200) expect(r.text).not.toContain('MN00000001');
  });
});
