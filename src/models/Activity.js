const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Activity = {
  // 取得客戶的活動時間軸（含關聯的商機名稱）
  findByCustomer(customerId) {
    return db.prepare(`
      SELECT a.*, p.opportunity_name
      FROM activities a
      LEFT JOIN pipelines p ON a.pipeline_id = p.id
      WHERE a.customer_id = ? AND a.deleted_at IS NULL
      ORDER BY a.activity_date DESC, a.id DESC
    `).all(customerId);
  },

  findById(id) {
    return db.prepare(`SELECT * FROM activities WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  create(data) {
    if (!data.customer_id) throw new Error('客戶為必填欄位');
    if (!data.content || !data.content.trim()) throw new Error('活動內容為必填欄位');

    const stmt = db.prepare(`
      INSERT INTO activities (customer_id, pipeline_id, activity_type, content, activity_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      parseInt(data.customer_id),
      data.pipeline_id ? parseInt(data.pipeline_id) : null,
      data.activity_type || '其他',
      data.content.trim(),
      data.activity_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
      data.userInfo || 'system'
    );

    const id = result.lastInsertRowid;
    AuditLogService.logCreate('activities', id, data, data.userInfo);
    return id;
  },

  softDelete(id, userInfo) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;

    db.prepare(`UPDATE activities SET deleted_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
    AuditLogService.logDelete('activities', id, oldRecord, userInfo);
    return true;
  }
};

module.exports = Activity;
