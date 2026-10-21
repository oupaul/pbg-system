// 整合測試共用工具：登入、帶 cookie 發請求（不自動跟隨轉址，方便檢查 302/403）。
const SKIP = !!process.env.PBG_INTEGRATION_SKIP;
const BASE = process.env.PBG_TEST_BASE_URL;
const ids = SKIP ? {} : JSON.parse(process.env.PBG_TEST_IDS || '{}');
const PASSWORD = 'Passw0rd-test-1';

// 整合測試未準備好（例如 Node 版本載不了 better-sqlite3）時整組略過
const describeIntegration = SKIP ? describe.skip : describe;

let ipCounter = 10;
const clients = new Map();

function parseCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

class Client {
  constructor(cookie = '', ip = '10.0.0.1') { this.cookie = cookie; this.ip = ip; }

  async request(method, path, { form, json, headers = {}, origin = BASE, raw } = {}) {
    const h = { 'X-Forwarded-For': this.ip, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET' && origin) h.Origin = origin;
    let body;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    if (hasBody && form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    else if (hasBody && json) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (hasBody && raw) { body = raw.body; Object.assign(h, raw.headers); }
    const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location') || '', text, headers: res.headers };
  }
  get(path, opts) { return this.request('GET', path, opts); }
  post(path, opts) { return this.request('POST', path, opts); }
}

async function login(username, password = PASSWORD) {
  const ip = `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250 + 1}`; // 每個帳號用不同來源 IP，避免共用登入限速
  const c = new Client('', ip);
  const res = await c.post('/login', { form: { username, password } });
  c.cookie = parseCookies({ headers: res.headers });
  c.loginStatus = res.status;
  c.loginLocation = res.location;
  return c;
}

// 取得（並快取）某使用者的已登入 client
async function as(username) {
  if (!clients.has(username)) clients.set(username, await login(username));
  return clients.get(username);
}

const anonymous = () => new Client('', '10.99.0.1');

// 回應是否代表「被擋下」：403／401，或被導回登入頁
// 少數處理函式自己檢查權限，擋下時是導回原頁並帶「權限不足」錯誤訊息（例如批次刪除獎金）
const isDenied = (r) => {
  if (r.status === 403 || r.status === 401) return true;
  if (r.status !== 302) return false;
  if (/\/login/.test(r.location)) return true;
  try { return decodeURIComponent(r.location).includes('權限不足'); } catch { return false; }
};
// 回應是否代表「進到了處理函式」（沒被權限擋下）：不是 401/403，也不是導向登入
const isAllowed = (r) => !isDenied(r);

module.exports = { describeIntegration, BASE, ids, PASSWORD, as, login, anonymous, Client, isDenied, isAllowed };

// ---- 路由清單（由注入在測試伺服器上的 /__test/routes 取得）與參數填值 ----
const PARAM_VALUES = {
  id: '999999', attachmentId: '999999', activityId: '999999', recordId: '999999', operationId: 'nope',
  token: 'a'.repeat(32), year: '2026', filename: 'nope.tar.gz', tableName: 'projects'
};
const concretize = (p) => p.replace(/:([A-Za-z]+)/g, (m, name) => PARAM_VALUES[name] || '999999');

async function getRoutes() {
  const admin = await as('admin');
  const res = await admin.get('/__test/routes');
  const raw = JSON.parse(res.text);
  const routes = [];
  for (const r of raw) {
    if (r.path.startsWith('/__test/')) continue;
    // express 允許一條路由有多個路徑（以逗號串接顯示）
    for (const p of r.path.split(',')) routes.push({ method: r.method, path: p, key: `${r.method} ${p}`, url: concretize(p) });
  }
  return routes;
}

// 用 multipart 上傳單一檔案
async function postFile(client, path, { field = 'file', filename, content, type = 'application/octet-stream' }) {
  const fd = new FormData();
  fd.append(field, new Blob([content], { type }), filename);
  const headers = { 'X-Forwarded-For': client.ip, Origin: BASE };
  if (client.cookie) headers.Cookie = client.cookie;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: fd, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location') || '', text, headers: res.headers };
}

module.exports.getRoutes = getRoutes;
module.exports.postFile = postFile;
module.exports.concretize = concretize;
