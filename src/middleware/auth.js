// 認證中間件
const requireAuth = (req, res, next) => {
  // 排除登入和登出路由，避免重定向循環
  if (req.path === '/login' || req.path === '/logout') {
    console.log('[認證] 跳過認證檢查（登入/登出路由）:', req.path);
    return next();
  }
  
  // 檢查是否已經在登入循環中（避免重定向循環）
  if (req.query.redirect && req.query.redirect.includes('/login')) {
    console.log('[認證] 檢測到重定向循環，直接重定向到 /login（無參數）');
    return res.redirect('/login');
  }
  
  if (req.session && req.session.user) {
    // 用戶已登入
    req.user = req.session.user;
    next();
  } else {
    // 用戶未登入，重定向到登入頁面
    // 確保不會創建循環重定向
    const originalUrl = req.originalUrl || req.url;
    console.log('[認證] 用戶未登入，重定向到登入頁面，原始URL:', originalUrl);
    
    // 如果原始 URL 已經包含 redirect 參數且指向 /login，就直接重定向到 /login
    if (originalUrl.includes('/login')) {
      console.log('[認證] 檢測到可能的循環，直接重定向到 /login');
      return res.redirect('/login');
    }
    
    const redirectUrl = '/login?redirect=' + encodeURIComponent(originalUrl);
    console.log('[認證] 重定向URL:', redirectUrl);
    res.redirect(redirectUrl);
  }
};

// 檢查是否已登入（不重定向，用於某些頁面）
const checkAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
};

// 檢查是否有編輯權限
// admin 和 user 有完整權限
// salesperson 和 boss 只有讀取權限
const requireEditPermission = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '未登入' });
  }
  
  const role = req.user.role;
  
  // admin 和 user 有編輯權限
  if (role === 'admin' || role === 'user') {
    return next();
  }
  
  // salesperson 和 boss 只有讀取權限
  if (role === 'salesperson' || role === 'boss') {
    return res.status(403).json({ 
      error: '權限不足', 
      message: '您的帳號只有讀取權限，無法進行編輯操作' 
    });
  }
  
  // 其他情況視為無權限
  return res.status(403).json({ error: '權限不足' });
};

// 檢查是否有管理員權限
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '未登入' });
  }
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: '權限不足', 
      message: '此功能僅限管理員使用' 
    });
  }
  
  next();
};

// 檢查用戶角色並設定權限標記
const setUserPermissions = (req, res, next) => {
  if (req.user) {
    // 設定權限標記
    req.user.canEdit = (req.user.role === 'admin' || req.user.role === 'user');
    req.user.isAdmin = (req.user.role === 'admin');
    req.user.isReadOnly = (req.user.role === 'salesperson' || req.user.role === 'boss');
    req.user.isSalesperson = (req.user.role === 'salesperson');
    req.user.isBoss = (req.user.role === 'boss');
    
    // 將權限資訊傳遞給所有視圖
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
  requireAdmin,
  setUserPermissions
};

