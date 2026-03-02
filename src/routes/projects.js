const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../models/db');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Bonus = require('../models/Bonus');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');
const AuditLogService = require('../services/AuditLogService');

// 專案附件上傳：儲存至 uploads/attachments，檔名唯一
const attachmentsDir = path.join(__dirname, '..', '..', 'uploads', 'attachments');
if (!fs.existsSync(attachmentsDir)) {
  fs.mkdirSync(attachmentsDir, { recursive: true });
}
const uploadAttachment = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, attachmentsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const name = `project_${req.params.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/** 修正上傳檔名編碼：瀏覽器常以 UTF-8 傳送中文，若被解為 Latin-1 會變亂碼 */
function fixFilenameEncoding(name) {
  if (!name || typeof name !== 'string') return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded;
  } catch (e) {
    return name;
  }
}

function getAttachmentsByProject(projectId, options = {}) {
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_attachments'").get();
    if (!table) return [];
    const includeDeleted = options.includeDeleted === true;
    const sql = includeDeleted
      ? 'SELECT * FROM project_attachments WHERE project_id = ? ORDER BY deleted_at IS NULL DESC, created_at DESC'
      : 'SELECT * FROM project_attachments WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC';
    return db.prepare(sql).all(projectId);
  } catch (e) {
    return [];
  }
}

// 輔助函數：獲取所有啟用的專案類型
function getActiveProjectTypes() {
  try {
    return db.prepare(`
      SELECT * FROM project_types 
      WHERE is_active = 1 
      ORDER BY display_order ASC, type_name ASC
    `).all();
  } catch (err) {
    console.error('獲取專案類型失敗:', err);
    // 如果表不存在，返回空陣列
    return [];
  }
}

// 輔助函數：獲取類型顏色（包括停用的類型）
function getProjectTypeColor(typeName) {
  try {
    const type = db.prepare('SELECT badge_color FROM project_types WHERE type_name = ?').get(typeName);
    return type ? type.badge_color : 'info';
  } catch (err) {
    // 如果表不存在或查詢失敗，使用預設顏色
    return 'info';
  }
}

// 輔助函數：獲取所有報表群組（供專案表單下拉選單）
function getReportGroups() {
  try {
    return db.prepare(`
      SELECT * FROM report_groups ORDER BY display_order ASC, name ASC
    `).all();
  } catch (err) {
    return [];
  }
}

// 專案列表
router.get('/', (req, res) => {
  // Debug: 檢查用戶資訊
  console.log('[專案列表] 用戶資訊:', req.user);
  
  const years = Project.getYears();
  const expectedInvoiceYearMonths = Project.getExpectedInvoiceYearMonths();
  const yearFilter = req.query.year || 'all'; // 預設為 'all'（全部年度）
  const filters = {
    year: yearFilter && yearFilter !== 'all' ? yearFilter : null,
    status: req.query.status,
    type: req.query.type,
    salesperson: req.query.salesperson,
    keyword: req.query.keyword, // 新增關鍵字搜尋
    expected_invoice_year_month: req.query.expected_invoice_year_month, // 新增預計開票年月篩選
    uninvoiced: req.query.uninvoiced === 'true' || req.query.uninvoiced === true, // 未開立發票
    unpaid: req.query.unpaid === 'true' || req.query.unpaid === true, // 有未收款金額
    overdue_unpaid: req.query.overdue_unpaid === 'true' || req.query.overdue_unpaid === true, // 逾期未收款
    sortBy: req.query.sortBy || 'contract_year', // 排序欄位
    sortOrder: req.query.sortOrder || 'DESC' // 排序方向
  };

  // 傳遞用戶資訊以進行角色過濾
  const projects = Project.findAll(filters, req.user);
  console.log('[專案列表] 查詢到的專案數量:', projects.length);
  
  // 業務下拉清單：業務員只顯示自己；非 admin/user/boss 排除獨立計算業務；含離職人員
  let salespeople;
  if (req.user && req.user.role === 'salesperson' && req.user.salesperson_id) {
    const sp = Salesperson.findById(req.user.salesperson_id);
    salespeople = sp ? [sp] : [];
  } else {
    salespeople = Salesperson.findAll(true); // 含離職
    if (req.user && req.user.role !== 'admin' && req.user.role !== 'user' && req.user.role !== 'boss') {
      salespeople = salespeople.filter(s => !s.show_separate_dashboard);
    }
  }
  const projectTypes = getActiveProjectTypes();
  
  // 建立類型顏色映射（包括所有類型，不僅是啟用的）
  let typeColorMap = {};
  try {
    const allTypes = db.prepare('SELECT type_name, badge_color FROM project_types').all();
    allTypes.forEach(type => {
      typeColorMap[type.type_name] = type.badge_color;
    });
  } catch (err) {
    // 如果表不存在，不預載任何映射
    typeColorMap = {};
  }

  // 構建查詢參數字串（用於排序連結）
  const buildQueryString = (newSortBy, newSortOrder) => {
    const params = new URLSearchParams();
    if (filters.year) params.append('year', yearFilter);
    if (filters.status) params.append('status', filters.status);
    if (filters.type) params.append('type', filters.type);
    if (filters.salesperson) params.append('salesperson', filters.salesperson);
    if (filters.customer) params.append('customer', filters.customer);
    if (filters.keyword) params.append('keyword', filters.keyword);
    if (filters.expected_invoice_year_month) params.append('expected_invoice_year_month', filters.expected_invoice_year_month);
    if (filters.uninvoiced) params.append('uninvoiced', 'true');
    if (filters.unpaid) params.append('unpaid', 'true');
    if (filters.overdue_unpaid) params.append('overdue_unpaid', 'true');
    params.append('sortBy', newSortBy);
    params.append('sortOrder', newSortOrder);
    return params.toString();
  };

  // 預先生成所有排序連結和箭頭圖示，避免在模板字面量中使用 EJS 語法
  const getSortLink = (field) => {
    const newOrder = filters.sortBy === field && filters.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    return buildQueryString(field, newOrder);
  };
  
  const getSortIcon = (field) => {
    if (filters.sortBy === field) {
      return filters.sortOrder === 'ASC' ? '<i class="bi bi-arrow-up"></i>' : '<i class="bi bi-arrow-down"></i>';
    }
    return '';
  };
  
  const sortLinks = {
    project_code: getSortLink('project_code'),
    contract_month: getSortLink('contract_month'),
    project_type: getSortLink('project_type'),
    salesperson_name: getSortLink('salesperson_name'),
    company_name: getSortLink('company_name'),
    project_name: getSortLink('project_name'),
    price_with_tax: getSortLink('price_with_tax'),
    total_invoiced: getSortLink('total_invoiced'),
    uninvoiced_amount: getSortLink('uninvoiced_amount'),
    total_received: getSortLink('total_received'),
    unpaid_amount: getSortLink('unpaid_amount'),
    expected_invoice_year_month: getSortLink('expected_invoice_year_month'),
    status: getSortLink('status')
  };
  
  const sortIcons = {
    project_code: getSortIcon('project_code'),
    contract_month: getSortIcon('contract_month'),
    project_type: getSortIcon('project_type'),
    salesperson_name: getSortIcon('salesperson_name'),
    company_name: getSortIcon('company_name'),
    project_name: getSortIcon('project_name'),
    price_with_tax: getSortIcon('price_with_tax'),
    total_invoiced: getSortIcon('total_invoiced'),
    uninvoiced_amount: getSortIcon('uninvoiced_amount'),
    total_received: getSortIcon('total_received'),
    unpaid_amount: getSortIcon('unpaid_amount'),
    expected_invoice_year_month: getSortIcon('expected_invoice_year_month'),
    status: getSortIcon('status')
  };

  // 確保年度篩選預設為 'all'（全部年度）
  const displayYear = yearFilter && yearFilter !== 'all' ? yearFilter : 'all';

  // 計算統計資訊：所有角色皆顯示（依目前篩選結果加總）
  const showFilterStats = filters.uninvoiced || filters.unpaid || filters.overdue_unpaid;
  const showStatsForRole = !!req.user; // 登入者皆顯示
  let salespersonStats = null;
  if (showStatsForRole || showFilterStats) {
    salespersonStats = {
      totalPrice: 0,
      totalInvoiced: 0,
      totalUninvoiced: 0,
      totalReceived: 0,
      totalUnpaid: 0
    };
    projects.forEach(project => {
      salespersonStats.totalPrice += project.price_with_tax || 0;
      salespersonStats.totalInvoiced += project.total_invoiced || 0;
      salespersonStats.totalUninvoiced += project.uninvoiced_amount ?? ((project.price_with_tax || 0) - (project.total_invoiced || 0));
      salespersonStats.totalReceived += project.total_received || 0;
      salespersonStats.totalUnpaid += Math.max(0, (project.total_invoiced || 0) - (project.total_received || 0) - (project.sales_discount || 0));
    });
  }

  res.render('projects/index', {
    title: '專案管理',
    projects,
    years,
    expectedInvoiceYearMonths,
    filters: {
      ...filters,
      year: displayYear
    },
    salespeople,
    sortLinks: sortLinks,
    sortIcons: sortIcons,
    salespersonStats: salespersonStats,
    isFilterStatsOnly: showFilterStats && !showStatsForRole, // 僅因篩選而顯示加總（非業務員/老闆）
    userRole: req.user ? req.user.role : null,
    projectTypes: projectTypes,
    typeColorMap: typeColorMap
  });
});

// 新增專案表單（需要編輯權限）
router.get('/new', requireEditPermission, (req, res) => {
  const salespeople = Salesperson.findAll();
  const customers = Customer.findAll();
  const projectTypes = getActiveProjectTypes();
  let project = null;
  if (req.query.from_template) {
    const ProjectTemplate = require('../models/ProjectTemplate');
    const template = ProjectTemplate.findById(req.query.from_template);
    if (template) {
      project = {
        project_code: '',
        contract_year: new Date().getFullYear(),
        contract_month: new Date().getMonth() + 1,
        status: '未結案',
        project_type: template.project_type,
        salesperson_id: template.salesperson_id,
        customer_id: template.customer_id,
        project_name: template.project_name,
        price_with_tax: template.price_with_tax,
        price_without_tax: template.price_without_tax,
        sales_discount: template.sales_discount,
        is_new_customer: template.is_new_customer,
        expected_invoice_year_month: template.expected_invoice_year_month,
        notes: template.notes
      };
    }
  }

  const reportGroups = getReportGroups();
  res.render('projects/form', {
    title: '新增專案',
    project,
    salespeople,
    customers,
    projectTypes,
    reportGroups,
    action: '/projects',
    method: 'POST'
  });
});

// 建立專案（需要編輯權限）
router.post('/', requireEditPermission, (req, res) => {
  try {
    // 驗證必填欄位
    if (!req.body.project_code || !req.body.project_code.trim()) {
      return res.redirect('/projects/new?error=' + encodeURIComponent('專案編號為必填欄位'));
    }

    if (!req.body.project_type || !req.body.project_type.trim()) {
      return res.redirect('/projects/new?error=' + encodeURIComponent('專案類型為必填欄位'));
    }

    if (!req.body.project_name || !req.body.project_name.trim()) {
      return res.redirect('/projects/new?error=' + encodeURIComponent('專案名稱為必填欄位'));
    }

    // 驗證專案類型是否存在於 project_types 表中
    try {
      const projectType = db.prepare('SELECT type_name FROM project_types WHERE type_name = ? AND is_active = 1').get(req.body.project_type.trim());
      if (!projectType) {
        return res.redirect('/projects/new?error=' + encodeURIComponent(`專案類型 "${req.body.project_type}" 不存在或已停用，請從類型管理頁面新增或啟用該類型`));
      }
    } catch (err) {
      console.error('驗證專案類型時發生錯誤:', err);
      // 如果 project_types 表不存在，記錄警告但繼續執行（向後兼容）
      if (err.message && err.message.includes('no such table')) {
        console.warn('project_types 表不存在，跳過類型驗證（向後兼容模式）');
      } else {
        return res.redirect('/projects/new?error=' + encodeURIComponent('驗證專案類型時發生錯誤：' + err.message));
      }
    }

    // 處理客戶
    let customerId = req.body.customer_id;
    if (!customerId && req.body.new_customer_name) {
      const customerCode = `C${Date.now()}`;
      customerId = Customer.create({
        customer_code: customerCode,
        tax_id: req.body.new_tax_id,
        company_name: req.body.new_customer_name
      });
    }

    // 檢查專案編號 + 類型 + 客戶的組合是否已存在
    const existingProject = Project.findByCodeTypeAndCustomer(
      req.body.project_code.trim(),
      req.body.project_type.trim(),
      customerId || null
    );
    
    if (existingProject) {
      return res.redirect('/projects/new?error=' + encodeURIComponent(
        `專案編號 "${req.body.project_code}" 在類型 "${req.body.project_type}" 中${customerId ? '與該客戶' : ''}已存在`
      ));
    }

    const projectId = Project.create({
      project_code: req.body.project_code.trim(),
      contract_year: parseInt(req.body.contract_year),
      contract_month: parseInt(req.body.contract_month),
      status: req.body.status,
      project_type: req.body.project_type.trim(),
      salesperson_id: req.body.salesperson_id || null,
      customer_id: customerId || null,
      project_name: req.body.project_name.trim(),
      price_with_tax: parseFloat(req.body.price_with_tax) || 0,
      price_without_tax: parseFloat(req.body.price_without_tax) || 0,
      sales_discount: parseFloat(req.body.sales_discount) || 0,
      is_new_customer: req.body.is_new_customer === '1',
      notes: req.body.notes ? req.body.notes.trim() : null,
      report_group_id: req.body.report_group_id || null,
      userInfo: getUserInfo(req)
    });

    // 檢查是否成功建立專案
    if (!projectId) {
      return res.redirect('/projects/new?error=' + encodeURIComponent(
        '建立專案失敗，請檢查資料是否正確或專案是否已存在'
      ));
    }

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    // 檢查是否為唯一約束錯誤
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.redirect('/projects/new?error=' + encodeURIComponent(
        `專案編號 "${req.body.project_code}" 在類型 "${req.body.project_type}" 中${req.body.customer_id ? '與該客戶' : ''}已存在`
      ));
    }
    res.redirect('/projects/new?error=' + encodeURIComponent(err.message));
  }
});

// 專案附件下載/預覽（需有專案檢視權限；已軟刪除者不可下載）
router.get('/:id/attachments/:attachmentId/download', (req, res) => {
  const project = Project.findById(req.params.id, req.user);
  if (!project) return res.status(404).send('找不到專案或無權限');
  try {
    const row = db.prepare('SELECT * FROM project_attachments WHERE id = ? AND project_id = ?').get(req.params.attachmentId, req.params.id);
    if (!row) return res.status(404).send('找不到附件');
    if (row.deleted_at) return res.status(410).send('此附件已刪除');
    const filePath = path.join(attachmentsDir, row.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('檔案不存在');
    const name = encodeURIComponent(row.original_filename).replace(/'/g, '%27');
    const mimeType = row.mime_type || 'application/octet-stream';
    const isPDF = mimeType === 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    // PDF 使用 inline 預覽，其他檔案使用 attachment 下載
    res.setHeader('Content-Disposition', `${isPDF ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`);
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error('附件下載錯誤:', err);
    res.status(500).send('下載失敗');
  }
});

// 專案附件軟刪除（需編輯權限）
router.post('/:id/attachments/:attachmentId/delete', requireEditPermission, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM project_attachments WHERE id = ? AND project_id = ?').get(req.params.attachmentId, req.params.id);
    if (!row) return res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent('找不到附件'));
    const oldData = { ...row };
    db.prepare("UPDATE project_attachments SET deleted_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.attachmentId);
    const newData = { ...oldData, deleted_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    AuditLogService.logUpdate('project_attachments', req.params.attachmentId, oldData, newData, getUserInfo(req));
    res.redirect(`/projects/${req.params.id}?success=` + encodeURIComponent('附件已刪除（可於「顯示已刪除」中還原）'));
  } catch (err) {
    console.error('附件刪除錯誤:', err);
    res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 專案附件還原（需編輯權限）
router.post('/:id/attachments/:attachmentId/restore', requireEditPermission, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM project_attachments WHERE id = ? AND project_id = ?').get(req.params.attachmentId, req.params.id);
    if (!row) return res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent('找不到附件'));
    if (!row.deleted_at) return res.redirect(`/projects/${req.params.id}?success=` + encodeURIComponent('附件未刪除'));
    const oldData = { ...row };
    db.prepare('UPDATE project_attachments SET deleted_at = NULL WHERE id = ?').run(req.params.attachmentId);
    const newData = { ...oldData, deleted_at: null };
    AuditLogService.logUpdate('project_attachments', req.params.attachmentId, oldData, newData, getUserInfo(req));
    res.redirect(`/projects/${req.params.id}?show_deleted=1&success=` + encodeURIComponent('附件已還原'));
  } catch (err) {
    console.error('附件還原錯誤:', err);
    res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 專案附件上傳（需編輯權限）
router.post('/:id/attachments', requireEditPermission, uploadAttachment.single('file'), (req, res) => {
  if (!req.file) return res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent('請選擇檔案'));
  try {
    const displayName = fixFilenameEncoding(req.file.originalname || req.file.filename);
    const result = db.prepare(`
      INSERT INTO project_attachments (project_id, original_filename, stored_filename, mime_type, file_size)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, displayName, req.file.filename, req.file.mimetype || null, req.file.size || 0);
    const newData = {
      project_id: req.params.id,
      original_filename: displayName,
      stored_filename: req.file.filename,
      mime_type: req.file.mimetype || null,
      file_size: req.file.size || 0
    };
    AuditLogService.logCreate('project_attachments', result.lastInsertRowid, newData, getUserInfo(req));
    res.redirect(`/projects/${req.params.id}?success=` + encodeURIComponent('附件已上傳'));
  } catch (err) {
    console.error('附件上傳錯誤:', err);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 專案詳情
router.get('/:id', (req, res) => {
  // 傳遞用戶資訊以進行權限檢查
  const project = Project.findById(req.params.id, req.user);
  if (!project) {
    return res.status(404).render('error', { message: '找不到專案或無權限查看', error: {} });
  }

  const showDeleted = req.query.show_deleted === '1' || req.query.show_deleted === 'true';
  const invoices = Invoice.findByProject(project.id, { includeDeleted: showDeleted });
  const payments = Payment.findByProject(project.id, { includeDeleted: showDeleted });
  const bonuses = Bonus.findByProject(project.id);
  const Cost = require('../models/Cost');
  const costs = Cost.findByProject(project.id);

  // 計算每筆發票的收款狀態（與收款明細比對，僅用未刪除的收款）
  // 支援分次收款：僅在「已收齊」時顯示提前/準時/逾期到款；部分收款時依預計收款日顯示待收狀態
  const paymentsForStatus = Payment.findByProject(project.id); // 未刪除
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const diffDays = (d1, d2) => Math.round((new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24));

  const invoicesWithStatus = invoices.map(inv => {
    const invPayments = paymentsForStatus.filter(p => p.invoice_id === inv.id);
    const expectedDate = inv.expected_payment_date || null;
    const invAmount = (inv.amount_with_tax || 0) - (inv.allowance_amount || 0);
    const paid = invPayments.reduce((s, p) => s + Payment.calculateActualReceived(p), 0);
    const isFullyPaid = invAmount <= 0 || paid >= invAmount;
    let paymentStatus = { text: '-', class: 'text-muted' };

    if (invPayments.length > 0 && !isFullyPaid) {
      // 部分收款：不顯示「提前到款」，改依預計收款日顯示待收狀態
      if (!expectedDate) {
        paymentStatus = { text: `部分收款 (未收 $${Math.round(invAmount - paid).toLocaleString()})`, class: 'text-warning' };
      } else if (expectedDate > today) {
        const days = diffDays(expectedDate, today);
        paymentStatus = { text: `部分收款，將於${days}天後收款`, class: 'text-primary' };
      } else if (expectedDate < today) {
        const days = diffDays(today, expectedDate);
        paymentStatus = { text: `部分收款，已逾期${days}天`, class: 'text-danger' };
      } else {
        paymentStatus = { text: '部分收款，預計今日收款', class: 'text-warning' };
      }
    } else if (invPayments.length > 0 && isFullyPaid) {
      // 已收齊：取最後一筆收款日期與預計收款日比較（或最早一筆若無預計日）
      const withDate = invPayments.filter(p => p.payment_date);
      const sortedPayments = (withDate.length ? withDate : invPayments)
        .slice().sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
      const lastPaymentDate = sortedPayments[sortedPayments.length - 1]?.payment_date;
      const firstPaymentDate = sortedPayments[0]?.payment_date;
      const refDate = lastPaymentDate || firstPaymentDate;

      if (!refDate) {
        paymentStatus = { text: '已收齊', class: 'text-success' };
      } else if (!expectedDate) {
        paymentStatus = { text: '已收齊', class: 'text-success' };
      } else if (refDate === expectedDate) {
        paymentStatus = { text: '準時到款', class: 'text-success' };
      } else if (refDate > expectedDate) {
        const days = diffDays(refDate, expectedDate);
        paymentStatus = { text: `款項到帳但逾期${days}天`, class: 'text-warning' };
      } else {
        const days = diffDays(expectedDate, refDate);
        paymentStatus = { text: `提前${days}天到款`, class: 'text-info' };
      }
    } else {
      // 無收款記錄：依預計收款日與當天比較
      if (!expectedDate) {
        paymentStatus = { text: '-', class: 'text-muted' };
      } else if (expectedDate > today) {
        const days = diffDays(expectedDate, today);
        paymentStatus = { text: `將於${days}天後收款`, class: 'text-primary' };
      } else if (expectedDate < today) {
        const days = diffDays(today, expectedDate);
        paymentStatus = { text: `已逾期${days}天`, class: 'text-danger' };
      } else {
        paymentStatus = { text: '預計今日收款', class: 'text-warning' };
      }
    }

    return { ...inv, paymentStatus };
  });

  // 有效發票（供收款對應選擇，僅 有效 狀態）
  const validInvoices = Invoice.findValidByProject ? Invoice.findValidByProject(project.id) : invoices.filter(i => !i.status || i.status === '有效');

  // 每筆發票的已收款/未收款摘要（支援一筆發票分多次收款）
  const invoiceIdsInPayments = new Set(paymentsForStatus.filter(p => p.invoice_id).map(p => p.invoice_id));
  const allInvsForSummary = [...validInvoices];
  invoices.forEach(inv => {
    if (!allInvsForSummary.some(i => i.id === inv.id) && invoiceIdsInPayments.has(inv.id)) {
      allInvsForSummary.push(inv); // 含已作廢但曾有收款的發票（供編輯時顯示）
    }
  });
  const invoiceUnpaidSummary = allInvsForSummary.map(inv => {
    const invPayments = paymentsForStatus.filter(p => p.invoice_id === inv.id);
    const paid = invPayments.reduce((s, p) => s + Payment.calculateActualReceived(p), 0);
    const invAmount = (inv.amount_with_tax || 0) - (inv.allowance_amount || 0);
    const unpaid = Math.max(0, invAmount - paid);
    const isValid = !inv.status || inv.status === '有效';
    return { invoice_id: inv.id, invoice_number: inv.invoice_number, amount: invAmount, paid, unpaid, isValid };
  });

  // 計算彙總（僅計有效發票）
  const totalInvoiced = Invoice.getTotalByProject(project.id);
  // 計算實際收款金額（考慮匯費差異，僅計未刪除收款）
  const totalReceived = paymentsForStatus.reduce((sum, p) => sum + Payment.calculateActualReceived(p), 0);
  const totalBonus = bonuses.reduce((sum, b) => sum + (b.bonus_amount || 0), 0);
  const totalCost = Cost.getTotalByProject(project.id);
  const grossProfit = (project.price_without_tax || 0) - totalCost;
  
  // 建立類型顏色映射
  let typeColorMap = {};
  try {
    const allTypes = db.prepare('SELECT type_name, badge_color FROM project_types').all();
    allTypes.forEach(type => {
      typeColorMap[type.type_name] = type.badge_color;
    });
  } catch (err) {
    // 不預載任何類型顏色映射
    typeColorMap = {};
  }

  const attachments = getAttachmentsByProject(project.id, { includeDeleted: showDeleted });

  res.render('projects/show', {
    title: project.project_name,
    project,
    invoices: invoicesWithStatus,
    validInvoices, // 有效發票（收款對應用）
    invoiceUnpaidSummary, // 每筆發票已收/未收摘要（支援分次收款）
    payments,
    costs,
    attachments,
    bonuses,
    typeColorMap,
    showDeleted, // 是否顯示已刪除的發票/收款
    success: req.query.success ? decodeURIComponent(req.query.success) : null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null,
    summary: {
      totalInvoiced,
      uninvoiced: project.price_with_tax - totalInvoiced,
      totalReceived,
      outstanding: totalInvoiced - totalReceived - (project.sales_discount || 0),
      totalBonus,
      totalCost,
      grossProfit
    }
  });
});

// 編輯專案表單（需要編輯權限）
router.get('/:id/edit', requireEditPermission, (req, res) => {
  const project = Project.findById(req.params.id, req.user);
  if (!project) {
    return res.status(404).render('error', { message: '找不到專案或無權限查看', error: {} });
  }

  const salespeople = Salesperson.findAll(true);
  const customers = Customer.findAll();
  const projectTypes = getActiveProjectTypes();
  const reportGroups = getReportGroups();

  res.render('projects/form', {
    title: '編輯專案',
    project,
    salespeople,
    customers,
    projectTypes,
    reportGroups,
    action: `/projects/${project.id}`,
    method: 'POST'
  });
});

// 更新專案（需要編輯權限）
router.post('/:id', requireEditPermission, (req, res) => {
  try {
    const currentProject = Project.findById(req.params.id, req.user);
    if (!currentProject) {
      return res.status(404).render('error', {
        title: '找不到專案',
        message: '找不到專案或無權限編輯',
        error: {}
      });
    }

    // 處理客戶
    let customerId = req.body.customer_id;
    if (!customerId && req.body.new_customer_name) {
      const customerCode = `C${Date.now()}`;
      customerId = Customer.create({
        customer_code: customerCode,
        tax_id: req.body.new_tax_id,
        company_name: req.body.new_customer_name
      });
    }
    customerId = customerId || null;

    // 如果專案編號、類型或客戶ID有變更，檢查新的組合是否已存在
    if (req.body.project_code !== currentProject.project_code || 
        req.body.project_type !== currentProject.project_type ||
        customerId !== (currentProject.customer_id || null)) {
      const existingProject = Project.findByCodeTypeAndCustomer(
        req.body.project_code,
        req.body.project_type,
        customerId
      );
      
      // 如果找到其他專案（不是當前專案），則表示重複
      if (existingProject && existingProject.id !== parseInt(req.params.id)) {
        return res.redirect(`/projects/${req.params.id}/edit?error=` + encodeURIComponent(
          `專案編號 "${req.body.project_code}" 在類型 "${req.body.project_type}" 中${customerId ? '與該客戶' : ''}已存在`
        ));
      }
    }

    Project.update(req.params.id, {
      project_code: req.body.project_code,
      contract_year: req.body.contract_year ? parseInt(req.body.contract_year) : null,
      contract_month: req.body.contract_month ? parseInt(req.body.contract_month) : null,
      status: req.body.status || '未結案',
      project_type: req.body.project_type,
      salesperson_id: req.body.salesperson_id && req.body.salesperson_id !== '' ? parseInt(req.body.salesperson_id) : null,
      customer_id: customerId, // 使用處理過的 customerId（可能包含新建的客戶）
      project_name: req.body.project_name || null,
      price_with_tax: req.body.price_with_tax ? parseFloat(req.body.price_with_tax) : 0,
      price_without_tax: req.body.price_without_tax ? parseFloat(req.body.price_without_tax) : 0,
      sales_discount: req.body.sales_discount ? parseFloat(req.body.sales_discount) : 0,
      is_new_customer: req.body.is_new_customer === '1' ? 1 : 0,
      notes: req.body.notes || null,
      report_group_id: req.body.report_group_id && req.body.report_group_id !== '' ? parseInt(req.body.report_group_id) : null,
      userInfo: getUserInfo(req) // 添加用戶資訊用於審計日誌
    });

    res.redirect(`/projects/${req.params.id}`);
  } catch (err) {
    console.error(err);
    // 檢查是否為唯一約束錯誤
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.redirect(`/projects/${req.params.id}/edit?error=` + encodeURIComponent(
        `專案編號 "${req.body.project_code}" 在類型 "${req.body.project_type}" 中已存在`
      ));
    }
    res.redirect(`/projects/${req.params.id}/edit?error=` + encodeURIComponent(err.message));
  }
});

