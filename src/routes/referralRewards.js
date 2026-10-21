const express = require('express');
const { toMoney } = require('../utils/money');
const router = express.Router();
const ReferralReward = require('../models/ReferralReward');
const { getUserInfo } = require('../utils/authHelper');
const safeRedirect = require('../utils/safeRedirect');
const { requireCrmEditPermission } = require('../middleware/auth');
const { userCanAccessProject } = require('../utils/projectScope');

// 轉介紹獎勵總覽
router.get('/', (req, res) => {
  const status = req.query.status || '';
  const rewards = ReferralReward.findAll({ status: status || undefined }, req.user);

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
    // 關聯的專案必須在自己的專案檢視範圍內（避免用範圍外專案的獎勵探測或寫入他人專案資料）
    if (req.body.project_id && !userCanAccessProject(req.user, req.body.project_id)) {
      return res.status(403).render('error', { title: '權限不足', message: '此專案不在您的權限範圍內', error: {} });
    }
    ReferralReward.create({
      referring_customer_id: req.body.referring_customer_id,
      referred_customer_id: req.body.referred_customer_id || null,
      project_id: req.body.project_id || null,
      recipient_type: req.body.recipient_type,
      recipient_user_id: req.body.recipient_user_id || null,
      reward_amount: toMoney(req.body.reward_amount),
      status: req.body.status || '待發放',
      notes: req.body.notes || null,
      createdByUserId: req.user && Number.isInteger(req.user.id) ? req.user.id : null,
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
    if (!ReferralReward.isVisibleTo(reward.id, req.user)) {
      return res.status(403).render('error', { title: '權限不足', message: '此轉介紹獎勵不在您的權限範圍內', error: {} });
    }
    if (req.body.project_id && !userCanAccessProject(req.user, req.body.project_id)) {
      return res.status(403).render('error', { title: '權限不足', message: '此專案不在您的權限範圍內', error: {} });
    }

    ReferralReward.update(req.params.id, {
      referred_customer_id: req.body.referred_customer_id || null,
      project_id: req.body.project_id || null,
      recipient_type: req.body.recipient_type,
      recipient_user_id: req.body.recipient_user_id || null,
      reward_amount: toMoney(req.body.reward_amount),
      status: req.body.status || '待發放',
      forfeiture_reason: req.body.forfeiture_reason || null,
      notes: req.body.notes || null,
      userInfo: getUserInfo(req)
    });

    const redirectTo = safeRedirect(req.body.redirect, `/customers/${reward.referring_customer_id}`);
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    const reward = ReferralReward.findById(req.params.id);
    if (reward) {
      const redirectTo = safeRedirect(req.body.redirect, `/customers/${reward.referring_customer_id}`);
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
    if (!ReferralReward.isVisibleTo(reward.id, req.user)) {
      return res.status(403).json({ error: '權限不足', message: '此轉介紹獎勵不在您的權限範圍內' });
    }

    const redirectTo = safeRedirect(req.body.redirect, `/customers/${reward.referring_customer_id}`);
    ReferralReward.delete(req.params.id, getUserInfo(req));

    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
