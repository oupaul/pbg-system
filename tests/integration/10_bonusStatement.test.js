// 獎金對帳單：依專案範圍限制可產出的業務、參數驗證、回應標頭與稽核紀錄。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids, anonymous } = require('./helpers');

const q = (spId, extra = '') => `/bonuses/statement?salesperson_id=${spId}&year=2026&period=year${extra}`;
const dbRead = (fn) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly: true });
  try { return fn(db); } finally { db.close(); }
};
const auditCount = (spId) => dbRead(db => db.prepare("SELECT COUNT(*) AS n FROM system_logs WHERE action = 'generate_statement' AND table_name = 'bonus_statements' AND record_id = ?").get(spId).n);

describeIntegration('獎金對帳單：權限與範圍', () => {
  test('未登入導向登入頁', async () => {
    const r = await anonymous().get(q(ids.spA));
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/\/login/);
  });

  test('系統管理員與老闆（範圍全部）可產出任何業務', async () => {
    for (const u of ['admin', 'u_boss']) {
      const c = await as(u);
      for (const sp of [ids.spA, ids.spB]) {
        const r = await c.get(q(sp));
        expect([u, sp, r.status]).toEqual([u, sp, 200]);
      }
    }
  });

  test('業務只能產出自己的，產出別人的回 403 且不留下稽核紀錄', async () => {
    const a = await as('u_salesA');
    expect((await a.get(q(ids.spA))).status).toBe(200);
    const before = auditCount(ids.spB);
    const denied = await a.get(q(ids.spB));
    expect(denied.status).toBe(403);
    expect(denied.text).not.toMatch(/%PDF/);
    expect(auditCount(ids.spB)).toBe(before);
    const b = await as('u_salesB');
    expect((await b.get(q(ids.spB))).status).toBe(200);
    expect((await b.get(q(ids.spA))).status).toBe(403);
  });

  test('指派範圍只能產出被指派的業務；範圍為無者全部 403', async () => {
    const asg = await as('u_assigned');
    expect((await asg.get(q(ids.spA))).status).toBe(200);
    expect((await asg.get(q(ids.spB))).status).toBe(403);
    expect((await (await as('u_none')).get(q(ids.spA))).status).toBe(403);
  });
});

describeIntegration('獎金對帳單：參數與輸出', () => {
  test('不合法的參數回 400', async () => {
    const admin = await as('admin');
    const bad = [
      '/bonuses/statement',
      `/bonuses/statement?salesperson_id=abc&year=2026&period=year`,
      `/bonuses/statement?salesperson_id=${ids.spA}&year=26&period=year`,
      `/bonuses/statement?salesperson_id=${ids.spA}&year=2026&period=q5`,
      `/bonuses/statement?salesperson_id=${ids.spA}&year=2026&period=m13`,
      `/bonuses/statement?salesperson_id=${ids.spA}&year=2026&period=${encodeURIComponent("year' OR 1=1")}`,
      `/bonuses/statement?salesperson_id=${ids.spA}&year=1999&period=year`
    ];
    for (const url of bad) {
      const r = await admin.get(url);
      expect([url, r.status]).toEqual([url, 400]);
    }
  });

  test('不存在的業務回 400（不是 500）', async () => {
    const r = await (await as('admin')).get(q(999999));
    expect(r.status).toBe(400);
  });

  test('回應是 PDF，帶下載檔名、不快取，並寫入稽核紀錄', async () => {
    const admin = await as('admin');
    const before = auditCount(ids.spA);
    const res = await fetch(process.env.PBG_TEST_BASE_URL + q(ids.spA, '&x=1'), { headers: { Cookie: admin.cookie, 'X-Forwarded-For': admin.ip } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const disp = res.headers.get('content-disposition');
    expect(disp).toContain("filename*=UTF-8''" + encodeURIComponent('獎金對帳單_'));
    expect(disp).toContain('2026.pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(auditCount(ids.spA)).toBe(before + 1);

    const log = dbRead(db => db.prepare("SELECT new_value, user_info FROM system_logs WHERE action = 'generate_statement' AND table_name = 'bonus_statements' AND record_id = ? ORDER BY id DESC LIMIT 1").get(ids.spA));
    const detail = JSON.parse(log.new_value);
    expect(detail.statement_id).toMatch(/^BS-\d+-2026-\d{14}$/);
    expect(detail.counts.pending).toBeGreaterThanOrEqual(1); // 種子資料有一筆待發放
    expect(log.user_info).toBeTruthy();

    // 稽核頁能正常顯示這種紀錄
    const audit = await admin.get('/audit-logs?action=generate_statement');
    expect(audit.status).toBe(200);
    expect(audit.text).toContain('產出對帳單');
    expect(audit.text).toContain(detail.statement_id);
  });

  test('獎金頁面：業務只看到自己的選項，範圍全部者看到所有業務', async () => {
    const page = (await (await as('u_salesA')).get('/bonuses')).text;
    const selectA = /<select name="salesperson_id"[\s\S]*?<\/select>/.exec(page);
    expect(selectA).toBeTruthy();
    expect(selectA[0]).toContain(`value="${ids.spA}"`);
    expect(selectA[0]).not.toContain(`value="${ids.spB}"`);
    const adminPage = (await (await as('admin')).get('/bonuses')).text;
    const selectAll = /<select name="salesperson_id"[\s\S]*?<\/select>/.exec(adminPage)[0];
    expect(selectAll).toContain(`value="${ids.spA}"`);
    expect(selectAll).toContain(`value="${ids.spB}"`);
  });
});
