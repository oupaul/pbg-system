// Simple in-memory TTL cache — no external dependencies.
// Suitable for single-process Node.js deployments (which this app is).

class CacheService {
  constructor() {
    // Map<key, { value, expiresAt }>
    this._store = new Map();

    // Prune expired entries every minute
    setInterval(() => this._prune(), 60 * 1000).unref();
  }

  /**
   * Get a cached value. Returns undefined if missing or expired.
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store a value with a TTL in milliseconds (default 5 minutes).
   */
  set(key, value, ttlMs = 5 * 60 * 1000) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Delete one key (call after data mutation to invalidate stale cache).
   */
  del(key) {
    this._store.delete(key);
  }

  /**
   * Delete all keys that start with a given prefix.
   */
  delByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  /**
   * Get-or-set: if cached, return immediately; otherwise call fn(), cache result, return it.
   */
  async getOrSet(key, fn, ttlMs = 5 * 60 * 1000) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  _prune() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }
}

// Export singleton
module.exports = new CacheService();