// 更新預計開立發票年月（需要編輯權限）
router.post('/:id/update-expected-invoice', requireEditPermission, (req, res) => {
  try {
    console.log('='.repeat(60));
    console.log('[更新預計開票] 開始處理');
    console.log('[更新預計開票] 專案ID:', req.params.id);
    console.log('[更新預計開票] 接收到的表單資料:', JSON.stringify(req.body, null, 2));
    console.log('[更新預計開票] expected_invoice_year_month 值:', req.body.expected_invoice_year_month);
    console.log('[更新預計開票] 值的類型:', typeof req.body.expected_invoice_year_month);
    
    const project = Project.findById(req.params.id, req.user);
    if (!project) {
      console.error('[更新預計開票] 找不到專案:', req.params.id);
      return res.status(404).send('找不到專案或無權限編輯');
    }

    console.log('[更新預計開票] 找到專案:', {
      id: project.id,
      code: project.project_code,
      name: project.project_name,
      current_value: project.expected_invoice_year_month
    });

    const newValue = req.body.expected_invoice_year_month || null;
    const updateData = {
      expected_invoice_year_month: newValue,
      userInfo: getUserInfo(req)
    };
    
    console.log('[更新預計開票] 準備更新的資料:', JSON.stringify(updateData, null, 2));
    console.log('[更新預計開票] 從:', project.expected_invoice_year_month, '→ 到:', newValue);
    
    // 執行更新
    const result = Project.update(req.params.id, updateData);
    
    console.log('[更新預計開票] 更新結果:', result);
    
    // better-sqlite3 會自動儲存，不需要手動調用 saveDatabase()
    
    // 驗證更新結果
    const updatedProject = Project.findById(req.params.id, req.user);
    console.log('[更新預計開票] 驗證 - 更新後的值:', updatedProject.expected_invoice_year_month);
    
    if (updatedProject.expected_invoice_year_month === newValue) {
      console.log('[更新預計開票] ✅ 驗證成功 - 資料已正確更新');
    } else {
      console.error('[更新預計開票] ❌ 驗證失敗 - 資料未正確更新');
      console.error('[更新預計開票] 期望值:', newValue);
      console.error('[更新預計開票] 實際值:', updatedProject.expected_invoice_year_month);
    }
    console.log('='.repeat(60));

    res.redirect(`/projects/${req.params.id}?success=` + encodeURIComponent('預計開票年月更新成功'));
  } catch (err) {
    console.error('[更新預計開票] ❌ 錯誤:', err);
    console.error('[更新預計開票] 錯誤堆疊:', err.stack);
    console.log('='.repeat(60));
    res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent('更新失敗: ' + err.message));
  }
});

// 刪除專案（需要編輯權限）
router.post('/:id/delete', requireEditPermission, (req, res) => {
  try {
    Project.delete(req.params.id);
    res.redirect('/projects');
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
