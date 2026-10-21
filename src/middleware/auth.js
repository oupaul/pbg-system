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

// 強制變更預設密碼：帳號被標記 must_change_password（目前只有全新安裝時建立的預設
// admin 帳號會是 1）時，除了修改密碼頁本身與登出以外，一律導向修改密碼頁——
// 避免帳號留著固定的預設密碼卻忘記改掉。
// 角色要求強制雙因素驗證、但使用者尚未啟用：除了設定頁與登出，其他一律導向設定頁。
// 先改密碼（must_change_password）再設定雙因素驗證，避免兩個強制流程互相導來導去。
const TWO_FACTOR_SETUP_ALLOWED_PREFIXES = ['/account/security', '/logout', '/change-password', '/healthz'];
const enforceTwoFactorSetup = (req, res, next) => {
  if (!req.user || !req.user.must_setup_2fa || req.user.must_change_password) return next();
  if (TWO_FACTOR_SETUP_ALLOWED_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  if (req.method === 'GET' && req.accepts('html')) return res.redirect('/account/security/2fa/setup');
  return res.status(403).json({ error: '需要先設定雙因素驗證', message: '您的角色要求啟用雙因素驗證，請先到「帳號安全」完成設定' });
};

const enforcePasswordChange = (req, res, next) => {
  if (!req.user || !req.user.must_change_password) return next();
  if (req.path === '/change-password' || req.path === '/logout') return next();
  res.redirect('/change-password');
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

// 依角色旗標放行（roles 表），自訂角色也能正確運作。
// 內建 admin 角色永遠放行，避免角色設定被改壞時整個系統沒有人能再進入管理頁面。
function requireRoleFlag(flag, message) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.accepts('html')) {
        return res.status(403).render('error', { title: '權限不足', message, error: {} });
      }
      return res.status(401).json({ error: '未登入' });
    }

    const role = getRolePermissions(req.user.role);
    if (role && role[flag]) return next();
    if (req.user.role === ROLES.ADMIN) return next();

    if (req.accepts('html')) {
      return res.status(403).render('error', { title: '權限不足', message, error: {} });
    }
    return res.status(403).json({ error: '權限不足', message });
  };
}

// 使用者管理、修改記錄、登入紀錄、系統健康、廣播通知、客戶匯入匯出等（can_manage_users）
const requireAdmin = requireRoleFlag('can_manage_users', '此功能僅限管理員使用');
// 角色管理（can_manage_roles）
const requireManageRoles = requireRoleFlag('can_manage_roles', '此功能僅限具備「角色管理」權限的角色使用');
// 系統設定與各種選項／類型／狀態／簽核關卡管理（can_manage_settings）
const requireManageSettings = requireRoleFlag('can_manage_settings', '此功能僅限具備「系統設定」權限的角色使用');
// 備份還原（can_backup_restore）
const requireBackupRestore = requireRoleFlag('can_backup_restore', '此功能僅限具備「備份還原」權限的角色使用');
// 專案總表／成本明細的批次匯入（can_import；另需通過 /import-export 的 can_edit 檢查）
const requireImport = requireRoleFlag('can_import', '此功能僅限具備「批次匯入」權限的角色使用');

// 密碼雜湊的指紋（存在 session 裡）：使用者改密碼或管理員重設密碼後指紋會變，
// 其他已登入的 session 下一次請求就會失效，不會讓舊登入狀態在改密碼後繼續有效。
function passwordFingerprint(passwordHash) {
  return require('crypto').createHash('sha256').update(String(passwordHash || '')).digest('hex').slice(0, 16);
}

// 閒置登出等「背景輪詢」不算使用者活動，否則開著頁面的分頁會讓 session 永遠不會閒置過期
function isBackgroundRequest(req) {
  return req.method === 'GET' && req.path === '/notifications/poll';
}

