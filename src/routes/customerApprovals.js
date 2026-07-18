const express = require('express');
const router = express.Router();
const CustomerCreationRequest = require('../models/CustomerCreationRequest');

// 新客戶/廠商審核：僅系統管理員（admin）與專案管理員（user）可使用
const requireCustomerApprovalPermission = (req, res, next) => {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.status(403).render('error', { title: '權限不足', message: '此功能僅限系統管理員與專案管理員使用', error: {} });
    }
    return res.status(401).json({ error: '未登入' });
  }
  if (req.user.role === 'admin' || req.user.role === 'user') return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '權限不足', message: '此功能僅限系統管理員與專案管理員使用', error: {} });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限系統管理員與專案管理員使用' });
};

// 待審核新客戶/廠商列表
router.get('/', requireCustomerApprovalPermission, (req, res) => {
  const requests = CustomerCreationRequest.findPending();

  res.render('customer-approvals/index', {
    title: '客戶/廠商審核',
    requests,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 核准：真正建立客戶/廠商資料
router.post('/:id/approve', requireCustomerApprovalPermission, (req, res) => {
  try {
    CustomerCreationRequest.approve(req.params.id, req.user);
    res.redirect('/customer-approvals?success=' + encodeURIComponent('已核准，客戶/廠商資料已建立'));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

// 駁回：不會建立客戶/廠商資料
router.post('/:id/reject', requireCustomerApprovalPermission, (req, res) => {
  try {
    CustomerCreationRequest.reject(req.params.id, req.user, req.body.review_note);
    res.redirect('/customer-approvals?success=' + encodeURIComponent('已駁回此申請'));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
