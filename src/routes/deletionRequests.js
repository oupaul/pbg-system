const express = require('express');
const router = express.Router();
const DeletionRequest = require('../models/DeletionRequest');
const Activity = require('../models/Activity');
const { requireDeletePermission } = require('../middleware/auth');

const TARGET_LABELS = {
  pipeline: '潛在商機',
  activity: '活動紀錄'
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
  return null;
}

// 待審核刪除申請列表（僅具備刪除權限的角色可見）
router.get('/', requireDeletePermission, (req, res) => {
  const requests = DeletionRequest.findPending().map(r => ({
    ...r,
    target_link: buildTargetLink(r)
  }));

  res.render('deletion-requests/index', {
    title: '刪除審核',
    requests,
    targetLabels: TARGET_LABELS,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 核准：真正執行刪除
router.post('/:id/approve', requireDeletePermission, (req, res) => {
  try {
    DeletionRequest.approve(req.params.id, req.user);
    res.redirect('/deletion-requests?success=' + encodeURIComponent('已核准，資料已刪除'));
  } catch (err) {
    console.error(err);
    res.redirect('/deletion-requests?error=' + encodeURIComponent(err.message));
  }
});

// 駁回：資料維持不變
router.post('/:id/reject', requireDeletePermission, (req, res) => {
  try {
    DeletionRequest.reject(req.params.id, req.user, req.body.review_note);
    res.redirect('/deletion-requests?success=' + encodeURIComponent('已駁回此刪除申請，資料維持不變'));
  } catch (err) {
    console.error(err);
    res.redirect('/deletion-requests?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
