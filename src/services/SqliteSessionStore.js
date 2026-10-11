// 以 SQLite 儲存 session（取代預設的 MemoryStore）：
// - 服務重啟、部署更新後使用者不會被全部登出
// - 不會因 session 累積而吃光記憶體（MemoryStore 在 production 也會被 express-session 警告）
// 不新增外部相依套件，直接使用現有的 better-sqlite3 連線；資料表在啟動時自動建立。
const session = require('express-session');
const db = require('../models/db');

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)');
    this._cleanup();
    this._timer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this._timer.unref();
  }

  _cleanup() {
    try {
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    } catch (err) {
      console.error('[SessionStore] 清理過期 session 失敗:', err.message);
    }
  }

  _expiresOf(sess) {
    const cookie = sess && sess.cookie;
    if (cookie && cookie.expires) return new Date(cookie.expires).getTime();
    if (cookie && cookie.originalMaxAge) return Date.now() + cookie.originalMaxAge;
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      db.prepare(`
        INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
      `).run(sid, JSON.stringify(sess), this._expiresOf(sess));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this._expiresOf(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
