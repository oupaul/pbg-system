// 專案存取範圍檢查（依角色的 project_view_scope：全部／指派／自己／無）。
// 寫入類路由原本只檢查「可編輯」，沒檢查操作的專案是否在使用者範圍內，
// 範圍為「自己／指派」的角色可藉由猜 id 修改他人專案的發票、收款、成本、獎金、附件。
// 這裡的判斷沿用 Project._isInScope（未綁定業務的「自己」範圍一律拒絕，不放行）。
const db = require('../models/db');
const Project = require('../models/Project');

function userCanAccessProject(user, projectId) {
  const id = parseInt(projectId, 10);
  if (!id || !user) return false;
  const row = db.prepare('SELECT id, salesperson_id FROM projects WHERE id = ?').get(id);
  return !!row && Project._isInScope(row, user);
}

function deny(req, res) {
  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '權限不足', message: '此專案不在您的權限範圍內', error: {} });
  }
  return res.status(403).json({ error: '權限不足', message: '此專案不在您的權限範圍內' });
}

// 專案編號放在 req.body.project_id（新增發票/收款/成本/獎金）
function requireProjectScopeFromBody(req, res, next) {
  return userCanAccessProject(req.user, req.body && req.body.project_id) ? next() : deny(req, res);
}

// 專案編號放在路由參數（預設 :id）
function requireProjectScopeFromParam(param = 'id') {
  return (req, res, next) => (userCanAccessProject(req.user, req.params[param]) ? next() : deny(req, res));
}

// 記錄（發票/收款/成本/獎金）的 :id，經 findById 取得所屬專案再檢查；記錄不存在時放行，交給路由本身回 404
function requireProjectScopeFromRecord(findById, param = 'id') {
  return (req, res, next) => {
    const record = findById(req.params[param]);
    if (!record) return next();
    return userCanAccessProject(req.user, record.project_id) ? next() : deny(req, res);
  };
}

// :id 必須是純數字（附件上傳的檔名會用到它，避免 ../ 之類的路徑穿越）
function requireNumericParam(param = 'id') {
  return (req, res, next) => {
    if (!/^\d+$/.test(String(req.params[param] || ''))) {
      return res.status(400).render('error', { title: '請求錯誤', message: '無效的識別碼', error: {} });
    }
    next();
  };
}

module.exports = {
  userCanAccessProject,
  requireProjectScopeFromBody,
  requireProjectScopeFromParam,
  requireProjectScopeFromRecord,
  requireNumericParam
};
