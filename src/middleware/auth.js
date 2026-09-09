const { ROLES, PROJECT_VIEW_SCOPE } = require('../constants');

// Lazy-load Role to avoid circular dependency at module init time
function getRolePermissions(roleKey) {
  try {
    const Role = require('../models/Role');
    return Role.findByKey(roleKey) || null;
  } catch {
    return null;
  }
}

// 多層簽核：即使角色沒有對應的單層審核旗標，只要被設定為某一關的審核角色也算有權限，
// 這樣才能存取審核列表頁面去處理輪到自己的那一關（實際能不能核准/駁回由 model 層再驗證一次）
function isApprovalChainRole(approvalType, roleKey) {
  try {
    const db = require('../models/db');
    const row = db.prepare(`
      SELECT 1 FROM approval_chain_steps WHERE approval_type = ? AND role_key = ? AND is_active = 1 LIMIT 1
    `).get(approvalType, roleKey);
    return !!row;
  } catch {
    return false;
  }
}

const requireAuth = (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();

  if (req.query.redirect && req.query.redirect.includes('/login')) {
    return res.redirect('/login');
  }

  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  const originalUrl = req.originalUrl || req.url;
  if (originalUrl.includes('/login')) return res.redirect('/login');
  res.redirect('/login?redirect=' + encodeURIComponent(originalUrl));
};

const checkAuth = (req, res, next) => {
  if (req.session && req.session.user) req.user = req.session.user;
  next();
};

// Uses roles table (can_edit) so custom roles work correctly.
const requireEditPermission = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '未登入' });

  const role = getRolePermissions(req.user.role);
  if (role && role.can_edit) return next();

  return res.status(403).json({
    error: '權限不足',
    message: '您的帳號只有讀取權限，無法進行編輯操作'
  });
};

// CRM（客戶/銷售機會）編輯權限：獨立於財務相關的 can_edit，
// 業務開發是業務員的基本工作內容，不因專案唯讀限制而連帶受限。
const requireCrmEditPermission = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '未登入' });

  const role = getRolePermissions(req.user.role);
  if (role && role.can_edit_crm) return next();

  return res.status(403).json({
    error: '權限不足',
    message: '您的帳號沒有客戶/商機編輯權限'
  });
};

// 刪除審核頁面：僅限具備 can_delete 權限的角色（可直接刪除的人，才能審核他人的刪除申請）
const requireDeletePermission = (req, res, next) => {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.status(403).render('error', { title: '權限不足', message: '此功能僅限具備刪除權限的角色使用', error: {} });
    }
    return res.status(401).json({ error: '未登入' });
  }

  const role = getRolePermissions(req.user.role);
  if (role && role.can_delete) return next();
  if (isApprovalChainRole('deletion', req.user.role)) return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '權限不足', message: '此功能僅限具備刪除權限的角色使用', error: {} });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限具備刪除權限的角色使用' });
};

// 新客戶/廠商審核：僅限具備 can_approve_customer 權限的角色
const requireCustomerApprovalPermission = (req, res, next) => {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.status(403).render('error', { title: '權限不足', message: '此功能僅限具備審核權限的角色使用', error: {} });
    }
    return res.status(401).json({ error: '未登入' });
  }

  const role = getRolePermissions(req.user.role);
  if (role && role.can_approve_customer) return next();
  if (isApprovalChainRole('customer_creation', req.user.role)) return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', { title: '權限不足', message: '此功能僅限具備審核權限的角色使用', error: {} });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限具備審核權限的角色使用' });
};

// 匯入/匯出功能：僅限具備 can_edit 權限的角色（Uses roles table so custom roles work correctly）
const requireImportExport = (req, res, next) => {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.status(403).render('error', {
        title: '權限不足',
        message: '此功能僅限系統管理員與專案管理員使用',
        error: {}
      });
    }
    return res.status(401).json({ error: '未登入' });
  }

  const role = getRolePermissions(req.user.role);
  if (role && role.can_edit) return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', {
      title: '權限不足',
      message: '此功能僅限系統管理員與專案管理員使用',
      error: {}
    });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限系統管理員與專案管理員使用' });
};

// Uses roles table (can_manage_users) so custom admin-like roles work correctly.
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    // JSON vs HTML response
    if (req.accepts('html')) {
      return res.status(403).render('error', {
        title: '權限不足',
        message: '此功能僅限管理員使用',
        error: {}
      });
    }
    return res.status(401).json({ error: '未登入' });
  }

  const role = getRolePermissions(req.user.role);
  if (role && role.can_manage_users) return next();

  // Fallback: built-in admin role always has access
  if (req.user.role === ROLES.ADMIN) return next();

  if (req.accepts('html')) {
    return res.status(403).render('error', {
      title: '權限不足',
      message: '此功能僅限管理員使用',
      error: {}
    });
  }
  return res.status(403).json({ error: '權限不足', message: '此功能僅限管理員使用' });
};

