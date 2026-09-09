const db = require('./db');
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
  findByProject(projectId) {
    return db.prepare(`
      SELECT costs.*, customers.company_name AS vendor_name
      FROM costs
      LEFT JOIN customers ON customers.id = costs.vendor_id
      WHERE costs.project_id = ?
      ORDER BY costs.cost_date DESC, costs.created_at DESC
    `).all(projectId);
  },

  // 依ID取得成本
  findById(id) {
    return db.prepare(`SELECT * FROM costs WHERE id = ?`).get(id);
  },

  // 計算專案的實際成本總額
  getTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(actual_amount), 0) as total
      FROM costs
      WHERE project_id = ?
    `).get(projectId);
    return result ? result.total : 0;
  },

  // 計算專案的預估成本總額
  getEstimatedTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(estimated_amount), 0) as total
      FROM costs
      WHERE project_id = ?
    `).get(projectId);
    return result ? result.total : 0;
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
    const estimatedAmount = data.estimated_amount !== undefined && data.estimated_amount !== null ? parseFloat(data.estimated_amount) || 0 : 0;
    const actualAmount = data.actual_amount !== undefined && data.actual_amount !== null ? parseFloat(data.actual_amount) || 0 : 0;
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
        item_code, item_name, cost_category, payment_method, payment_term, order_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      orderStatus
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
      'item_code', 'item_name', 'cost_category', 'payment_method', 'payment_term', 'order_status'
    ];

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === 'estimated_amount' || field === 'actual_amount') {
          const v = parseFloat(data[field]) || 0;
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

  // 刪除成本
  delete(id, userInfo = null) {
    const cost = this.findById(id);
    if (!cost) return false;
    
    db.prepare('DELETE FROM costs WHERE id = ?').run(id);
    
    // 記錄刪除
    AuditLogService.logDelete('costs', id, cost, userInfo);
    
    return true;
  }
};

module.exports = Cost;

