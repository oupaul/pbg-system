// 資料完整性：發票號碼唯一性、資料保留與自動清理。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids } = require('./helpers');

const dbPath = () => path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db');
// 測試直接讀寫測試資料庫（只有複製出來的測試資料庫，不是真實資料）
function withDb(fn, { readonly = true } = {}) {
  const db = new Database(dbPath(), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}
const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };
const activeCount = (number) => withDb(db => db.prepare(
  "SELECT COUNT(*) c FROM invoices WHERE invoice_number = ? COLLATE NOCASE AND deleted_at IS NULL AND COALESCE(status,'有效') <> '作廢'").get(number).c);
const invoiceIdByNumber = (number) => withDb(db => (db.prepare("SELECT id FROM invoices WHERE invoice_number = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1").get(number) || {}).id);

describeIntegration('發票號碼唯一性', () => {
  let admin;
  beforeAll(async () => { admin = await as('admin'); });
  const create = (projectId, number, extra = {}) => admin.post('/invoices/', {
    form: { project_id: String(projectId), invoice_number: number, invoice_date: '2026-10-05', amount_with_tax: '1000', ...extra }
  });

  test('第一次可以建立，同號碼再開一張會被擋下並說明原因', async () => {
    expect(decode((await create(ids.C.project, 'UQ00000001')).location)).not.toMatch(/error=/);
    expect(activeCount('UQ00000001')).toBe(1);
    const dup = await create(ids.C.project, 'UQ00000001');
    expect(decode(dup.location)).toMatch(/error=.*已被.*P-C.*另一張有效發票使用/);
    expect(activeCount('UQ00000001')).toBe(1);
  });

  test('忽略大小寫與前後空白，也不分專案', async () => {
    const lower = await create(ids.D.project, 'uq00000001');
    expect(decode(lower.location)).toMatch(/error=/);
    const spaced = await create(ids.D.project, '  UQ00000001  ');
    expect(decode(spaced.location)).toMatch(/error=/);
    expect(activeCount('UQ00000001')).toBe(1);
  });

  test('沒有發票號碼的發票可以有多張（號碼是選填）', async () => {
    await create(ids.C.project, '', { amount_with_tax: '100' });
    await create(ids.C.project, '', { amount_with_tax: '200' });
    const n = withDb(db => db.prepare("SELECT COUNT(*) c FROM invoices WHERE project_id = ? AND (invoice_number IS NULL OR invoice_number = '')").get(ids.C.project).c);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  test('作廢後號碼可以重新使用', async () => {
    await create(ids.C.project, 'UQ00000002');
    const id = invoiceIdByNumber('UQ00000002');
    expect((await admin.post(`/invoices/${id}/void`, { form: { void_reason: 'test' } })).status).toBeLessThan(400);
    expect(activeCount('UQ00000002')).toBe(0);
    expect(decode((await create(ids.D.project, 'UQ00000002')).location)).not.toMatch(/error=/);
    expect(activeCount('UQ00000002')).toBe(1);
  });

  test('作廢並重開可以沿用同一個號碼', async () => {
    await create(ids.C.project, 'UQ00000003');
    const id = invoiceIdByNumber('UQ00000003');
    const r = await admin.post(`/invoices/${id}/void-and-reissue`, { form: { invoice_number: 'UQ00000003', invoice_date: '2026-10-06', amount_with_tax: '1000' } });
    expect(decode(r.location)).toMatch(/success=/);
    expect(activeCount('UQ00000003')).toBe(1);
  });

  test('修改發票號碼成為另一張發票的號碼會被擋下；改成自己原本的號碼（含大小寫變化）可以', async () => {
    await create(ids.C.project, 'UQ00000004');
    await create(ids.C.project, 'UQ00000005');
    const id5 = invoiceIdByNumber('UQ00000005');
    const dup = await admin.post(`/invoices/${id5}`, { form: { invoice_number: 'uq00000004', invoice_date: '2026-10-05', amount_with_tax: '1000' } });
    expect(decode(dup.location)).toMatch(/error=.*已被/);
    expect(withDb(db => db.prepare('SELECT invoice_number n FROM invoices WHERE id = ?').get(id5).n)).toBe('UQ00000005');
    const same = await admin.post(`/invoices/${id5}`, { form: { invoice_number: 'uq00000005', invoice_date: '2026-10-05', amount_with_tax: '1000' } });
    expect(decode(same.location)).not.toMatch(/error=/);
  });

  test('已刪除的發票不佔用號碼；還原時如果號碼已被使用就不能還原', async () => {
    await create(ids.C.project, 'UQ00000006');
    const first = invoiceIdByNumber('UQ00000006');
    await admin.post(`/invoices/${first}/delete`, { form: {} });
    expect(activeCount('UQ00000006')).toBe(0);
    expect(decode((await create(ids.C.project, 'UQ00000006')).location)).not.toMatch(/error=/);
    const restore = await admin.post(`/invoices/${first}/restore`, { form: {} });
    expect(decode(restore.location)).toMatch(/error=.*已被/);
    expect(activeCount('UQ00000006')).toBe(1);
  });

  test('資料庫有同條件的唯一索引作為最後防線（繞過應用程式直接寫入也會失敗）', () => {
    expect(withDb(db => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_invoices_number_active'").get())).toBe(true);
    expect(() => withDb(db => db.prepare(
      "INSERT INTO invoices (project_id, invoice_number, invoice_date, amount_with_tax, status) VALUES (?, 'UQ00000001', '2026-10-05', 1, '有效')").run(ids.D.project), { readonly: false })
    ).toThrow(/UNIQUE/);
  });

  test('權限：範圍外的專案不能用來探測發票號碼（仍受專案範圍檢查）', async () => {
    const attacker = await as('u_ownedit');
    const r = await attacker.post('/invoices/', { form: { project_id: String(ids.B.project), invoice_number: 'UQ00000001', invoice_date: '2026-10-05', amount_with_tax: '1' } });
    expect(r.status).toBe(403);
  });
});

describeIntegration('資料保留與自動清理', () => {
  let admin;
  beforeAll(async () => {
    admin = await as('admin');
    withDb(db => {
      const old = '2020-01-01 00:00:00';
      const ins = db.prepare("INSERT INTO system_logs (action, table_name, record_id, user_info, created_at) VALUES ('update', 'old_test', ?, 'retention-test', ?)");
      for (let i = 1; i <= 3; i++) ins.run(i, old);
      ins.run(99, new Date().toISOString().slice(0, 19).replace('T', ' ')); // 最近的一筆
      const login = db.prepare("INSERT INTO login_history (user_id, ip_address, logged_in_at) VALUES (1, '203.0.113.9', ?)");
      login.run(old); login.run(old);
      const note = db.prepare("INSERT INTO notifications (user_id, type, title, is_read, created_at) VALUES (1, 'retention_test', ?, ?, ?)");
      note.run('舊的已讀 1', 1, old); note.run('舊的已讀 2', 1, old); note.run('舊的未讀', 0, old);
      note.run('新的已讀', 1, new Date().toISOString().slice(0, 19).replace('T', ' '));
    }, { readonly: false });
  });

  const count = (sql) => withDb(db => db.prepare(sql).get().c);
  const oldLogs = () => count("SELECT COUNT(*) c FROM system_logs WHERE table_name = 'old_test' AND created_at < '2021-01-01'");
  const oldLogins = () => count("SELECT COUNT(*) c FROM login_history WHERE ip_address = '203.0.113.9'");
  const retentionNotes = () => withDb(db => db.prepare("SELECT title FROM notifications WHERE type = 'retention_test' ORDER BY title").all().map(r => r.title));
  const setDays = (logs, logins, notes) => admin.post('/settings/bulk-update', {
    form: { retention_system_logs_days: String(logs), retention_login_history_days: String(logins), retention_read_notifications_days: String(notes) }
  });

  test('設定頁顯示資料保留卡片與各項目目前筆數', async () => {
    const page = (await admin.get('/settings/')).text;
    expect(page).toContain('資料保留與自動清理');
    expect(page).toContain('修改記錄');
    expect(page).toContain('登入紀錄');
    expect(page).toContain('已讀通知');
  });

  test('預設不清理：沒設定保留天數時，立即清理不會刪任何資料', async () => {
    const r = await admin.post('/settings/retention/run', { form: {} });
    expect(decode(r.location)).toMatch(/success=.*沒有超過保留天數/);
    expect(oldLogs()).toBe(3);
    expect(oldLogins()).toBe(2);
    expect(retentionNotes()).toHaveLength(4);
  });

  test('不合法的保留天數被拒絕（太短的天數可能誤刪近期資料）', async () => {
    for (const [logs, logins, notes] of [[10, 0, 0], [0, 5, 0], [0, 0, 3], [99999, 0, 0], [-1, 0, 0]]) {
      const r = await setDays(logs, logins, notes);
      expect([logs, logins, notes, /error=/.test(decode(r.location))]).toEqual([logs, logins, notes, true]);
    }
    expect(oldLogs()).toBe(3);
  });

  test('設定保留天數後立即清理：只刪超過天數的資料，未讀通知與最近的資料保留，並留下一筆清理記錄', async () => {
    expect(decode((await setDays(100, 100, 30)).location)).toMatch(/success=/);
    const r = await admin.post('/settings/retention/run', { form: {} });
    expect(decode(r.location)).toMatch(/success=.*已清理/);
    expect(oldLogs()).toBe(0);
    expect(oldLogins()).toBe(0);
    expect(retentionNotes()).toEqual(['新的已讀', '舊的未讀']);
    expect(count("SELECT COUNT(*) c FROM system_logs WHERE record_id = 99 AND table_name = 'old_test'")).toBe(1); // 最近的修改記錄還在
    expect(count("SELECT COUNT(*) c FROM system_logs WHERE action = 'retention_cleanup'")).toBeGreaterThanOrEqual(1);
  });

  test('改回 0 就是不清理', async () => {
    expect(decode((await setDays(0, 0, 0)).location)).toMatch(/success=/);
    const page = (await admin.get('/settings/')).text;
    expect(page).toMatch(/name="retention_system_logs_days" value="0"/);
  });

  test('沒有「系統設定」權限的人不能設定或執行清理', async () => {
    const c = await as('u_edit');
    expect((await c.post('/settings/retention/run', { form: {} })).status).toBe(403);
    expect((await c.post('/settings/bulk-update', { form: { retention_system_logs_days: '30' } })).status).toBe(403);
  });
});
