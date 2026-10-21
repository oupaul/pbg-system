// 雙因素驗證「信任此裝置」：只有通過驗證碼並勾選才發憑證、憑證只存雜湊且綁使用者、
// 撤銷／改密碼／重設 2FA／停用帳號／到期／功能關閉時一律失效。各測試用各自的使用者（驗證碼防重放是逐人計算）。
const path = require('path');
const Database = require('better-sqlite3');
const totp = require('../../src/utils/totp');
const { describeIntegration, as, ids, Client, PASSWORD, BASE } = require('./helpers');

const NAME = 'pbg_td';
const SECRET = ids.twoFactor && ids.twoFactor.secret;
const RECOVERY = ids.twoFactor && ids.twoFactor.recoveryCodes;
const codeAt = (offset = 0) => totp.hotp(SECRET, totp.timeStep() + offset);
const withDb = (fn, { readonly = true } = {}) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
};
const userId = (name) => ids.users[name];
const devices = (name) => withDb(db => db.prepare('SELECT * FROM trusted_devices WHERE user_id = ?').all(userId(name)));
const setTrustDays = (n) => withDb(db => db.prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'two_factor_trust_days'").run(String(n)), { readonly: false });

let ipCounter = 1;
const newClient = (cookie = '') => new Client(cookie, `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250 + 1}`);
const cookiesOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : []);
const pairs = (list) => list.map(c => c.split(';')[0]).join('; ');
const tokenFrom = (res) => {
  const c = cookiesOf(res).find(x => x.startsWith(`${NAME}=`));
  return c ? c.split(';')[0].slice(NAME.length + 1) : null;
};

// 帳號密碼登入（可帶裝置 cookie）。回傳 { client, res }；成功進入系統時 client 帶有 session cookie
const passwordLogin = async (username, deviceToken = null, password = PASSWORD) => {
  const c = newClient(deviceToken ? `${NAME}=${deviceToken}` : '');
  const res = await c.post('/login', { form: { username, password } });
  const session = cookiesOf(res).filter(x => !x.startsWith(`${NAME}=`));
  c.cookie = [deviceToken ? `${NAME}=${deviceToken}` : null, session.length ? pairs(session) : null].filter(Boolean).join('; ');
  return { client: c, res };
};
const isLoggedIn = async (c) => (await c.get('/projects/')).status === 200;
// 走完第二步；trust 為 true 時勾選「信任此裝置」。回傳 { client, res, token }
const secondStep = async (username, { trust = false, code = codeAt() } = {}) => {
  const { client, res } = await passwordLogin(username);
  expect(res.location).toBe('/login/2fa');
  const form = { code };
  if (trust) form.trust_device = '1';
  const r = await client.post('/login/2fa', { form });
  const session = cookiesOf(r).filter(x => !x.startsWith(`${NAME}=`));
  if (session.length) client.cookie = pairs(session);
  return { client, res: r, token: tokenFrom(r) };
};
// 用已信任的裝置憑證只輸入密碼登入：成功回傳已登入的 client，否則 null
const trustedLogin = async (username, token, password = PASSWORD) => {
  const { client, res } = await passwordLogin(username, token, password);
  if (res.location === '/' && await isLoggedIn(client)) return client;
  return null;
};

