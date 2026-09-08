const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM activity_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT type_name, badge_color FROM activity_types').all()
    .forEach(t => { map[t.type_name] = t.badge_color; });
  return map;
}

function countInUse(typeName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM activities WHERE activity_type = ? AND deleted_at IS NULL').get(typeName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const types = db.prepare(`SELECT * FROM activity_types ORDER BY display_order ASC, type_name ASC`).all();
    res.render('activityTypes/index', {
      title: '活動類型管理',
      types,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入活動類型失敗:', err);
    res.render('activityTypes/index', {
      title: '活動類型管理',
      types: [],
      success: '',
      error: '載入活動類型失敗：' + err.message
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { type_name, badge_color, display_order } = req.body;

  if (!type_name || !type_name.trim()) {
    return res.redirect('/activity-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }

  const trimmedName = type_name.trim();
  const existing = db.prepare('SELECT id FROM activity_types WHERE type_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/activity-types?error=' + encodeURIComponent('類型名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM activity_types').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'secondary';

    db.prepare(`
      INSERT INTO activity_types (type_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);

    res.redirect('/activity-types?success=' + encodeURIComponent('活動類型新增成功'));
  } catch (err) {
    console.error('新增活動類型失敗:', err);
    res.redirect('/activity-types?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { type_name, badge_color, display_order, is_active } = req.body;

  const existing = db.prepare('SELECT id, type_name FROM activity_types WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/activity-types?error=' + encodeURIComponent('類型不存在'));
  }

  if (!type_name || !type_name.trim()) {
    return res.redirect('/activity-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }

  const trimmedName = type_name.trim();
  if (trimmedName !== existing.type_name) {
    const nameConflict = db.prepare('SELECT id FROM activity_types WHERE type_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/activity-types?error=' + encodeURIComponent('類型名稱已被其他類型使用'));
    }
  }

  // HTML checkbox 未勾選時瀏覽器完全不會送出這個欄位，不能只判斷是否等於 '0'，
  // 否則「未勾選啟用」會被誤判為沒有值而略過停用檢查
  const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.type_name);
    if (inUse > 0) {
      return res.redirect('/activity-types?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆活動紀錄使用此類型`));
    }
  }

  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'secondary';

    db.prepare(`
      UPDATE activity_types
      SET type_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);

    res.redirect('/activity-types?success=' + encodeURIComponent('活動類型更新成功'));
  } catch (err) {
    console.error('更新活動類型失敗:', err);
    res.redirect('/activity-types?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const type = db.prepare('SELECT type_name FROM activity_types WHERE id = ?').get(id);
  if (!type) {
    return res.redirect('/activity-types?error=' + encodeURIComponent('類型不存在'));
  }

  const inUse = countInUse(type.type_name);
  if (inUse > 0) {
    return res.redirect('/activity-types?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆活動紀錄使用此類型`));
  }

  try {
    db.prepare('DELETE FROM activity_types WHERE id = ?').run(id);
    res.redirect('/activity-types?success=' + encodeURIComponent('活動類型刪除成功'));
  } catch (err) {
    console.error('刪除活動類型失敗:', err);
    res.redirect('/activity-types?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
