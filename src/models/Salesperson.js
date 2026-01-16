const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Salesperson = {
  // 取得所有業務
  findAll(includeInactive = false) {
    let sql = `SELECT * FROM salespeople`;
    if (!includeInactive) {
      sql += ` WHERE status = 'active'`;
    }
    sql += ` ORDER BY name`;
    return db.prepare(sql).all();
  },

  // 依ID取得
  findById(id) {
    return db.prepare(`SELECT * FROM salespeople WHERE id = ?`).get(id);
  },

  // 依姓名取得
  findByName(name) {
    return db.prepare(`SELECT * FROM salespeople WHERE name = ?`).get(name);
  },

  // 新增業務
  create(data) {
    const stmt = db.prepare(`
      INSERT INTO salespeople (name, status, resigned_date)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(
      data.name,
      data.status || 'active',
      data.resigned_date || null
    );
    
    const salespersonId = result.lastInsertRowid;
    
    // 記錄新增
    AuditLogService.logCreate('salespeople', salespersonId, {
      name: data.name,
      status: data.status || 'active',
      resigned_date: data.resigned_date || null
    }, data.userInfo);
    
    return salespersonId;
  },

  // 更新業務
  update(id, data) {
    // 取得舊值
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    
    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};
    
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
      newData.name = data.name;
    } else {
      newData.name = oldRecord.name;
    }
    
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
      newData.status = data.status;
    } else {
      newData.status = oldRecord.status;
    }
    
    if (data.resigned_date !== undefined) {
      fields.push('resigned_date = ?');
      values.push(data.resigned_date);
      newData.resigned_date = data.resigned_date;
    } else {
      newData.resigned_date = oldRecord.resigned_date;
    }
    
    // 如果沒有要更新的欄位，直接返回
    if (fields.length === 0) return false;
    
    // 添加 updated_at
    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);
    
    const sql = `UPDATE salespeople SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 無論 result.changes 是否大於 0，都記錄修改（因為 updated_at 總是會更新）
    if (result.changes >= 0) {
      // 記錄修改
      AuditLogService.logUpdate('salespeople', id, oldRecord, newData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 取得或建立業務
  findOrCreate(name) {
    let person = this.findByName(name);
    if (!person) {
      const id = this.create({ name });
      person = this.findById(id);
    }
    return person;
  },

  // 取得業務業績統計
  getPerformance(id, year) {
    let sql = `
      SELECT 
        COUNT(DISTINCT p.id) as project_count,
        COALESCE(SUM(p.price_with_tax), 0) as total_amount,
        COALESCE(SUM(CASE WHEN p.project_type = '食驗室' THEN p.price_with_tax ELSE 0 END), 0) as lab_amount,
        COALESCE(SUM(CASE WHEN p.project_type = '純廣' THEN p.price_with_tax ELSE 0 END), 0) as ad_amount,
        COALESCE(SUM(CASE WHEN p.project_type = '專案' THEN p.price_with_tax ELSE 0 END), 0) as project_amount
      FROM projects p
      WHERE p.salesperson_id = ?
    `;
    
    if (year) {
      sql += ` AND p.contract_year = ?`;
      return db.prepare(sql).get(id, year);
    } else {
      return db.prepare(sql).get(id);
    }
  }
};

module.exports = Salesperson;
