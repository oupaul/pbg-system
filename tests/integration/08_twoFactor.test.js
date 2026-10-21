// 雙因素驗證（TOTP）：登入第二步、防重放、鎖定、復原碼、強制啟用、停用、管理員重設。
// 種子使用者（見 setup/seed.js）都使用同一把 RFC 測試密鑰，驗證碼由 src/utils/totp 在測試中算出。
const path = require('path');
const Database = require('better-sqlite3');
const totp = require('../../src/utils/totp');
const { describeIntegration, as, login, ids, PASSWORD } = require('./helpers');

const SECRET = ids.twoFactor && ids.twoFactor.secret;
const RECOVERY = ids.twoFactor && ids.twoFactor.recoveryCodes;
// 目前時間步 + offset 的驗證碼（伺服器容許前後各一步，所以 offset 0/±1 都有效）
const codeAt = (offset = 0) => totp.hotp(SECRET, totp.timeStep() + offset);
const wrongCode = (offset = 0) => String((parseInt(codeAt(offset), 10) + 1) % 1000000).padStart(6, '0');
const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };
const dbRow = (sql, ...params) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly: true });
  try { return db.prepare(sql).get(...params); } finally { db.close(); }
};
const isLoggedIn = async (c) => (await c.get('/projects/')).status === 200;
// 通過密碼、停在第二步的 client
const atSecondStep = async (username) => {
  const c = await login(username);
  expect(c.loginStatus).toBe(302);
  expect(c.loginLocation).toBe('/login/2fa');
  return c;
};
const fullLogin = async (username, code = codeAt()) => {
  const c = await atSecondStep(username);
  const r = await c.post('/login/2fa', { form: { code } });
  // 驗證成功後會換發新的 session cookie
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (setCookie.length) c.cookie = setCookie.map(x => x.split(';')[0]).join('; ');
  return { client: c, response: r };
};

describeIntegration('雙因素驗證：登入第二步', () => {
  test('已啟用的使用者密碼正確後停在第二步，這時還沒有任何登入權限', async () => {
    const c = await atSecondStep('u_2fa_login');
    const page = await c.get('/projects/');
    expect(page.status).toBe(302);
    expect(page.location).toMatch(/\/login/);
    expect((await c.get('/login/2fa')).status).toBe(200);
    expect((await c.get('/')).status).toBe(302);
  });

  test('沒有經過密碼那一步，直接開第二步頁面或送驗證碼都會被導回登入', async () => {
    const anon = await login('no_such_user_for_2fa', 'x');
    expect(decode((await anon.get('/login/2fa')).location)).toMatch(/\/login\?error=/);
    const post = await anon.post('/login/2fa', { form: { code: codeAt() } });
    expect(decode(post.location)).toMatch(/\/login\?error=/);
  });

  test('驗證碼錯誤不能登入；正確才能登入並進到系統', async () => {
    const c = await atSecondStep('u_2fa_login');
    const bad = await c.post('/login/2fa', { form: { code: wrongCode() } });
    expect(bad.location).toMatch(/^\/login\/2fa\?error=/);
    expect(await isLoggedIn(c)).toBe(false);

    const ok = await c.post('/login/2fa', { form: { code: codeAt() } });
    expect(ok.status).toBe(302);
    expect(ok.location).toBe('/');
    const cookie = (ok.headers.getSetCookie() || []).map(x => x.split(';')[0]).join('; ');
    c.cookie = cookie;
    expect(await isLoggedIn(c)).toBe(true);
  });

  test('同一組驗證碼不能重複使用（防重放）；下一個時間步的新驗證碼可以', async () => {
    // 上一個測試已經用掉目前時間步的驗證碼
    const c = await atSecondStep('u_2fa_login');
    const replay = await c.post('/login/2fa', { form: { code: codeAt() } });
    expect(replay.location).toMatch(/^\/login\/2fa\?error=/);
    const next = await c.post('/login/2fa', { form: { code: codeAt(1) } });
    expect(next.location).toBe('/');
  });

  test('驗證碼格式不對（太短、含字母、空白）一律拒絕', async () => {
    const c = await atSecondStep('u_2fa_login');
    for (const bad of ['', '12345', 'abcdef', '1234567', '12 34']) {
      const r = await c.post('/login/2fa', { form: { code: bad } });
      expect([bad, r.location.startsWith('/login/2fa?error=')]).toEqual([bad, true]);
    }
  });

  test('連續輸錯驗證碼會暫時鎖定，鎖定期間連正確驗證碼也不接受', async () => {
    const c = await atSecondStep('u_2fa_lock');
    for (let i = 0; i < 5; i++) await c.post('/login/2fa', { form: { code: wrongCode() } });
    const afterLock = await c.post('/login/2fa', { form: { code: codeAt() } });
    expect(decode(afterLock.location)).toMatch(/\/login\?error=.*鎖定/);
    // 重新登入後仍然被鎖定
    const again = await atSecondStep('u_2fa_lock');
    const r = await again.post('/login/2fa', { form: { code: codeAt(1) } });
    expect(decode(r.location)).toMatch(/鎖定/);
  });

  test('用假帳號名稱（例如 2fa:帳號）搞不了別人的驗證步驟：密碼失敗與驗證碼失敗的計數互相獨立', async () => {
    for (let i = 0; i < 6; i++) await login('2fa:u_2fa_iso', 'wrong-password');
    const { response } = await fullLogin('u_2fa_iso');
    expect(response.location).toBe('/');
  });

  test('復原碼可以代替驗證碼登入，每組只能用一次，大小寫與連字號不影響', async () => {
    const first = await atSecondStep('u_2fa_recovery');
    const ok = await first.post('/login/2fa', { form: { code: RECOVERY[0].toLowerCase().replace('-', ' ') } });
    expect(ok.location).toBe('/');

    const second = await atSecondStep('u_2fa_recovery');
    const reuse = await second.post('/login/2fa', { form: { code: RECOVERY[0] } });
    expect(reuse.location).toMatch(/^\/login\/2fa\?error=/);
    const other = await second.post('/login/2fa', { form: { code: RECOVERY[1] } });
    expect(other.location).toBe('/');
    expect(JSON.parse(dbRow('SELECT recovery_codes FROM users WHERE username = ?', 'u_2fa_recovery').recovery_codes)).toHaveLength(1);
  });

  test('密鑰無法解開（例如還原到金鑰不同的新主機）時拒絕登入，不會放行', async () => {
    const c = await atSecondStep('u_2fa_unavail');
    const r = await c.post('/login/2fa', { form: { code: codeAt() } });
    expect(decode(r.location)).toMatch(/\/login\?error=.*無法使用.*管理員/);
    expect(await isLoggedIn(c)).toBe(false);
  });

  test('密鑰在資料庫中是加密儲存的（不是明文）', () => {
    const row = dbRow('SELECT totp_secret FROM users WHERE username = ?', 'u_2fa_login');
    expect(row.totp_secret).toMatch(/^v1\./);
    expect(row.totp_secret).not.toContain(SECRET);
  });
});

