const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

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
    // 確保所有參數都有預設值，避免 undefined
    const projectId = data.project_id !== undefined && data.project_id !== null ? parseInt(data.project_id) : null;
    const invoiceDate = data.invoice_date || null;
    const invoiceNumber = data.invoice_number || null;
    const amountWithTax = data.amount_with_tax !== undefined && data.amount_with_tax !== null ? parseFloat(data.amount_with_tax) : 0;
    const expectedPaymentDate = data.expected_payment_date || null;
    
    const stmt = db.prepare(`
      INSERT INTO invoices (project_id, invoice_date, invoice_number, amount_with_tax, expected_payment_date)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      projectId,
      invoiceDate,
      invoiceNumber,
      amountWithTax,
      expectedPaymentDate
    );
    
    const invoiceId = result.lastInsertRowid;
    
    // 記錄修改
    AuditLogService.logCreate('invoices', invoiceId, data, data.userInfo);
    
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

  // 取得專案已開發票總額
  getTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(amount_with_tax), 0) as total
      FROM invoices WHERE project_id = ?
    `).get(projectId);
    return result.total;
  },

  // 取得月份發票統計
  getMonthlyStats(year, month) {
    return db.prepare(`
      SELECT 
        COUNT(*) as invoice_count,
        SUM(amount_with_tax) as total_amount
      FROM invoices
      WHERE strftime('%Y', invoice_date) = ? 
        AND strftime('%m', invoice_date) = ?
    `).get(String(year), String(month).padStart(2, '0'));
  }
};

module.exports = Invoice;
