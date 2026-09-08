const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function getActiveProjectTypeNames() {
  try {
    return db.prepare(`SELECT type_name FROM project_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC`).all().map(t => t.type_name);
  } catch (err) {
    return [];
  }
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const tiers = db.prepare(`SELECT * FROM bonus_tiers ORDER BY project_type ASC, tier_name ASC`).all();
    res.render('bonusTiers/index', {
      title: '獎金級距設定',
      tiers,
      projectTypes: getActiveProjectTypeNames(),
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入獎金級距失敗:', err);
    res.render('bonusTiers/index', {
      title: '獎金級距設定',
      tiers: [],
      projectTypes: getActiveProjectTypeNames(),
      success: '',
      error: '載入獎金級距失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { project_type, tier_name, percentage, cost_deduction_rate, description } = req.body;

  if (!project_type || !project_type.trim() || !tier_name || !tier_name.trim()) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent('專案類型與級距名稱不能為空'));
  }

  const trimmedType = project_type.trim();
  const trimmedName = tier_name.trim();

  const validType = getActiveProjectTypeNames().includes(trimmedType);
  if (!validType) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent(`專案類型「${trimmedType}」不存在或已停用`));
  }

  try {
    db.prepare(`
      INSERT INTO bonus_tiers (project_type, tier_name, percentage, cost_deduction_rate, description, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(
      trimmedType,
      trimmedName,
      parseFloat(percentage) || 0,
      parseFloat(cost_deduction_rate) || 0,
      description || null
    );

    res.redirect('/bonus-tiers?success=' + encodeURIComponent('獎金級距新增成功'));
  } catch (err) {
    console.error('新增獎金級距失敗:', err);
    res.redirect('/bonus-tiers?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { project_type, tier_name, percentage, cost_deduction_rate, description, is_active } = req.body;

  const existing = db.prepare('SELECT id FROM bonus_tiers WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent('獎金級距不存在'));
  }

  if (!project_type || !project_type.trim() || !tier_name || !tier_name.trim()) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent('專案類型與級距名稱不能為空'));
  }

  const trimmedType = project_type.trim();
  const trimmedName = tier_name.trim();

  const validType = getActiveProjectTypeNames().includes(trimmedType);
  if (!validType) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent(`專案類型「${trimmedType}」不存在或已停用`));
  }

  try {
    const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

    db.prepare(`
      UPDATE bonus_tiers
      SET project_type = ?, tier_name = ?, percentage = ?, cost_deduction_rate = ?, description = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      trimmedType,
      trimmedName,
      parseFloat(percentage) || 0,
      parseFloat(cost_deduction_rate) || 0,
      description || null,
      active,
      id
    );

    res.redirect('/bonus-tiers?success=' + encodeURIComponent('獎金級距更新成功'));
  } catch (err) {
    console.error('更新獎金級距失敗:', err);
    res.redirect('/bonus-tiers?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const tier = db.prepare('SELECT id FROM bonus_tiers WHERE id = ?').get(id);
  if (!tier) {
    return res.redirect('/bonus-tiers?error=' + encodeURIComponent('獎金級距不存在'));
  }

  try {
    db.prepare('DELETE FROM bonus_tiers WHERE id = ?').run(id);
    res.redirect('/bonus-tiers?success=' + encodeURIComponent('獎金級距刪除成功'));
  } catch (err) {
    console.error('刪除獎金級距失敗:', err);
    res.redirect('/bonus-tiers?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

module.exports = router;
