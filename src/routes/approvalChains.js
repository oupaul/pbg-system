const express = require('express');
const router = express.Router();
const db = require('../models/db');
const ApprovalChain = require('../models/ApprovalChain');
const Role = require('../models/Role');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const APPROVAL_TYPES = {
  customer_creation: '新客戶/廠商審核',
  deletion: '刪除審核'
};

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const chains = {};
  Object.keys(APPROVAL_TYPES).forEach(type => {
    chains[type] = ApprovalChain.getAllSteps(type);
  });

  res.render('approvalChains/index', {
    title: '簽核關卡設定',
    chains,
    approvalTypes: APPROVAL_TYPES,
    roles: Role.findAll(),
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

router.post('/create', requireAuth, requireAdmin, (req, res) => {
  const { approval_type, role_key, step_name } = req.body;

  if (!APPROVAL_TYPES[approval_type]) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('無效的申請類型'));
  }
  if (!role_key) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('請選擇審核角色'));
  }
  if (!Role.findByKey(role_key)) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('角色不存在'));
  }

  try {
    const maxOrder = db.prepare('SELECT MAX(step_order) as max_order FROM approval_chain_steps WHERE approval_type = ?').get(approval_type);
    const order = (maxOrder?.max_order || 0) + 1;

    db.prepare(`
      INSERT INTO approval_chain_steps (approval_type, step_order, role_key, step_name, is_active, updated_at)
      VALUES (?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(approval_type, order, role_key, step_name || null);

    res.redirect('/approval-chains?success=' + encodeURIComponent('關卡新增成功'));
  } catch (err) {
    console.error('新增簽核關卡失敗:', err);
    res.redirect('/approval-chains?error=' + encodeURIComponent('新增失敗：' + err.message));
  }
});

function countStuckAtStep(approvalType, stepOrder) {
  const targetTable = approvalType === 'deletion' ? 'deletion_requests' : 'customer_creation_requests';
  const statusCol = approvalType === 'deletion' ? 'status' : 'request_status';
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${targetTable} WHERE ${statusCol} = 'pending' AND current_step = ?`).get(stepOrder);
  return row?.count || 0;
}

router.post('/update/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { role_key, step_name, is_active } = req.body;

  const existing = db.prepare('SELECT * FROM approval_chain_steps WHERE id = ?').get(id);
  if (!existing) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('關卡不存在'));
  }
  if (!role_key || !Role.findByKey(role_key)) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('請選擇有效的審核角色'));
  }

  // HTML checkbox 未勾選時瀏覽器不會送出這個欄位，先算出 active 再判斷是否要停用
  const active = (is_active === '1' || is_active === 1) ? 1 : 0;
  if (active === 0) {
    const stuck = countStuckAtStep(existing.approval_type, existing.step_order);
    if (stuck > 0) {
      return res.redirect('/approval-chains?error=' + encodeURIComponent(`無法停用：仍有 ${stuck} 筆申請正卡在此關卡，請先處理完畢`));
    }
  }

  try {
    db.prepare(`
      UPDATE approval_chain_steps
      SET role_key = ?, step_name = ?, is_active = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(role_key, step_name || null, active, id);

    res.redirect('/approval-chains?success=' + encodeURIComponent('關卡更新成功'));
  } catch (err) {
    console.error('更新簽核關卡失敗:', err);
    res.redirect('/approval-chains?error=' + encodeURIComponent('更新失敗：' + err.message));
  }
});

// 上移/下移：跟相鄰的關卡互換 step_order
router.post('/reorder/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const direction = req.body.direction === 'up' ? 'up' : 'down';

  const current = db.prepare('SELECT * FROM approval_chain_steps WHERE id = ?').get(id);
  if (!current) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('關卡不存在'));
  }

  const neighbor = direction === 'up'
    ? db.prepare('SELECT * FROM approval_chain_steps WHERE approval_type = ? AND step_order < ? ORDER BY step_order DESC LIMIT 1').get(current.approval_type, current.step_order)
    : db.prepare('SELECT * FROM approval_chain_steps WHERE approval_type = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1').get(current.approval_type, current.step_order);

  if (!neighbor) {
    return res.redirect('/approval-chains?success=' + encodeURIComponent('已經是第一關/最後一關'));
  }

  // 調整順序會改變每一關對應的角色，若剛好有申請卡在這兩關其中一關，
  // 調整後審核者會對不上，先擋下避免造成資料不一致
  const stuckCurrent = countStuckAtStep(current.approval_type, current.step_order);
  const stuckNeighbor = countStuckAtStep(current.approval_type, neighbor.step_order);
  if (stuckCurrent > 0 || stuckNeighbor > 0) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('無法調整順序：有申請正卡在這兩關其中一關，請先處理完畢再調整'));
  }

  try {
    const swap = db.transaction(() => {
      // 先挪到一個暫時不會撞到 UNIQUE(approval_type, step_order) 的值，避免交換時衝突
      db.prepare('UPDATE approval_chain_steps SET step_order = -1 WHERE id = ?').run(current.id);
      db.prepare('UPDATE approval_chain_steps SET step_order = ? WHERE id = ?').run(current.step_order, neighbor.id);
      db.prepare('UPDATE approval_chain_steps SET step_order = ? WHERE id = ?').run(neighbor.step_order, current.id);
    });
    swap();
    res.redirect('/approval-chains?success=' + encodeURIComponent('順序已調整'));
  } catch (err) {
    console.error('調整簽核關卡順序失敗:', err);
    res.redirect('/approval-chains?error=' + encodeURIComponent('調整失敗：' + err.message));
  }
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM approval_chain_steps WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent('關卡不存在'));
  }

  // 刪除前檢查是否有申請正卡在這一關，避免留下永遠卡住的申請
  const stuck = countStuckAtStep(existing.approval_type, existing.step_order);
  if (stuck > 0) {
    return res.redirect('/approval-chains?error=' + encodeURIComponent(`無法刪除：仍有 ${stuck} 筆申請卡在此關卡，請先處理完畢`));
  }

  try {
    db.prepare('DELETE FROM approval_chain_steps WHERE id = ?').run(req.params.id);
    res.redirect('/approval-chains?success=' + encodeURIComponent('關卡刪除成功'));
  } catch (err) {
    console.error('刪除簽核關卡失敗:', err);
    res.redirect('/approval-chains?error=' + encodeURIComponent('刪除失敗：' + err.message));
  }
});

module.exports = router;
