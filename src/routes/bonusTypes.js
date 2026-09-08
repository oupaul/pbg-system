const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 新增獎金表單用：啟用中的獎金類型，依顯示順序排序
function findActive() {
  return db.prepare(`
    SELECT * FROM bonus_types
    WHERE is_active = 1
    ORDER BY display_order ASC, type_name ASC
  `).all();
}

// 獎金類型管理（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const types = db.prepare(`
    SELECT * FROM bonus_types ORDER BY display_order ASC, type_name ASC
  `).all();

  res.render('bonusTypes/index', {
    title: '獎金類型管理',
    types,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

// 新增獎金類型（僅管理員）
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const typeName = (req.body.type_name || '').trim();
  if (!typeName) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }

  const existing = db.prepare('SELECT id FROM bonus_types WHERE type_name = ?').get(typeName);
  if (existing) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent('類型名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM bonus_types').get();
    const order = req.body.display_order ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order || 0) + 1);

    db.prepare(`
      INSERT INTO bonus_types (type_name, display_order, is_active, updated_at)
      VALUES (?, ?, 1, datetime('now', 'localtime'))
    `).run(typeName, order);

    res.redirect('/bonus-types?success=' + encodeURIComponent('獎金類型新增成功'));
  } catch (err) {
    console.error('新增獎金類型失敗:', err);
    res.redirect('/bonus-types?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

// 更新獎金類型（僅管理員）
router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM bonus_types WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent('類型不存在'));
  }

  const typeName = (req.body.type_name || '').trim();
  if (!typeName) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }

  if (typeName !== existing.type_name) {
    const conflict = db.prepare('SELECT id FROM bonus_types WHERE type_name = ? AND id != ?').get(typeName, id);
    if (conflict) {
      return res.redirect('/bonus-types?error=' + encodeURIComponent('類型名稱已被其他類型使用'));
    }
  }

  const active = (req.body.is_active === '1' || req.body.is_active === 1) ? 1 : 0;

  // 停用前檢查是否有獎金記錄在用這個類型名稱
  if (active === 0) {
    const inUse = db.prepare('SELECT COUNT(*) as count FROM bonus_calculations WHERE bonus_type = ?').get(existing.type_name);
    if (inUse.count > 0) {
      return res.redirect('/bonus-types?error=' + encodeURIComponent(`無法停用：仍有 ${inUse.count} 筆獎金記錄使用此類型`));
    }
  }

  try {
    const order = req.body.display_order !== undefined && req.body.display_order !== ''
      ? parseInt(req.body.display_order, 10) : existing.display_order;

    db.prepare(`
      UPDATE bonus_types
      SET type_name = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(typeName, order, active, id);

    res.redirect('/bonus-types?success=' + encodeURIComponent('獎金類型更新成功'));
  } catch (err) {
    console.error('更新獎金類型失敗:', err);
    res.redirect('/bonus-types?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 刪除獎金類型（僅管理員）
router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM bonus_types WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent('類型不存在'));
  }

  const inUse = db.prepare('SELECT COUNT(*) as count FROM bonus_calculations WHERE bonus_type = ?').get(existing.type_name);
  if (inUse.count > 0) {
    return res.redirect('/bonus-types?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse.count} 筆獎金記錄使用此類型`));
  }

  try {
    db.prepare('DELETE FROM bonus_types WHERE id = ?').run(req.params.id);
    res.redirect('/bonus-types?success=' + encodeURIComponent('獎金類型刪除成功'));
  } catch (err) {
    console.error('刪除獎金類型失敗:', err);
    res.redirect('/bonus-types?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
module.exports = router;
