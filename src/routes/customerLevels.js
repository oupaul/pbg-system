const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 客戶詳情/列表表單用：啟用中的客戶等級，依顯示順序排序
function findActive() {
  return db.prepare(`
    SELECT * FROM customer_levels
    WHERE is_active = 1
    ORDER BY display_order ASC, level_name ASC
  `).all();
}

// 名稱 -> 顏色對照表（含停用的等級，既有客戶資料若用了已停用的等級，畫面仍要能查到顏色顯示）
function findColorMap() {
  const map = {};
  db.prepare('SELECT level_name, badge_color FROM customer_levels').all()
    .forEach(l => { map[l.level_name] = l.badge_color; });
  return map;
}

// 是否有客戶或送審中的申請在用這個等級名稱
function countInUse(levelName) {
  const customers = db.prepare('SELECT COUNT(*) as count FROM customers WHERE customer_level = ? AND deleted_at IS NULL').get(levelName);
  const requests = db.prepare('SELECT COUNT(*) as count FROM customer_creation_requests WHERE customer_level = ?').get(levelName);
  return (customers?.count || 0) + (requests?.count || 0);
}

// 客戶等級管理（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const levels = db.prepare(`
    SELECT * FROM customer_levels ORDER BY display_order ASC, level_name ASC
  `).all();

  res.render('customerLevels/index', {
    title: '客戶等級管理',
    levels,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

// 新增客戶等級（僅管理員）
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const levelName = (req.body.level_name || '').trim();
  if (!levelName) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent('等級名稱不能為空'));
  }

  const existing = db.prepare('SELECT id FROM customer_levels WHERE level_name = ?').get(levelName);
  if (existing) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent('等級名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM customer_levels').get();
    const order = req.body.display_order ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = req.body.badge_color || 'secondary';

    db.prepare(`
      INSERT INTO customer_levels (level_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(levelName, color, order);

    res.redirect('/customer-levels?success=' + encodeURIComponent('客戶等級新增成功'));
  } catch (err) {
    console.error('新增客戶等級失敗:', err);
    res.redirect('/customer-levels?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

// 更新客戶等級（僅管理員）
router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM customer_levels WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent('等級不存在'));
  }

  const levelName = (req.body.level_name || '').trim();
  if (!levelName) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent('等級名稱不能為空'));
  }

  if (levelName !== existing.level_name) {
    const conflict = db.prepare('SELECT id FROM customer_levels WHERE level_name = ? AND id != ?').get(levelName, id);
    if (conflict) {
      return res.redirect('/customer-levels?error=' + encodeURIComponent('等級名稱已被其他等級使用'));
    }
  }

  const active = (req.body.is_active === '1' || req.body.is_active === 1) ? 1 : 0;

  // 停用前檢查是否有客戶（含送審中的申請）在用這個等級名稱
  if (active === 0) {
    const inUse = countInUse(existing.level_name);
    if (inUse > 0) {
      return res.redirect('/customer-levels?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆客戶/申請使用此等級`));
    }
  }

  try {
    const order = req.body.display_order !== undefined && req.body.display_order !== ''
      ? parseInt(req.body.display_order, 10) : existing.display_order;
    const color = req.body.badge_color || existing.badge_color;

    db.prepare(`
      UPDATE customer_levels
      SET level_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(levelName, color, order, active, id);

    res.redirect('/customer-levels?success=' + encodeURIComponent('客戶等級更新成功'));
  } catch (err) {
    console.error('更新客戶等級失敗:', err);
    res.redirect('/customer-levels?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 刪除客戶等級（僅管理員）
router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM customer_levels WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent('等級不存在'));
  }

  const inUse = countInUse(existing.level_name);
  if (inUse > 0) {
    return res.redirect('/customer-levels?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆客戶/申請使用此等級`));
  }

  try {
    db.prepare('DELETE FROM customer_levels WHERE id = ?').run(req.params.id);
    res.redirect('/customer-levels?success=' + encodeURIComponent('客戶等級刪除成功'));
  } catch (err) {
    console.error('刪除客戶等級失敗:', err);
    res.redirect('/customer-levels?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
