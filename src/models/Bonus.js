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

  // 取得獎金級距設定
  getTiers(projectType = null) {
    let sql = `SELECT * FROM bonus_tiers WHERE is_active = 1`;
    if (projectType) {
      sql += ` AND project_type = ?`;
      return db.prepare(sql).all(projectType);
    }
    return db.prepare(sql).all();
  },

  // 計算專案獎金
  calculateProjectBonus(project, salesperson) {
    const bonuses = [];
    const priceWithoutTax = project.price_without_tax || (project.price_with_tax / 1.05);

    if (project.project_type === '食驗室') {
      // 食驗室獎金（不扣成本）
      bonuses.push({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '食驗室獎金',
        base_amount: priceWithoutTax,
        bonus_percentage: 0, // 依級距決定
        bonus_amount: 0,
        status: salesperson.status === 'resigned' ? '充公' : '待發放',
        forfeiture_reason: salesperson.status === 'resigned' ? `${salesperson.resigned_date}離職充公` : null
      });
    } else if (project.project_type === '純廣') {
      // 純廣獎金（扣成本10%）
      const baseAmount = priceWithoutTax * 0.9;
      bonuses.push({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '純廣獎金',
        base_amount: baseAmount,
        bonus_percentage: 0,
        bonus_amount: 0,
        status: '待發放'
      });
    } else if (project.project_type === '專案') {
      // 專案獎金（扣成本40%）
      const baseAmount = priceWithoutTax * 0.6;
      
      // 簽約獎金 20%
      bonuses.push({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '專案簽約獎金',
        base_amount: baseAmount,
        bonus_percentage: 20,
        bonus_amount: baseAmount * 0.2,
        status: '待發放'
      });

      // 結案獎金 80%
      bonuses.push({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '專案結案獎金',
        base_amount: baseAmount,
        bonus_percentage: 80,
        bonus_amount: baseAmount * 0.8,
        status: '待發放'
      });
    }

    // 新客戶開發獎金
    if (project.is_new_customer) {
      bonuses.push({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '開發獎金',
        base_amount: 0,
        bonus_percentage: 0,
        bonus_amount: 0,
        status: '待發放'
      });
    }

    return bonuses;
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
