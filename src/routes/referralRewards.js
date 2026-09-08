const express = require('express');
const router = express.Router();
const ReferralReward = require('../models/ReferralReward');
const { getUserInfo } = require('../utils/authHelper');
const { requireCrmEditPermission } = require('../middleware/auth');

// 轉介紹獎勵總覽
router.get('/', (req, res) => {
  const status = req.query.status || '';
  const rewards = ReferralReward.findAll({ status: status || undefined });

  res.render('referralRewards/index', {
    title: '轉介紹獎勵',
    rewards,
    statusFilter: status,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 新增轉介紹獎勵（從客戶詳情頁的表單送出）
router.post('/', requireCrmEditPermission, (req, res) => {
  try {
    ReferralReward.create({
      referring_customer_id: req.body.referring_customer_id,
      referred_customer_id: req.body.referred_customer_id || null,
      project_id: req.body.project_id || null,
      recipient_type: req.body.recipient_type,
      recipient_user_id: req.body.recipient_user_id || null,
      reward_amount: parseFloat(req.body.reward_amount) || 0,
      status: req.body.status || '待發放',
      notes: req.body.notes || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/customers/${req.body.referring_customer_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/customers/${req.body.referring_customer_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新轉介紹獎勵（含狀態變更：標記已發放/充公）
router.post('/:id', requireCrmEditPermission, (req, res) => {
  try {
    const reward = ReferralReward.findById(req.params.id);
    if (!reward) {
      return res.status(404).render('error', { title: '找不到轉介紹獎勵記錄', message: '找不到轉介紹獎勵記錄', error: {} });
    }

    ReferralReward.update(req.params.id, {
      referred_customer_id: req.body.referred_customer_id || null,
      project_id: req.body.project_id || null,
      recipient_type: req.body.recipient_type,
      recipient_user_id: req.body.recipient_user_id || null,
      reward_amount: parseFloat(req.body.reward_amount) || 0,
      status: req.body.status || '待發放',
      forfeiture_reason: req.body.forfeiture_reason || null,
      notes: req.body.notes || null,
      userInfo: getUserInfo(req)
    });

    const redirectTo = req.body.redirect || `/customers/${reward.referring_customer_id}`;
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    const reward = ReferralReward.findById(req.params.id);
    if (reward) {
      const redirectTo = req.body.redirect || `/customers/${reward.referring_customer_id}`;
      res.redirect(redirectTo + '?error=' + encodeURIComponent(err.message));
    } else {
      res.redirect('/referral-rewards?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除轉介紹獎勵
router.post('/:id/delete', requireCrmEditPermission, (req, res) => {
  try {
    const reward = ReferralReward.findById(req.params.id);
    if (!reward) {
      return res.status(404).json({ error: '找不到轉介紹獎勵記錄' });
    }

    const redirectTo = req.body.redirect || `/customers/${reward.referring_customer_id}`;
    ReferralReward.delete(req.params.id, getUserInfo(req));

    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
