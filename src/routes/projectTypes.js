const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// 取得所有專案類型（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const types = db.prepare(`
      SELECT * FROM project_types 
      ORDER BY display_order ASC, type_name ASC
    `).all();
    
    res.render('projectTypes/index', {
      title: '專案類型管理',
      types: types,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入專案類型失敗:', err);
    res.render('projectTypes/index', {
      title: '專案類型管理',
      types: [],
      success: '',
      error: '載入專案類型失敗：' + err.message
    });
  }
});

// 新增專案類型（僅管理員）
router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { type_name, badge_color, display_order } = req.body;
  
  if (!type_name || !type_name.trim()) {
    return res.redirect('/project-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }
  
  const trimmedName = type_name.trim();
  
  // 檢查名稱是否已存在
  const existing = db.prepare('SELECT id FROM project_types WHERE type_name = ?').get(trimmedName);
  if (existing) {
    return res.redirect('/project-types?error=' + encodeURIComponent('類型名稱已存在'));
  }
  
  try {
    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM project_types').get();
    const order = display_order ? parseInt(display_order, 10) : ((maxOrder?.max_order || 0) + 1);
    const color = badge_color || 'info';
    
    db.prepare(`
      INSERT INTO project_types (type_name, badge_color, display_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(trimmedName, color, order);
    
    res.redirect('/project-types?success=' + encodeURIComponent('專案類型新增成功'));
  } catch (err) {
    console.error('新增專案類型失敗:', err);
    res.redirect('/project-types?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

// 更新專案類型（僅管理員）
router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { type_name, badge_color, display_order, is_active } = req.body;
  
  if (!type_name || !type_name.trim()) {
    return res.redirect('/project-types?error=' + encodeURIComponent('類型名稱不能為空'));
  }
  
  const trimmedName = type_name.trim();
  
  // 檢查類型是否存在
  const existing = db.prepare('SELECT id, type_name FROM project_types WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/project-types?error=' + encodeURIComponent('類型不存在'));
  }
  
  // 如果名稱有變更，檢查新名稱是否已被其他類型使用
  if (trimmedName !== existing.type_name) {
    const nameConflict = db.prepare('SELECT id FROM project_types WHERE type_name = ? AND id != ?').get(trimmedName, id);
    if (nameConflict) {
      return res.redirect('/project-types?error=' + encodeURIComponent('類型名稱已被其他類型使用'));
    }
  }
  
  // 檢查是否有專案使用此類型，如果停用
  if (is_active === '0' || is_active === 0) {
    const projectsUsing = db.prepare('SELECT COUNT(*) as count FROM projects WHERE project_type = ?').get(existing.type_name);
    if (projectsUsing.count > 0) {
      return res.redirect('/project-types?error=' + encodeURIComponent(`無法停用：仍有 ${projectsUsing.count} 個專案使用此類型`));
    }
  }
  
  try {
    const order = display_order ? parseInt(display_order, 10) : existing.display_order || 0;
    const color = badge_color || 'info';
    const active = (is_active === '1' || is_active === 1 || is_active === 'true') ? 1 : 0;
    
    db.prepare(`
      UPDATE project_types 
      SET type_name = ?, badge_color = ?, display_order = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(trimmedName, color, order, active, id);
    
    res.redirect('/project-types?success=' + encodeURIComponent('專案類型更新成功'));
  } catch (err) {
    console.error('更新專案類型失敗:', err);
    res.redirect('/project-types?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 刪除專案類型（僅管理員）
router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  
  // 檢查類型是否存在
  const type = db.prepare('SELECT type_name FROM project_types WHERE id = ?').get(id);
  if (!type) {
    return res.redirect('/project-types?error=' + encodeURIComponent('類型不存在'));
  }
  
  // 檢查是否有專案使用此類型
  const projectsUsing = db.prepare('SELECT COUNT(*) as count FROM projects WHERE project_type = ?').get(type.type_name);
  if (projectsUsing.count > 0) {
    return res.redirect('/project-types?error=' + encodeURIComponent(`無法刪除：仍有 ${projectsUsing.count} 個專案使用此類型`));
  }
  
  try {
    db.prepare('DELETE FROM project_types WHERE id = ?').run(id);
    res.redirect('/project-types?success=' + encodeURIComponent('專案類型刪除成功'));
  } catch (err) {
    console.error('刪除專案類型失敗:', err);
    res.redirect('/project-types?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

module.exports = router;

