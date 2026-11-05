// 成本相關選項（成本類型、費用類別、付款辦法、付款條件、下單狀態）的「使用中」檢查只算有效的成本：
// 仍有有效成本使用時不能刪除／停用；成本被刪除（軟刪除）後就不再擋住，不然使用者看不到是哪幾筆在用。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

function withDb(fn, { readonly = true } = {}) {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}
const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };

const LOOKUPS = [
  { base: '/cost-types', table: 'cost_types', nameCol: 'type_name', field: 'cost_type' },
  { base: '/cost-categories', table: 'cost_categories', nameCol: 'category_name', field: 'cost_category' },
  { base: '/payment-methods', table: 'payment_methods', nameCol: 'method_name', field: 'payment_method' },
  { base: '/payment-terms', table: 'payment_terms', nameCol: 'term_name', field: 'payment_term' },
  { base: '/order-statuses', table: 'order_statuses', nameCol: 'status_name', field: 'order_status' }
];

describeIntegration('成本選項的使用中檢查：不算已刪除的成本', () => {
  let admin; let P;
  beforeAll(async () => {
    admin = await as('admin');
    P = withDb(db => Number(db.prepare(`
      INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
      VALUES ('LOOKUP-1', 2026, 10, 'A類', '選項使用中檢查', ?, ?, 100000, 95238)
    `).run(ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
  });

  for (const L of LOOKUPS) {
    test(`${L.base}：有效成本使用時擋下刪除與停用；成本刪除後可以刪除`, async () => {
      const name = `用途檢查-${L.field}`;
      const lookupId = withDb(db => Number(db.prepare(`INSERT INTO ${L.table} (${L.nameCol}, is_active) VALUES (?, 1)`).run(name).lastInsertRowid), { readonly: false });
      await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2026-10-10', item_name: `用 ${name}`, [L.field]: name, estimated_amount: '1', actual_amount: '1' } });
      const costId = withDb(db => db.prepare('SELECT id FROM costs WHERE item_name = ?').get(`用 ${name}`).id);
      const exists = () => !!withDb(db => db.prepare(`SELECT 1 x FROM ${L.table} WHERE id = ?`).get(lookupId));

      // 有效成本在用：擋下
      const blocked = await admin.post(`${L.base}/delete/${lookupId}`, { form: {} });
      expect(decode(blocked.location)).toContain('無法刪除：仍有 1 筆成本記錄');
      expect(exists()).toBe(true);

      // 成本被刪除（軟刪除）後：不再擋
      await admin.post(`/costs/${costId}/delete`, { form: {} });
      const ok = await admin.post(`${L.base}/delete/${lookupId}`, { form: {} });
      expect(decode(ok.location)).not.toContain('無法刪除');
      expect(exists()).toBe(false);
    });
  }

  test('停用也一樣：只有有效成本會擋', async () => {
    const L = LOOKUPS[0];
    const name = '用途檢查-停用';
    const lookupId = withDb(db => Number(db.prepare(`INSERT INTO ${L.table} (${L.nameCol}, is_active) VALUES (?, 1)`).run(name).lastInsertRowid), { readonly: false });
    await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2026-10-10', item_name: '用 停用', cost_type: name, estimated_amount: '1', actual_amount: '1' } });
    const costId = withDb(db => db.prepare("SELECT id FROM costs WHERE item_name = '用 停用'").get().id);
    const active = () => withDb(db => db.prepare(`SELECT is_active FROM ${L.table} WHERE id = ?`).get(lookupId).is_active);
    const body = { type_name: name, is_active: '0' };
    const blocked = await admin.post(`${L.base}/update/${lookupId}`, { form: body });
    expect(decode(blocked.location)).toContain('無法停用');
    expect(active()).toBe(1);
    await admin.post(`/costs/${costId}/delete`, { form: {} });
    const ok = await admin.post(`${L.base}/update/${lookupId}`, { form: body });
    expect(decode(ok.location)).not.toContain('無法停用');
    expect(active()).toBe(0);
  });
});
