const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const { getVisibleSalespersonIds } = require('../utils/projectScope');

// 轉介紹獎勵的可見範圍（依使用者的專案檢視範圍）。獎勵金額屬於財務資料，不能讓範圍外的人看到：
//   - 專案檢視範圍為「全部」：不限制
//   - 其他（自己／指派／無）只看得到：
//       1. 自己是領取人（staff 且 recipient_user_id 是自己）的獎勵
//       2. 有關聯專案時：該專案在自己的範圍內
//       3. 沒有關聯專案時：介紹人（客戶）的客戶關係負責人是自己
//     有關聯專案但專案不在範圍內的獎勵，即使客戶是自己負責的也不顯示（避免透過獎勵看到範圍外專案的資訊）
// 使用者參數必須傳入：沒有傳（null）視為「沒有任何權限」而不是不限制，避免呼叫端漏傳造成洩漏。
// SQL 片段需要別名 r（referral_rewards）與 p（projects，LEFT JOIN）。
// 因「領取人是自己」而看得到、但關聯專案在範圍外的獎勵，專案編號與名稱會被遮蔽（見 maskOutOfScopeProject）。
function scopeClause(user) {
  const ids = getVisibleSalespersonIds(user);
  if (ids === null) return { sql: '', params: [] };
  const userId = user && user.id ? user.id : -1;
  const projectPart = ids.length
    ? `(r.project_id IS NOT NULL AND p.salesperson_id IN (${ids.map(() => '?').join(',')}))`
    : '0';
  return {
    sql: ` AND (r.recipient_user_id = ? OR ${projectPart} OR (r.project_id IS NULL AND (SELECT c2.owner_salesperson_id FROM customers c2 WHERE c2.id = r.referring_customer_id) = ?))`,
    params: [userId, ...ids, userId]
  };
}

// 關聯專案不在使用者範圍內的列（只可能是「領取人是自己」而可見的獎勵）：遮蔽專案編號與名稱，不洩漏範圍外專案的資訊
function maskOutOfScopeProject(rows, user) {
  const ids = getVisibleSalespersonIds(user);
  if (ids === null) return rows;
  return rows.map(r => {
    if (r.project_id && !ids.includes(r.project_salesperson_id)) {
      return { ...r, project_code: null, project_name: null };
    }
    return r;
  });
}

const ReferralReward = {
  // 取得某客戶身為介紹人的所有轉介紹紀錄
  findByCustomer(customerId, user) {
    const scope = scopeClause(user);
    const rows = db.prepare(`
      SELECT r.*,
        referred.company_name AS referred_customer_name,
        p.project_code, p.project_name, p.salesperson_id AS project_salesperson_id,
        u.name AS recipient_user_name
      FROM referral_rewards r
      LEFT JOIN customers referred ON referred.id = r.referred_customer_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.recipient_user_id
      WHERE r.referring_customer_id = ?${scope.sql}
      ORDER BY r.created_at DESC
    `).all(customerId, ...scope.params);
    return maskOutOfScopeProject(rows, user);
  },

  // 依ID取得
  findById(id) {
    return db.prepare(`SELECT * FROM referral_rewards WHERE id = ?`).get(id);
  },

  // 取得所有轉介紹獎勵（總覽頁用，可依狀態篩選）
  findAll(filters = {}, user) {
    const scope = scopeClause(user);
    const statusCond = filters.status ? ' AND r.status = ?' : '';
    const statusParams = filters.status ? [filters.status] : [];
    const rows = db.prepare(`
      SELECT r.*,
        referring.company_name AS referring_customer_name,
        referred.company_name AS referred_customer_name,
        p.project_code, p.project_name, p.salesperson_id AS project_salesperson_id,
        u.name AS recipient_user_name
      FROM referral_rewards r
      JOIN customers referring ON referring.id = r.referring_customer_id
      LEFT JOIN customers referred ON referred.id = r.referred_customer_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.recipient_user_id
      WHERE 1=1${statusCond}${scope.sql}
      ORDER BY r.created_at DESC
    `).all(...statusParams, ...scope.params);
    return maskOutOfScopeProject(rows, user);
  },

  // 這筆獎勵對該使用者是否可見（修改/刪除前用來檢查範圍）
  isVisibleTo(id, user) {
    const scope = scopeClause(user);
    const row = db.prepare(`
      SELECT r.id FROM referral_rewards r
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?${scope.sql}
    `).get(id, ...scope.params);
    return !!row;
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
