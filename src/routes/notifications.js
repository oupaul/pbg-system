const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const NotificationService = require('../services/NotificationService');
const User = require('../models/User');
const { getNotificationIcon } = NotificationService;
const { ONLINE_THRESHOLD_MINUTES } = require('../constants');

// 廣播訊息：僅系統管理員可使用
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '權限不足',
      message: '只有管理員可以使用廣播通知功能',
      error: {}
    });
  }
  next();
}

// 通知中心：僅顯示、操作自己的通知
router.get('/', (req, res) => {
  const filter = req.query.filter === 'unread' ? 'unread' : 'all';
  const notifications = Notification.findForUser(req.user.id, { unreadOnly: filter === 'unread' });

  res.render('notifications/index', {
    title: '通知中心',
    notifications,
    filter,
    getNotificationIcon,
    unreadCount: Notification.countUnread(req.user.id)
  });
});

// 輪詢端點：導覽列鈴鐺定期呼叫，取得目前未讀數與最新通知（JSON）
router.get('/poll', (req, res) => {
  const recent = Notification.findForUser(req.user.id, { limit: 8 });
  res.json({
    unreadCount: Notification.countUnread(req.user.id),
    notifications: recent.map(n => ({
      id: n.id,
      title: n.title,
      created_at: n.created_at,
      is_read: !!n.is_read,
      ...getNotificationIcon(n.type)
    }))
  });
});

// 廣播通知：顯示發送表單與目前線上人數
router.get('/broadcast', requireAdmin, (req, res) => {
  const online = User.findOnline(ONLINE_THRESHOLD_MINUTES).filter(u => u.id !== req.user.id);
  res.render('notifications/broadcast', {
    title: '廣播通知',
    onlineUsers: online,
    onlineThresholdMinutes: ONLINE_THRESHOLD_MINUTES,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 廣播通知：發送給目前線上使用者
router.post('/broadcast', requireAdmin, (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) {
    return res.redirect('/notifications/broadcast?error=' + encodeURIComponent('請輸入通知內容'));
  }

  const count = NotificationService.broadcastToOnlineUsers(message, req.user);
  res.redirect('/notifications/broadcast?success=' + encodeURIComponent(`已發送給 ${count} 位線上使用者`));
});

// 點擊通知：標記已讀後導向原始連結
router.get('/:id/open', (req, res) => {
  const notification = Notification.findById(req.params.id);
  if (!notification || notification.user_id !== req.user.id) {
    return res.redirect('/notifications');
  }

  Notification.markRead(notification.id, req.user.id);
  res.redirect(notification.link || '/notifications');
});

// 標記單筆已讀（停留在通知中心頁面，不導頁）
router.post('/:id/read', (req, res) => {
  Notification.markRead(req.params.id, req.user.id);
  res.redirect('/notifications' + (req.query.filter === 'unread' ? '?filter=unread' : ''));
});

// 全部標記已讀
router.post('/mark-all-read', (req, res) => {
  Notification.markAllRead(req.user.id);
  res.redirect('/notifications' + (req.query.filter === 'unread' ? '?filter=unread' : ''));
});

module.exports = router;
