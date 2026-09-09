const db = require('./db');

const ApprovalChain = {
  // 取得某種申請類型目前啟用中的簽核關卡，依關卡順序排序。
  // 空陣列代表沒有設定多層簽核，呼叫端應該退回原本的單層審核行為
  // （走 roles.can_approve_customer / roles.can_delete 旗標）。
  getSteps(approvalType) {
    return db.prepare(`
      SELECT * FROM approval_chain_steps
      WHERE approval_type = ? AND is_active = 1
      ORDER BY step_order ASC
    `).all(approvalType);
  },

  // 取得某種申請類型「含停用」的完整關卡清單（管理頁用）
  getAllSteps(approvalType) {
    return db.prepare(`
      SELECT * FROM approval_chain_steps
      WHERE approval_type = ?
      ORDER BY step_order ASC
    `).all(approvalType);
  }
};

module.exports = ApprovalChain;
