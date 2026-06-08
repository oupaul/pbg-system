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

module.exports = { loginRateLimiter, resetOnSuccess };
