const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function findActive() {
  return db.prepare(`SELECT * FROM pipeline_statuses WHERE is_active = 1 ORDER BY display_order ASC`).all();
}

function findColorMap() {
  const map = {};
  db.prepare('SELECT status_name, badge_color FROM pipeline_statuses').all()
    .forEach(s => { map[s.status_name] = s.badge_color; });
  return map;
}

function countInUse(statusName) {
  const row = db.prepare('SELECT COUNT(*) as count FROM pipelines WHERE status = ? AND deleted_at IS NULL').get(statusName);
  return row?.count || 0;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const statuses = db.prepare(`SELECT * FROM pipeline_statuses ORDER BY display_order ASC`).all();
  res.render('pipelineStatuses/index', {
    title: '銷售機會狀態管理',
    statuses,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const statusName = (req.body.status_name || '').trim();
  if (!statusName) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  const existing = db.prepare('SELECT id FROM pipeline_statuses WHERE status_name = ?').get(statusName);
  if (existing) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM pipeline_statuses').get();
    const order = req.body.display_order ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = req.body.badge_color || 'secondary';
    const isWon = req.body.is_won === '1' ? 1 : 0;
    const isLost = req.body.is_lost === '1' ? 1 : 0;

    db.prepare(`
      INSERT INTO pipeline_statuses (status_name, is_won, is_lost, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(statusName, isWon, isLost, color, order);

    res.redirect('/pipeline-statuses?success=' + encodeURIComponent('銷售機會狀態新增成功'));
  } catch (err) {
    console.error('新增銷售機會狀態失敗:', err);
    res.redirect('/pipeline-statuses?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM pipeline_statuses WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  const statusName = (req.body.status_name || '').trim();
  if (!statusName) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態名稱不能為空'));
  }

  if (statusName !== existing.status_name) {
    const conflict = db.prepare('SELECT id FROM pipeline_statuses WHERE status_name = ? AND id != ?').get(statusName, id);
    if (conflict) {
      return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態名稱已被其他狀態使用'));
    }
  }

  const active = (req.body.is_active === '1' || req.body.is_active === 1) ? 1 : 0;

  if (active === 0) {
    const inUse = countInUse(existing.status_name);
    if (inUse > 0) {
      return res.redirect('/pipeline-statuses?error=' + encodeURIComponent(`無法停用：仍有 ${inUse} 筆銷售機會使用此狀態`));
    }
  }

  try {
    const order = req.body.display_order !== undefined && req.body.display_order !== ''
      ? parseInt(req.body.display_order, 10) : existing.display_order;
    const color = req.body.badge_color || existing.badge_color;
    const isWon = req.body.is_won === '1' ? 1 : 0;
    const isLost = req.body.is_lost === '1' ? 1 : 0;

    // 改名時同步更新既有銷售機會與 lost_reason 記錄使用的字面值，避免改名後
    // 舊資料的狀態變成「找不到對應設定」而只能退回舊版寫死判斷
    if (statusName !== existing.status_name) {
      db.prepare('UPDATE pipelines SET status = ? WHERE status = ?').run(statusName, existing.status_name);
    }

    db.prepare(`
      UPDATE pipeline_statuses
      SET status_name = ?, is_won = ?, is_lost = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(statusName, isWon, isLost, color, order, active, id);

    res.redirect('/pipeline-statuses?success=' + encodeURIComponent('銷售機會狀態更新成功'));
  } catch (err) {
    console.error('更新銷售機會狀態失敗:', err);
    res.redirect('/pipeline-statuses?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM pipeline_statuses WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent('狀態不存在'));
  }

  const inUse = countInUse(existing.status_name);
  if (inUse > 0) {
    return res.redirect('/pipeline-statuses?error=' + encodeURIComponent(`無法刪除：仍有 ${inUse} 筆銷售機會使用此狀態`));
  }

  try {
    db.prepare('DELETE FROM pipeline_statuses WHERE id = ?').run(req.params.id);
    res.redirect('/pipeline-statuses?success=' + encodeURIComponent('銷售機會狀態刪除成功'));
  } catch (err) {
    console.error('刪除銷售機會狀態失敗:', err);
    res.redirect('/pipeline-statuses?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
router.findColorMap = findColorMap;
module.exports = router;
