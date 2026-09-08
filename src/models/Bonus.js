const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Bonus = {
  // 取得專案的所有獎金
  findByProject(projectId) {
    return db.prepare(`SELECT * FROM v_bonus_summary WHERE project_id = ?`).all(projectId);
  },

  // 取得業務的所有獎金
  findBySalesperson(salespersonId, year = null) {
    let sql = `SELECT * FROM v_bonus_summary WHERE salesperson_id = ?`;
    const params = [salespersonId];
    
    if (year) {
      sql = `
        SELECT b.* FROM v_bonus_summary b
        JOIN projects p ON b.project_id = p.id
        WHERE b.salesperson_id = ? AND p.contract_year = ?
      `;
      params.push(year);
    }
    
    return db.prepare(sql).all(...params);
  },

  // 依ID取得
  findById(id) {
    return db.prepare(`SELECT * FROM v_bonus_summary WHERE id = ?`).get(id);
  },

  // 新增獎金記錄
  create(data) {
    // bonus_type 不再由資料庫 CHECK 約束限制（改為可自訂的 bonus_types 表），
    // 這裡是唯一的新增入口（POST /bonuses 與 Excel 匯入都會經過這裡），改在應用層驗證
    const validType = db.prepare('SELECT id FROM bonus_types WHERE type_name = ? AND is_active = 1').get(data.bonus_type);
    if (!validType) {
      throw new Error(`獎金類型「${data.bonus_type}」不存在或已停用，請至「獎金類型管理」確認`);
    }

    const stmt = db.prepare(`
      INSERT INTO bonus_calculations (
        project_id, salesperson_id, bonus_type, base_amount,
        bonus_percentage, bonus_amount, payment_date, status, forfeiture_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      data.project_id,
      data.salesperson_id,
      data.bonus_type,
      data.base_amount || 0,
      data.bonus_percentage || 0,
      data.bonus_amount || 0,
      data.payment_date || null,
      data.status || '待發放',
      data.forfeiture_reason || null
    );
    
    const bonusId = result.lastInsertRowid;
    
    // 記錄修改
    AuditLogService.logCreate('bonus_calculations', bonusId, data, data.userInfo);
    
    return bonusId;
  },

  // 更新獎金
  update(id, data) {
    // 取得舊值（從原始表查詢）
    const oldRecord = db.prepare(`SELECT * FROM bonus_calculations WHERE id = ?`).get(id);
    if (!oldRecord) return false;

    const fields = [];
    const values = [];

    const allowedFields = [
      'base_amount', 'bonus_percentage', 'bonus_amount',
      'payment_date', 'status', 'forfeiture_reason'
    ];

    const newData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
        newData[field] = data[field];
      }
    }

    if (fields.length === 0) return false;

    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);

    const sql = `UPDATE bonus_calculations SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 構建完整的新資料（包含未更新的欄位）
    const completeNewData = { ...oldRecord, ...newData };
    
    // 無論 result.changes 是否大於 0，都記錄修改（因為 updated_at 總是會更新）
    if (result.changes >= 0) {
      // 記錄修改
      AuditLogService.logUpdate('bonus_calculations', id, oldRecord, completeNewData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 刪除獎金
  delete(id, userInfo = null) {
    // 取得舊值
    const oldRecord = db.prepare(`SELECT * FROM bonus_calculations WHERE id = ?`).get(id);
    
    const result = db.prepare(`DELETE FROM bonus_calculations WHERE id = ?`).run(id);
    
    if (result.changes > 0 && oldRecord) {
      // 記錄刪除
      AuditLogService.logDelete('bonus_calculations', id, oldRecord, userInfo);
    }
    
    return result.changes > 0;
  },

  // 取得獎金統計
  getStatistics(year) {
    return db.prepare(`
      SELECT 
        bonus_type,
        COUNT(*) as count,
        SUM(bonus_amount) as total_amount,
        SUM(CASE WHEN bc.status = '已發放' THEN bonus_amount ELSE 0 END) as paid_amount,
        SUM(CASE WHEN bc.status = '待發放' THEN bonus_amount ELSE 0 END) as pending_amount,
        SUM(CASE WHEN bc.status = '充公' THEN bonus_amount ELSE 0 END) as forfeited_amount
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      WHERE p.contract_year = ?
      GROUP BY bonus_type
    `).all(year);
  },

  // 取得特定業務員的獎金統計
  getStatisticsBySalesperson(year, salespersonId) {
    return db.prepare(`
      SELECT 
        bonus_type,
        COUNT(*) as count,
        SUM(bonus_amount) as total_amount,
        SUM(CASE WHEN bc.status = '已發放' THEN bonus_amount ELSE 0 END) as paid_amount,
        SUM(CASE WHEN bc.status = '待發放' THEN bonus_amount ELSE 0 END) as pending_amount,
        SUM(CASE WHEN bc.status = '充公' THEN bonus_amount ELSE 0 END) as forfeited_amount
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      WHERE p.contract_year = ? AND bc.salesperson_id = ?
      GROUP BY bonus_type
    `).all(year, salespersonId);
  },

  // 取得業務獎金彙總
  getSalespersonSummary(year) {
    return db.prepare(`
      SELECT 
        s.id,
        s.name,
        COUNT(DISTINCT bc.project_id) as project_count,
        SUM(bc.bonus_amount) as total_bonus,
        SUM(CASE WHEN bc.status = '已發放' THEN bc.bonus_amount ELSE 0 END) as paid_bonus,
        SUM(CASE WHEN bc.status = '待發放' THEN bc.bonus_amount ELSE 0 END) as pending_bonus
      FROM salespeople s
      LEFT JOIN bonus_calculations bc ON s.id = bc.salesperson_id
      LEFT JOIN projects p ON bc.project_id = p.id AND p.contract_year = ?
      GROUP BY s.id
      HAVING total_bonus > 0 OR project_count > 0
      ORDER BY total_bonus DESC
    `).all(year);
  }
};

module.exports = Bonus;
