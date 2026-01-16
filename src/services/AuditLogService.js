const db = require('../models/db');

class AuditLogService {
  /**
   * 記錄操作
   * @param {string} action - 操作類型 (create, update, delete)
   * @param {string} tableName - 資料表名稱
   * @param {number} recordId - 記錄ID
   * @param {object} oldValue - 舊值 (可選)
   * @param {object} newValue - 新值 (可選)
   * @param {string} userInfo - 使用者資訊 (可選)
   */
  log(action, tableName, recordId, oldValue = null, newValue = null, userInfo = null) {
    try {
      const stmt = db.prepare(`
        INSERT INTO system_logs (action, table_name, record_id, old_value, new_value, user_info)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        action,
        tableName,
        recordId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        userInfo
      );
      
      // 調試信息：確認記錄已寫入
      if (process.env.NODE_ENV === 'development') {
        console.log(`[AuditLog] ${action} ${tableName}:${recordId} - 記錄已寫入 (ID: ${result.lastInsertRowid})`);
      }
    } catch (err) {
      console.error('記錄修改日誌失敗:', err);
      console.error('操作詳情:', { action, tableName, recordId, oldValue, newValue, userInfo });
      // 不中斷主流程，僅記錄錯誤
    }
  }

  /**
   * 記錄新增操作
   */
  logCreate(tableName, recordId, newValue, userInfo = null) {
    this.log('create', tableName, recordId, null, newValue, userInfo);
  }

  /**
   * 記錄更新操作
   */
  logUpdate(tableName, recordId, oldValue, newValue, userInfo = null) {
    this.log('update', tableName, recordId, oldValue, newValue, userInfo);
  }

  /**
   * 記錄刪除操作
   */
  logDelete(tableName, recordId, oldValue, userInfo = null) {
    this.log('delete', tableName, recordId, oldValue, null, userInfo);
  }

  /**
   * 取得修改記錄列表
   */
  getLogs(filters = {}) {
    let sql = `SELECT * FROM system_logs WHERE 1=1`;
    const params = [];

    if (filters.tableName) {
      sql += ` AND table_name = ?`;
      params.push(filters.tableName);
    }

    if (filters.recordId) {
      sql += ` AND record_id = ?`;
      params.push(filters.recordId);
    }

    if (filters.action) {
      sql += ` AND action = ?`;
      params.push(filters.action);
    }

    if (filters.startDate) {
      sql += ` AND created_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND created_at <= ?`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  /**
   * 取得記錄的修改歷史
   */
  getRecordHistory(tableName, recordId) {
    return db.prepare(`
      SELECT * FROM system_logs
      WHERE table_name = ? AND record_id = ?
      ORDER BY created_at DESC
    `).all(tableName, recordId);
  }

  /**
   * 取得統計資訊
   */
  getStatistics(filters = {}) {
    let sql = `
      SELECT 
        action,
        table_name,
        COUNT(*) as count
      FROM system_logs
      WHERE 1=1
    `;
    const params = [];

    if (filters.startDate) {
      sql += ` AND created_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND created_at <= ?`;
      params.push(filters.endDate);
    }

    sql += ` GROUP BY action, table_name ORDER BY count DESC`;

    return db.prepare(sql).all(...params);
  }

  /**
   * 取得總記錄數
   */
  getTotalCount(filters = {}) {
    let sql = `SELECT COUNT(*) as total FROM system_logs WHERE 1=1`;
    const params = [];

    if (filters.tableName) {
      sql += ` AND table_name = ?`;
      params.push(filters.tableName);
    }

    if (filters.recordId) {
      sql += ` AND record_id = ?`;
      params.push(filters.recordId);
    }

    if (filters.action) {
      sql += ` AND action = ?`;
      params.push(filters.action);
    }

    if (filters.startDate) {
      sql += ` AND created_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND created_at <= ?`;
      params.push(filters.endDate);
    }

    const result = db.prepare(sql).get(...params);
    return result ? result.total : 0;
  }
}

module.exports = new AuditLogService();

