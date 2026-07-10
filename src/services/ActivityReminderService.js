/**
 * 客戶追蹤提醒服務
 * 找出已指派負責業務、但超過設定天數沒有活動紀錄（拜訪/電話/客訴...）的客戶
 */
const db = require('../models/db');

const ActivityReminderService = {
  /**
   * @param {number} reminderDays - 超過幾天沒有活動紀錄視為需要追蹤
   * @param {number|null} salespersonId - 僅回傳該業務負責的客戶，null 為全部
   * @returns {Array}
   */
  getOverdueCustomers(reminderDays = 14, salespersonId = null) {
    const salespersonCond = salespersonId != null ? 'AND c.owner_salesperson_id = ?' : '';
    const params = salespersonId != null ? [salespersonId] : [];

    const rows = db.prepare(`
      SELECT c.id, c.company_name, c.customer_code, s.name as owner_salesperson_name,
        MAX(a.activity_date) as last_activity_date
      FROM customers c
      JOIN salespeople s ON c.owner_salesperson_id = s.id
      LEFT JOIN activities a ON a.customer_id = c.id AND a.deleted_at IS NULL
      WHERE c.owner_salesperson_id IS NOT NULL ${salespersonCond}
      GROUP BY c.id
      HAVING last_activity_date IS NULL
          OR last_activity_date < datetime('now', 'localtime', '-' || ? || ' days')
      ORDER BY (last_activity_date IS NULL) DESC, last_activity_date ASC
    `).all(...params, reminderDays);

    return rows.map(r => ({
      id: r.id,
      company_name: r.company_name,
      customer_code: r.customer_code,
      owner_salesperson_name: r.owner_salesperson_name,
      last_activity_date: r.last_activity_date,
      days_since_last_activity: r.last_activity_date
        ? Math.floor((Date.now() - new Date(r.last_activity_date.replace(' ', 'T')).getTime()) / 86400000)
        : null
    }));
  }
};

module.exports = ActivityReminderService;
