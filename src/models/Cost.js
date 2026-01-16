const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Cost = {
  // 取得專案的所有成本
  findByProject(projectId) {
    return db.prepare(`
      SELECT * FROM costs
      WHERE project_id = ?
      ORDER BY cost_date DESC, created_at DESC
    `).all(projectId);
  },

  // 依ID取得成本
  findById(id) {
    return db.prepare(`SELECT * FROM costs WHERE id = ?`).get(id);
  },

  // 計算專案的總成本
  getTotalByProject(projectId) {
    const result = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM costs
      WHERE project_id = ?
    `).get(projectId);
    return result ? result.total : 0;
  },

  // 新增成本
  create(data) {
    const projectId = data.project_id !== undefined && data.project_id !== null ? parseInt(data.project_id) : null;
    const costDate = data.cost_date || null;
    const costType = data.cost_type || null;
    const amount = data.amount !== undefined && data.amount !== null ? parseFloat(data.amount) : 0;
    const notes = data.notes || null;
    
    const stmt = db.prepare(`
      INSERT INTO costs (
        project_id, cost_date, cost_type, amount, notes
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      projectId,
      costDate,
      costType,
      amount,
      notes
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
    
    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};
    
    const allowedFields = ['cost_date', 'cost_type', 'amount', 'notes'];
    
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === 'amount') {
          values.push(parseFloat(data[field]) || 0);
          newData[field] = parseFloat(data[field]) || 0;
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

