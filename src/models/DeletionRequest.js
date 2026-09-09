const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const Pipeline = require('./Pipeline');
const Activity = require('./Activity');
const Customer = require('./Customer');
const ApprovalChain = require('./ApprovalChain');

// 多層簽核：驗證審核者是否為目前關卡指定的角色，並回傳關卡資訊。
// steps 為空陣列時代表沒有設定多層簽核（回傳 null），呼叫端應退回原本的單層審核判斷。
function checkApprovalStep(request, reviewer) {
  const steps = ApprovalChain.getSteps('deletion');
  if (steps.length === 0) return null;

  const currentStep = request.current_step || 1;
  const stepConfig = steps.find(s => s.step_order === currentStep);
  if (!stepConfig) {
    throw new Error('簽核關卡設定異常，請聯絡系統管理員確認「簽核關卡設定」');
  }
  if (reviewer.role !== stepConfig.role_key) {
    throw new Error(`此關卡（${stepConfig.step_name || stepConfig.role_key}）僅限對應角色審核`);
  }

  const maxOrder = Math.max(...steps.map(s => s.step_order));
  const nextStepConfig = steps.find(s => s.step_order > currentStep);
  return {
    isLastStep: currentStep >= maxOrder || !nextStepConfig,
    nextStep: nextStepConfig ? nextStepConfig.step_order : null,
    nextStepConfig
  };
}

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

  // 核准：若有設定多層簽核且尚未到最後一關，只推進到下一關（維持 pending，不執行刪除）；
  // 沒有設定多層簽核，或已經是最後一關，才真正執行軟刪除
  approve(id, reviewer) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此刪除申請');
    if (request.status !== 'pending') throw new Error('此申請已被處理過');

    const stepResult = checkApprovalStep(request, reviewer);
    if (stepResult && !stepResult.isLastStep) {
      db.prepare(`UPDATE deletion_requests SET current_step = ? WHERE id = ?`).run(stepResult.nextStep, id);
      AuditLogService.logUpdate('deletion_requests', id,
        { current_step: request.current_step || 1 },
        { current_step: stepResult.nextStep },
        reviewer.name || reviewer.username);
      return { advanced: true, nextStep: stepResult.nextStep, nextStepConfig: stepResult.nextStepConfig };
    }

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

  // 駁回：資料維持不變，僅標記申請狀態。多層簽核時，任一關卡的審核者都可以
  // 直接駁回整份申請（不需要等其他關卡）
  reject(id, reviewer, reviewNote) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此刪除申請');
    if (request.status !== 'pending') throw new Error('此申請已被處理過');

    checkApprovalStep(request, reviewer);

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
