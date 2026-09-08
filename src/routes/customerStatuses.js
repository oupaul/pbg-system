const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 客戶詳情/列表表單用：啟用中的客戶往來狀態，依顯示順序排序
function findActive() {
  return db.prepare(`
    SELECT * FROM customer_statuses
    WHERE is_active = 1
    ORDER BY display_order ASC, status_name ASC
  `).all();
}

// 名稱 -> 顏色對照表（含停用的狀態，既有客戶資料若用了已停用的狀態，畫面仍要能查到顏色顯示）
function findColorMap() {
  const map = {};
  db.prepare('SELECT status_name, badge_color FROM customer_statuses').all()
    .forEach(s => { map[s.status_name] = s.badge_color; });
  return map;
}

// 是否有客戶或送審中的申請在用這個狀態名稱
function countInUse(statusName) {
  const customers = db.prepare('SELECT COUNT(*) as count FROM customers WHERE status = ? AND deleted_at IS NULL').get(statusName);
  const requests = db.prepare('SELECT COUNT(*) as count FROM customer_creation_requests WHERE status = ?').get(statusName);
  return (customers?.count || 0) + (requests?.count || 0);
}

// 客戶狀態管理（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const statuses = db.prepare(`
    SELECT * FROM customer_statuses ORDER BY display_order ASC, status_name ASC
  `).all();

  res.render('customerStatuses/index', {
    title: '客戶狀態管理',
    statuses,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

// 新增客戶狀態（僅管理員）
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const statusName = (req.body.status_name || '').trim();
  if (!statusName) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  const existing = db.prepare('SELECT id FROM customer_statuses WHERE status_name = ?').get(statusName);
  if (existing) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM customer_statuses').get();
    const order = req.body.display_order ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = req.body.badge_color || 'secondary';

    db.prepare(`
      INSERT INTO customer_statuses (status_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(statusName, color, order);

    res.redirect('/customer-statuses?success=' + encodeURIComponent('客戶狀態新增成功'));
  } catch (err) {
    console.error('新增客戶狀態失敗:', err);
    res.redirect('/customer-statuses?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

// 更新客戶狀態（僅管理員）
router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM customer_statuses WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  const statusName = (req.body.status_name || '').trim();
  if (!statusName) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  if (statusName !== existing.status_name) {
    const conflict = db.prepare('SELECT id FROM customer_statuses WHERE status_name = ? AND id != ?').get(statusName, id);
    if (conflict) {
      return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態名稱已被其他狀態使用'));
    }
  }

  const active = (req.body.is_active === '1' || req.body.is_active === 1) ? 1 : 0;

  // 停用前檢查是否有客戶（含送審中的申請）在用這個狀態名稱
  if (active === 0) {
    const inUse = countInUse(existing.status_name);
    if (inUse > 0) {
      return res.redirect('/customer-statuses?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆客戶/申請使用此狀態`));
    }
  }

  try {
    const order = req.body.display_order !== undefined && req.body.display_order !== ''
      ? parseInt(req.body.display_order, 10) : existing.display_order;
    const color = req.body.badge_color || existing.badge_color;

    db.prepare(`
      UPDATE customer_statuses
      SET status_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(statusName, color, order, active, id);

    res.redirect('/customer-statuses?success=' + encodeURIComponent('客戶狀態更新成功'));
  } catch (err) {
    console.error('更新客戶狀態失敗:', err);
    res.redirect('/customer-statuses?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 刪除客戶狀態（僅管理員）
router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM customer_statuses WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  const inUse = countInUse(existing.status_name);
  if (inUse > 0) {
    return res.redirect('/customer-statuses?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆客戶/申請使用此狀態`));
  }

  try {
    db.prepare('DELETE FROM customer_statuses WHERE id = ?').run(req.params.id);
    res.redirect('/customer-statuses?success=' + encodeURIComponent('客戶狀態刪除成功'));
  } catch (err) {
    console.error('刪除客戶狀態失敗:', err);
    res.redirect('/customer-statuses?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
