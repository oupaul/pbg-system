console.log('[啟動] 開始載入應用程式...');

const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');

console.log('[啟動] Express 模組載入完成');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('[啟動] Express 應用程式建立完成，PORT:', PORT);

// 設定檔案上傳
const upload = multer({ 
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Session 設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'invoice-bonus-system-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // 設定為 false，除非您已配置 HTTPS（否則 session cookie 無法在 HTTP 下工作）
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 小時
  }
}));
console.log('[啟動] Session 配置完成');

// 中間件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 設定EJS模板引擎
console.log('[啟動] 設定EJS模板引擎...');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// 在開發環境中禁用緩存
if (process.env.NODE_ENV !== 'production') {
  app.set('view cache', false);
}
console.log('[啟動] ✓ EJS模板引擎設定完成');

// 載入認證中間件
console.log('[啟動] 載入認證中間件...');
const { requireAuth, setUserPermissions } = require('./middleware/auth');
console.log('[啟動] ✓ 認證中間件載入完成');

// 載入部署配置
const deployConfig = require('./config/deploy');

// 載入資料庫
const db = require('./models/db');

// 確保 invoices 表有 expected_payment_date 欄位（向後兼容）
try {
  const tableInfo = db.prepare('PRAGMA table_info(invoices)').all();
  const hasExpectedPaymentDate = tableInfo.some(col => col.name === 'expected_payment_date');
  if (!hasExpectedPaymentDate) {
    console.log('[啟動] 添加 expected_payment_date 欄位到 invoices 表...');
    db.exec('ALTER TABLE invoices ADD COLUMN expected_payment_date TEXT');
    console.log('[啟動] ✓ expected_payment_date 欄位已添加');
  }
} catch (err) {
  console.warn('[啟動] 檢查 expected_payment_date 欄位時發生錯誤:', err.message);
}

// 輔助函數：獲取系統設定
function getSystemSetting(key, defaultValue = null) {
  try {
    const setting = db.prepare('SELECT setting_value, setting_type FROM system_settings WHERE setting_key = ?').get(key);
    if (!setting) {
      return defaultValue;
    }
    
    // 根據類型轉換值
    switch (setting.setting_type) {
      case 'number':
        return parseInt(setting.setting_value, 10);
      case 'boolean':
        return setting.setting_value === 'true';
      case 'json':
        return JSON.parse(setting.setting_value);
      default:
        return setting.setting_value;
    }
  } catch (err) {
    console.error(`獲取系統設定失敗 (${key}):`, err);
    return defaultValue;
  }
}

// 視圖中間件：將用戶資訊和部署配置傳遞給所有視圖
// 必須在所有路由之前，確保所有視圖都能訪問 user 和配置
app.use((req, res, next) => {
  // 從 session 獲取用戶資訊並設定到 req.user
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  // 將部署配置傳遞給所有視圖
  res.locals.pageTitleSuffix = deployConfig.pageTitleSuffix;
  res.locals.siteName = deployConfig.siteName;
  res.locals.footerText = deployConfig.footerText;
  
  // 將閒置登出配置傳遞給所有視圖
  res.locals.idleTimeoutMinutes = getSystemSetting('idle_timeout_minutes', 30);
  res.locals.idleWarningMinutes = getSystemSetting('idle_warning_minutes', 2);
  
  next();
});

// 設定用戶權限標記（必須在設定 req.user 之後）
app.use(setUserPermissions);

