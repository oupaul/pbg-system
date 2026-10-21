// 發票／收款批次刪除與還原：全有或全無、同一專案、專案範圍、權限、參數驗證、稽核紀錄。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids, isDenied } = require('./helpers');

const dbPath = () => path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db');
function withDb(fn, { readonly = true } = {}) {
  const db = new Database(dbPath(), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}
// 送出表單：陣列欄位以重複的 key 送出（ids=1&ids=2），和瀏覽器勾選多個 checkbox 一致
const post = (client, url, fields = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) body.append(k, String(x));
  return client.post(url, { raw: { body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } });
};
// 批次測試用自己的專案，不佔用共用專案的時間軸（時間軸測試每頁只看前 30 筆事件）
const makeProject = (code) => withDb(db => Number(db.prepare(`
  INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
  VALUES (?, 2026, 10, 'A類', '批次測試專案', ?, ?, 10000000, 9523810)
`).run(code, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };
const invId = (n) => withDb(db => db.prepare('SELECT id FROM invoices WHERE invoice_number = ? ORDER BY id DESC').get(n).id);
const deletedAt = (table, id) => withDb(db => db.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id).deleted_at);
const logCount = (table, action, recordId) => withDb(db => db.prepare('SELECT COUNT(*) n FROM system_logs WHERE table_name = ? AND action = ? AND record_id = ?').get(table, action, recordId).n);

describeIntegration('批次刪除／還原發票', () => {
  let admin; let P; const created = {};
  const mk = async (number, project = P) => {
    await admin.post('/invoices/', { form: { project_id: String(project), invoice_number: number, invoice_date: '2026-10-03', amount_with_tax: '100' } });
    created[number] = invId(number);
    return created[number];
  };
  beforeAll(async () => {
    admin = await as('admin');
    P = makeProject('BATCH-INV');
    for (const n of ['BT00000001', 'BT00000002', 'BT00000003']) await mk(n);
  });

  test('批次刪除：全部標記刪除並寫稽核，導回專案頁的發票分頁並顯示筆數', async () => {
    const a = created.BT00000001; const b = created.BT00000002;
    const r = await post(admin, '/invoices/batch-delete', { project_id: String(P), ids: [String(a), String(b)] });
    expect(r.status).toBe(302);
    expect(r.location).toContain(`/projects/${P}`);
    expect(r.location).toContain('#pane-invoices');
    expect(decode(r.location)).toContain('已刪除 2 張發票');
    expect(deletedAt('invoices', a)).toBeTruthy();
    expect(deletedAt('invoices', b)).toBeTruthy();
    expect(logCount('invoices', 'delete', a)).toBe(1);
  });

  test('重複批次刪除不會重複寫紀錄，已刪除的略過', async () => {
    const a = created.BT00000001;
    const r = await post(admin, '/invoices/batch-delete', { project_id: String(P), ids: [String(a)] });
    expect(decode(r.location)).toContain('已刪除 0 張發票');
    expect(decode(r.location)).toContain('不需處理');
    expect(logCount('invoices', 'delete', a)).toBe(1);
  });

  test('批次還原', async () => {
    const a = created.BT00000001; const b = created.BT00000002;
    const r = await post(admin, '/invoices/batch-restore', { project_id: String(P), ids: [String(a), String(b)] });
    expect(decode(r.location)).toContain('已還原 2 張發票');
    expect(r.location).toContain('show_deleted=1');
    expect(deletedAt('invoices', a)).toBeNull();
    expect(deletedAt('invoices', b)).toBeNull();
  });

  test('全有或全無：其中一張還原失敗（號碼已被占用）時，整批都不變', async () => {
    const ok = created.BT00000001;
    const clash = await mk('BT00000009');
    await post(admin, '/invoices/batch-delete', { project_id: String(P), ids: [String(ok), String(clash)] });
    expect(deletedAt('invoices', clash)).toBeTruthy();
    await admin.post('/invoices/', { form: { project_id: String(P), invoice_number: 'BT00000009', invoice_date: '2026-10-04', amount_with_tax: '50' } }); // 號碼被新發票占用
    const before = logCount('invoices', 'update', ok);
    const r = await post(admin, '/invoices/batch-restore', { project_id: String(P), ids: [String(ok), String(clash)] });
    expect(r.status).toBe(302);
    expect(decode(r.location)).toContain('全部未變更');
    expect(deletedAt('invoices', ok)).toBeTruthy();    // 本來可以還原的那張也沒動
    expect(deletedAt('invoices', clash)).toBeTruthy();
    expect(logCount('invoices', 'update', ok)).toBe(before); // 稽核紀錄一起復原
  });

  test('跨專案的 id 整批拒絕，什麼都不變', async () => {
    const mine = created.BT00000003;
    const other = ids.A.invoice; // 另一個專案的發票
    const r = await post(admin, '/invoices/batch-delete', { project_id: String(P), ids: [String(mine), String(other)] });
    expect(r.status).toBe(400);
    expect(deletedAt('invoices', mine)).toBeNull();
    expect(deletedAt('invoices', other)).toBeNull();
  });

  test('不合法的參數：沒勾選、非數字、不存在、超過上限', async () => {
    expect((await post(admin, '/invoices/batch-delete', {})).status).toBe(400);
    expect((await post(admin, '/invoices/batch-delete', { ids: 'abc' })).status).toBe(400);
    expect((await post(admin, '/invoices/batch-delete', { ids: "1' OR '1'='1" })).status).toBe(400);
    expect((await post(admin, '/invoices/batch-delete', { ids: '99999999' })).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => String(i + 1));
    expect((await post(admin, '/invoices/batch-delete', { ids: tooMany })).status).toBe(400);
    // 沒勾選但帶了 project_id：導回該專案並顯示錯誤
    const r = await post(admin, '/invoices/batch-delete', { project_id: String(P) });
    expect(r.status).toBe(302);
    expect(decode(r.location)).toContain('請先勾選');
  });
});

describeIntegration('批次刪除／還原發票：權限與專案範圍', () => {
  let admin;
  beforeAll(async () => { admin = await as('admin'); });

  test('唯讀角色（老闆、業務）與未登入都被擋下', async () => {
    for (const u of ['u_boss', 'u_salesA', 'u_none']) {
      const c = await as(u);
      for (const url of ['/invoices/batch-delete', '/invoices/batch-restore', '/payments/batch-delete', '/payments/batch-restore']) {
        const r = await c.post(url, { form: { ids: String(ids.A.invoice) } });
        expect([u, url, isDenied(r)]).toEqual([u, url, true]);
      }
    }
    expect(withDb(db => db.prepare('SELECT deleted_at FROM invoices WHERE id = ?').get(ids.A.invoice).deleted_at)).toBeNull();
  });

  test('可編輯但範圍為「自己」的角色：自己的專案可以，別人的專案 403 且不變更', async () => {
    const c = await as('u_ownedit'); // 綁業務 A
    // 專案 A 的發票額度已滿（種子資料），直接寫入一張給這個測試用
    const mine = withDb(db => Number(db.prepare("INSERT INTO invoices (project_id, invoice_number, invoice_date, amount_with_tax, status) VALUES (?, 'BS00000001', '2026-10-03', 10, '有效')").run(ids.A.project).lastInsertRowid), { readonly: false });
    const denied = await post(c, '/invoices/batch-delete', { project_id: String(ids.B.project), ids: String(ids.B.invoice) });
    expect(denied.status).toBe(403);
    expect(deletedAt('invoices', ids.B.invoice)).toBeNull();
    // 混合：自己的 + 別人的 → 整批拒絕
    const mixed = await post(c, '/invoices/batch-delete', { ids: [String(mine), String(ids.B.invoice)] });
    expect(mixed.status).toBe(400); // 跨專案
    expect(deletedAt('invoices', mine)).toBeNull();
    const ok = await post(c, '/invoices/batch-delete', { ids: String(mine) });
    expect(ok.status).toBe(302);
    expect(deletedAt('invoices', mine)).toBeTruthy();
  });
});

describeIntegration('批次刪除／還原收款', () => {
  let admin; let P; const pays = [];
  beforeAll(async () => {
    admin = await as('admin');
    P = makeProject('BATCH-PAY');
    for (const amt of ['11', '22', '33']) await admin.post('/payments/', { form: { project_id: String(P), payment_date: '2026-10-09', bank_deposit_amount: amt, notes: 'batch-pay' } });
    withDb(db => db.prepare("SELECT id FROM payments WHERE notes = 'batch-pay' ORDER BY id").all().forEach(r => pays.push(r.id)));
  });

  test('批次刪除與還原收款', async () => {
    const del = await post(admin, '/payments/batch-delete', { project_id: String(P), ids: pays.map(String) });
    expect(decode(del.location)).toContain('已刪除 3 筆收款');
    expect(del.location).toContain('#pane-payments');
    for (const id of pays) expect(deletedAt('payments', id)).toBeTruthy();
    const res = await post(admin, '/payments/batch-restore', { project_id: String(P), ids: pays.map(String) });
    expect(decode(res.location)).toContain('已還原 3 筆收款');
    for (const id of pays) expect(deletedAt('payments', id)).toBeNull();
  });

  test('範圍外的專案整批拒絕', async () => {
    const c = await as('u_ownedit');
    const r = await post(c, '/payments/batch-delete', { ids: String(ids.B.payment) });
    expect(r.status).toBe(403);
    expect(deletedAt('payments', ids.B.payment)).toBeNull();
  });
});

describeIntegration('專案頁的批次勾選介面', () => {
  test('可編輯的角色看得到勾選框與批次按鈕，唯讀角色看不到', async () => {
    const adminPage = (await (await as('admin')).get(`/projects/${ids.A.project}`)).text;
    expect(adminPage).toContain('form="invBatchForm"');
    expect(adminPage).toContain('form="payBatchForm"');
    expect(adminPage).toContain('/invoices/batch-delete');
    expect(adminPage).toContain('/payments/batch-restore');
    const salesPage = (await (await as('u_salesA')).get(`/projects/${ids.A.project}`)).text;
    expect(salesPage).not.toContain('form="invBatchForm"');
    expect(salesPage).not.toContain('id="invBatchForm"');
    expect(salesPage).not.toContain('/invoices/batch-delete');
  });
});