describeIntegration('雙因素驗證：角色強制啟用與設定流程', () => {
  test('角色強制但尚未啟用：登入後所有頁面都被導向設定頁，變更類請求被擋下，登出可用', async () => {
    const c = await login('u_req_a');
    expect(c.loginLocation).toBe('/');
    for (const p of ['/', '/projects/', '/customers/', '/bonuses/']) {
      const r = await c.get(p);
      expect([p, r.status, r.location]).toEqual([p, 302, '/account/security/2fa/setup']);
    }
    expect((await c.post('/customers/', { form: { company_name: 'x' } })).status).toBe(403);
    expect((await c.get('/account/security/2fa/setup')).status).toBe(200);
    expect((await c.get('/account/security')).status).toBe(200);
    const out = await c.post('/logout');
    expect(out.location).toBe('/login');
  });

  test('走完設定流程：錯誤的驗證碼不能啟用；正確後顯示 10 組復原碼，之後可正常使用，下次登入需要第二步', async () => {
    const c = await login('u_req_b');
    const setup = await c.get('/account/security/2fa/setup');
    expect(setup.status).toBe(200);
    const secret = (setup.text.match(/<code class="fs-5 user-select-all">([A-Z2-7 ]+)<\/code>/) || [])[1].replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.text).toContain('otpauth://totp/');
    expect(setup.text).toContain('/vendor/qrcode/qrcode.js');

    // 重新整理設定頁時密鑰不變（不然掃描到一半就失效）
    const again = (await c.get('/account/security/2fa/setup')).text;
    expect(again).toContain(secret.match(/.{1,4}/g).join(' '));

    const bad = await c.post('/account/security/2fa/enable', { form: { code: '000000' } });
    expect(decode(bad.location)).toMatch(/2fa\/setup\?error=.*驗證碼不正確/);
    expect(dbRow('SELECT totp_enabled e FROM users WHERE username = ?', 'u_req_b').e).toBe(0);

    const good = await c.post('/account/security/2fa/enable', { form: { code: totp.hotp(secret, totp.timeStep()) } });
    expect(good.status).toBe(200);
    const codes = good.text.match(/<code class="fs-5 user-select-all">([A-Z2-9]{5}-[A-Z2-9]{5})<\/code>/g) || [];
    expect(codes).toHaveLength(10);
    expect(good.headers.get('cache-control')).toMatch(/no-store/);

    const row = dbRow('SELECT totp_enabled e, totp_secret s, recovery_codes r FROM users WHERE username = ?', 'u_req_b');
    expect(row.e).toBe(1);
    expect(row.s).not.toContain(secret);
    expect(row.r).not.toMatch(/[A-Z2-9]{5}-[A-Z2-9]{5}/); // 復原碼只存雜湊

    expect(await isLoggedIn(c)).toBe(true); // 不再被導去設定頁
    const next = await login('u_req_b');
    expect(next.loginLocation).toBe('/login/2fa');
  });

  test('角色強制且已啟用的使用者不能停用', async () => {
    const { client } = await fullLogin('u_req_c');
    const r = await client.post('/account/security/2fa/disable', { form: { password: PASSWORD, code: codeAt(1) } });
    expect(decode(r.location)).toMatch(/error=.*角色要求/);
    expect(dbRow('SELECT totp_enabled e FROM users WHERE username = ?', 'u_req_c').e).toBe(1);
  });
});