describeIntegration('信任此裝置：建立與使用', () => {
  test('登入第二步顯示「信任這台裝置」選項；勾選並驗證成功後發 HttpOnly 的憑證，資料庫只存雜湊', async () => {
    const { client, res } = await passwordLogin('u_td_1');
    const page = await client.get('/login/2fa');
    expect(page.text).toContain('name="trust_device"');
    expect(page.text).toContain('30 天');

    const done = await client.post('/login/2fa', { form: { code: codeAt(), trust_device: '1' } });
    expect(done.status).toBe(302);
    const setCookie = cookiesOf(done).find(x => x.startsWith(`${NAME}=`));
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=2592000/i); // 30 天
    const token = tokenFrom(done);
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    const rows = devices('u_td_1');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).not.toContain(token);
    const days = (new Date(rows[0].expires_at.replace(' ', 'T')) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect(res.status).toBe(302);
  });

  test('帶著憑證的裝置只要密碼就能登入、不再問驗證碼；留下稽核紀錄與最後使用時間', async () => {
    const { token } = await secondStep('u_td_2', { trust: true });
    expect(token).toBeTruthy();
    const c = await trustedLogin('u_td_2', token);
    expect(c).not.toBeNull();
    expect(devices('u_td_2')[0].last_used_at).toBeTruthy();
    const n = withDb(db => db.prepare("SELECT COUNT(*) n FROM system_logs WHERE action = '2fa_skipped_trusted_device' AND record_id = ?").get(userId('u_td_2')).n);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('密碼錯誤時，即使有有效憑證也不能登入', async () => {
    const { token } = await secondStep('u_td_3', { trust: true });
    const { client, res } = await passwordLogin('u_td_3', token, 'wrong-password-xyz');
    expect(res.location).toMatch(/^\/login\?error=/);
    expect(await isLoggedIn(client)).toBe(false);
  });

  test('沒有勾選就不發憑證，下次登入仍要驗證碼', async () => {
    const { res, token } = await secondStep('u_td_4', { trust: false });
    expect(res.status).toBe(302);
    expect(token).toBeNull();
    expect(devices('u_td_4')).toHaveLength(0);
    const { res: again } = await passwordLogin('u_td_4');
    expect(again.location).toBe('/login/2fa');
  });

  test('用復原碼登入時，就算勾選也不發憑證', async () => {
    const { client } = await passwordLogin('u_td_5');
    const r = await client.post('/login/2fa', { form: { code: RECOVERY[0], trust_device: '1' } });
    expect(r.status).toBe(302);
    expect(r.location).toBe('/');
    expect(tokenFrom(r)).toBeNull();
    expect(devices('u_td_5')).toHaveLength(0);
  });

  test('驗證碼錯誤時不會發憑證', async () => {
    const { client } = await passwordLogin('u_td_6');
    const bad = String((parseInt(codeAt(), 10) + 1) % 1000000).padStart(6, '0');
    const r = await client.post('/login/2fa', { form: { code: bad, trust_device: '1' } });
    expect(r.location).toMatch(/^\/login\/2fa\?error=/);
    expect(tokenFrom(r)).toBeNull();
    expect(devices('u_td_6')).toHaveLength(0);
  });
});

describeIntegration('信任此裝置：憑證不能被濫用', () => {
  let tokenA;
  beforeAll(async () => { tokenA = (await secondStep('u_td_7', { trust: true })).token; });

  test('別人的憑證對其他使用者無效（綁定使用者）', async () => {
    expect(await trustedLogin('u_td_8', tokenA)).toBeNull();
    const { res } = await passwordLogin('u_td_8', tokenA);
    expect(res.location).toBe('/login/2fa');
  });

  test('亂填、被改過、長度不對的憑證都無效', async () => {
    const flipped = tokenA.slice(0, -1) + (tokenA.endsWith('0') ? '1' : '0');
    for (const bad of ['abc', flipped, tokenA + 'ff', 'ZZZZ'.repeat(16), "' OR 1=1 --"]) {
      const { res } = await passwordLogin('u_td_7', bad);
      expect([bad, res.location]).toEqual([bad, '/login/2fa']);
    }
  });

  test('原本的憑證仍然有效（上面的失敗嘗試不會影響它）', async () => {
    expect(await trustedLogin('u_td_7', tokenA)).not.toBeNull();
  });

  test('到期的憑證無效', async () => {
    withDb(db => db.prepare("UPDATE trusted_devices SET expires_at = datetime('now', 'localtime', '-1 minutes') WHERE user_id = ?").run(userId('u_td_7')), { readonly: false });
    expect(await trustedLogin('u_td_7', tokenA)).toBeNull();
  });
});

describeIntegration('信任此裝置：撤銷與失效', () => {
  test('在帳號安全頁看得到信任的裝置（標示目前這台），撤銷後該憑證無效', async () => {
    const { token } = await secondStep('u_td_9', { trust: true });
    const c = await trustedLogin('u_td_9', token);
    const page = (await c.get('/account/security')).text;
    expect(page).toContain('信任的裝置');
    expect(page).toContain('目前這台');
    const id = devices('u_td_9')[0].id;
    const r = await c.post(`/account/security/devices/${id}/revoke`, { form: {} });
    expect(r.status).toBe(302);
    expect(devices('u_td_9')).toHaveLength(0);
    expect(await trustedLogin('u_td_9', token)).toBeNull();
  });
});

describeIntegration('信任此裝置：各種情況下一律失效', () => {
  test('只能撤銷自己的裝置；「全部撤銷」只影響自己', async () => {
    const a = await secondStep('u_td_10', { trust: true });
    const b = await secondStep('u_td_11', { trust: true });
    const cb = await trustedLogin('u_td_11', b.token);
    const idOfA = devices('u_td_10')[0].id;
    const r = await cb.post(`/account/security/devices/${idOfA}/revoke`, { form: {} });
    expect(decodeURIComponent(r.location)).toContain('找不到這台裝置');
    expect(devices('u_td_10')).toHaveLength(1);
    // 不合法的 id
    const bad = await cb.post('/account/security/devices/abc/revoke', { form: {} });
    expect(decodeURIComponent(bad.location)).toContain('無效的裝置');

    await cb.post('/account/security/devices/revoke-all', { form: {} });
    expect(devices('u_td_11')).toHaveLength(0);
    expect(devices('u_td_10')).toHaveLength(1);
    expect(await trustedLogin('u_td_10', a.token)).not.toBeNull();
  });

  test('修改密碼後，所有信任裝置失效', async () => {
    const { token } = await secondStep('u_td_12', { trust: true });
    const c = await trustedLogin('u_td_12', token);
    const NEW = 'New-Passw0rd-12345';
    const r = await c.post('/change-password', { form: { currentPassword: PASSWORD, newPassword: NEW, confirmPassword: NEW } });
    expect(decodeURIComponent(r.location)).toContain('密碼修改成功');
    expect(devices('u_td_12')).toHaveLength(0);
    const { res } = await passwordLogin('u_td_12', token, NEW);
    expect(res.location).toBe('/login/2fa');
  });

  test('管理員重設該使用者的雙因素驗證後，信任裝置失效', async () => {
    await secondStep('u_td_13', { trust: true });
    expect(devices('u_td_13')).toHaveLength(1);
    const admin = await as('admin');
    const r = await admin.post(`/users/${userId('u_td_13')}/reset-2fa`, { form: {} });
    expect(r.status).toBe(302);
    expect(devices('u_td_13')).toHaveLength(0);
  });

  test('管理員停用該帳號後，信任裝置失效（重新啟用也回不來）', async () => {
    const { token } = await secondStep('u_td_14', { trust: true });
    const admin = await as('admin');
    await admin.post(`/users/${userId('u_td_14')}/toggle-active`, { form: {} }); // 停用
    expect(devices('u_td_14')).toHaveLength(0);
    const again = await admin.post(`/users/${userId('u_td_14')}/toggle-active`, { form: {} }); // 再啟用（已停用的帳號也要能從列表重新啟用）
    expect(again.status).toBe(302);
    expect(withDb(db => db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId('u_td_14')).is_active)).toBe(1);
    const { res } = await passwordLogin('u_td_14', token);
    expect(res.location).toBe('/login/2fa');
  });

  test('每位使用者最多保留 10 台，新增第 11 台時最舊的被移除', async () => {
    withDb(db => {
      const ins = db.prepare("INSERT INTO trusted_devices (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, 'old', datetime('now', 'localtime', '+10 days'))");
      for (let i = 0; i < 10; i++) ins.run(userId('u_td_16'), `fake-hash-${i}`);
    }, { readonly: false });
    const oldestId = devices('u_td_16')[0].id;
    await secondStep('u_td_16', { trust: true });
    const rows = devices('u_td_16');
    expect(rows).toHaveLength(10);
    expect(rows.map(r => r.id)).not.toContain(oldestId);
  });
});

