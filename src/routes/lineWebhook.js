const express = require('express');
const router = express.Router();
const LineService = require('../services/LineService');

// LINE Messaging API Webhook：
// 1. 驗證簽章（X-Line-Signature，需要 express.json() 保留的 req.rawBody）
// 2. 使用者傳送任何文字訊息時，自動回覆對方的 LINE User ID，
//    讓使用者能自助取得 ID 並提供給管理員填入自己的使用者資料，藉此完成通知綁定
router.post('/', (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!req.rawBody || !LineService.verifySignature(req.rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  // 先回應 200，避免 LINE 平台逾時重送；事件處理在背景繼續執行
  res.status(200).send('OK');

  const events = (req.body && req.body.events) || [];
  events.forEach(event => {
    if (event.type === 'message' && event.message && event.message.type === 'text' && event.replyToken) {
      const userId = event.source && event.source.userId;
      if (userId) {
        LineService.replyMessage(
          event.replyToken,
          `您的 LINE User ID：\n${userId}\n\n請將此 ID 提供給系統管理員，設定於您的使用者資料中即可開始接收通知。`
        ).catch(() => {});
      }
    }
  });
});

module.exports = router;
