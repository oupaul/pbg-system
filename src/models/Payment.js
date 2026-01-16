const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Payment = {
  // 取得專案的所有收款
  findByProject(projectId) {
    return db.prepare(`
      SELECT p.*, i.invoice_number
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.project_id = ?
      ORDER BY p.payment_date
    `).all(projectId);
  },

  // 依ID取得收款
  findById(id) {
    return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id);
  },

  // 新增收款
  create(data) {
    // 確保所有參數都有預設值，避免 undefined
    const projectId = data.project_id !== undefined && data.project_id !== null ? parseInt(data.project_id) : null;
    const invoiceId = data.invoice_id !== undefined && data.invoice_id !== null ? parseInt(data.invoice_id) : null;
    const paymentDate = data.payment_date || null;
    const bankDepositAmount = data.bank_deposit_amount !== undefined && data.bank_deposit_amount !== null ? parseFloat(data.bank_deposit_amount) : 0;
    const paymentDifference = data.payment_difference !== undefined && data.payment_difference !== null ? parseFloat(data.payment_difference) : 0;
    const differenceType = data.difference_type || null;
    const notes = data.notes || null;
    
    const stmt = db.prepare(`
      INSERT INTO payments (
        project_id, invoice_id, payment_date, bank_deposit_amount, 
        payment_difference, difference_type, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      projectId,
      invoiceId,
      paymentDate,
      bankDepositAmount,
      paymentDifference,
      differenceType,
      notes
    );
    
    const paymentId = result.lastInsertRowid;
    
    // 記錄修改
    AuditLogService.logCreate('payments', paymentId, data, data.userInfo);
    
    return paymentId;
  },

  // 更新收款
  update(id, data) {
    // 取得舊值
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    
    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};
    
    const allowedFields = ['invoice_id', 'payment_date', 'bank_deposit_amount', 'payment_difference', 'difference_type', 'notes'];
    
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
        newData[field] = data[field];
      } else {
        newData[field] = oldRecord[field];
      }
    });
    
    // 如果沒有要更新的欄位，直接返回
    if (fields.length === 0) return false;
    
    // 添加 updated_at
    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);
    
    const sql = `UPDATE payments SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 無論 result.changes 是否大於 0，都記錄修改（因為 updated_at 總是會更新）
    if (result.changes >= 0) {
      // 記錄修改
      AuditLogService.logUpdate('payments', id, oldRecord, newData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 刪除收款
  delete(id, userInfo = null) {
    // 取得舊值
    const oldRecord = this.findById(id);
    
    const result = db.prepare(`DELETE FROM payments WHERE id = ?`).run(id);
    
    if (result.changes > 0 && oldRecord) {
      // 記錄刪除
      AuditLogService.logDelete('payments', id, oldRecord, userInfo);
    }
    
    return result.changes > 0;
  },

  // 計算單筆收款記錄的實際收款金額（考慮匯費差異）
  calculateActualReceived(payment) {
    if (!payment) return 0;
    const bankAmount = payment.bank_deposit_amount || 0;
    const difference = payment.payment_difference || 0;
    // 如果差異類型是「匯費」，則實際收款 = 銀行匯入金額 + 差異金額
    if (payment.difference_type === '匯費') {
      return bankAmount + difference;
    }
    // 否則只計算銀行匯入金額
    return bankAmount;
  },

  // 取得專案收款總額
  getTotalByProject(projectId) {
    const payments = this.findByProject(projectId);
    const totalReceived = payments.reduce((sum, p) => {
      return sum + this.calculateActualReceived(p);
    }, 0);
    return {
      total_received: totalReceived,
      total_difference: payments.reduce((sum, p) => sum + (p.payment_difference || 0), 0)
    };
  }
};

module.exports = Payment;