describeIntegration('信任此裝置：系統設定可關閉', () => {
  test('信任天數設為 0：登入頁不顯示選項、不發憑證、既有憑證不再有效；改回後既有憑證恢復有效', async () => {
    const { token } = await secondStep('u_td_15', { trust: true });
    expect(await trustedLogin('u_td_15', token)).not.toBeNull();
    try {
      setTrustDays(0);
      const { client, res } = await passwordLogin('u_td_15', token);
      expect(res.location).toBe('/login/2fa'); // 既有憑證不再被接受
      const page = await client.get('/login/2fa');
      expect(page.text).not.toContain('name="trust_device"');
    } finally {
      setTrustDays(30);
    }
    expect(await trustedLogin('u_td_15', token)).not.toBeNull();
  });

  test('設定頁的驗證：信任天數只接受 0–90', async () => {
    const admin = await as('admin');
    for (const bad of ['91', '-1', 'abc']) {
      const r = await admin.post('/settings/bulk-update', { form: { two_factor_trust_days: bad } });
      expect([bad, withDb(db => db.prepare("SELECT setting_value v FROM system_settings WHERE setting_key = 'two_factor_trust_days'").get().v)]).toEqual([bad, '30']);
      expect(r.status).toBe(302);
    }
    await admin.post('/settings/bulk-update', { form: { two_factor_trust_days: '14' } });
    expect(withDb(db => db.prepare("SELECT setting_value v FROM system_settings WHERE setting_key = 'two_factor_trust_days'").get().v)).toBe('14');
    setTrustDays(30);
  });
});
