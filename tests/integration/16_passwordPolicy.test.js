// 密碼規則：最短 6 個字元；複雜度由管理員在系統設定開關（預設關閉）。改密碼、管理員新增／編輯使用者都要遵守。
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration, as, login, ids, PASSWORD } = require('./helpers');

const withDb = (fn) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly: true });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
};
const complexitySetting = () => withDb(db => db.prepare("SELECT setting_value v FROM system_settings WHERE setting_key = 'password_complexity_enabled'").get());
const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };

const changePassword = async (client, current, next) =>
  client.post('/change-password', { form: { currentPassword: current, newPassword: next, confirmPassword: next } });
const setComplexity = async (admin, on) => {
  await admin.post('/settings/bulk-update', { form: { password_complexity_enabled: on ? 'true' : 'false' } });
  expect(complexitySetting().v).toBe(on ? 'true' : 'false');
};
// 用新密碼登入是否成功（成功會導向 / 或 /login/2fa 以外的站內頁，失敗導回 /login?error）
const canLogin = async (username, password) => {
  const c = await login(username, password);
  return !/^\/login/.test(c.loginLocation || '');
};

describeIntegration('密碼規則：預設只檢查長度（最短 6 個字元）', () => {
  test('migration 建立的設定預設是關閉', () => {
    expect(complexitySetting()).toBeTruthy();
    expect(complexitySetting().v).toBe('false');
  });

  test('改密碼：5 個字元被拒絕，6 個字元（沒有複雜度）可以', async () => {
    const c = await login('u_pw_1');
    const short = await changePassword(c, PASSWORD, 'abc12');
    expect(decode(short.location)).toContain('至少需要 6 個字元');
    expect(await canLogin('u_pw_1', PASSWORD)).toBe(true); // 密碼沒被改

    const ok = await changePassword(c, PASSWORD, 'abcdef');
    expect(decode(ok.location)).toContain('密碼修改成功');
    expect(await canLogin('u_pw_1', 'abcdef')).toBe(true);
    expect(await canLogin('u_pw_1', PASSWORD)).toBe(false);
  });

  test('超過 128 個字元被拒絕', async () => {
    const c = await login('u_pw_2');
    const r = await changePassword(c, PASSWORD, 'a'.repeat(129));
    expect(decode(r.location)).toContain('不可超過 128');
  });

  test('管理員新增使用者：5 個字元被拒絕，6 個字元可以', async () => {
    const admin = await as('admin');
    const bad = await admin.post('/users/', { form: { username: 'pw_new_a', password: 'abc12', name: 'pw new a', role: 'edit_only' } });
    expect(decode(bad.location)).toContain('至少需要 6 個字元');
    expect(withDb(db => db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'pw_new_a'").get().c)).toBe(0);
    const ok = await admin.post('/users/', { form: { username: 'pw_new_b', password: '123456', name: 'pw new b', role: 'edit_only' } });
    expect(ok.status).toBe(302);
    expect(withDb(db => db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'pw_new_b'").get().c)).toBe(1);
    expect(await canLogin('pw_new_b', '123456')).toBe(true);
  });

  test('改密碼頁與使用者表單顯示目前的規則說明', async () => {
    const c = await login('u_pw_3');
    expect((await c.get('/change-password')).text).toContain('至少 6 個字元');
    const admin = await as('admin');
    const form = (await admin.get('/users/new')).text;
    expect(form).toContain('至少 6 個字元');
    expect(form).toContain('minlength="6"');
    expect(form).not.toContain('minlength="10"');
  });
});

describeIntegration('密碼規則：管理員開啟複雜度要求', () => {
  test('開啟後：弱密碼被拒絕、強密碼可以；包含使用者名稱被拒絕；關閉後恢復', async () => {
    const admin = await as('admin');
    try {
      await setComplexity(admin, true);

      const c = await login('u_pw_3');
      const hint = (await c.get('/change-password')).text;
      expect(hint).toContain('至少 3 種');

      for (const weak of ['abcdef', 'Abcdef', 'abc123']) {
        const r = await changePassword(c, PASSWORD, weak);
        expect([weak, decode(r.location).includes('至少 3 種')]).toEqual([weak, true]);
      }
      const name = await changePassword(c, PASSWORD, 'Xu_pw_3-9a');
      expect(decode(name.location)).toContain('使用者名稱');
      expect(await canLogin('u_pw_3', PASSWORD)).toBe(true); // 都沒改成

      const strong = await changePassword(c, PASSWORD, 'Abc123');
      expect(decode(strong.location)).toContain('密碼修改成功');
      expect(await canLogin('u_pw_3', 'Abc123')).toBe(true);

      // 管理員新增：弱密碼被擋，強密碼可以
      const weakNew = await admin.post('/users/', { form: { username: 'pw_new_c', password: 'abcdef', name: 'pw new c', role: 'edit_only' } });
      expect(decode(weakNew.location)).toContain('至少 3 種');
      expect(withDb(db => db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'pw_new_c'").get().c)).toBe(0);
      const strongNew = await admin.post('/users/', { form: { username: 'pw_new_d', password: 'Abc123', name: 'pw new d', role: 'edit_only' } });
      expect(strongNew.status).toBe(302);
      expect(withDb(db => db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'pw_new_d'").get().c)).toBe(1);

      // 管理員編輯：弱密碼被擋且不會改到
      const id = ids.users.u_pw_4;
      const weakEdit = await admin.post(`/users/${id}`, { form: { name: 'u_pw_4', role: 'edit_only', password: 'abcdef', is_active: '1' } });
      expect(decode(weakEdit.location)).toContain('至少 3 種');
      expect(await canLogin('u_pw_4', PASSWORD)).toBe(true);
      const strongEdit = await admin.post(`/users/${id}`, { form: { name: 'u_pw_4', role: 'edit_only', password: 'Abc123', is_active: '1' } });
      expect(strongEdit.status).toBe(302);
      expect(decode(strongEdit.location)).not.toContain('error');
      expect(await canLogin('u_pw_4', 'Abc123')).toBe(true);
    } finally {
      await setComplexity(admin, false);
    }
    // 關閉後，簡單密碼又可以了
    const c2 = await login('u_pw_2');
    const r = await changePassword(c2, PASSWORD, 'abcdef');
    expect(decode(r.location)).toContain('密碼修改成功');
  });

  test('只有管理員能改這個設定（沒有「系統設定」權限的角色不行）', async () => {
    const before = complexitySetting().v;
    const r = await (await as('u_user')).post('/settings/bulk-update', { form: { password_complexity_enabled: 'true' } });
    expect([403, 302].includes(r.status)).toBe(true);
    expect(complexitySetting().v).toBe(before);
  });

  test('設定頁有「密碼規則」卡片，顯示目前的選項', async () => {
    const html = (await (await as('admin')).get('/settings')).text;
    expect(html).toContain('密碼規則');
    expect(html).toContain('name="password_complexity_enabled"');
    expect(html).toContain('最短長度：<strong>6 個字元</strong>');
  });
});
