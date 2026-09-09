const express = require('express');
const router = express.Router();
const DeletionRequest = require('../models/DeletionRequest');
const Activity = require('../models/Activity');
const ApprovalChain = require('../models/ApprovalChain');
const Role = require('../models/Role');
const { requireDeletePermission } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const TARGET_LABELS = {
  pipeline: '銷售機會',
  activity: '活動紀錄',
  customer: '客戶/廠商'
};

// 依申請的目標類型組出可點擊回原始資料的連結
function buildTargetLink(request) {
  if (request.target_type === 'pipeline') {
    return `/pipelines/${request.target_id}`;
  }
  if (request.target_type === 'activity') {
    const activity = Activity.findById(request.target_id);
    return activity ? `/customers/${activity.customer_id}` : null;
  }
  if (request.target_type === 'customer') {
    return `/customers/${request.target_id}`;
  }
  return null;
}

// 待審核刪除申請列表（僅具備刪除權限的角色可見）
router.get('/', requireDeletePermission, (req, res) => {
  const requests = DeletionRequest.findPending().map(r => ({
    ...r,
    target_link: buildTargetLink(r)
  }));
  const chainSteps = ApprovalChain.getSteps('deletion');
  const roleNameMap = {};
  Role.findAll(true).forEach(r => { roleNameMap[r.role_key] = r.role_name; });

  res.render('deletion-requests/index', {
    title: '刪除審核',
    requests,
    targetLabels: TARGET_LABELS,
    chainSteps,
    roleNameMap,
    currentUserRole: req.user.role,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 核准：真正執行刪除
router.post('/:id/approve', requireDeletePermission, (req, res) => {
  try {
    const request = DeletionRequest.findById(req.params.id);
    const result = DeletionRequest.approve(req.params.id, req.user);

    if (result && result.advanced) {
      // 多層簽核：這一關通過了，但還沒到最後一關，通知下一關的角色，不通知申請人
      if (request && result.nextStepConfig) {
        NotificationService.notifyApprovalStepApprovers(result.nextStepConfig.role_key, {
          type: 'deletion_request_pending',
          title: `待審核（${result.nextStepConfig.step_name || result.nextStepConfig.role_key}）：${request.target_summary || ''}`,
          message: `上一關已核准，審核人：${req.user.name || req.user.username}`,
          link: '/deletion-requests',
          related_type: 'deletion_request',
          related_id: request.id
        }, req.user.id);
      }
      return res.redirect('/deletion-requests?success=' + encodeURIComponent('此關卡已核准，已轉交下一關審核'));
    }

    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'deletion_request_approved',
        title: `刪除申請已核准：${request.target_summary || ''}`,
        message: `審核人：${req.user.name || req.user.username}`,
        link: '/deletion-requests',
        related_type: 'deletion_request',
        related_id: request.id
      });
    }
    res.redirect('/deletion-requests?success=' + encodeURIComponent('已核准，資料已刪除'));
  } catch (err) {
    console.error(err);
    res.redirect('/deletion-requests?error=' + encodeURIComponent(err.message));
  }
});

// 駁回：資料維持不變
router.post('/:id/reject', requireDeletePermission, (req, res) => {
  try {
    const request = DeletionRequest.findById(req.params.id);
    DeletionRequest.reject(req.params.id, req.user, req.body.review_note);
    if (request) {
      NotificationService.notify(request.requested_by, {
        type: 'deletion_request_rejected',
        title: `刪除申請已駁回：${request.target_summary || ''}`,
        message: req.body.review_note ? `駁回原因：${req.body.review_note}` : `審核人：${req.user.name || req.user.username}`,
        link: buildTargetLink(request) || '/deletion-requests',
        related_type: 'deletion_request',
        related_id: request.id
      });
    }
    res.redirect('/deletion-requests?success=' + encodeURIComponent('已駁回此刪除申請，資料維持不變'));
  } catch (err) {
    console.error(err);
    res.redirect('/deletion-requests?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
