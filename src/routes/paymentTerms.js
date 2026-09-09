const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM payment_terms WHERE is_active = 1 ORDER BY display_order ASC, term_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT term_name, badge_color FROM payment_terms').all()
    .forEach(t => { map[t.term_name] = t.badge_color; });
  return map;
}

function countInUse(termName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM costs WHERE payment_term = ?').get(termName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const terms = db.prepare(`SELECT * FROM payment_terms ORDER BY display_order ASC, term_name ASC`).all();
    res.render('paymentTerms/index', {
      title: '付款條件管理',
      terms,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入付款條件失敗:', err);
    res.render('paymentTerms/index', {
      title: '付款條件管理',
      terms: [],
      success: '',
      error: '載入付款條件失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { term_name, badge_color, display_order } = req.body;

  if (!term_name || !term_name.trim()) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件名稱不能為空'));
  }

  const trimmedName = term_name.trim();
  const existing = db.prepare('SELECT id FROM payment_terms WHERE term_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM payment_terms').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO payment_terms (term_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/payment-terms?success=' + encodeURIComponent('付款條件新增成功'));
  } catch (err) {
    console.error('新增付款條件失敗:', err);
    res.redirect('/payment-terms?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { term_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, term_name FROM payment_terms WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件不存在'));
  }

  if (!term_name || !term_name.trim()) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件名稱不能為空'));
  }

  const trimmedName = term_name.trim();
  if (trimmedName !== existing.term_name) {
    const nameConflict = db.prepare('SELECT id FROM payment_terms WHERE term_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件名稱已被其他選項使用'));
    }
  }

  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.term_name);
    if (inUse > 0) {
      return res.redirect('/payment-terms?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆成本記錄使用此付款條件`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE payment_terms
      SET term_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/payment-terms?success=' + encodeURIComponent('付款條件更新成功'));
  } catch (err) {
    console.error('更新付款條件失敗:', err);
    res.redirect('/payment-terms?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const term = db.prepare('SELECT term_name FROM payment_terms WHERE id = ?').get(id);
  if (!term) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent('付款條件不存在'));
  }

  const inUse = countInUse(term.term_name);
  if (inUse > 0) {
    return res.redirect('/payment-terms?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆成本記錄使用此付款條件`));
  }

  try {
    db.prepare('DELETE FROM payment_terms WHERE id = ?').run(id);
    res.redirect('/payment-terms?success=' + encodeURIComponent('付款條件刪除成功'));
  } catch (err) {
    console.error('刪除付款條件失敗:', err);
    res.redirect('/payment-terms?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
