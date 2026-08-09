/**
 * 通知中心服務。
 *
 * 兩種通知來源：
 * 1. 事件觸發（由 routes 在動作發生當下呼叫）：送出審核申請、審核核准/駁回。
 * 2. 系統提醒（由 generateReminderNotifications 在請求時計算並 dedup 建立）：
 *    客戶追蹤逾期、開票提醒 —— 邏輯比照首頁儀表板現有的提醒計算方式，
 *    但完全獨立運作，不會更動首頁儀表板本身的顯示內容。
 */
const db = require('../models/db');
const Notification = require('../models/Notification');
const ActivityReminderService = require('./ActivityReminderService');
const EmailService = require('./EmailService');
const LineService = require('./LineService');
const User = require('../models/User');
const { ONLINE_THRESHOLD_MINUTES } = require('../constants');

// 僅這些「重要事件」類型會嘗試透過 Email/LINE 發送，一般系統提醒（客戶追蹤、開票提醒）不發送，避免訊息轟炸
const EXTERNAL_CHANNEL_TYPES = new Set([
  'customer_approval_pending', 'customer_approval_approved', 'customer_approval_rejected',
  'deletion_request_pending', 'deletion_request_approved', 'deletion_request_rejected',
  'pipeline_created', 'pipeline_updated', 'pipeline_status_changed', 'pipeline_converted',
  'activity_created'
]);

// 依使用者填寫的 email/line_user_id 發送外部通知；失敗只記錄 log，不影響站內通知本身
function dispatchExternalChannels(userId, type, title, message, link) {
  if (!EXTERNAL_CHANNEL_TYPES.has(type)) return;
  try {
    const row = db.prepare('SELECT email, line_user_id FROM users WHERE id = ?').get(userId);
    if (!row) return;
    if (row.email) {
      EmailService.sendNotificationEmail({ email: row.email }, { title, message, link }).catch(err => {
        console.error('[NotificationService] Email 發送失敗:', err.message);
      });
    }
    if (row.line_user_id) {
      LineService.sendNotification(row.line_user_id, { title, message, link }).catch(err => {
        console.error('[NotificationService] LINE 發送失敗:', err.message);
      });
    }
  } catch (e) { /* 外部通知發送失敗不應影響站內通知 */ }
}

// 通知類型 -> 圖示與顏色（導覽列鈴鐺下拉選單與 /notifications 頁面共用）
const NOTIFICATION_ICONS = {
  customer_approval_pending: { icon: 'bi-person-check', color: 'text-primary' },
  customer_approval_approved: { icon: 'bi-check-circle', color: 'text-success' },
  customer_approval_rejected: { icon: 'bi-x-circle', color: 'text-danger' },
  deletion_request_pending: { icon: 'bi-shield-exclamation', color: 'text-warning' },
  deletion_request_approved: { icon: 'bi-check-circle', color: 'text-success' },
  deletion_request_rejected: { icon: 'bi-x-circle', color: 'text-danger' },
  activity_reminder: { icon: 'bi-clock-history', color: 'text-warning' },
  invoice_overdue: { icon: 'bi-exclamation-triangle', color: 'text-danger' },
  invoice_upcoming: { icon: 'bi-cash-coin', color: 'text-info' },
  pipeline_created: { icon: 'bi-bullseye', color: 'text-primary' },
  pipeline_updated: { icon: 'bi-pencil-square', color: 'text-info' },
  pipeline_status_changed: { icon: 'bi-arrow-repeat', color: 'text-warning' },
  pipeline_converted: { icon: 'bi-folder-symlink', color: 'text-success' },
  activity_created: { icon: 'bi-journal-text', color: 'text-info' },
  broadcast_message: { icon: 'bi-megaphone', color: 'text-primary' }
};

function getNotificationIcon(type) {
  return NOTIFICATION_ICONS[type] || { icon: 'bi-bell', color: 'text-secondary' };
}

function getSystemSetting(key, defaultValue) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row ? row.setting_value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

const WIN_PROBABILITY_STAGES = { 10: '初步接洽', 30: '需求分析', 50: '提案報價', 100: '商務談判' };

// 通知內文用：把銷售機會的實際內容組成人看得懂的摘要文字（客戶、金額、機率、預計成交月份等）
function formatPipelineSummary(pipeline) {
  if (!pipeline) return '';
  const stageLabel = WIN_PROBABILITY_STAGES[pipeline.win_probability];
  const probText = pipeline.win_probability !== null && pipeline.win_probability !== undefined
    ? (stageLabel ? `${stageLabel} ${pipeline.win_probability}%` : `${pipeline.win_probability}%`)
    : '-';
  const lines = [
    `客戶：${pipeline.customer_name || '-'}`,
    `銷售機會名稱：${pipeline.opportunity_name || '-'}`,
    `預估專案類型：${pipeline.project_type || '-'}`,
    `預估金額：$${(pipeline.estimated_amount || 0).toLocaleString()}`,
    `成交機率：${probText}`,
    `預計成交月份：${pipeline.expected_close_year_month || '-'}`,
    `業務人員：${pipeline.salesperson_name || '-'}`
  ];
  if (pipeline.notes) lines.push(`備註：${pipeline.notes}`);
  return lines.join('\n');
}

// 通知內文用：把客戶活動紀錄的實際內容組成人看得懂的摘要文字，格式比照 formatPipelineSummary
function formatActivitySummary({ customerName, activityType, activityDate, content }) {
  const lines = [
    `客戶：${customerName || '-'}`,
    `活動類型：${activityType || '-'}`,
    `活動日期：${activityDate || '-'}`
  ];
  if (content) lines.push(`內容：${content}`);
  return lines.join('\n');
}

