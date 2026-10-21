const express = require('express');
const { toMoney } = require('../utils/money');
const router = express.Router();
const Cost = require('../models/Cost');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');
const { requireProjectScopeFromBody, requireProjectScopeFromRecord } = require('../utils/projectScope');

// 寫入成本需要編輯權限，且操作的專案必須在使用者的專案範圍內
const costScope = requireProjectScopeFromRecord(id => Cost.findById(id));

// 新增成本
router.post('/', requireEditPermission, requireProjectScopeFromBody, (req, res) => {
  try {
    Cost.create({
      project_id: req.body.project_id,
      cost_date: req.body.cost_date,
      cost_type: req.body.cost_type || null,
      vendor_id: req.body.vendor_id || null,
      estimated_amount: toMoney(req.body.estimated_amount),
      actual_amount: toMoney(req.body.actual_amount),
      notes: req.body.notes || null,
      item_code: req.body.item_code || null,
      item_name: req.body.item_name || '',
      cost_category: req.body.cost_category || null,
      payment_method: req.body.payment_method || null,
      payment_term: req.body.payment_term || null,
      order_status: req.body.order_status || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新成本
router.post('/:id', requireEditPermission, costScope, (req, res) => {
  try {
    const cost = Cost.findById(req.params.id);
    if (!cost) {
      return res.status(404).render('error', { 
        title: '找不到成本記錄',
        message: '找不到成本記錄', 
        error: {} 
      });
    }

    Cost.update(req.params.id, {
      cost_date: req.body.cost_date,
      cost_type: req.body.cost_type || null,
      vendor_id: req.body.vendor_id || null,
      estimated_amount: toMoney(req.body.estimated_amount),
      actual_amount: toMoney(req.body.actual_amount),
      notes: req.body.notes || null,
      item_code: req.body.item_code || null,
      item_name: req.body.item_name || '',
      cost_category: req.body.cost_category || null,
      payment_method: req.body.payment_method || null,
      payment_term: req.body.payment_term || null,
      order_status: req.body.order_status || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${cost.project_id}`);
  } catch (err) {
    console.error(err);
    const cost = Cost.findById(req.params.id);
    if (cost) {
      res.redirect(`/projects/${cost.project_id}?error=` + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除成本
router.post('/:id/delete', requireEditPermission, costScope, (req, res) => {
  try {
    const cost = Cost.findById(req.params.id);
    if (!cost) {
      return res.status(404).json({ error: '找不到成本記錄' });
    }

    const projectId = cost.project_id;
    Cost.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;

