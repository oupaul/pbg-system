const db = require('./db');
const ApprovalChain = require('./ApprovalChain');
const AuditLogService = require('../services/AuditLogService');

// 多層簽核：驗證審核者是否為目前關卡指定的角色，並回傳關卡資訊。
// steps 為空陣列時代表沒有設定多層簽核（回傳 null），呼叫端應退回原本的單層審核判斷。
// 比照 CustomerCreationRequest.js / DeletionRequest.js 完全相同的邏輯。
function checkApprovalStep(request, reviewer) {
  const steps = ApprovalChain.getSteps('invoice_request');
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

// 營業稅率：沿用專案表單試算金額用的同一份系統設定（預設台灣 5%）
function getTaxRate() {
  const SettingsRoutes = require('../routes/settings');
  return SettingsRoutes.getSystemSetting('tax_rate', 5);
}

// 明細金額一律由伺服器端重算，不信任前端送來的單價/金額欄位
function buildItems(rawItems) {
  const items = (rawItems || [])
    .map((item, idx) => {
      const itemName = (item.item_name || '').toString().trim();
      const quantity = parseFloat(item.quantity);
      const unitPrice = parseFloat(item.unit_price);
      return {
        item_order: idx + 1,
        item_name: itemName,
        quantity: isNaN(quantity) ? 0 : quantity,
        unit: item.unit || null,
        unit_price: isNaN(unitPrice) ? 0 : unitPrice,
        notes: item.notes || null
      };
    })
    .filter(item => item.item_name);

  if (items.length === 0) {
    throw new Error('至少需要一筆明細品項');
  }

  items.forEach(item => {
    item.amount = Math.round(item.quantity * item.unit_price * 100) / 100;
  });

  return items;
}

const InvoiceRequest = {
  // 建立發票開立申請（含逐項明細），金額由後端依明細加總計算
  create(data) {
    if (!data.project_id) throw new Error('專案為必填欄位');
    if (!data.requested_by) throw new Error('缺少申請人資訊');

    const items = buildItems(data.items);
    const subtotalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const taxRate = getTaxRate();
    const taxAmount = Math.round(subtotalAmount * taxRate) / 100;
    const totalAmount = Math.round((subtotalAmount + taxAmount) * 100) / 100;

    const insertRequest = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO invoice_requests (
          project_id, request_type, quote_number, recipient_name, recipient_address, recipient_phone,
          subtotal_amount, tax_amount, total_amount, notes, requested_by, requested_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        parseInt(data.project_id),
        data.request_type || null,
        data.quote_number || null,
        data.recipient_name || null,
        data.recipient_address || null,
        data.recipient_phone || null,
        subtotalAmount,
        taxAmount,
        totalAmount,
        data.notes || null,
        data.requested_by,
        data.requested_by_name || null
      );

      const requestId = result.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO invoice_request_items (invoice_request_id, item_order, item_name, quantity, unit, unit_price, amount, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach(item => {
        insertItem.run(requestId, item.item_order, item.item_name, item.quantity, item.unit, item.unit_price, item.amount, item.notes);
      });

      return requestId;
    });

    const id = insertRequest();
    AuditLogService.logCreate('invoice_requests', id, { ...data, items }, data.requested_by_name);
    return id;
  },

  findById(id) {
    const request = db.prepare(`
      SELECT r.*, p.project_code, p.project_name, p.customer_code, p.company_name, p.tax_id
      FROM invoice_requests r
      LEFT JOIN v_project_summary p ON r.project_id = p.id
      WHERE r.id = ?
    `).get(id);
    if (!request) return null;
    request.items = db.prepare(`
      SELECT * FROM invoice_request_items WHERE invoice_request_id = ? ORDER BY item_order ASC
    `).all(id);
    return request;
  },

  // 待審核清單（給審核頁面用）
  findPending() {
    return db.prepare(`
      SELECT r.*, p.project_code, p.project_name, p.customer_code, p.company_name
      FROM invoice_requests r
      LEFT JOIN v_project_summary p ON r.project_id = p.id
      WHERE r.request_status = 'pending'
      ORDER BY r.requested_at ASC
    `).all();
  },

  countPending() {
    return db.prepare(`SELECT COUNT(*) as count FROM invoice_requests WHERE request_status = 'pending'`).get().count;
  },

  // 核准：若有設定多層簽核且尚未到最後一關，只推進到下一關（維持 pending）；
  // 沒有設定多層簽核，或已經是最後一關，才把申請標記為 approved——刻意不會
  // 自動建立 invoices 紀錄，財務仍照現有「新增發票」流程手動輸入真正的發票號碼/日期
  approve(id, reviewer) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此申請');
    if (request.request_status !== 'pending') throw new Error('此申請已被處理過');

    const stepResult = checkApprovalStep(request, reviewer);
    if (stepResult && !stepResult.isLastStep) {
      db.prepare(`UPDATE invoice_requests SET current_step = ? WHERE id = ?`).run(stepResult.nextStep, id);
      AuditLogService.logUpdate('invoice_requests', id,
        { current_step: request.current_step || 1 },
        { current_step: stepResult.nextStep },
        reviewer.name || reviewer.username);
      return { advanced: true, nextStep: stepResult.nextStep, nextStepConfig: stepResult.nextStepConfig };
    }

    db.prepare(`
      UPDATE invoice_requests
      SET request_status = 'approved', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, id);

    AuditLogService.logUpdate('invoice_requests', id, request, { request_status: 'approved' }, reviewer.name);
    return { approved: true };
  },

  // 駁回：多層簽核時，任一關卡的審核者都可以直接駁回整份申請（不需要等其他關卡）
  reject(id, reviewer, reviewNote) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此申請');
    if (request.request_status !== 'pending') throw new Error('此申請已被處理過');

    checkApprovalStep(request, reviewer);

    db.prepare(`
      UPDATE invoice_requests
      SET request_status = 'rejected', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime'), review_note = ?
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, reviewNote || null, id);

    AuditLogService.logUpdate('invoice_requests', id, request, { request_status: 'rejected' }, reviewer.name);
    return true;
  }
};

module.exports = InvoiceRequest;
