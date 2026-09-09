const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM order_statuses WHERE is_active = 1 ORDER BY display_order ASC, status_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT status_name, badge_color FROM order_statuses').all()
    .forEach(t => { map[t.status_name] = t.badge_color; });
  return map;
}

function countInUse(statusName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM costs WHERE order_status = ?').get(statusName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const statuses = db.prepare(`SELECT * FROM order_statuses ORDER BY display_order ASC, status_name ASC`).all();
    res.render('orderStatuses/index', {
      title: '下單狀態管理',
      statuses,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入下單狀態失敗:', err);
    res.render('orderStatuses/index', {
      title: '下單狀態管理',
      statuses: [],
      success: '',
      error: '載入下單狀態失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { status_name, badge_color, display_order } = req.body;

  if (!status_name || !status_name.trim()) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  const trimmedName = status_name.trim();
  const existing = db.prepare('SELECT id FROM order_statuses WHERE status_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM order_statuses').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO order_statuses (status_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/order-statuses?success=' + encodeURIComponent('下單狀態新增成功'));
  } catch (err) {
    console.error('新增下單狀態失敗:', err);
    res.redirect('/order-statuses?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, status_name FROM order_statuses WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  if (!status_name || !status_name.trim()) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  const trimmedName = status_name.trim();
  if (trimmedName !== existing.status_name) {
    const nameConflict = db.prepare('SELECT id FROM order_statuses WHERE status_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態名稱已被其他選項使用'));
    }
  }

  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.status_name);
    if (inUse > 0) {
      return res.redirect('/order-statuses?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆成本記錄使用此狀態`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE order_statuses
      SET status_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/order-statuses?success=' + encodeURIComponent('下單狀態更新成功'));
  } catch (err) {
    console.error('更新下單狀態失敗:', err);
    res.redirect('/order-statuses?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const status = db.prepare('SELECT status_name FROM order_statuses WHERE id = ?').get(id);
  if (!status) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  const inUse = countInUse(status.status_name);
  if (inUse > 0) {
    return res.redirect('/order-statuses?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆成本記錄使用此狀態`));
  }

  try {
    db.prepare('DELETE FROM order_statuses WHERE id = ?').run(id);
    res.redirect('/order-statuses?success=' + encodeURIComponent('下單狀態刪除成功'));
  } catch (err) {
    console.error('刪除下單狀態失敗:', err);
    res.redirect('/order-statuses?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
