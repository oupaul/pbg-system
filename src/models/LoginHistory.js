const db = require('./db');

const LoginHistory = {
  // 記錄一次成功登入
  record(userId, ipAddress, userAgent) {
    db.prepare(`
      INSERT INTO login_history (user_id, ip_address, user_agent)
      VALUES (?, ?, ?)
    `).run(userId, ipAddress || null, userAgent || null);
  },

  // 查詢登入紀錄（可依使用者/日期篩選，分頁）
  list({ userId, startDate, endDate, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const params = [];

    if (userId) {
      conditions.push('lh.user_id = ?');
      params.push(userId);
    }
    if (startDate) {
      conditions.push('lh.logged_in_at >= ?');
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push('lh.logged_in_at <= ?');
      params.push(`${endDate} 23:59:59`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    return db.prepare(`
      SELECT lh.id, lh.user_id, lh.ip_address, lh.user_agent, lh.logged_in_at,
             u.username, u.name
      FROM login_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      ${where}
      ORDER BY lh.logged_in_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
  },

  // 計算符合篩選條件的總筆數（供分頁使用）
  count({ userId, startDate, endDate } = {}) {
    const conditions = [];
    const params = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (startDate) {
      conditions.push('logged_in_at >= ?');
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push('logged_in_at <= ?');
      params.push(`${endDate} 23:59:59`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = db.prepare(`SELECT COUNT(*) as count FROM login_history ${where}`).get(...params);
    return result.count;
  }
};

module.exports = LoginHistory;
