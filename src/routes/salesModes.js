const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM sales_modes WHERE is_active = 1 ORDER BY display_order ASC, mode_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT mode_name, badge_color FROM sales_modes').all()
    .forEach(t => { map[t.mode_name] = t.badge_color; });
  return map;
}

function countInUse(modeName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM projects WHERE sales_mode = ?').get(modeName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const types = db.prepare(`SELECT * FROM sales_modes ORDER BY display_order ASC, mode_name ASC`).all();
    res.render('salesModes/index', {
      title: '銷售模式管理',
      types,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入銷售模式失敗:', err);
    res.render('salesModes/index', {
      title: '銷售模式管理',
      types: [],
      success: '',
      error: '載入銷售模式失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { mode_name, badge_color, display_order } = req.body;

  if (!mode_name || !mode_name.trim()) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent('模式名稱不能為空'));
  }

  const trimmedName = mode_name.trim();
  const existing = db.prepare('SELECT id FROM sales_modes WHERE mode_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent('模式名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM sales_modes').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO sales_modes (mode_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/sales-modes?success=' + encodeURIComponent('銷售模式新增成功'));
  } catch (err) {
    console.error('新增銷售模式失敗:', err);
    res.redirect('/sales-modes?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { mode_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, mode_name FROM sales_modes WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent('模式不存在'));
  }

  if (!mode_name || !mode_name.trim()) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent('模式名稱不能為空'));
  }

  const trimmedName = mode_name.trim();
  if (trimmedName !== existing.mode_name) {
    const nameConflict = db.prepare('SELECT id FROM sales_modes WHERE mode_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/sales-modes?error=' + encodeURIComponent('模式名稱已被其他模式使用'));
    }
  }

  // HTML checkbox 未勾選時瀏覽器完全不會送出這個欄位，不能只判斷是否等於 '0'，
  // 否則「未勾選啟用」會被誤判為沒有值而略過停用檢查
  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.mode_name);
    if (inUse > 0) {
      return res.redirect('/sales-modes?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆專案使用此模式`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE sales_modes
      SET mode_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/sales-modes?success=' + encodeURIComponent('銷售模式更新成功'));
  } catch (err) {
    console.error('更新銷售模式失敗:', err);
    res.redirect('/sales-modes?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const type = db.prepare('SELECT mode_name FROM sales_modes WHERE id = ?').get(id);
  if (!type) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent('模式不存在'));
  }

  const inUse = countInUse(type.mode_name);
  if (inUse > 0) {
    return res.redirect('/sales-modes?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆專案使用此模式`));
  }

  try {
    db.prepare('DELETE FROM sales_modes WHERE id = ?').run(id);
    res.redirect('/sales-modes?success=' + encodeURIComponent('銷售模式刪除成功'));
  } catch (err) {
    console.error('刪除銷售模式失敗:', err);
    res.redirect('/sales-modes?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
