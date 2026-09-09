const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY display_order ASC, method_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT method_name, badge_color FROM payment_methods').all()
    .forEach(t => { map[t.method_name] = t.badge_color; });
  return map;
}

function countInUse(methodName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM costs WHERE payment_method = ?').get(methodName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const methods = db.prepare(`SELECT * FROM payment_methods ORDER BY display_order ASC, method_name ASC`).all();
    res.render('paymentMethods/index', {
      title: '付款辦法管理',
      methods,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入付款辦法失敗:', err);
    res.render('paymentMethods/index', {
      title: '付款辦法管理',
      methods: [],
      success: '',
      error: '載入付款辦法失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { method_name, badge_color, display_order } = req.body;

  if (!method_name || !method_name.trim()) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法名稱不能為空'));
  }

  const trimmedName = method_name.trim();
  const existing = db.prepare('SELECT id FROM payment_methods WHERE method_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM payment_methods').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO payment_methods (method_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/payment-methods?success=' + encodeURIComponent('付款辦法新增成功'));
  } catch (err) {
    console.error('新增付款辦法失敗:', err);
    res.redirect('/payment-methods?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { method_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, method_name FROM payment_methods WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法不存在'));
  }

  if (!method_name || !method_name.trim()) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法名稱不能為空'));
  }

  const trimmedName = method_name.trim();
  if (trimmedName !== existing.method_name) {
    const nameConflict = db.prepare('SELECT id FROM payment_methods WHERE method_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法名稱已被其他選項使用'));
    }
  }

  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.method_name);
    if (inUse > 0) {
      return res.redirect('/payment-methods?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆成本記錄使用此付款辦法`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE payment_methods
      SET method_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/payment-methods?success=' + encodeURIComponent('付款辦法更新成功'));
  } catch (err) {
    console.error('更新付款辦法失敗:', err);
    res.redirect('/payment-methods?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const method = db.prepare('SELECT method_name FROM payment_methods WHERE id = ?').get(id);
  if (!method) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent('付款辦法不存在'));
  }

  const inUse = countInUse(method.method_name);
  if (inUse > 0) {
    return res.redirect('/payment-methods?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆成本記錄使用此付款辦法`));
  }

  try {
    db.prepare('DELETE FROM payment_methods WHERE id = ?').run(id);
    res.redirect('/payment-methods?success=' + encodeURIComponent('付款辦法刪除成功'));
  } catch (err) {
    console.error('刪除付款辦法失敗:', err);
    res.redirect('/payment-methods?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