const NotificationService = {
  notify(userId, { type, title, message, link, related_type, related_id }) {
    if (!userId) return null;
    const id = Notification.create({ user_id: userId, type, title, message, link, related_type, related_id });
    dispatchExternalChannels(userId, type, title, message, link);
    return id;
  },

  notifyUsers(userIds, payload, excludeUserId = null) {
    const targets = [...new Set(userIds)].filter(id => id && id !== excludeUserId);
    targets.forEach(id => this.notify(id, payload));
  },

  // 通知具備客戶/廠商審核權限者（admin/user，對應 customerApprovals.js 的權限檢查）
  notifyCustomerApprovers(payload, excludeUserId = null) {
    const rows = db.prepare(`SELECT id FROM users WHERE role IN ('admin', 'user') AND is_active = 1`).all();
    this.notifyUsers(rows.map(r => r.id), payload, excludeUserId);
  },

  // 通知具備刪除審核權限者（roles.can_delete = 1）
  notifyDeletionApprovers(payload, excludeUserId = null) {
    const rows = db.prepare(`
      SELECT u.id FROM users u
      JOIN roles r ON r.role_key = u.role
      WHERE r.can_delete = 1 AND u.is_active = 1
    `).all();
    this.notifyUsers(rows.map(r => r.id), payload, excludeUserId);
  },

  // 廣播訊息給目前線上的使用者（最近 ONLINE_THRESHOLD_MINUTES 分鐘內有活動者），回傳實際送達人數
  broadcastToOnlineUsers(message, sender) {
    const online = User.findOnline(ONLINE_THRESHOLD_MINUTES).filter(u => u.id !== sender.id);
    this.notifyUsers(online.map(u => u.id), {
      type: 'broadcast_message',
      title: '系統廣播訊息',
      message,
      link: '/notifications'
    });
    return online.length;
  },

  // 通知管理員於系統設定中指定的收件人（銷售機會新增/編輯/狀態變更/轉入專案、客戶活動紀錄新增）
  notifyBusinessWatchers(payload, excludeUserId = null) {
    const idsStr = getSystemSetting('business_event_notify_user_ids', '');
    const ids = idsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(id => !isNaN(id) && id > 0);
    if (ids.length === 0) return;
    this.notifyUsers(ids, payload, excludeUserId);
  },

  // 依使用者身份產生系統提醒類通知，透過 createIfNotExists 避免同一目標重複建立未讀通知
  generateReminderNotifications(user) {
    if (!user || !user.id) return;

    try {
      const reminderDays = parseInt(getSystemSetting('activity_reminder_days', '14'), 10) || 14;
      const overdue = ActivityReminderService.getOverdueCustomers(reminderDays, user.id);
      overdue.forEach(c => {
        Notification.createIfNotExists({
          user_id: user.id,
          type: 'activity_reminder',
          title: `客戶追蹤提醒：${c.company_name}`,
          message: c.last_activity_date ? `已 ${c.days_since_last_activity} 天未安排活動紀錄` : '尚無任何活動紀錄',
          link: `/customers/${c.id}`,
          related_type: 'customer',
          related_id: c.id
        });
      });
    } catch (e) { /* 提醒產生失敗不應影響正常畫面渲染 */ }

    if (!user.salesperson_id) return;

    try {
      const enabled = getSystemSetting('invoice_notification_enabled', 'true') === 'true';
      if (!enabled) return;

      const daysBefore = parseInt(getSystemSetting('invoice_notification_days_before_month_end', '6'), 10) || 6;
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysUntilEndOfMonth = lastDay - now.getDate();

      const overdueProjects = db.prepare(`
        SELECT id, project_code, project_name, expected_invoice_year_month
        FROM v_project_summary
        WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month < ?
          AND status = '未結案' AND salesperson_id = ? AND uninvoiced_amount > 0
      `).all(currentYearMonth, user.salesperson_id);

      overdueProjects.forEach(p => {
        Notification.createIfNotExists({
          user_id: user.id,
          type: 'invoice_overdue',
          title: `開票逾期提醒：${p.project_name}`,
          message: `預計開票月份 ${p.expected_invoice_year_month} 已過期，尚未全數開立發票`,
          link: `/projects/${p.id}`,
          related_type: 'project',
          related_id: p.id
        });
      });

      if (daysUntilEndOfMonth <= daysBefore) {
        const upcomingProjects = db.prepare(`
          SELECT id, project_code, project_name
          FROM v_project_summary
          WHERE expected_invoice_year_month = ? AND status = '未結案' AND salesperson_id = ? AND uninvoiced_amount > 0
        `).all(currentYearMonth, user.salesperson_id);

        upcomingProjects.forEach(p => {
          Notification.createIfNotExists({
            user_id: user.id,
            type: 'invoice_upcoming',
            title: `開票提醒：${p.project_name}`,
            message: '本月底前應開立發票',
            link: `/projects/${p.id}`,
            related_type: 'project',
            related_id: p.id
          });
        });
      }
    } catch (e) { /* 提醒產生失敗不應影響正常畫面渲染 */ }
  }
};

module.exports = NotificationService;
module.exports.getNotificationIcon = getNotificationIcon;
module.exports.formatPipelineSummary = formatPipelineSummary;
module.exports.formatActivitySummary = formatActivitySummary;
