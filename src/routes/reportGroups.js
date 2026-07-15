/**
 * 報表群組管理（僅管理員）
 * 用於毛利分析「依群組彙總」及專案表單的群組選單。
 */
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT * FROM report_groups
      ORDER BY display_order ASC, name ASC
    `).all();

    res.render('reportGroups/index', {
      title: '報表群組管理',
      groups: groups || [],
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入報表群組失敗:', err);
    res.render('reportGroups/index', {
      title: '報表群組管理',
      groups: [],
      success: '',
      error: '載入失敗：' + (err.message || 'report_groups 表可能尚未建立，請先執行遷移')
    });
  }
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.redirect('/report-groups?error=' + encodeURIComponent('群組名稱不能為空'));
  }

  const existing = db.prepare('SELECT id FROM report_groups WHERE name = ?').get(name);
  if (existing) {
    return res.redirect('/report-groups?error=' + encodeURIComponent('群組名稱已存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM report_groups').get();
    const order = req.body.display_order !== '' && req.body.display_order != null
      ? parseInt(req.body.display_order, 10) : ((maxOrder?.max_order ?? 0) + 1);

    db.prepare(`
      INSERT INTO report_groups (name, display_order, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
    `).run(name, order);

    res.redirect('/report-groups?success=' + encodeURIComponent('報表群組新增成功'));
  } catch (err) {
    console.error('新增報表群組失敗:', err);
    res.redirect('/report-groups?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.redirect('/report-groups?error=' + encodeURIComponent('群組名稱不能為空'));
  }

  const existing = db.prepare('SELECT id, name FROM report_groups WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/report-groups?error=' + encodeURIComponent('群組不存在'));
  }

  if (name !== existing.name) {
    const conflict = db.prepare('SELECT id FROM report_groups WHERE name = ? AND id != ?').get(name, id);
    if (conflict) {
      return res.redirect('/report-groups?error=' + encodeURIComponent('群組名稱已被使用'));
    }
  }

  try {
    const order = req.body.display_order !== '' && req.body.display_order != null
      ? parseInt(req.body.display_order, 10) : (existing.display_order ?? 0);

    db.prepare(`
      UPDATE report_groups SET name = ?, display_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
    `).run(name, order, id);

    res.redirect('/report-groups?success=' + encodeURIComponent('報表群組更新成功'));
  } catch (err) {
    console.error('更新報表群組失敗:', err);
    res.redirect('/report-groups?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const group = db.prepare('SELECT id, name FROM report_groups WHERE id = ?').get(id);
  if (!group) {
    return res.redirect('/report-groups?error=' + encodeURIComponent('群組不存在'));
  }

  const count = db.prepare('SELECT COUNT(*) as count FROM projects WHERE report_group_id = ?').get(id);
  if (count.count > 0) {
    return res.redirect('/report-groups?error=' + encodeURIComponent(`無法刪除：仍有 ${count.count} 個專案歸屬此群組`));
  }

  try {
    db.prepare('DELETE FROM report_groups WHERE id = ?').run(id);
    res.redirect('/report-groups?success=' + encodeURIComponent('報表群組刪除成功'));
  } catch (err) {
    console.error('刪除報表群組失敗:', err);
    res.redirect('/report-groups?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

module.exports = router;
