// 選項類管理頁（14 支）的「調整順序」：POST <base>/reorder
// 後端收到整份 id 清單後重新編號 1..n；清單不完整／重複／不合法一律拒絕且不寫入；
// 只有「系統設定」權限能用；管理頁面有拖曳排序所需的標記，且不再有手動輸入順序的欄位。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as } = require('./helpers');

function withDb(fn, { readonly = true } = {}) {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}

const PAGES = [
  { base: '/activity-types', table: 'activity_types', nameCol: 'type_name' },
  { base: '/bonus-types', table: 'bonus_types', nameCol: 'type_name' },
  { base: '/cost-categories', table: 'cost_categories', nameCol: 'category_name' },
  { base: '/cost-types', table: 'cost_types', nameCol: 'type_name' },
  { base: '/customer-levels', table: 'customer_levels', nameCol: 'level_name' },
  { base: '/customer-statuses', table: 'customer_statuses', nameCol: 'status_name' },
  { base: '/order-statuses', table: 'order_statuses', nameCol: 'status_name' },
  { base: '/payment-methods', table: 'payment_methods', nameCol: 'method_name' },
  { base: '/payment-terms', table: 'payment_terms', nameCol: 'term_name' },
  { base: '/pipeline-amount-options', table: 'pipeline_amount_options', nameCol: 'amount' },
  { base: '/pipeline-statuses', table: 'pipeline_statuses', nameCol: 'status_name' },
  { base: '/project-types', table: 'project_types', nameCol: 'type_name' },
  { base: '/report-groups', table: 'report_groups', nameCol: 'name' },
  { base: '/sales-modes', table: 'sales_modes', nameCol: 'mode_name' }
];

// 確保資料表至少有 n 筆。補的列一律是「停用」的（例如客戶狀態表有啟用中的列時，客戶匯入／新增會開始驗證狀態，
// 會影響同時在跑的其他測試檔），並記下 id，結束時刪除。報表群組沒有 is_active 欄位。
const inserted = []; // { table, id }
function ensureRows(P, n) {
  withDb(db => {
    const have = db.prepare(`SELECT COUNT(*) c FROM ${P.table}`).get().c;
    for (let i = have; i < n; i++) {
      const value = P.table === 'pipeline_amount_options' ? 1000 + i : `排序測試-${i}`;
      const r = P.table === 'report_groups'
        ? db.prepare(`INSERT INTO ${P.table} (${P.nameCol}, display_order) VALUES (?, 5)`).run(value)
        : db.prepare(`INSERT INTO ${P.table} (${P.nameCol}, display_order, is_active) VALUES (?, 5, 0)`).run(value);
      inserted.push({ table: P.table, id: Number(r.lastInsertRowid) });
    }
  }, { readonly: false });
}

const orderOf = (table) => withDb(db => db.prepare(`SELECT id, display_order FROM ${table} ORDER BY display_order ASC, id ASC`).all());
const idsOf = (table) => withDb(db => db.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map(r => r.id));

