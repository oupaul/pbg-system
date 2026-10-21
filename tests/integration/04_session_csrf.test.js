// 登入、session、CSRF 與提權防護的行為測試。
const { describeIntegration, as, login, anonymous, ids, BASE, PASSWORD } = require('./helpers');

describeIntegration('CSRF 來源檢查', () => {
  test('跨站 Origin 的 POST 被拒絕；本站 Origin 可以通過', async () => {
    const admin = await as('admin');
    const evil = await admin.post('/settings/update', { form: { setting_key: 'x' }, origin: 'http://evil.example' });
    expect(evil.status).toBe(403);
    const nullOrigin = await admin.post('/settings/update', { form: { setting_key: 'x' }, origin: 'null' });
    expect(nullOrigin.status).toBe(403);
    const ok = await admin.post('/settings/update', { form: { setting_key: 'x' } });
    expect(ok.status).not.toBe(403);
  });

  test('沒有 Origin 但 Referer 是外站時同樣被拒絕', async () => {
    const admin = await as('admin');
    const r = await admin.post('/settings/update', { form: { setting_key: 'x' }, origin: null, headers: { Referer: 'http://evil.example/page' } });
    expect(r.status).toBe(403);
  });

  test('跨站請求不能執行高風險動作（刪除專案、建立使用者、備份還原）', async () => {
    const admin = await as('admin');
    for (const path of [`/projects/${ids.B.project}/delete`, '/users/', '/backup-restore/restore', '/roles/']) {
      const r = await admin.post(path, { form: {}, origin: 'http://evil.example' });
      expect([path, r.status]).toEqual([path, 403]);
    }
  });
});

describeIntegration('登入與 session', () => {
  test('帳號不存在與密碼錯誤的回應一致（不洩漏哪些帳號存在）', async () => {
    const unknown = await login('no_such_user_xyz', 'whatever-123');
    const wrong = await login('u_edit', 'wrong-password-123');
    expect(unknown.loginStatus).toBe(302);
    expect(wrong.loginStatus).toBe(302);
    expect(unknown.loginLocation).toBe(wrong.loginLocation);
    expect(unknown.loginLocation).toMatch(/error=/);
  });

  test('同一帳號連續登入失敗會被鎖定，鎖定期間連正確密碼也不接受', async () => {
    for (let i = 0; i < 5; i++) await login('u_lock', `wrong-${i}-password`);
    const afterLock = await login('u_lock', PASSWORD);
    expect(afterLock.loginLocation).toMatch(/error=/);
    const c = afterLock;
    const page = await c.get('/projects/');
    expect(page.status).toBe(302); // 沒登入成功
    expect(page.location).toMatch(/\/login/);
  });

  test('登出後原本的 session 立即失效', async () => {
    const c = await login('u_boss');
    expect((await c.get('/projects/')).status).toBe(200);
    await c.post('/logout');
    const after = await c.get('/projects/');
    expect(after.status).toBe(302);
    expect(after.location).toMatch(/\/login/);
  });

  test('帳號被停用後，已登入的 session 下一個請求就失效', async () => {
    const victim = await login('u_victim');
    expect((await victim.get('/import-export/')).status).toBe(200);
    const admin = await as('admin');
    const toggle = await admin.post(`/users/${ids.users.u_victim}/toggle-active`, { form: {} });
    expect(toggle.status).toBeLessThan(400);
    const after = await victim.get('/import-export/');
    expect(after.status).toBe(302);
    expect(after.location).toMatch(/\/login/);
    // 停用的帳號也不能重新登入
    const relogin = await login('u_victim');
    expect(relogin.loginLocation).toMatch(/error=/);
  });

  test('被要求更改密碼的帳號在改密碼前不能使用其他頁面', async () => {
    const c = await login('u_mustchange');
    expect(c.loginStatus).toBe(302);
    for (const path of ['/projects/', '/', '/import-export/', '/customers/']) {
      const r = await c.get(path);
      expect([path, r.status, r.location]).toEqual([path, 302, '/change-password']);
    }
    expect((await c.get('/change-password')).status).toBe(200);
  });
});

describeIntegration('角色管理的提權防護', () => {
  test('只有「角色管理」權限的人不能授予「使用者管理」旗標，但可以授予其他旗標', async () => {
    const rolesMgr = await as('u_roles');
    const created = await rolesMgr.post('/roles/', {
      json: { role_key: 'esc_role', role_name: 'esc_role', can_manage_users: 'on', can_manage_settings: 'on', project_view_scope: 'all', is_active: 'on' }
    });
    expect(created.status).toBe(200);
    const roleId = JSON.parse(created.text).roleId;
    expect(roleId).toBeGreaterThan(0);

    const admin = await as('admin');
    const form = (await admin.get(`/roles/${roleId}/edit`)).text;
    const checked = (name) => new RegExp(`name="${name}"\\s*checked`).test(form);
    expect(checked('can_manage_users')).toBe(false);   // 被擋下
    expect(checked('can_manage_settings')).toBe(true); // 其他旗標正常
  });

  test('管理員可以授予「使用者管理」旗標', async () => {
    const admin = await as('admin');
    const created = await admin.post('/roles/', { json: { role_key: 'adm_role', role_name: 'adm_role', can_manage_users: 'on', project_view_scope: 'all', is_active: 'on' } });
    const roleId = JSON.parse(created.text).roleId;
    const form = (await admin.get(`/roles/${roleId}/edit`)).text;
    expect(/name="can_manage_users"\s*checked/.test(form)).toBe(true);
  });

  test('沒有「使用者管理」權限的人也不能用編輯角色的方式移除既有角色的該旗標', async () => {
    const admin = await as('admin');
    const created = await admin.post('/roles/', { json: { role_key: 'keep_role', role_name: 'keep_role', can_manage_users: 'on', project_view_scope: 'all', is_active: 'on' } });
    const roleId = JSON.parse(created.text).roleId;
    const rolesMgr = await as('u_roles');
    await rolesMgr.request('PUT', `/roles/${roleId}`, { json: { role_name: 'keep_role', project_view_scope: 'all', is_active: 'on' } });
    const form = (await admin.get(`/roles/${roleId}/edit`)).text;
    expect(/name="can_manage_users"\s*checked/.test(form)).toBe(true); // 維持原值
  });
});
