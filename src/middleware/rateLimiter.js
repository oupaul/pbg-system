// In-memory rate limiter — no external dependencies required.
// Tracks failed login attempts per IP; resets after windowMs.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 20;

// Map<ip, { count, resetAt }>
const store = new Map();

// Prune expired entries every 10 minutes to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now > entry.resetAt) store.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function getEntry(ip) {
  const now = Date.now();
  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }
  return entry;
}

/**
 * Middleware for POST /login — rejects after MAX_ATTEMPTS within WINDOW_MS.
 * Call resetOnSuccess(ip) after a successful login to clear the counter.
 */
function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const entry = getEntry(ip);

  if (entry.count >= MAX_ATTEMPTS) {
    const waitSec = Math.ceil((entry.resetAt - Date.now()) / 1000);
    const waitMin = Math.ceil(waitSec / 60);
    return res.redirect(
      `/login?error=${encodeURIComponent(`登入嘗試次數過多，請 ${waitMin} 分鐘後再試`)}`
    );
  }

  entry.count += 1;
  next();
}

function resetOnSuccess(ip) {
  store.delete(ip);
}

// ── 每個帳號的失敗鎖定 ──
// 只靠每 IP 限速擋不住「換 IP 持續猜同一個帳號」：同一個帳號（不論帳號是否存在，避免洩漏哪些帳號存在）
// 連續失敗 ACCOUNT_MAX_FAILURES 次後鎖定 ACCOUNT_LOCK_MS，期間連正確密碼也不接受。
const ACCOUNT_MAX_FAILURES = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

const accountKey = (username) => String(username || '').trim().toLowerCase().slice(0, 100);

// 帳號層級的失敗計數器工廠：密碼失敗與雙因素驗證碼失敗各用獨立的實例，
// 否則有人可以用 "2fa:受害者帳號" 之類的假帳號名稱刻意把別人的驗證步驟鎖住
function createAccountLimiter() {
  const store = new Map(); // key(帳號小寫) -> { failures, lockedUntil, lastFailAt }

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if ((!entry.lockedUntil || now > entry.lockedUntil) && now - entry.lastFailAt > ACCOUNT_LOCK_MS) store.delete(key);
    }
  }, 10 * 60 * 1000).unref();

  return {
    // 帳號目前是否被鎖定；回傳剩餘分鐘數（未鎖定回傳 0）
    lockedMinutes(username) {
      const entry = store.get(accountKey(username));
      if (!entry || !entry.lockedUntil) return 0;
      const remaining = entry.lockedUntil - Date.now();
      if (remaining <= 0) {
        store.delete(accountKey(username));
        return 0;
      }
      return Math.ceil(remaining / 60000);
    },
    recordFailure(username) {
      const key = accountKey(username);
      if (!key) return;
      const entry = store.get(key) || { failures: 0, lockedUntil: 0, lastFailAt: 0 };
      entry.failures += 1;
      entry.lastFailAt = Date.now();
      if (entry.failures >= ACCOUNT_MAX_FAILURES) {
        entry.lockedUntil = Date.now() + ACCOUNT_LOCK_MS;
        entry.failures = 0;
      }
      store.set(key, entry);
    },
    clear(username) {
      store.delete(accountKey(username));
    }
  };
}

const passwordLimiter = createAccountLimiter();
const twoFactorLimiter = createAccountLimiter();

module.exports = {
  loginRateLimiter, resetOnSuccess,
  accountLockedMinutes: (u) => passwordLimiter.lockedMinutes(u),
  recordAccountFailure: (u) => passwordLimiter.recordFailure(u),
  clearAccountFailures: (u) => passwordLimiter.clear(u),
  // 雙因素驗證碼（登入第二步、停用、重新產生復原碼）專用
  twoFactorLockedMinutes: (u) => twoFactorLimiter.lockedMinutes(u),
  recordTwoFactorFailure: (u) => twoFactorLimiter.recordFailure(u),
  clearTwoFactorFailures: (u) => twoFactorLimiter.clear(u)
};
