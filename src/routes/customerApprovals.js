const express = require('express');
const router = express.Router();
const CustomerCreationRequest = require('../models/CustomerCreationRequest');
const NotificationService = require('../services/NotificationService');

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
    const request = CustomerCreationRequest.findById(req.params.id);
    const customerId = CustomerCreationRequest.approve(req.params.id, req.user);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'customer_approval_approved',
        title: `審核通過：${request.company_name}`,
        message: `審核人：${req.user.name || req.user.username}`,
        link: `/customers/${customerId}`,
        related_type: 'customer',
        related_id: customerId
      });
    }
    res.redirect('/customer-approvals?success=' + encodeURIComponent('已核准，客戶/廠商資料已建立'));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

// 駁回：不會建立客戶/廠商資料
router.post('/:id/reject', requireCustomerApprovalPermission, (req, res) => {
  try {
    const request = CustomerCreationRequest.findById(req.params.id);
    CustomerCreationRequest.reject(req.params.id, req.user, req.body.review_note);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'customer_approval_rejected',
        title: `審核駁回：${request.company_name}`,
        message: req.body.review_note ? `駁回原因：${req.body.review_note}` : `審核人：${req.user.name || req.user.username}`,
        link: '/customers',
        related_type: 'customer_creation_request',
        related_id: request.id
      });
    }
    res.redirect('/customer-approvals?success=' + encodeURIComponent('已駁回此申請'));
  } catch (err) {
    console.error(err);
    res.redirect('/customer-approvals?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
