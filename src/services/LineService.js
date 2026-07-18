/**
 * LINE 通知服務（LINE Messaging API）。Channel Access Token / Secret 來自 system_settings，
 * 尚未設定或未啟用前一律靜默略過。
 */
const crypto = require('crypto');
const db = require('../models/db');

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function getSetting(key, defaultValue) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row ? row.setting_value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// 把通知內的相對路徑（例如 /pipelines/5）組成完整可點擊網址；尚未設定系統網址時，維持原本的相對路徑
function buildFullLink(link) {
  if (!link) return '';
  const baseUrl = getSetting('system_base_url', '').trim().replace(/\/+$/, '');
  if (!baseUrl) return link;
  return baseUrl + (link.startsWith('/') ? link : '/' + link);
}

function getConfig() {
  return {
    enabled: getSetting('line_notification_enabled', 'false') === 'true',
    accessToken: getSetting('line_channel_access_token', ''),
    channelSecret: getSetting('line_channel_secret', '')
  };
}

const LineService = {
  isEnabled() {
    const config = getConfig();
    return config.enabled && !!config.accessToken;
  },

  // 驗證 LINE 平台送來的 Webhook 簽章（X-Line-Signature），rawBody 必須是原始 Buffer/字串
  verifySignature(rawBody, signature) {
    const config = getConfig();
    if (!config.channelSecret || !signature) return false;
    const hash = crypto.createHmac('sha256', config.channelSecret).update(rawBody).digest('base64');
    return hash === signature;
  },

  // 主動推播訊息給指定使用者
  async pushMessage(lineUserId, text) {
    if (!lineUserId) return false;
    const config = getConfig();
    if (!config.enabled || !config.accessToken) return false;

    try {
      const res = await fetch(`${LINE_API_BASE}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.accessToken}`
        },
        body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
      });
      if (!res.ok) {
        console.error('[LineService] push 失敗:', res.status, await res.text());
        return false;
      }
      return true;
    } catch (err) {
      console.error('[LineService] push 例外:', err.message);
      return false;
    }
  },

  // 回覆 Webhook 事件（用於使用者自助取得自己的 LINE User ID）
  async replyMessage(replyToken, text) {
    const config = getConfig();
    if (!config.accessToken) return false;

    try {
      const res = await fetch(`${LINE_API_BASE}/message/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.accessToken}`
        },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
      });
      if (!res.ok) {
        console.error('[LineService] reply 失敗:', res.status, await res.text());
        return false;
      }
      return true;
    } catch (err) {
      console.error('[LineService] reply 例外:', err.message);
      return false;
    }
  },

  async sendNotification(lineUserId, notification) {
    const fullLink = buildFullLink(notification.link);
    const body = [notification.title, notification.message, fullLink ? `請登入系統查看：${fullLink}` : '']
      .filter(Boolean).join('\n');
    return this.pushMessage(lineUserId, body);
  }
};

module.exports = LineService;
