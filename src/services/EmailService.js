/**
 * Email 通知服務。SMTP 設定來自 system_settings，尚未設定 host/enabled 前一律靜默略過。
 */
const nodemailer = require('nodemailer');
const db = require('../models/db');

function getSetting(key, defaultValue) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row ? row.setting_value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function getConfig() {
  return {
    enabled: getSetting('email_notification_enabled', 'false') === 'true',
    host: getSetting('smtp_host', ''),
    port: parseInt(getSetting('smtp_port', '587'), 10) || 587,
    secure: getSetting('smtp_secure', 'false') === 'true',
    user: getSetting('smtp_user', ''),
    password: getSetting('smtp_password', ''),
    from: getSetting('smtp_from', '')
  };
}

function buildTransporter(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined
  });
}

const EmailService = {
  isEnabled() {
    const config = getConfig();
    return config.enabled && !!config.host;
  },

  // 寄送一封信；設定不完整或寄送失敗都只記錄 log，不拋出例外（避免影響呼叫端的主流程）
  async sendMail(to, subject, text) {
    if (!to) return false;
    const config = getConfig();
    if (!config.enabled) return false;
    if (!config.host) {
      console.warn('[EmailService] 尚未設定 SMTP 主機，略過寄送');
      return false;
    }

    try {
      const transporter = buildTransporter(config);
      await transporter.sendMail({
        from: config.from || config.user,
        to,
        subject,
        text
      });
      return true;
    } catch (err) {
      console.error('[EmailService] 寄送失敗:', err.message);
      return false;
    }
  },

  async sendNotificationEmail(user, notification) {
    if (!user || !user.email) return false;
    const body = [notification.message, notification.link ? `請登入系統查看：${notification.link}` : ''].filter(Boolean).join('\n\n');
    return this.sendMail(user.email, `[業績獎金系統] ${notification.title}`, body);
  }
};

module.exports = EmailService;
