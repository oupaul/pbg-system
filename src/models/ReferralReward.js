const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const ReferralReward = {
  // 取得某客戶身為介紹人的所有轉介紹紀錄
  findByCustomer(customerId) {
    return db.prepare(`
      SELECT r.*,
        referred.company_name AS referred_customer_name,
        p.project_code, p.project_name,
        u.name AS recipient_user_name
      FROM referral_rewards r
      LEFT JOIN customers referred ON referred.id = r.referred_customer_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.recipient_user_id
      WHERE r.referring_customer_id = ?
      ORDER BY r.created_at DESC
    `).all(customerId);
  },

  // 依ID取得
  findById(id) {
    return db.prepare(`SELECT * FROM referral_rewards WHERE id = ?`).get(id);
  },

  // 取得所有轉介紹獎勵（總覽頁用，可依狀態篩選）
  findAll(filters = {}) {
    const statusCond = filters.status ? ' AND r.status = ?' : '';
    const statusParams = filters.status ? [filters.status] : [];
    return db.prepare(`
      SELECT r.*,
        referring.company_name AS referring_customer_name,
        referred.company_name AS referred_customer_name,
        p.project_code, p.project_name,
        u.name AS recipient_user_name
      FROM referral_rewards r
      JOIN customers referring ON referring.id = r.referring_customer_id
      LEFT JOIN customers referred ON referred.id = r.referred_customer_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.recipient_user_id
      WHERE 1=1${statusCond}
      ORDER BY r.created_at DESC
    `).all(...statusParams);
  },

  // 新增轉介紹獎勵
  create(data) {
    const referringCustomerId = parseInt(data.referring_customer_id);
    const referredCustomerId = data.referred_customer_id ? parseInt(data.referred_customer_id) : null;
    const projectId = data.project_id ? parseInt(data.project_id) : null;
    const recipientType = data.recipient_type === 'staff' ? 'staff' : 'customer';
    const recipientUserId = recipientType === 'staff' && data.recipient_user_id ? parseInt(data.recipient_user_id) : null;
    const rewardAmount = data.reward_amount !== undefined && data.reward_amount !== null ? parseFloat(data.reward_amount) || 0 : 0;
    const status = data.status || '待發放';
    const forfeitureReason = data.forfeiture_reason || null;
    const notes = data.notes || null;

    const stmt = db.prepare(`
      INSERT INTO referral_rewards (
        referring_customer_id, referred_customer_id, project_id,
        recipient_type, recipient_user_id, reward_amount,
        status, forfeiture_reason, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      referringCustomerId,
      referredCustomerId,
      projectId,
      recipientType,
      recipientUserId,
      rewardAmount,
      status,
      forfeitureReason,
      notes
    );

    const id = result.lastInsertRowid;
    AuditLogService.logCreate('referral_rewards', id, data, data.userInfo);
    return id;
  },

  // 更新轉介紹獎勵（含狀態變更：標記已發放/充公）
  update(id, data) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;

    const fields = [];
    const values = [];
    const newData = {};

    const allowedFields = [
      'referred_customer_id', 'project_id', 'recipient_type', 'recipient_user_id',
      'reward_amount', 'status', 'forfeiture_reason', 'notes'
    ];

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        let value = data[field];
        if (field === 'referred_customer_id' || field === 'project_id' || field === 'recipient_user_id') {
          value = (value === '' || value === null) ? null : parseInt(value);
        } else if (field === 'reward_amount') {
          value = parseFloat(value) || 0;
        } else if (value === '') {
          value = null;
        }
        values.push(value);
        newData[field] = value;
      } else {
        newData[field] = oldRecord[field];
      }
    });

    if (fields.length === 0) return true;

    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);

    db.prepare(`UPDATE referral_rewards SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    AuditLogService.logUpdate('referral_rewards', id, oldRecord, newData, data.userInfo);
    return true;
  },

  // 刪除轉介紹獎勵
  delete(id, userInfo = null) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;

    db.prepare('DELETE FROM referral_rewards WHERE id = ?').run(id);

    AuditLogService.logDelete('referral_rewards', id, oldRecord, userInfo);
    return true;
  }
};

module.exports = ReferralReward;
