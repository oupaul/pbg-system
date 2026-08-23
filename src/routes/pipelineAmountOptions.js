const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 銷售機會表單用：啟用中的金額選項，依顯示順序排序
function findActive() {
  return db.prepare(`
    SELECT * FROM pipeline_amount_options
    WHERE is_active = 1
    ORDER BY display_order ASC, amount ASC
  `).all();
}

// 金額選項管理（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const options = db.prepare(`
    SELECT * FROM pipeline_amount_options ORDER BY display_order ASC, amount ASC
  `).all();

  res.render('pipelineAmountOptions/index', {
    title: '銷售機會金額選項管理',
    options,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

// 新增金額選項（僅管理員）
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount <= 0) {
    return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('請輸入大於 0 的金額'));
  }

  const existing = db.prepare('SELECT id FROM pipeline_amount_options WHERE amount = ?').get(amount);
  if (existing) {
    return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('此金額已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM pipeline_amount_options').get();
    const order = req.body.display_order ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order || 0) + 1);

    db.prepare(`
      INSERT INTO pipeline_amount_options (amount, display_order, is_active, updated_at)
      VALUES (?, ?, 1, datetime('now', 'localtime'))
    `).run(amount, order);

    res.redirect('/pipeline-amount-options?success=' + encodeURIComponent('金額選項新增成功'));
  } catch (err) {
    console.error('新增金額選項失敗:', err);
    res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

// 更新金額選項（僅管理員）
router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM pipeline_amount_options WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('選項不存在'));
  }

  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount <= 0) {
    return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('請輸入大於 0 的金額'));
  }

  if (amount !== existing.amount) {
    const conflict = db.prepare('SELECT id FROM pipeline_amount_options WHERE amount = ? AND id != ?').get(amount, id);
    if (conflict) {
      return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('此金額已被其他選項使用'));
    }
  }

  try {
    const order = req.body.display_order !== undefined && req.body.display_order !== ''
      ? parseInt(req.body.display_order, 10) : existing.display_order;
    const active = (req.body.is_active === '1' || req.body.is_active === 1) ? 1 : 0;

    db.prepare(`
      UPDATE pipeline_amount_options
      SET amount = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(amount, order, active, id);

    res.redirect('/pipeline-amount-options?success=' + encodeURIComponent('金額選項更新成功'));
  } catch (err) {
    console.error('更新金額選項失敗:', err);
    res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 刪除金額選項（僅管理員）
// pipelines.estimated_amount 是自由數值欄位、不參照本表，刪除選項不影響既有銷售機會
router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM pipeline_amount_options WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('選項不存在'));
  }

  try {
    db.prepare('DELETE FROM pipeline_amount_options WHERE id = ?').run(req.params.id);
    res.redirect('/pipeline-amount-options?success=' + encodeURIComponent('金額選項刪除成功'));
  } catch (err) {
    console.error('刪除金額選項失敗:', err);
    res.redirect('/pipeline-amount-options?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

router.findActive = findActive;
module.exports = router;