describeIntegration('雙因素驗證：帳號安全頁（停用、重新產生復原碼）', () => {
  test('停用需要目前密碼加驗證碼：缺一不可，都對才停用，之後只需密碼登入', async () => {
    const { client } = await fullLogin('u_2fa_disable');
    const noPassword = await client.post('/account/security/2fa/disable', { form: { password: 'wrong-password', code: codeAt(1) } });
    expect(decode(noPassword.location)).toMatch(/error=.*密碼或驗證碼錯誤/);
    const noCode = await client.post('/account/security/2fa/disable', { form: { password: PASSWORD, code: '000000' } });
    expect(decode(noCode.location)).toMatch(/error=.*密碼或驗證碼錯誤/);
    expect(dbRow('SELECT totp_enabled e FROM users WHERE username = ?', 'u_2fa_disable').e).toBe(1);

    const ok = await client.post('/account/security/2fa/disable', { form: { password: PASSWORD, code: codeAt(1) } });
    expect(decode(ok.location)).toMatch(/success=/);
    const row = dbRow('SELECT totp_enabled e, totp_secret s, recovery_codes r FROM users WHERE username = ?', 'u_2fa_disable');
    expect([row.e, row.s, row.r]).toEqual([0, null, null]);
    const plain = await login('u_2fa_disable');
    expect(plain.loginLocation).toBe('/');
  });

  test('重新產生復原碼：需要密碼＋驗證碼；新的一組取代舊的', async () => {
    const { client } = await fullLogin('u_2fa_regen');
    const bad = await client.post('/account/security/2fa/recovery-codes', { form: { password: PASSWORD, code: '000000' } });
    expect(decode(bad.location)).toMatch(/error=/);

    const ok = await client.post('/account/security/2fa/recovery-codes', { form: { password: PASSWORD, code: codeAt(1) } });
    expect(ok.status).toBe(200);
    expect((ok.text.match(/[A-Z2-9]{5}-[A-Z2-9]{5}/g) || []).length).toBe(10);

    // 舊的復原碼失效
    const c2 = await atSecondStep('u_2fa_regen');
    const old = await c2.post('/login/2fa', { form: { code: RECOVERY[0] } });
    expect(old.location).toMatch(/^\/login\/2fa\?error=/);
  });

  test('帳號安全頁每個登入者都能開啟，顯示正確的狀態', async () => {
    const c = await as('u_boss');
    const r = await c.get('/account/security');
    expect(r.status).toBe(200);
    expect(r.text).toContain('未啟用');
    expect(r.text).toContain('/account/security/2fa/setup');
  });
});

describeIntegration('雙因素驗證：管理員重設與角色設定', () => {
  test('管理員可以重設使用者的雙因素驗證，之後該使用者只需密碼；並通知該使用者', async () => {
    const admin = await as('admin');
    const userId = ids.users.u_2fa_reset;
    expect((await login('u_2fa_reset')).loginLocation).toBe('/login/2fa');
    const r = await admin.post(`/users/${userId}/reset-2fa`, { form: {} });
    expect(decode(r.location)).toMatch(/success=.*已重設/);
    expect(dbRow('SELECT totp_enabled e, totp_secret s FROM users WHERE id = ?', userId)).toEqual({ e: 0, s: null });
    expect((await login('u_2fa_reset')).loginLocation).toBe('/');
    expect(dbRow("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'two_factor_reset'", userId).c).toBe(1);
    expect(dbRow("SELECT COUNT(*) c FROM system_logs WHERE action = '2fa_reset_by_admin' AND record_id = ?", userId).c).toBe(1);
  });

  test('沒有使用者管理權限的人不能重設別人的雙因素驗證', async () => {
    const c = await as('u_edit');
    expect((await c.post(`/users/${ids.users.u_req_c}/reset-2fa`, { form: {} })).status).toBe(403);
    expect(dbRow('SELECT totp_enabled e FROM users WHERE id = ?', ids.users.u_req_c).e).toBe(1);
  });

  test('使用者列表顯示雙因素狀態；角色表單有「強制雙因素驗證」選項且可儲存', async () => {
    const admin = await as('admin');
    const list = (await admin.get('/users/')).text;
    expect(list).toContain('雙因素');
    expect(list).toContain('已啟用');

    const form = (await admin.get('/roles/new')).text;
    expect(form).toContain('name="require_2fa"');
    const created = await admin.post('/roles/', { json: { role_key: 'req_role_test', role_name: 'req_role_test', require_2fa: 'on', project_view_scope: 'all', is_active: 'on' } });
    const roleId = JSON.parse(created.text).roleId;
    expect(/name="require_2fa"\s*checked/.test((await admin.get(`/roles/${roleId}/edit`)).text)).toBe(true);
  });
});
