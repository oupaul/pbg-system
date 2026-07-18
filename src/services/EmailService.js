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
  },

  // 供系統設定頁「測試發送」使用：刻意不檢查 email_notification_enabled，
  // 讓管理員可以在正式啟用前先驗證 SMTP 主機/帳密是否正確。
  // overrides 讓畫面可以直接用「目前表單上還沒儲存的值」測試，不必先存檔；
  // 密碼欄位因為畫面上永遠顯示空白（避免外洩已存的密碼），留空時 fallback 回資料庫已存的密碼。
  async sendTestMail(to, overrides = {}) {
    if (!to) return { success: false, message: '請輸入收件人 Email' };
    const saved = getConfig();
    const config = {
      host: overrides.host || saved.host,
      port: overrides.port ? (parseInt(overrides.port, 10) || 587) : saved.port,
      secure: overrides.secure !== undefined ? (overrides.secure === 'true' || overrides.secure === true) : saved.secure,
      user: overrides.user || saved.user,
      password: overrides.password || saved.password,
      from: overrides.from || saved.from
    };
    if (!config.host) return { success: false, message: '尚未設定 SMTP 主機，請先填寫下方欄位' };

    try {
      const transporter = buildTransporter(config);
      await transporter.sendMail({
        from: config.from || config.user,
        to,
        subject: '[業績獎金系統] 測試郵件',
        text: '這是一封測試郵件，用來確認 SMTP 設定是否正確。若您收到此信，代表 Email 通知功能設定成功。'
      });
      return { success: true, message: '測試郵件已成功寄出，請確認收件匣（含垃圾郵件）' };
    } catch (err) {
      return { success: false, message: '寄送失敗：' + err.message };
    }
  }
};

module.exports = EmailService;
