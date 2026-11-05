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

describeIntegration('成本：批次刪除／還原（軟刪除）與批次編輯', () => {
  let admin; let P; let Q; const c = {};
  const deleted = (id) => withDb(db => db.prepare('SELECT deleted_at FROM costs WHERE id = ?').get(id).deleted_at);
  const row = (id) => withDb(db => db.prepare('SELECT * FROM costs WHERE id = ?').get(id));
  const costId = (name) => withDb(db => db.prepare('SELECT id FROM costs WHERE item_name = ?').get(name).id);
  const side = (html, label) => { const m = new RegExp(`<span>${label}(?:<small[^>]*>[^<]*</small>)?</span>\\s*<span[^>]*>[^0-9<]*([\\d,]+)</span>`).exec(html); return m && Number(m[1].replace(/,/g, '')); };
  beforeAll(async () => {
    admin = await as('admin');
    P = makeProject('BATCH-COST');
    Q = makeProject('BATCH-COST-2');
    for (const [n, est, act] of [['BC-1', '100', '90'], ['BC-2', '200', '190'], ['BC-3', '300', '290'], ['BC-4', '400', '390']]) {
      // 用免稅（金額不換算），這組測試的重點是刪除／還原／批次編輯，金額加總好對
      await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2026-10-03', item_name: n, estimated_amount: est, actual_amount: act, tax_included: '0' } });
      c[n] = costId(n);
    }
    await admin.post('/costs/', { form: { project_id: String(Q), cost_date: '2026-10-03', item_name: 'BC-OTHER', estimated_amount: '999', actual_amount: '888', tax_included: '0' } });
    c['BC-OTHER'] = costId('BC-OTHER');
  });

  test('批次刪除是軟刪除：標記 deleted_at、寫稽核、其他成本與其他專案不動', async () => {
    const r = await post(admin, '/costs/batch-delete', { project_id: String(P), ids: [String(c['BC-1']), String(c['BC-2'])] });
    expect(r.status).toBe(302);
    expect(r.location).toContain(`/projects/${P}`);
    expect(r.location).toContain('#pane-costs');
    expect(decode(r.location)).toContain('已刪除 2 筆成本');
    expect(deleted(c['BC-1'])).toBeTruthy();
    expect(deleted(c['BC-2'])).toBeTruthy();
    expect(deleted(c['BC-3'])).toBeNull();
    expect(deleted(c['BC-OTHER'])).toBeNull();
    expect(row(c['BC-1']).estimated_amount).toBe(100); // 資料還在
    expect(logCount('costs', 'delete', c['BC-1'])).toBe(1);
  });

  test('刪除後預估成本與總成本只算沒刪的；顯示已刪除時列出但不計入', async () => {
    const html = (await admin.get(`/projects/${P}`)).text;
    expect(html).toContain('BC-3');
    expect(html).not.toContain('>BC-1<');
    expect(side(html, '預估成本')).toBe(700); // BC-3 + BC-4
    expect(side(html, '總成本')).toBe(680);
    const withDeleted = (await admin.get(`/projects/${P}?show_deleted=1`)).text;
    expect(withDeleted).toContain('BC-1');
    expect(withDeleted).toContain('已刪除');
    expect(withDeleted).toContain(`/costs/${c['BC-1']}/restore`);
    expect(side(withDeleted, '預估成本')).toBe(700); // 已刪除的不計入
  });

  test('重複刪除不重複寫紀錄；已刪除的成本不能編輯', async () => {
    const again = await post(admin, '/costs/batch-delete', { project_id: String(P), ids: [String(c['BC-1'])] });
    expect(decode(again.location)).toContain('已刪除 0 筆成本');
    expect(logCount('costs', 'delete', c['BC-1'])).toBe(1);
    const edit = await admin.post(`/costs/${c['BC-1']}`, { form: { cost_date: '2026-10-03', item_name: 'BC-1', estimated_amount: '1', actual_amount: '1' } });
    expect(decode(edit.location || '')).toContain('已刪除');
    expect(row(c['BC-1']).estimated_amount).toBe(100);
  });

  test('批次還原與單筆還原：金額重新計入', async () => {
    const r = await post(admin, '/costs/batch-restore', { project_id: String(P), ids: [String(c['BC-1'])] });
    expect(decode(r.location)).toContain('已還原 1 筆成本');
    expect(r.location).toContain('show_deleted=1');
    expect(deleted(c['BC-1'])).toBeNull();
    const single = await admin.post(`/costs/${c['BC-2']}/restore`, { form: {} });
    expect(single.status).toBe(302);
    expect(deleted(c['BC-2'])).toBeNull();
    const html = (await admin.get(`/projects/${P}`)).text;
    expect(side(html, '預估成本')).toBe(1000);
    expect(side(html, '總成本')).toBe(960);
  });

  test('單筆刪除也是軟刪除，可還原', async () => {
    await admin.post(`/costs/${c['BC-2']}/delete`, { form: {} });
    expect(deleted(c['BC-2'])).toBeTruthy();
    await admin.post(`/costs/${c['BC-2']}/restore`, { form: {} });
    expect(deleted(c['BC-2'])).toBeNull();
  });

  test('夾帶其他專案或不存在的 id 整批拒絕、什麼都不變', async () => {
    const mixed = await post(admin, '/costs/batch-delete', { project_id: String(P), ids: [String(c['BC-4']), String(c['BC-OTHER'])] });
    expect(mixed.status).toBe(400);
    expect(deleted(c['BC-4'])).toBeNull();
    expect(deleted(c['BC-OTHER'])).toBeNull();
    const missing = await post(admin, '/costs/batch-delete', { project_id: String(P), ids: [String(c['BC-4']), '99999999'] });
    expect(missing.status).toBe(400);
    expect(deleted(c['BC-4'])).toBeNull();
    for (const url of ['/costs/batch-delete', '/costs/batch-restore', '/costs/batch-update']) {
      expect((await post(admin, url, {})).status).toBe(400);
      expect((await post(admin, url, { ids: 'abc', order_status: 'x' })).status).toBe(400);
      expect((await post(admin, url, { ids: "1' OR '1'='1", order_status: 'x' })).status).toBe(400);
      const tooMany = Array.from({ length: 201 }, (_, i) => String(i + 1));
      expect((await post(admin, url, { ids: tooMany, order_status: 'x' })).status).toBe(400);
    }
  });

  describe('批次編輯', () => {
    let statusName; let methodName;
    beforeAll(() => {
      // 用資料庫裡現有的啟用選項；沒有就自己建兩個
      withDb(db => {
        const ensure = (table, col, name) => { if (!db.prepare(`SELECT 1 x FROM ${table} WHERE ${col} = ? AND is_active = 1`).get(name)) db.prepare(`INSERT INTO ${table} (${col}, is_active) VALUES (?, 1)`).run(name); };
        ensure('order_statuses', 'status_name', '批次測試已下單');
        ensure('payment_methods', 'method_name', '批次測試匯款');
      }, { readonly: false });
      statusName = '批次測試已下單'; methodName = '批次測試匯款';
    });

    test('只更新有填的欄位，其他欄位（含金額）不變，每筆寫稽核', async () => {
      const before = row(c['BC-3']);
      const r = await post(admin, '/costs/batch-update', { project_id: String(P), ids: [String(c['BC-3']), String(c['BC-4'])], order_status: statusName, payment_method: methodName });
      expect(r.status).toBe(302);
      expect(r.location).toContain('#pane-costs');
      expect(decode(r.location)).toContain('已編輯 2 筆成本');
      for (const n of ['BC-3', 'BC-4']) {
        const after = row(c[n]);
        expect(after.order_status).toBe(statusName);
        expect(after.payment_method).toBe(methodName);
      }
      const after = row(c['BC-3']);
      expect(after.estimated_amount).toBe(before.estimated_amount);
      expect(after.actual_amount).toBe(before.actual_amount);
      expect(after.item_name).toBe(before.item_name);
      expect(after.cost_date).toBe(before.cost_date);
      expect(logCount('costs', 'update', c['BC-3'])).toBeGreaterThan(0);
    });

    test('批次改稅別：免稅 → 含稅，未稅金額依 5% 重算，金額本身不變；不合法的稅別拒絕', async () => {
      const r = await post(admin, '/costs/batch-update', { project_id: String(P), ids: [String(c['BC-3']), String(c['BC-4'])], tax_included: '1' });
      expect(decode(r.location)).toContain('已編輯 2 筆成本');
      expect(row(c['BC-3'])).toMatchObject({ tax_included: 1, tax_rate: 5, estimated_amount: 300, actual_amount: 290, estimated_amount_ex_tax: 285.71, actual_amount_ex_tax: 276.19 });
      expect(row(c['BC-4'])).toMatchObject({ tax_included: 1, estimated_amount_ex_tax: 380.95, actual_amount_ex_tax: 371.43 });
      const bad = await post(admin, '/costs/batch-update', { project_id: String(P), ids: String(c['BC-3']), tax_included: '2' });
      expect(decode(bad.location)).toContain('稅別');
      expect(row(c['BC-3']).tax_included).toBe(1);
      // 還原成免稅，避免影響後面的測試
      await post(admin, '/costs/batch-update', { project_id: String(P), ids: [String(c['BC-3']), String(c['BC-4'])], tax_included: '0' });
      expect(row(c['BC-3'])).toMatchObject({ tax_included: 0, estimated_amount_ex_tax: 300, actual_amount_ex_tax: 290 });
    });

    test('沒有填任何要變更的欄位 → 導回並提示，不變更', async () => {
      const r = await post(admin, '/costs/batch-update', { project_id: String(P), ids: String(c['BC-3']) });
      expect(r.status).toBe(302);
      expect(decode(r.location)).toContain('請至少填寫一個');
    });

    test('不存在或停用的選項、錯誤的日期／廠商：整批拒絕，全部不變', async () => {
      const before = row(c['BC-3']).order_status;
      const bad1 = await post(admin, '/costs/batch-update', { project_id: String(P), ids: String(c['BC-3']), order_status: '不存在的狀態' });
      expect(decode(bad1.location)).toContain('不存在或已停用');
      const bad2 = await post(admin, '/costs/batch-update', { project_id: String(P), ids: String(c['BC-3']), cost_date: '2026/13/45' });
      expect(decode(bad2.location)).toContain('日期格式');
      const bad3 = await post(admin, '/costs/batch-update', { project_id: String(P), ids: String(c['BC-3']), vendor_id: '99999999' });
      expect(decode(bad3.location)).toContain('找不到指定的廠商');
      expect(row(c['BC-3']).order_status).toBe(before);
    });

    test('整批在同一交易：第二筆失敗時第一筆也復原（已刪除的成本略過不算失敗）', async () => {
      const x = await (async () => { await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2026-10-04', item_name: 'BC-DEL', estimated_amount: '1', actual_amount: '1', tax_included: '0' } }); return costId('BC-DEL'); })();
      await post(admin, '/costs/batch-delete', { project_id: String(P), ids: String(x) });
      const r = await post(admin, '/costs/batch-update', { project_id: String(P), ids: [String(c['BC-3']), String(x)], cost_date: '2026-11-11' });
      expect(decode(r.location)).toContain('已編輯 1 筆成本');
      expect(row(c['BC-3']).cost_date).toBe('2026-11-11');
      expect(row(x).cost_date).toBe('2026-10-04'); // 已刪除的沒被改
    });
  });

  test('唯讀角色與無權限者被擋下；範圍為「自己」的角色動不到別人專案的成本', async () => {
    for (const u of ['u_boss', 'u_salesA', 'u_none']) {
      const cl = await as(u);
      for (const url of ['/costs/batch-delete', '/costs/batch-restore', '/costs/batch-update']) {
        const r = await cl.post(url, { form: { ids: String(c['BC-4']), order_status: 'x' } });
        expect([u, url, isDenied(r)]).toEqual([u, url, true]);
      }
      const single = await cl.post(`/costs/${c['BC-4']}/restore`, { form: {} });
      expect([u, isDenied(single)]).toEqual([u, true]);
    }
    expect(deleted(c['BC-4'])).toBeNull();
    const own = await as('u_ownedit'); // 綁業務 A；種子的 B 專案成本在範圍外
    const other = ids.B.cost;
    for (const url of ['/costs/batch-delete', '/costs/batch-update']) {
      const denied = await post(own, url, { project_id: String(ids.B.project), ids: String(other), order_status: 'x' });
      expect([url, denied.status]).toEqual([url, 403]);
    }
    expect(deleted(other)).toBeNull();
  });
});

describeIntegration('專案頁的批次勾選介面', () => {
  test('可編輯的角色看得到勾選框與批次按鈕，唯讀角色看不到', async () => {
    const adminPage = (await (await as('admin')).get(`/projects/${ids.A.project}`)).text;
    expect(adminPage).toContain('form="invBatchForm"');
    expect(adminPage).toContain('form="payBatchForm"');
    expect(adminPage).toContain('/invoices/batch-delete');
    expect(adminPage).toContain('/payments/batch-restore');
    expect(adminPage).toContain('form="costBatchForm"');
    expect(adminPage).toContain('/costs/batch-delete');
    expect(adminPage).toContain('/costs/batch-update');
    expect(adminPage).toContain('id="costBatchEditModal"');
    expect(adminPage).not.toContain('進項編號');
    // 頁面內嵌的 script（含勾選／批次按鈕的邏輯）語法必須正確：改壞了整頁互動都會失效
    const scripts = [...adminPage.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new Function(code)).not.toThrow();
    const salesPage = (await (await as('u_salesA')).get(`/projects/${ids.A.project}`)).text;
    expect(salesPage).not.toContain('form="invBatchForm"');
    expect(salesPage).not.toContain('id="invBatchForm"');
    expect(salesPage).not.toContain('/invoices/batch-delete');
    expect(salesPage).not.toContain('costBatchForm');
    expect(salesPage).not.toContain('/costs/batch-delete');
    expect(salesPage).not.toContain('costBatchEditModal');
  });
});
