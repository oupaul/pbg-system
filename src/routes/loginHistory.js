const express = require('express');
const LoginHistory = require('../models/LoginHistory');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

// user_agent 來自 HTTP 標頭，是使用者可控的自由文字，輸出到畫面前務必跳脫
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAGE_SIZE = 50;

router.get('/', (req, res) => {
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const startDate = req.query.start_date || null;
  const endDate = req.query.end_date || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const filters = { userId, startDate, endDate };

  const records = LoginHistory.list({ ...filters, page, pageSize: PAGE_SIZE }).map(r => ({
    ...r,
    username_html: escapeHtml(r.username),
    name_html: escapeHtml(r.name),
    ip_address_html: escapeHtml(r.ip_address || '-'),
    user_agent_html: escapeHtml(r.user_agent || '-')
  }));
  const total = LoginHistory.count(filters);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const users = User.findAll().map(u => ({
    ...u,
    name_html: escapeHtml(u.name),
    username_html: escapeHtml(u.username)
  }));

  const queryParams = new URLSearchParams();
  if (userId) queryParams.set('user_id', userId);
  if (startDate) queryParams.set('start_date', startDate);
  if (endDate) queryParams.set('end_date', endDate);
  const queryString = queryParams.toString();

  res.render('login-history/index', {
    title: '登入紀錄',
    records,
    users,
    filters: { userId, startDate, endDate },
    pagination: { page, totalPages, total },
    queryString
  });
});

module.exports = router;
