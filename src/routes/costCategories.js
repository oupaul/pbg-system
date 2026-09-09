const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM cost_categories WHERE is_active = 1 ORDER BY display_order ASC, category_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT category_name, badge_color FROM cost_categories').all()
    .forEach(t => { map[t.category_name] = t.badge_color; });
  return map;
}

function countInUse(categoryName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM costs WHERE cost_category = ?').get(categoryName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const categories = db.prepare(`SELECT * FROM cost_categories ORDER BY display_order ASC, category_name ASC`).all();
    res.render('costCategories/index', {
      title: '費用類別管理',
      categories,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入費用類別失敗:', err);
    res.render('costCategories/index', {
      title: '費用類別管理',
      categories: [],
      success: '',
      error: '載入費用類別失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { category_name, badge_color, display_order } = req.body;

  if (!category_name || !category_name.trim()) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent('類別名稱不能為空'));
  }

  const trimmedName = category_name.trim();
  const existing = db.prepare('SELECT id FROM cost_categories WHERE category_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent('類別名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM cost_categories').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO cost_categories (category_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/cost-categories?success=' + encodeURIComponent('費用類別新增成功'));
  } catch (err) {
    console.error('新增費用類別失敗:', err);
    res.redirect('/cost-categories?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { category_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, category_name FROM cost_categories WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent('類別不存在'));
  }

  if (!category_name || !category_name.trim()) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent('類別名稱不能為空'));
  }

  const trimmedName = category_name.trim();
  if (trimmedName !== existing.category_name) {
    const nameConflict = db.prepare('SELECT id FROM cost_categories WHERE category_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/cost-categories?error=' + encodeURIComponent('類別名稱已被其他類別使用'));
    }
  }

  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.category_name);
    if (inUse > 0) {
      return res.redirect('/cost-categories?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆成本記錄使用此類別`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE cost_categories
      SET category_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/cost-categories?success=' + encodeURIComponent('費用類別更新成功'));
  } catch (err) {
    console.error('更新費用類別失敗:', err);
    res.redirect('/cost-categories?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const category = db.prepare('SELECT category_name FROM cost_categories WHERE id = ?').get(id);
  if (!category) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent('類別不存在'));
  }

  const inUse = countInUse(category.category_name);
  if (inUse > 0) {
    return res.redirect('/cost-categories?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆成本記錄使用此類別`));
  }

  try {
    db.prepare('DELETE FROM cost_categories WHERE id = ?').run(id);
    res.redirect('/cost-categories?success=' + encodeURIComponent('費用類別刪除成功'));
  } catch (err) {
    console.error('刪除費用類別失敗:', err);
    res.redirect('/cost-categories?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
