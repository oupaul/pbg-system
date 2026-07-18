const db = require('./db');
const Customer = require('./Customer');
const Pipeline = require('./Pipeline');
const AuditLogService = require('../services/AuditLogService');

// 是否綁定了銷售機會（新增銷售機會時使用「快速新增客戶/廠商」且非管理員/專案管理員送審）
function hasBundledPipeline(request) {
  return !!(request && request.pipeline_opportunity_name);
}

const CustomerCreationRequest = {
  // 建立新客戶/廠商送審申請（非管理員/專案管理員新增時呼叫）。
  // 若同時帶有 pipeline_opportunity_name 等欄位，代表這筆申請也綁定了一筆待建立的銷售機會，
  // 核准客戶的同時會一併建立該銷售機會（見 approve()）。
  create(data) {
    if (!data.customer_code) throw new Error('客戶編號不能為空');
    if (!data.company_name) throw new Error('公司名稱不能為空');

    const result = db.prepare(`
      INSERT INTO customer_creation_requests (
        customer_code, tax_id, company_name, party_type, vendor_type,
        owner_salesperson_id, contact_name, contact_phone, contact_email,
        bank_name, bank_account, address, customer_level, industry, status,
        is_new_customer, requested_by, requested_by_name,
        pipeline_opportunity_name, pipeline_project_type, pipeline_estimated_amount,
        pipeline_win_probability, pipeline_expected_close_year_month,
        pipeline_salesperson_id, pipeline_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.customer_code,
      data.tax_id || null,
      data.company_name,
      data.party_type || '客戶',
      data.vendor_type || null,
      data.owner_salesperson_id || null,
      data.contact_name || null,
      data.contact_phone || null,
      data.contact_email || null,
      data.bank_name || null,
      data.bank_account || null,
      data.address || null,
      data.customer_level || null,
      data.industry || null,
      data.status || '往來中',
      data.is_new_customer ? 1 : 0,
      data.requested_by,
      data.requested_by_name || null,
      data.pipeline_opportunity_name || null,
      data.pipeline_project_type || null,
      data.pipeline_estimated_amount !== undefined && data.pipeline_estimated_amount !== null && data.pipeline_estimated_amount !== ''
        ? parseFloat(data.pipeline_estimated_amount) : null,
      data.pipeline_win_probability !== undefined && data.pipeline_win_probability !== null && data.pipeline_win_probability !== ''
        ? parseInt(data.pipeline_win_probability) : null,
      data.pipeline_expected_close_year_month || null,
      data.pipeline_salesperson_id || null,
      data.pipeline_notes || null
    );

    const id = result.lastInsertRowid;
    AuditLogService.logCreate('customer_creation_requests', id, data, data.requested_by_name);
    return id;
  },

  findById(id) {
    return db.prepare(`SELECT * FROM customer_creation_requests WHERE id = ?`).get(id);
  },

  // 待審核清單（給管理員審核頁面用）
  findPending() {
    return db.prepare(`
      SELECT r.*, u.name as owner_salesperson_name, sp.name as pipeline_salesperson_name
      FROM customer_creation_requests r
      LEFT JOIN users u ON r.owner_salesperson_id = u.id
      LEFT JOIN salespeople sp ON r.pipeline_salesperson_id = sp.id
      WHERE r.request_status = 'pending'
      ORDER BY r.requested_at ASC
    `).all();
  },

  countPending() {
    return db.prepare(`SELECT COUNT(*) as count FROM customer_creation_requests WHERE request_status = 'pending'`).get().count;
  },

  // 核准前編輯：同仁填寫有誤時，管理員可先修正申請內容（客戶欄位與綁定的銷售機會欄位）再核准
  update(id, data) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此申請');
    if (request.request_status !== 'pending') throw new Error('此申請已被處理過，無法編輯');

    const fields = [];
    const values = [];
    const setField = (col, val) => { fields.push(`${col} = ?`); values.push(val); };

    const STRING_FIELDS = [
      'customer_code', 'tax_id', 'company_name', 'party_type', 'vendor_type',
      'contact_name', 'contact_phone', 'contact_email', 'bank_name', 'bank_account',
      'address', 'customer_level', 'industry', 'status',
      'pipeline_opportunity_name', 'pipeline_project_type', 'pipeline_expected_close_year_month', 'pipeline_notes'
    ];
    STRING_FIELDS.forEach(key => {
      if (data[key] !== undefined) setField(key, data[key] || null);
    });

    if (data.owner_salesperson_id !== undefined) setField('owner_salesperson_id', data.owner_salesperson_id || null);
    if (data.pipeline_salesperson_id !== undefined) setField('pipeline_salesperson_id', data.pipeline_salesperson_id || null);
    if (data.is_new_customer !== undefined) setField('is_new_customer', data.is_new_customer ? 1 : 0);
    if (data.pipeline_estimated_amount !== undefined) {
      setField('pipeline_estimated_amount', data.pipeline_estimated_amount !== '' && data.pipeline_estimated_amount !== null ? parseFloat(data.pipeline_estimated_amount) : null);
    }
    if (data.pipeline_win_probability !== undefined) {
      setField('pipeline_win_probability', data.pipeline_win_probability !== '' && data.pipeline_win_probability !== null ? parseInt(data.pipeline_win_probability) : null);
    }

    if (fields.length === 0) return false;

    values.push(id);
    db.prepare(`UPDATE customer_creation_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    AuditLogService.logUpdate('customer_creation_requests', id, request, data, data.editedByName);
    return true;
  },

  // 核准：真正建立 customers 資料列；若申請有綁定銷售機會，一併建立該銷售機會
  approve(id, reviewer) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此申請');
    if (request.request_status !== 'pending') throw new Error('此申請已被處理過');

    const customerId = Customer.create({
      customer_code: request.customer_code,
      tax_id: request.tax_id,
      company_name: request.company_name,
      party_type: request.party_type,
      vendor_type: request.vendor_type,
      owner_salesperson_id: request.owner_salesperson_id,
      contact_name: request.contact_name,
      contact_phone: request.contact_phone,
      contact_email: request.contact_email,
      bank_name: request.bank_name,
      bank_account: request.bank_account,
      address: request.address,
      customer_level: request.customer_level,
      industry: request.industry,
      status: request.status,
      is_new_customer: !!request.is_new_customer,
      userInfo: reviewer.name || reviewer.username
    });

    let pipelineId = null;
    if (hasBundledPipeline(request)) {
      pipelineId = Pipeline.create({
        customer_id: customerId,
        salesperson_id: request.pipeline_salesperson_id,
        owner_user_id: request.requested_by,
        opportunity_name: request.pipeline_opportunity_name,
        project_type: request.pipeline_project_type,
        estimated_amount: request.pipeline_estimated_amount,
        win_probability: request.pipeline_win_probability,
        expected_close_year_month: request.pipeline_expected_close_year_month,
        notes: request.pipeline_notes,
        userInfo: reviewer.name || reviewer.username
      });
    }

    db.prepare(`
      UPDATE customer_creation_requests
      SET request_status = 'approved', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime'),
          created_customer_id = ?, created_pipeline_id = ?
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, customerId, pipelineId, id);

    AuditLogService.logUpdate('customer_creation_requests', id, request, { request_status: 'approved', created_customer_id: customerId, created_pipeline_id: pipelineId }, reviewer.name);
    return { customerId, pipelineId };
  },

  // 駁回：不會建立客戶資料，綁定的銷售機會也一併作廢
  reject(id, reviewer, reviewNote) {
    const request = this.findById(id);
    if (!request) throw new Error('找不到此申請');
    if (request.request_status !== 'pending') throw new Error('此申請已被處理過');

    db.prepare(`
      UPDATE customer_creation_requests
      SET request_status = 'rejected', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime'), review_note = ?
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, reviewNote || null, id);

    AuditLogService.logUpdate('customer_creation_requests', id, request, { request_status: 'rejected' }, reviewer.name);
    return true;
  }
};

module.exports = CustomerCreationRequest;
module.exports.hasBundledPipeline = hasBundledPipeline;
