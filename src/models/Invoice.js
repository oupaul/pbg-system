const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

// 有效發票條件：用於 total_invoiced 等計算
const VALID_STATUS_CONDITION = `(status IS NULL OR status = '有效')`;

/**
 * 若專案已全額開票（未開票金額 <= 0），自動清空 expected_invoice_year_month。
 * 在發票新增或更新後呼叫，讓資料保持乾淨，避免通知殘留。
 */
function clearExpectedInvoiceIfFullyInvoiced(projectId) {
  try {
    const row = db.prepare(`
      SELECT
        p.price_with_tax,
        p.expected_invoice_year_month,
        COALESCE(SUM(i.amount_with_tax - COALESCE(i.allowance_amount, 0)), 0) AS total_invoiced
      FROM projects p
      LEFT JOIN invoices i
        ON i.project_id = p.id
        AND (i.status IS NULL OR i.status = '有效')
        AND i.deleted_at IS NULL
      WHERE p.id = ?
      GROUP BY p.id
    `).get(projectId);

    if (!row || !row.expected_invoice_year_month) return; // 本來就沒設定，不需處理

    const uninvoiced = row.price_with_tax - row.total_invoiced;
    if (uninvoiced <= 0.01) { // 容許 0.01 元浮點誤差
      db.prepare(`
        UPDATE projects
        SET expected_invoice_year_month = NULL,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(projectId);
    }
  } catch (err) {
    // 非關鍵操作，失敗不影響主流程
    console.warn('[Invoice] clearExpectedInvoiceIfFullyInvoiced 失敗:', err.message);
  }
}

const Invoice = {
  // 取得專案的所有發票（預設不含軟刪除；傳入 { includeDeleted: true } 則含已刪除）
  findByProject(projectId, opts = {}) {
    const includeDeleted = opts.includeDeleted === true;
    const deletedCond = includeDeleted ? '' : ' AND (deleted_at IS NULL)';
    return db.prepare(`
      SELECT * FROM invoices WHERE project_id = ? ${deletedCond} ORDER BY deleted_at IS NOT NULL, invoice_date
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

    // 超額開票防護（僅在非作廢重開的一般新增時驗證）
    if (projectId && !data._skipOverInvoiceCheck) {
      const project = db.prepare('SELECT price_with_tax FROM projects WHERE id = ?').get(projectId);
      if (project) {
        const currentTotal = this.getTotalByProject(projectId);
        if (currentTotal + amountWithTax > project.price_with_tax + 0.01) {
          const over = Math.round(currentTotal + amountWithTax - project.price_with_tax);
          throw new Error(
            `發票金額超出合約！` +
            `已開票 $${Math.round(currentTotal).toLocaleString()}，` +
            `本次新增 $${Math.round(amountWithTax).toLocaleString()}，` +
            `超出合約 $${Math.abs(over).toLocaleString()} 元`
          );
        }
      }
    }

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

    // 全額開票後自動清空預計開票月份
    if (projectId) clearExpectedInvoiceIfFullyInvoiced(projectId);

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
    if (data.allowance_amount !== undefined) {
      const val = data.allowance_amount === null || data.allowance_amount === '' ? null : parseFloat(data.allowance_amount);
      fields.push('allowance_amount = ?');
      values.push(val);
      newData.allowance_amount = val;
    } else {
      newData.allowance_amount = oldRecord.allowance_amount;
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
      AuditLogService.logUpdate('invoices', id, oldRecord, newData, data.userInfo);
    }

    // 全額開票後自動清空預計開票月份
    if (oldRecord.project_id) clearExpectedInvoiceIfFullyInvoiced(oldRecord.project_id);

    return result.changes > 0;
  },

  // 軟刪除發票（設定 deleted_at，不實際刪除）
  delete(id, userInfo = null) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    if (oldRecord.deleted_at) return true; // 已刪除視為成功

    const deletedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE invoices SET deleted_at = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(deletedAt, id);
    AuditLogService.logDelete('invoices', id, oldRecord, userInfo);
    return true;
  },

  // 還原軟刪除的發票
  restore(id, userInfo = null) {
    const record = this.findById(id);
    if (!record || !record.deleted_at) return false;
    db.prepare('UPDATE invoices SET deleted_at = NULL, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(id);
    AuditLogService.logUpdate('invoices', id, record, { deleted_at: null }, userInfo);
    return true;
  },

  // 取得專案已開發票總額（僅計有效且未刪除發票；部分折讓以認列金額計）
  getTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(amount_with_tax - COALESCE(allowance_amount, 0)), 0) as total
      FROM invoices WHERE project_id = ? AND ${VALID_STATUS_CONDITION} AND (deleted_at IS NULL)
    `).get(projectId);
    return result ? result.total : 0;
  },

  // 取得專案有效發票列表（用於收款對應等，不含已刪除）
  findValidByProject(projectId) {
    return db.prepare(`
      SELECT * FROM invoices WHERE project_id = ? AND ${VALID_STATUS_CONDITION} AND (deleted_at IS NULL) ORDER BY invoice_date
    `).all(projectId);
  },

  // 取得專案發票含收款摘要（優先使用 v_invoice_summary 視圖）
  // 每筆發票附帶 recognized_amount（認列金額）、total_received（已收款合計）、unpaid_amount（未收金額）
  findByProjectWithPayments(projectId, opts = {}) {
    const includeDeleted = opts.includeDeleted === true;
    try {
      const viewExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='view' AND name='v_invoice_summary'"
      ).get();
      if (!viewExists) {
        // 視圖尚未建立，fallback 至一般查詢並補零欄位
        const rows = this.findByProject(projectId, opts);
        return rows.map(inv => ({
          ...inv,
          recognized_amount: (inv.amount_with_tax || 0) - (inv.allowance_amount || 0),
          total_received: 0,
          unpaid_amount: 0
        }));
      }
      const deletedCond = includeDeleted ? '' : ' AND (deleted_at IS NULL)';
      return db.prepare(`
        SELECT * FROM v_invoice_summary
        WHERE project_id = ? ${deletedCond}
        ORDER BY deleted_at IS NOT NULL, invoice_date
      `).all(projectId);
    } catch (err) {
      console.warn('[Invoice] findByProjectWithPayments 失敗，回退至 findByProject:', err.message);
      return this.findByProject(projectId, opts);
    }
  },

  // 取得月份發票統計（僅計有效且未刪除發票；部分折讓以認列金額計）
  getMonthlyStats(year, month) {
    return db.prepare(`
      SELECT 
        COUNT(*) as invoice_count,
        SUM(amount_with_tax - COALESCE(allowance_amount, 0)) as total_amount
      FROM invoices
      WHERE strftime('%Y', invoice_date) = ? 
        AND strftime('%m', invoice_date) = ?
        AND ${VALID_STATUS_CONDITION}
        AND (deleted_at IS NULL)
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

  // 作廢並重開：將原發票作廢、建立新發票、自動轉移收款記錄，整個流程包在同一 transaction
  voidAndReissue(originalId, newInvoiceData, { void_reason } = {}, userInfo = null) {
    const original = this.findById(originalId);
    if (!original) return null;
    if (original.status === '作廢' || original.status === '整筆折讓') {
      throw new Error(`發票已是「${original.status}」狀態，無法重複操作`);
    }

    const voidedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const self = this;
    let newId, movedCount;

    const doVoidAndReissue = db.transaction(() => {
      // 1. 作廢原發票
      self.update(originalId, {
        status: '作廢',
        voided_at: voidedAt,
        void_reason: void_reason || null,
        expected_payment_date: null, // 作廢後不再期待收款
        userInfo
      });

      // 2. 建立新發票（跳過超額開票驗證：重開時已扣除原作廢金額，由呼叫端負責傳入合理金額）
      newId = self.create({
        project_id: original.project_id,
        invoice_date: newInvoiceData.invoice_date || null,
        invoice_number: newInvoiceData.invoice_number || null,
        amount_with_tax: newInvoiceData.amount_with_tax !== undefined
          ? parseFloat(newInvoiceData.amount_with_tax)
          : original.amount_with_tax,
        expected_payment_date: newInvoiceData.expected_payment_date || original.expected_payment_date || null,
        original_invoice_id: originalId,
        _skipOverInvoiceCheck: true, // 重開時原發票已作廢，合約額度已釋出，不需再驗證
        userInfo
      });

      // 3. 將原發票的 replacement_invoice_id 指向新發票
      self.update(originalId, {
        replacement_invoice_id: newId,
        userInfo
      });

      // 4. 自動將原發票的未刪除收款記錄轉移至新發票
      movedCount = db.prepare(
        `UPDATE payments
         SET invoice_id = ?, updated_at = datetime('now', 'localtime')
         WHERE invoice_id = ? AND deleted_at IS NULL`
      ).run(newId, originalId).changes;

      if (movedCount > 0) {
        console.log(`[Invoice.voidAndReissue] 已將 ${movedCount} 筆收款從發票 #${originalId} 轉移至 #${newId}`);
      }
    });

    doVoidAndReissue();

    return {
      original: this.findById(originalId),
      replacement: this.findById(newId),
      movedPayments: movedCount
    };
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

  // 部分折讓：設定折讓金額，發票仍為有效，認列金額 = amount_with_tax - allowance_amount
  setPartialAllowance(id, { allowance_amount, voided_at, void_reason } = {}, userInfo = null) {
    const old = this.findById(id);
    if (!old) return null;
    if (old.status === '作廢' || old.status === '整筆折讓') {
      throw new Error(`發票已是「${old.status}」狀態，無法設定部分折讓`);
    }
    const amount = parseFloat(allowance_amount);
    if (isNaN(amount) || amount < 0) throw new Error('折讓金額必須為不小於 0 的數字');
    const origAmount = parseFloat(old.amount_with_tax) || 0;
    if (amount > origAmount) throw new Error('折讓金額不可大於發票金額');
    this.update(id, {
      allowance_amount: amount,
      voided_at: voided_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
      void_reason: void_reason || null,
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
