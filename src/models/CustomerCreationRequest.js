const db = require('./db');
const Customer = require('./Customer');
const AuditLogService = require('../services/AuditLogService');

const CustomerCreationRequest = {
  // 建立新客戶/廠商送審申請（非管理員/專案管理員新增時呼叫）
  create(data) {
    if (!data.customer_code) throw new Error('客戶編號不能為空');
    if (!data.company_name) throw new Error('公司名稱不能為空');

    const result = db.prepare(`
      INSERT INTO customer_creation_requests (
        customer_code, tax_id, company_name, party_type, vendor_type,
        owner_salesperson_id, contact_name, contact_phone, contact_email,
        bank_name, bank_account, address, customer_level, industry, status,
        is_new_customer, requested_by, requested_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.requested_by_name || null
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
      SELECT r.*, u.name as owner_salesperson_name
      FROM customer_creation_requests r
      LEFT JOIN users u ON r.owner_salesperson_id = u.id
      WHERE r.request_status = 'pending'
      ORDER BY r.requested_at ASC
    `).all();
  },

  countPending() {
    return db.prepare(`SELECT COUNT(*) as count FROM customer_creation_requests WHERE request_status = 'pending'`).get().count;
  },

  // 核准：真正建立 customers 資料列
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

    db.prepare(`
      UPDATE customer_creation_requests
      SET request_status = 'approved', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now', 'localtime'), created_customer_id = ?
      WHERE id = ?
    `).run(reviewer.id, reviewer.name || reviewer.username, customerId, id);

    AuditLogService.logUpdate('customer_creation_requests', id, request, { request_status: 'approved', created_customer_id: customerId }, reviewer.name);
    return customerId;
  },

  // 駁回：不會建立客戶資料
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
