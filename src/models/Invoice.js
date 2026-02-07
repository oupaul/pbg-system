const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

// 有效發票條件：用於 total_invoiced 等計算
const VALID_STATUS_CONDITION = `(status IS NULL OR status = '有效')`;

const Invoice = {
  // 取得專案的所有發票
  findByProject(projectId) {
    return db.prepare(`
      SELECT * FROM invoices WHERE project_id = ? ORDER BY invoice_date
    `).all(projectId);
  },

  // 依ID取得發票
  findById(id) {
    return db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id);
  },

  // 根據發票號碼和專案ID查找發票
  findByNumberAndProject(invoiceNumber, projectId) {
    if (!invoiceNumber) return null;
    return db.prepare(`SELECT * FROM invoices WHERE invoice_number = ? AND project_id = ?`).get(invoiceNumber, projectId);
  },

  // 新增發票
  create(data) {
    const projectId = data.project_id !== undefined && data.project_id !== null ? parseInt(data.project_id) : null;
    const invoiceDate = data.invoice_date || null;
    const invoiceNumber = data.invoice_number || null;
    const amountWithTax = data.amount_with_tax !== undefined && data.amount_with_tax !== null ? parseFloat(data.amount_with_tax) : 0;
    const expectedPaymentDate = data.expected_payment_date || null;
    const status = data.status || '有效';
    const originalInvoiceId = data.original_invoice_id || null;
    
    const stmt = db.prepare(`
      INSERT INTO invoices (project_id, invoice_date, invoice_number, amount_with_tax, expected_payment_date, status, original_invoice_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      projectId,
      invoiceDate,
      invoiceNumber,
      amountWithTax,
      expectedPaymentDate,
      status,
      originalInvoiceId
    );
    
    const invoiceId = result.lastInsertRowid;
    const insertedData = { ...data, status, original_invoice_id: originalInvoiceId };
    
    // 記錄修改
    AuditLogService.logCreate('invoices', invoiceId, insertedData, data.userInfo);
    
    return invoiceId;
  },

  // 更新發票
  update(id, data) {
    // 取得舊值
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    
    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};
    
    // 只更新有提供的欄位
    if (data.invoice_date !== undefined) {
      fields.push('invoice_date = ?');
      values.push(data.invoice_date);
      newData.invoice_date = data.invoice_date;
    } else {
      newData.invoice_date = oldRecord.invoice_date;
    }
    
    if (data.invoice_number !== undefined) {
      fields.push('invoice_number = ?');
      values.push(data.invoice_number);
      newData.invoice_number = data.invoice_number;
    } else {
      newData.invoice_number = oldRecord.invoice_number;
    }
    
    if (data.amount_with_tax !== undefined) {
      fields.push('amount_with_tax = ?');
      values.push(data.amount_with_tax);
      newData.amount_with_tax = data.amount_with_tax;
    } else {
      newData.amount_with_tax = oldRecord.amount_with_tax;
    }
    
    if (data.expected_payment_date !== undefined) {
      fields.push('expected_payment_date = ?');
      values.push(data.expected_payment_date || null);
      newData.expected_payment_date = data.expected_payment_date || null;
    } else {
      newData.expected_payment_date = oldRecord.expected_payment_date;
    }
    
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
      newData.status = data.status;
    } else {
      newData.status = oldRecord.status;
    }
    if (data.voided_at !== undefined) {
      fields.push('voided_at = ?');
      values.push(data.voided_at || null);
      newData.voided_at = data.voided_at || null;
    } else {
      newData.voided_at = oldRecord.voided_at;
    }
    if (data.void_reason !== undefined) {
      fields.push('void_reason = ?');
      values.push(data.void_reason || null);
      newData.void_reason = data.void_reason || null;
    } else {
      newData.void_reason = oldRecord.void_reason;
    }
    if (data.replacement_invoice_id !== undefined) {
      fields.push('replacement_invoice_id = ?');
      values.push(data.replacement_invoice_id || null);
      newData.replacement_invoice_id = data.replacement_invoice_id || null;
    } else {
      newData.replacement_invoice_id = oldRecord.replacement_invoice_id;
    }
    if (data.original_invoice_id !== undefined) {
      fields.push('original_invoice_id = ?');
      values.push(data.original_invoice_id || null);
      newData.original_invoice_id = data.original_invoice_id || null;
    } else {
      newData.original_invoice_id = oldRecord.original_invoice_id;
    }
    
    // 如果沒有要更新的欄位，直接返回
    if (fields.length === 0) return false;
    
    // 添加 updated_at
    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);
    
    const sql = `UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 無論 result.changes 是否大於 0，都記錄修改（因為 updated_at 總是會更新）
    if (result.changes >= 0) {
      // 記錄修改
      AuditLogService.logUpdate('invoices', id, oldRecord, newData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 刪除發票
  delete(id, userInfo = null) {
    // 取得舊值
    const oldRecord = this.findById(id);
    
    const result = db.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
    
    if (result.changes > 0 && oldRecord) {
      // 記錄刪除
      AuditLogService.logDelete('invoices', id, oldRecord, userInfo);
    }
    
    return result.changes > 0;
  },

  // 取得專案已開發票總額（僅計有效發票）
  getTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(amount_with_tax), 0) as total
      FROM invoices WHERE project_id = ? AND ${VALID_STATUS_CONDITION}
    `).get(projectId);
    return result.total;
  },

  // 取得專案有效發票列表（用於收款對應等）
  findValidByProject(projectId) {
    return db.prepare(`
      SELECT * FROM invoices WHERE project_id = ? AND ${VALID_STATUS_CONDITION} ORDER BY invoice_date
    `).all(projectId);
  },

  // 取得月份發票統計（僅計有效發票）
  getMonthlyStats(year, month) {
    return db.prepare(`
      SELECT 
        COUNT(*) as invoice_count,
        SUM(amount_with_tax) as total_amount
      FROM invoices
      WHERE strftime('%Y', invoice_date) = ? 
        AND strftime('%m', invoice_date) = ?
        AND ${VALID_STATUS_CONDITION}
    `).get(String(year), String(month).padStart(2, '0'));
  },

  // 作廢發票
  void(id, { voided_at, void_reason } = {}, userInfo = null) {
    const old = this.findById(id);
    if (!old) return null;
    if (old.status === '作廢' || old.status === '整筆折讓') {
      throw new Error(`發票已是「${old.status}」狀態，無法重複操作`);
    }
    this.update(id, {
      status: '作廢',
      voided_at: voided_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
      void_reason: void_reason || null,
      expected_payment_date: null, // 作廢後不再期待收款，清除預計收款日
      userInfo
    });
    return this.findById(id);
  },

  // 作廢並重開：將原發票作廢，建立新發票並建立關聯
  voidAndReissue(originalId, newInvoiceData, { void_reason } = {}, userInfo = null) {
    const original = this.findById(originalId);
    if (!original) return null;
    if (original.status === '作廢' || original.status === '整筆折讓') {
      throw new Error(`發票已是「${original.status}」狀態，無法重複操作`);
    }
    const voidedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    this.update(originalId, {
      status: '作廢',
      voided_at: voidedAt,
      void_reason: void_reason || null,
      expected_payment_date: null, // 作廢後不再期待收款，清除預計收款日
      userInfo
    });
    const newId = this.create({
      project_id: original.project_id,
      invoice_date: newInvoiceData.invoice_date || null,
      invoice_number: newInvoiceData.invoice_number || null,
      amount_with_tax: newInvoiceData.amount_with_tax !== undefined ? parseFloat(newInvoiceData.amount_with_tax) : original.amount_with_tax,
      expected_payment_date: newInvoiceData.expected_payment_date || original.expected_payment_date || null,
      original_invoice_id: originalId,
      userInfo
    });
    this.update(originalId, {
      replacement_invoice_id: newId,
      userInfo
    });
    return { original: this.findById(originalId), replacement: this.findById(newId) };
  },

  // 整筆折讓
  setAllowance(id, { voided_at, void_reason } = {}, userInfo = null) {
    const old = this.findById(id);
    if (!old) return null;
    if (old.status === '作廢' || old.status === '整筆折讓') {
      throw new Error(`發票已是「${old.status}」狀態，無法重複操作`);
    }
    this.update(id, {
      status: '整筆折讓',
      voided_at: voided_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
      void_reason: void_reason || null,
      expected_payment_date: null, // 整筆折讓後不再期待收款，清除預計收款日
      userInfo
    });
    return this.findById(id);
  },

  // 判斷是否為有效發票（供外部使用）
  isValid(invoice) {
    if (!invoice) return false;
    const s = invoice.status;
    return s == null || s === '' || s === '有效';
  }
};

module.exports = Invoice;