const setUserPermissions = (req, res, next) => {
  if (req.user) {
    try {
      const User = require('../models/User');
      User.updateLastActive(req.user.id);
    } catch { /* 更新線上狀態失敗不應影響正常請求 */ }

    const role = getRolePermissions(req.user.role);

    req.user.canEdit = role ? !!role.can_edit : req.user.role === ROLES.ADMIN || req.user.role === ROLES.USER;
    req.user.canDelete = role ? !!role.can_delete : req.user.canEdit;
    req.user.canEditCrm = role ? !!role.can_edit_crm : req.user.canEdit || req.user.role === ROLES.SALESPERSON;
    req.user.canApproveCustomer = role ? !!role.can_approve_customer : (req.user.role === ROLES.ADMIN || req.user.role === ROLES.USER);
    // 多層簽核設定的關卡角色也要能看到審核列表頁與待審核數量，即使沒有單層審核旗標
    // （例如只被設定為「總經理」那一關，本身不需要 can_approve_customer/can_delete）
    req.user.canAccessCustomerApprovals = req.user.canApproveCustomer || isApprovalChainRole('customer_creation', req.user.role);
    req.user.canAccessDeletionApprovals = req.user.canDelete || isApprovalChainRole('deletion', req.user.role);
    req.user.isAdmin = role ? !!role.can_manage_users : req.user.role === ROLES.ADMIN;
    req.user.isReadOnly = !req.user.canEdit;
    req.user.isSalesperson = req.user.role === ROLES.SALESPERSON;
    req.user.isBoss = req.user.role === ROLES.BOSS;

    // Resolve project_view_scope from roles table, fall back to legacy logic
    if (role && role.project_view_scope) {
      req.user.project_view_scope = role.project_view_scope;
    } else {
      // Legacy fallback for roles created before the migration
      req.user.project_view_scope = req.user.isSalesperson
        ? PROJECT_VIEW_SCOPE.OWN
        : PROJECT_VIEW_SCOPE.ALL;
    }

    res.locals.user = req.user;
    res.locals.canEdit = req.user.canEdit;
    res.locals.canEditCrm = req.user.canEditCrm;
    res.locals.canDelete = req.user.canDelete;
    res.locals.canApproveCustomer = req.user.canApproveCustomer;
    res.locals.canAccessCustomerApprovals = req.user.canAccessCustomerApprovals;
    res.locals.canAccessDeletionApprovals = req.user.canAccessDeletionApprovals;
    res.locals.isAdmin = req.user.isAdmin;
    res.locals.isReadOnly = req.user.isReadOnly;

    if (req.user.canAccessDeletionApprovals) {
      try {
        const db = require('../models/db');
        const row = db.prepare(`SELECT COUNT(*) as count FROM deletion_requests WHERE status = 'pending'`).get();
        res.locals.pendingDeletionCount = row ? row.count : 0;
      } catch {
        res.locals.pendingDeletionCount = 0;
      }
    }

    // 新客戶/廠商審核：具備 can_approve_customer 權限或是多層簽核某一關的角色，才需要看到待審核數量
    if (req.user.canAccessCustomerApprovals) {
      try {
        const db = require('../models/db');
        const row = db.prepare(`SELECT COUNT(*) as count FROM customer_creation_requests WHERE request_status = 'pending'`).get();
        res.locals.pendingCustomerApprovalCount = row ? row.count : 0;
      } catch {
        res.locals.pendingCustomerApprovalCount = 0;
      }
    }

    // 通知中心：僅在 GET 請求時計算（系統提醒的建立採 dedup，重複執行不會產生重複通知，
    // 限制在 GET 是為了避免每次表單送出的 POST 動作都額外查詢一次）
    try {
      const Notification = require('../models/Notification');
      const NotificationService = require('../services/NotificationService');
      if (req.method === 'GET') {
        NotificationService.generateReminderNotifications(req.user);
      }
      res.locals.unreadNotificationCount = Notification.countUnread(req.user.id);
      res.locals.recentNotifications = Notification.findForUser(req.user.id, { limit: 8 });
      res.locals.getNotificationIcon = NotificationService.getNotificationIcon;
    } catch {
      res.locals.unreadNotificationCount = 0;
      res.locals.recentNotifications = [];
    }
  }
  next();
};

module.exports = {
  requireAuth,
  checkAuth,
  requireEditPermission,
  requireCrmEditPermission,
  requireDeletePermission,
  requireCustomerApprovalPermission,
  requireImportExport,
  requireAdmin,
  setUserPermissions
};
