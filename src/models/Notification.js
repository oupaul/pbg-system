const db = require('./db');

const Notification = {
  create({ user_id, type, title, message, link, related_type, related_id }) {
    const result = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link, related_type, related_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, type, title, message || null, link || null, related_type || null, related_id ?? null);
    return result.lastInsertRowid;
  },

  // 系統自動產生的提醒（客戶追蹤逾期、開票提醒）：同一使用者對同一目標若已有未讀通知就不重複建立
  createIfNotExists({ user_id, type, title, message, link, related_type, related_id }) {
    const existing = db.prepare(`
      SELECT id FROM notifications
      WHERE user_id = ? AND type = ? AND related_type = ? AND related_id = ? AND is_read = 0
    `).get(user_id, type, related_type || null, related_id ?? null);
    if (existing) return existing.id;
    return this.create({ user_id, type, title, message, link, related_type, related_id });
  },

  findForUser(userId, { unreadOnly = false, limit = 200 } = {}) {
    const cond = unreadOnly ? 'AND is_read = 0' : '';
    return db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? ${cond}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);
  },

  countUnread(userId) {
    return db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`).get(userId).count;
  },

  findById(id) {
    return db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id);
  },

  markRead(id, userId) {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(id, userId);
  },

  markAllRead(userId) {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`).run(userId);
  }
};

module.exports = Notification;
