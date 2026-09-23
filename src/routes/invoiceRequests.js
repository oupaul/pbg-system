const express = require('express');
const router = express.Router();
const InvoiceRequest = require('../models/InvoiceRequest');
const ApprovalChain = require('../models/ApprovalChain');
const Role = require('../models/Role');
const PdfExportService = require('../services/PdfExportService');
const NotificationService = require('../services/NotificationService');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission, requireInvoiceRequestApprovalPermission } = require('../middleware/auth');

// 建立發票開立申請（誰能新增發票，就誰能送出申請，比照 POST /invoices 的權限）
router.post('/', requireEditPermission, (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : Object.values(req.body.items || {});
    const requestId = InvoiceRequest.create({
      project_id: req.body.project_id,
      request_type: req.body.request_type,
      quote_number: req.body.quote_number,
      recipient_name: req.body.recipient_name,
      recipient_address: req.body.recipient_address,
      recipient_phone: req.body.recipient_phone,
      notes: req.body.notes,
      items,
      requested_by: req.user.id,
      requested_by_name: getUserInfo(req)
    });

    const request = InvoiceRequest.findById(requestId);
    NotificationService.notifyInvoiceRequestApprovers({
      type: 'invoice_request_pending',
      title: `發票開立申請待審核：${request.project_name || ''}`,
      message: `申請人：${getUserInfo(req)}\n總計（含稅）：${request.total_amount}`,
      link: '/invoice-requests',
      related_type: 'invoice_request',
      related_id: requestId
    }, req.user.id);

    res.redirect(`/projects/${req.body.project_id}?success=` + encodeURIComponent('已送出發票開立申請，待審核'));
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 待審核列表
router.get('/', requireInvoiceRequestApprovalPermission, (req, res) => {
  const requests = InvoiceRequest.findPending();
  const chainSteps = ApprovalChain.getSteps('invoice_request');
  const roleNameMap = {};
  Role.findAll(true).forEach(r => { roleNameMap[r.role_key] = r.role_name; });

  res.render('invoiceRequests/index', {
    title: '發票開立申請審核',
    requests,
    chainSteps,
    roleNameMap,
    currentUserRole: req.user.role,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 核准：未到最後關卡只推進 current_step；到最後關卡才把申請標記為 approved，
// 不會自動建立 invoices 紀錄
router.post('/:id/approve', requireInvoiceRequestApprovalPermission, (req, res) => {
  try {
    const request = InvoiceRequest.findById(req.params.id);
    const result = InvoiceRequest.approve(req.params.id, req.user);

    if (result.advanced) {
      if (request && result.nextStepConfig) {
        NotificationService.notifyApprovalStepApprovers(result.nextStepConfig.role_key, {
          type: 'invoice_request_pending',
          title: `待審核（${result.nextStepConfig.step_name || result.nextStepConfig.role_key}）：${request.project_name || ''}`,
          message: `上一關已核准，審核人：${req.user.name || req.user.username}`,
          link: '/invoice-requests',
          related_type: 'invoice_request',
          related_id: request.id
        }, req.user.id);
      }
      return res.redirect('/invoice-requests?success=' + encodeURIComponent('此關卡已核准，已轉交下一關審核'));
    }

    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'invoice_request_approved',
        title: `審核通過：${request.project_name || ''}`,
        message: `審核人：${req.user.name || req.user.username}，請洽財務開立發票`,
        link: `/projects/${request.project_id}`,
        related_type: 'invoice_request',
        related_id: request.id
      });
    }
    res.redirect('/invoice-requests?success=' + encodeURIComponent('已核准此發票開立申請'));
  } catch (err) {
    console.error(err);
    res.redirect('/invoice-requests?error=' + encodeURIComponent(err.message));
  }
});

// 駁回
router.post('/:id/reject', requireInvoiceRequestApprovalPermission, (req, res) => {
  try {
    const request = InvoiceRequest.findById(req.params.id);
    InvoiceRequest.reject(req.params.id, req.user, req.body.review_note);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'invoice_request_rejected',
        title: `審核駁回：${request.project_name || ''}`,
        message: req.body.review_note ? `駁回原因：${req.body.review_note}` : `審核人：${req.user.name || req.user.username}`,
        link: `/projects/${request.project_id}`,
        related_type: 'invoice_request',
        related_id: request.id
      });
    }
    res.redirect('/invoice-requests?success=' + encodeURIComponent('已駁回此發票開立申請'));
  } catch (err) {
    console.error(err);
    res.redirect('/invoice-requests?error=' + encodeURIComponent(err.message));
  }
});

// PDF 列印（申請單本身，供紙本簽核或存證用）
router.get('/:id/pdf', async (req, res) => {
  try {
    const request = InvoiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).render('error', { title: '找不到申請單', message: '找不到此發票開立申請', error: {} });
    }
    const buffer = await PdfExportService.generateInvoiceRequestPdf(request);
    const filename = `發票開立申請單_${request.project_code || request.id}.pdf`;
    const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err) {
    console.error('產生發票開立申請單 PDF 失敗:', err);
    res.status(500).render('error', { title: '產生 PDF 失敗', message: err.message, error: {} });
  }
});

module.exports = router;