describeIntegration('選項類管理頁：調整順序', () => {
  let admin; let settings; let boss; let sales;
  beforeAll(async () => {
    admin = await as('admin');
    settings = await as('u_settings');
    boss = await as('u_boss');
    sales = await as('u_salesA');
  });
  afterAll(() => {
    withDb(db => {
      for (const { table, id } of inserted) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      db.prepare("DELETE FROM cost_categories WHERE category_name = '排序-新增測試'").run();
    }, { readonly: false });
  });

  // 其他測試檔會同時新增／刪除選項；清單剛好變動時（409）就重讀再送
  const reorderReversed = async (client, P) => {
    for (let i = 0; i < 5; i++) {
      const ids = idsOf(P.table).reverse();
      const res = await client.post(`${P.base}/reorder`, { json: { ids } });
      if (res.status !== 409) return { res, ids };
    }
    throw new Error('清單一直在變動');
  };

  for (const P of PAGES) {
    test(`${P.base}：依送來的順序重新編號 1..n（含重複的舊編號也會被理順），其餘欄位不變`, async () => {
      // 先確保至少有 3 筆，並刻意製造重複的舊編號
      ensureRows(P, 3);
      withDb(db => db.prepare(`UPDATE ${P.table} SET display_order = 5`).run(), { readonly: false });
      const namesBefore = withDb(db => db.prepare(`SELECT id, ${P.nameCol} AS n FROM ${P.table} ORDER BY id`).all());

      const { res, ids } = await reorderReversed(admin, P);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.text)).toEqual({ ok: true });

      const after = orderOf(P.table);
      expect(after.map(r => r.id)).toEqual(ids);
      expect(after.map(r => r.display_order)).toEqual(ids.map((_, i) => i + 1));
      // 名稱沒被動到
      expect(withDb(db => db.prepare(`SELECT id, ${P.nameCol} AS n FROM ${P.table} ORDER BY id`).all().filter(r => namesBefore.some(b => b.id === r.id)))).toEqual(namesBefore.filter(b => idsOf(P.table).includes(b.id)));
    });
  }

  test('不合法的清單被拒絕且不寫入：缺項、多出不存在的 id、重複、非數字、空陣列、非陣列', async () => {
    const P = PAGES.find(p => p.table === 'cost_types');
    const before = orderOf(P.table);
    const all = idsOf(P.table);
    const cases = [
      [409, all.slice(1)],                    // 少一筆
      [409, [...all, 999999]],                // 多一筆不存在的
      [400, [all[0], all[0], ...all.slice(1)]], // 重複
      [400, ['abc', ...all.slice(1)]],        // 非數字
      [400, [-1, ...all.slice(1)]],           // 負數
      [400, [1.5, ...all.slice(1)]],          // 小數
      [400, []],                              // 空
      [400, 'x'],                             // 非陣列
      [400, null]
    ];
    for (const [status, ids] of cases) {
      const res = await admin.post(`${P.base}/reorder`, { json: { ids } });
      expect([ids, res.status]).toEqual([ids, status]);
      expect(JSON.parse(res.text).ok).toBe(false);
    }
    const res = await admin.post(`${P.base}/reorder`, { json: {} });
    expect(res.status).toBe(400);
    expect(orderOf(P.table)).toEqual(before);
  });

  test('字串形式的數字 id 也接受（和 JSON 數字等價）', async () => {
    const P = PAGES.find(p => p.table === 'payment_terms');
    for (let i = 0; i < 5; i++) {
      const ids = idsOf(P.table).reverse();
      const res = await admin.post(`${P.base}/reorder`, { json: { ids: ids.map(String) } });
      if (res.status === 409) continue;
      expect(res.status).toBe(200);
      expect(orderOf(P.table).map(r => r.id)).toEqual(ids);
      return;
    }
    throw new Error('清單一直在變動');
  });

  test('有「系統設定」權限的角色可以調整；老闆、業務員被擋且順序不變', async () => {
    const P = PAGES.find(p => p.table === 'sales_modes');
    const { res } = await reorderReversed(settings, P);
    expect(res.status).toBe(200);

    for (const [who, client] of [['boss', boss], ['sales', sales]]) {
      const before = orderOf(P.table);
      const denied = await client.post(`${P.base}/reorder`, { json: { ids: idsOf(P.table).reverse() } });
      expect([who, denied.status]).toEqual([who, 403]);
      expect(orderOf(P.table)).toEqual(before);
    }
  });

  test('管理頁有拖曳排序的標記（表格網址、每列 data-id、排序欄），且沒有手動輸入順序的欄位', async () => {
    for (const P of PAGES) {
      ensureRows(P, 1);
      const html = (await admin.get(P.base + '/')).text;
      expect([P.base, html.includes(`data-reorder-url="${P.base}/reorder"`)]).toEqual([P.base, true]);
      expect([P.base, /<tr data-id="\d+">\s*<td class="reorder-cell"><\/td>/.test(html)]).toEqual([P.base, true]);
      expect([P.base, html.includes('/js/reorder-table.js')]).toEqual([P.base, true]);
      expect([P.base, /name="display_order"/.test(html)]).toEqual([P.base, false]);
    }
  });

  test('新增項目排在最後；編輯項目不會動到順序', async () => {
    const P = PAGES.find(p => p.table === 'cost_categories');
    const name = '排序-新增測試';
    await admin.post(`${P.base}/create`, { form: { category_name: name, badge_color: 'info' } });
    const max = withDb(db => db.prepare(`SELECT MAX(display_order) m FROM ${P.table}`).get().m);
    const row = withDb(db => db.prepare(`SELECT id, display_order FROM ${P.table} WHERE ${P.nameCol} = ?`).get(name));
    expect(row.display_order).toBe(max);

    // 編輯（表單已沒有順序欄位）：順序保持不變
    const before = row.display_order;
    await admin.post(`${P.base}/update/${row.id}`, { form: { category_name: name, badge_color: 'success', is_active: '1' } });
    expect(withDb(db => db.prepare(`SELECT display_order, badge_color FROM ${P.table} WHERE id = ?`).get(row.id))).toEqual({ display_order: before, badge_color: 'success' });
  });

  for (const P of PAGES) {
    test(`${P.base}：編輯項目（表單沒有順序欄位）不會把順序重設成 0`, async () => {
      ensureRows(P, 2);
      const rows = withDb(db => db.prepare(`SELECT * FROM ${P.table} ORDER BY id`).all());
      const target = rows[rows.length - 1];
      withDb(db => db.prepare(`UPDATE ${P.table} SET display_order = 7 WHERE id = ?`).run(target.id), { readonly: false });
      const form = { [P.nameCol]: String(target[P.nameCol]), badge_color: 'secondary', ...(target.is_active === 1 ? { is_active: '1' } : {}) };
      const res = await admin.post(`${P.base}/update/${target.id}`, { form });
      expect(res.status).toBe(302);
      expect(withDb(db => db.prepare(`SELECT display_order FROM ${P.table} WHERE id = ?`).get(target.id).display_order)).toBe(7);
    });
  }
});
