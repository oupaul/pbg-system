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

// 匯入/匯出功能：僅限系統管理員（admin）與專案管理員（user）
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

  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.USER) return next();

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
    const role = getRolePermissions(req.user.role);

    req.user.canEdit = role ? !!role.can_edit : req.user.role === ROLES.ADMIN || req.user.role === ROLES.USER;
    req.user.canDelete = role ? !!role.can_delete : req.user.canEdit;
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
    res.locals.isAdmin = req.user.isAdmin;
    res.locals.isReadOnly = req.user.isReadOnly;
  }
  next();
};

module.exports = {
  requireAuth,
  checkAuth,
  requireEditPermission,
  requireImportExport,
  requireAdmin,
  setUserPermissions
};
