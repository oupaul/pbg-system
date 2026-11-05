const db = require('./db');
const { toMoney, round2 } = require('../utils/money');
const { getTaxRate, toExTax, parseTaxIncluded } = require('../utils/tax');
const AuditLogService = require('../services/AuditLogService');

// 驗證「成本類型/費用類別/付款辦法/付款條件/下單狀態」這幾個可自訂選項欄位：
// 留空一律放行（皆為選填），有值時必須存在於對應管理表且為啟用狀態，
// 否則丟出訊息引導使用者去後台管理頁新增/啟用（比照 Activity.js 的既有寫法）。
function validateLookupValue(table, column, value, label, managePageLabel) {
  if (!value) return;
  const valid = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ? AND is_active = 1`).get(value);
  if (!valid) {
    throw new Error(`${label}「${value}」不存在或已停用，請至「${managePageLabel}」確認`);
  }
}

const Cost = {
  // 取得專案的所有成本（含廠商名稱，供畫面顯示用）
  findByProject(projectId, { includeDeleted = false } = {}) {
    return db.prepare(`
      SELECT costs.*, customers.company_name AS vendor_name
      FROM costs
      LEFT JOIN customers ON customers.id = costs.vendor_id
      WHERE costs.project_id = ? ${includeDeleted ? '' : 'AND costs.deleted_at IS NULL'}
      ORDER BY costs.cost_date DESC, costs.created_at DESC
    `).all(projectId);
  },

  // 依ID取得成本（含已刪除的；呼叫端要看 deleted_at）
  findById(id) {
    return db.prepare(`SELECT * FROM costs WHERE id = ?`).get(id);
  },

  // 專案的成本彙總（不含已刪除）。毛利用「未稅」那組：actualExTax／estimatedExTax；
  // actual／estimated 是依各筆輸入的金額加總（含稅項目含稅、免稅項目原金額），畫面當參考顯示。
  getTotalsByProject(projectId) {
    const r = db.prepare(`
      SELECT COALESCE(SUM(actual_amount), 0) AS actual,
             COALESCE(SUM(COALESCE(actual_amount_ex_tax, actual_amount)), 0) AS actual_ex_tax,
             COALESCE(SUM(estimated_amount), 0) AS estimated,
             COALESCE(SUM(COALESCE(estimated_amount_ex_tax, estimated_amount)), 0) AS estimated_ex_tax
      FROM costs
      WHERE project_id = ? AND deleted_at IS NULL
    `).get(projectId);
    return {
      actual: round2(r.actual), actualExTax: round2(r.actual_ex_tax),
      estimated: round2(r.estimated), estimatedExTax: round2(r.estimated_ex_tax)
    };
  },

  // 新增成本
  create(data) {
    if (!data.item_name || !data.item_name.trim()) {
      throw new Error('成本名稱為必填欄位');
    }

    validateLookupValue('cost_types', 'type_name', data.cost_type, '成本類型', '成本類型管理');
    validateLookupValue('cost_categories', 'category_name', data.cost_category, '費用類別', '費用類別管理');
    validateLookupValue('payment_methods', 'method_name', data.payment_method, '付款辦法', '付款辦法管理');
    validateLookupValue('payment_terms', 'term_name', data.payment_term, '付款條件', '付款條件管理');
    validateLookupValue('order_statuses', 'status_name', data.order_status, '下單狀態', '下單狀態管理');

    const projectId = data.project_id !== undefined && data.project_id !== null ? parseInt(data.project_id) : null;
    const costDate = data.cost_date || null;
    const costType = data.cost_type || null;
    const vendorId = data.vendor_id ? parseInt(data.vendor_id) : null;
    const estimatedAmount = toMoney(data.estimated_amount);
    const actualAmount = toMoney(data.actual_amount);
    const taxIncluded = parseTaxIncluded(data.tax_included);
    if (taxIncluded === null) throw new Error('稅別必須是「含稅」或「免稅」');
    const taxRate = getTaxRate();
    const notes = data.notes || null;
    const itemCode = data.item_code || null;
    const itemName = data.item_name.trim();
    const costCategory = data.cost_category || null;
    const paymentMethod = data.payment_method || null;
    const paymentTerm = data.payment_term || null;
    const orderStatus = data.order_status || null;

    const stmt = db.prepare(`
      INSERT INTO costs (
        project_id, cost_date, cost_type, vendor_id, estimated_amount, actual_amount, notes,
        item_code, item_name, cost_category, payment_method, payment_term, order_status,
        tax_included, tax_rate, estimated_amount_ex_tax, actual_amount_ex_tax
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      projectId,
      costDate,
      costType,
      vendorId,
      estimatedAmount,
      actualAmount,
      notes,
      itemCode,
      itemName,
      costCategory,
      paymentMethod,
      paymentTerm,
      orderStatus,
      taxIncluded,
      taxRate,
      toExTax(estimatedAmount, taxIncluded === 1, taxRate),
      toExTax(actualAmount, taxIncluded === 1, taxRate)
    );

    const costId = result.lastInsertRowid;

    // 記錄修改
    AuditLogService.logCreate('costs', costId, data, data.userInfo);

    return costId;
  },

  // 更新成本
  update(id, data) {
    // 取得舊值
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    if (oldRecord.deleted_at) throw new Error('此成本已刪除，請先還原再修改');

    if (data.item_name !== undefined && !data.item_name.trim()) {
      throw new Error('成本名稱為必填欄位');
    }

    validateLookupValue('cost_types', 'type_name', data.cost_type, '成本類型', '成本類型管理');
    validateLookupValue('cost_categories', 'category_name', data.cost_category, '費用類別', '費用類別管理');
    validateLookupValue('payment_methods', 'method_name', data.payment_method, '付款辦法', '付款辦法管理');
    validateLookupValue('payment_terms', 'term_name', data.payment_term, '付款條件', '付款條件管理');
    validateLookupValue('order_statuses', 'status_name', data.order_status, '下單狀態', '下單狀態管理');

    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};

    const allowedFields = [
      'cost_date', 'cost_type', 'vendor_id', 'estimated_amount', 'actual_amount', 'notes',
      'item_code', 'item_name', 'cost_category', 'payment_method', 'payment_term', 'order_status', 'tax_included'
    ];

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === 'estimated_amount' || field === 'actual_amount') {
          const v = toMoney(data[field]);
          values.push(v);
          newData[field] = v;
        } else if (field === 'tax_included') {
          const v = parseTaxIncluded(data[field]);
          if (v === null) throw new Error('稅別必須是「含稅」或「免稅」');
          values.push(v);
          newData[field] = v;
        } else if (field === 'vendor_id') {
          const v = data[field] ? parseInt(data[field]) : null;
          values.push(v);
          newData[field] = v;
        } else if (field === 'item_name') {
          const v = data[field].trim();
          values.push(v);
          newData[field] = v;
        } else {
          values.push(data[field]);
          newData[field] = data[field];
        }
      } else {
        newData[field] = oldRecord[field];
      }
    });
    
    // 金額或稅別有變動就重算未稅金額（用目前的營業稅率）；只改備註、狀態等不動稅額
    if (newData.estimated_amount !== oldRecord.estimated_amount || newData.actual_amount !== oldRecord.actual_amount
      || (newData.tax_included !== undefined && newData.tax_included !== oldRecord.tax_included)) {
      const included = (newData.tax_included !== undefined ? newData.tax_included : oldRecord.tax_included) !== 0;
      const rate = getTaxRate();
      fields.push('tax_rate = ?', 'estimated_amount_ex_tax = ?', 'actual_amount_ex_tax = ?');
      values.push(rate, toExTax(newData.estimated_amount, included, rate), toExTax(newData.actual_amount, included, rate));
    }

    // 如果沒有要更新的欄位，直接返回
    if (fields.length === 0) {
      return true;
    }
    
    fields.push('updated_at = datetime(\'now\', \'localtime\')');
    
    const sql = `UPDATE costs SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id);
    
    db.prepare(sql).run(...values);
    
    // 記錄修改
    AuditLogService.logUpdate('costs', id, oldRecord, newData, data.userInfo);
    
    return true;
  },

  // 刪除成本（軟刪除：標記 deleted_at，可還原；時間為 UTC，與發票／收款一致）
  delete(id, userInfo = null) {
    const cost = this.findById(id);
    if (!cost) return false;
    if (cost.deleted_at) return true;

    const deletedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE costs SET deleted_at = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(deletedAt, id);
    AuditLogService.logDelete('costs', id, cost, userInfo);
    return true;
  },

  // 還原軟刪除的成本
  restore(id, userInfo = null) {
    const cost = this.findById(id);
    if (!cost || !cost.deleted_at) return false;
    db.prepare('UPDATE costs SET deleted_at = NULL, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(id);
    AuditLogService.logUpdate('costs', id, cost, { deleted_at: null }, userInfo);
    return true;
  }
};

module.exports = Cost;

