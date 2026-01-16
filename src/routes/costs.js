const express = require('express');
const router = express.Router();
const Cost = require('../models/Cost');
const { getUserInfo } = require('../utils/authHelper');

// 新增成本
router.post('/', (req, res) => {
  try {
    Cost.create({
      project_id: req.body.project_id,
      cost_date: req.body.cost_date,
      cost_type: req.body.cost_type || null,
      amount: parseFloat(req.body.amount) || 0,
      notes: req.body.notes || null,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新成本
router.post('/:id', (req, res) => {
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
      amount: parseFloat(req.body.amount) || 0,
      notes: req.body.notes || null,
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
router.post('/:id/delete', (req, res) => {
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