// 載入路由
console.log('[啟動] 開始載入路由模組...');
try {
  const authRoutes = require('./routes/auth');
  console.log('[啟動] ✓ auth 路由載入完成');
  const indexRoutes = require('./routes/index');
  console.log('[啟動] ✓ index 路由載入完成');
  const projectRoutes = require('./routes/projects');
  console.log('[啟動] ✓ projects 路由載入完成');
  const invoiceRoutes = require('./routes/invoices');
  console.log('[啟動] ✓ invoices 路由載入完成');
  const paymentRoutes = require('./routes/payments');
  console.log('[啟動] ✓ payments 路由載入完成');
  const bonusRoutes = require('./routes/bonuses');
  console.log('[啟動] ✓ bonuses 路由載入完成');
  const salespersonRoutes = require('./routes/salespeople');
  console.log('[啟動] ✓ salespeople 路由載入完成');
  const customerRoutes = require('./routes/customers');
  console.log('[啟動] ✓ customers 路由載入完成');
  const importExportRoutes = require('./routes/importExport');
  console.log('[啟動] ✓ importExport 路由載入完成');
  const auditLogRoutes = require('./routes/auditLogs');
  console.log('[啟動] ✓ auditLogs 路由載入完成');
  const apiRoutes = require('./routes/api');
  console.log('[啟動] ✓ api 路由載入完成');
  const userRoutes = require('./routes/users');
  console.log('[啟動] ✓ users 路由載入完成');
  const backupRestoreRoutes = require('./routes/backupRestore');
  console.log('[啟動] ✓ backupRestore 路由載入完成');
  const settingsRoutes = require('./routes/settings');
  console.log('[啟動] ✓ settings 路由載入完成');
  const projectTypesRoutes = require('./routes/projectTypes');
  console.log('[啟動] ✓ projectTypes 路由載入完成');
  const recentPaymentsRoutes = require('./routes/recentPayments');
  console.log('[啟動] ✓ recentPayments 路由載入完成');
  const healthRoutes = require('./routes/health');
  console.log('[啟動] ✓ health 路由載入完成');
  const costRoutes = require('./routes/costs');
  console.log('[啟動] ✓ costs 路由載入完成');
  const roleRoutes = require('./routes/roles');
  console.log('[啟動] ✓ roles 路由載入完成');
  const salesPerformanceRoutes = require('./routes/salesPerformance');
  console.log('[啟動] ✓ salesPerformance 路由載入完成');
  const grossProfitRoutes = require('./routes/grossProfit');
  console.log('[啟動] ✓ grossProfit 路由載入完成');

  // 認證路由（不需要登入）- 必須在其他路由之前
  // authRoutes 內部已經定義了 /login 和 /logout 路徑
  app.use(authRoutes);

  // 保護所有其他路由（需要登入）
  app.use('/projects', requireAuth, projectRoutes);
  app.use('/invoices', requireAuth, invoiceRoutes);
  app.use('/payments', requireAuth, paymentRoutes);
  app.use('/costs', requireAuth, costRoutes);
  app.use('/bonuses', requireAuth, bonusRoutes);
  app.use('/salespeople', requireAuth, salespersonRoutes);
  app.use('/customers', requireAuth, customerRoutes);
  app.use('/import-export', requireAuth, importExportRoutes(upload));
  app.use('/audit-logs', requireAuth, auditLogRoutes);
  app.use('/users', requireAuth, userRoutes);
  app.use('/backup-restore', requireAuth, backupRestoreRoutes);
  app.use('/settings', requireAuth, settingsRoutes);
  app.use('/project-types', requireAuth, projectTypesRoutes);
  app.use('/recent-payments', requireAuth, recentPaymentsRoutes);
  app.use('/sales-performance', requireAuth, salesPerformanceRoutes);
  app.use('/gross-profit', requireAuth, grossProfitRoutes);
  app.use('/search', requireAuth, require('./routes/search'));
  app.use('/health', requireAuth, healthRoutes);
  app.use('/roles', requireAuth, roleRoutes);
  app.use('/api', requireAuth, apiRoutes);
  app.use('/', requireAuth, indexRoutes);
  console.log('[啟動] ✓ 所有路由設定完成');
} catch (err) {
  console.error('[啟動錯誤] 載入路由時發生錯誤:', err);
  console.error('[啟動錯誤] 錯誤堆疊:', err.stack);
  throw err;
}

// 錯誤處理
app.use((err, req, res, next) => {
  console.error('[錯誤處理] 捕獲到錯誤:', err.message);
  console.error('[錯誤處理] 錯誤堆疊:', err.stack);
  try {
    res.status(500).render('error', { 
      title: '系統錯誤',
      user: req.session ? req.session.user : null,
      message: '系統錯誤: ' + (err.message || '未知錯誤'),
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  } catch (renderErr) {
    console.error('[錯誤處理] 渲染錯誤頁面失敗:', renderErr.message);
    // 如果渲染錯誤頁面也失敗，直接返回簡單的錯誤訊息
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>系統錯誤</title></head>
      <body>
        <h1>系統錯誤</h1>
        <p>${process.env.NODE_ENV === 'development' ? err.message : '發生錯誤，請稍後再試'}</p>
        <a href="/login">返回登入頁面</a>
      </body>
      </html>
    `);
  }
});

// 404處理
app.use((req, res) => {
  try {
    res.status(404).render('error', { 
      title: '找不到頁面',
      message: '找不到頁面',
      error: {}
    });
  } catch (renderErr) {
    console.error('[404處理] 渲染錯誤頁面失敗:', renderErr.message);
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>找不到頁面</title></head>
      <body>
        <h1>404 - 找不到頁面</h1>
        <p>您請求的頁面不存在</p>
        <a href="/login">返回登入頁面</a>
      </body>
      </html>
    `);
  }
});

// 處理未捕獲的錯誤
process.on('uncaughtException', (err) => {
  console.error('未捕獲的異常:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未處理的 Promise 拒絕:', reason);
});

// 啟動伺服器
const server = app.listen(PORT, () => {
  console.log(`\n🚀 專案開立發票業績認列獎金計算總表系統`);
  console.log(`   運行於 http://localhost:${PORT}`);
  console.log(`   環境: ${process.env.NODE_ENV || 'development'}\n`);
});

// 處理端口衝突錯誤
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 錯誤: 端口 ${PORT} 已被佔用`);
    console.error(`\n請執行以下操作之一：`);
    console.error(`  1. 停止現有服務: sudo systemctl stop invoice-bonus-system`);
    console.error(`  2. 或找出佔用端口的程序: sudo lsof -i :${PORT}`);
    console.error(`  3. 或殺掉佔用端口的程序: sudo kill -9 $(sudo lsof -t -i :${PORT})\n`);
    process.exit(1);
  } else {
    console.error('伺服器啟動錯誤:', err);
    process.exit(1);
  }
});

module.exports = app;