// 每次請求都以資料庫為準重新驗證 session 中的使用者：
// 帳號被停用、被刪除、密碼被改、角色或業務關聯被調整，都立即生效，不用等 session 過期。
// 另外在伺服器端強制閒置逾時（前端的閒置登出只是 JavaScript，可以被繞過或關掉）。
// 回傳 false 代表已經回應（session 失效），呼叫端不可再 next()。
function revalidateSession(req, res) {
  const sessionUser = req.session && req.session.user;
  if (!sessionUser) return true;

  let row = null;
  try {
    const db = require('../models/db');
    try {
      row = db.prepare('SELECT id, username, name, role, salesperson_id, is_active, must_change_password, password_hash, totp_enabled FROM users WHERE id = ?').get(sessionUser.id);
    } catch {
      // 舊資料庫尚未執行 must_change_password migration 時的退路：不能因此整個停用 session 驗證
      row = db.prepare('SELECT id, username, name, role, salesperson_id, is_active, password_hash FROM users WHERE id = ?').get(sessionUser.id);
    }
  } catch { /* 查詢失敗時不踢人，沿用 session 內容 */ return true; }

  let invalid = !row || !row.is_active;
  if (!invalid) {
    const fingerprint = passwordFingerprint(row.password_hash);
    if (sessionUser.pwv && sessionUser.pwv !== fingerprint) invalid = true;
    else if (!sessionUser.pwv) sessionUser.pwv = fingerprint; // 舊 session 第一次補上指紋
  }

  // 伺服器端閒置逾時：系統設定的閒置分鐘數 + 5 分鐘緩衝（0 代表不限制）
  if (!invalid) {
    try {
      const db = require('../models/db');
      const setting = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'idle_timeout_minutes'").get();
      const idleMinutes = setting ? parseInt(setting.setting_value, 10) : 30;
      const now = Date.now();
      if (idleMinutes > 0 && req.session.lastActivity && now - req.session.lastActivity > (idleMinutes + 5) * 60 * 1000) {
        invalid = true;
      } else if (!isBackgroundRequest(req) && (!req.session.lastActivity || now - req.session.lastActivity > 30 * 1000)) {
        req.session.lastActivity = now;
      }
    } catch { /* 忽略 */ }
  }

  if (invalid) {
    req.session.destroy(() => {
      if (req.path === '/login' || req.path === '/logout') return res.redirect('/login');
      if (req.accepts('html')) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl || req.url));
      return res.status(401).json({ error: '登入已失效，請重新登入' });
    });
    return false;
  }

  // 以資料庫為準更新 session 內的使用者資料（角色、姓名、業務關聯、強制改密碼旗標）
  sessionUser.username = row.username;
  sessionUser.name = row.name;
  sessionUser.role = row.role;
  sessionUser.salesperson_id = row.salesperson_id || null;
  sessionUser.must_change_password = !!row.must_change_password;
  // 雙因素驗證：角色要求強制啟用、但這個使用者還沒啟用 → 必須先完成設定才能使用系統（見 enforceTwoFactorSetup）
  const roleRow = getRolePermissions(row.role);
  sessionUser.totp_enabled = !!row.totp_enabled;
  sessionUser.must_setup_2fa = !!(roleRow && roleRow.require_2fa) && !row.totp_enabled;
  req.user = sessionUser;
  return true;
}

const setUserPermissions = (req, res, next) => {
  if (!revalidateSession(req, res)) return;
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
    // 內建 admin 角色永遠具備（與 requireRoleFlag 一致）
    const isBuiltInAdmin = req.user.role === ROLES.ADMIN;
    req.user.canManageRoles = isBuiltInAdmin || !!(role && role.can_manage_roles);
    req.user.canManageSettings = isBuiltInAdmin || !!(role && role.can_manage_settings);
    req.user.canBackupRestore = isBuiltInAdmin || !!(role && role.can_backup_restore);
    req.user.canImport = isBuiltInAdmin || !!(role && role.can_import);
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
    res.locals.canManageRoles = req.user.canManageRoles;
    res.locals.canManageSettings = req.user.canManageSettings;
    res.locals.canBackupRestore = req.user.canBackupRestore;
    res.locals.canImport = req.user.canImport;
    res.locals.mustSetup2fa = !!req.user.must_setup_2fa;
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
  passwordFingerprint,
  requireAuth,
  checkAuth,
  enforcePasswordChange,
  enforceTwoFactorSetup,
  requireEditPermission,
  requireCrmEditPermission,
  requireDeletePermission,
  requireCustomerApprovalPermission,
  requireImportExport,
  requireAdmin,
  requireManageRoles,
  requireManageSettings,
  requireBackupRestore,
  requireImport,
  requireRoleFlag,
  setUserPermissions
};
