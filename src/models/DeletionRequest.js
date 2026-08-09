const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const Pipeline = require('./Pipeline');
const Activity = require('./Activity');
const Customer = require('./Customer');

// target_type -> 實際執行軟刪除的 model 方法
const DELETE_HANDLERS = {
  pipeline: (id, userInfo) => Pipeline.softDelete(id, userInfo),
  activity: (id, userInfo) => Activity.softDelete(id, userInfo),
  customer: (id, userInfo) => Customer.softDelete(id, userInfo)
};

const DeletionRequest = {
  // 建立刪除申請（沒有 can_delete 權限的角色執行刪除時呼叫）
  create({ target_type, target_id, target_summary, reason, requested_by, requested_by_name }) {
    const result = db.prepare(`
      INSERT INTO deletion_requests (target_type, target_id, target_summary, reason, requested_by, requested_by_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(target_type, target_id, target_summary || null, reason || null, requested_by, requested_by_name || null);

    const id = result.lastInsertRowid;
    AuditLogService.logCreate('deletion_requests', id, { target_type, target_id, target_summary }, requested_by_name);
    return id;
  },

  // 該筆資料是否已有待審核中的刪除申請
  findPendingByTarget(target_type, target_id) {
    return db.prepare(`
      SELECT * FROM deletion_requests
      WHERE target_type = ? AND target_id = ? AND status = 'pending'
    `).get(target_type, target_id);
  },

  findById(id) {
    return db.prepare(`SELECT * FROM deletion_requests WHERE id = ?`).get(id);
  },

  // 待審核清單（給管理員審核頁面用）
  findPending() {
    return db.prepare(`
      SELECT * FROM deletion_requests
      WHERE status = 'pending'
      ORDER BY requested_at ASC
    `).all();
  },

  // 核准：真正執行軟刪除，並記錄審核者
  approve(id, reviewer) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此刪除申請');
    if (request.status !== 'pending') throw new Error('此申請已被處理過');

    const handler = DELETE_HANDLERS[request.target_type];
    if (!handler) throw new Error(`不支援的刪除類型：${request.target_type}`);

    handler(request.target_id, reviewer.name || reviewer.username);

    db.prepare(`
      UPDATE deletion_requests
      SET status = 'approved', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, id);

    AuditLogService.logUpdate('deletion_requests', id, request, { status: 'approved' }, reviewer.name);
    return true;
  },

  // 駁回：資料維持不變，僅標記申請狀態
  reject(id, reviewer, reviewNote) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此刪除申請');
    if (request.status !== 'pending') throw new Error('此申請已被處理過');

    db.prepare(`
      UPDATE deletion_requests
      SET status = 'rejected', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime'), review_note = ?
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, reviewNote || null, id);

    AuditLogService.logUpdate('deletion_requests', id, request, { status: 'rejected' }, reviewer.name);
    return true;
  }
};

module.exports = DeletionRequest;
