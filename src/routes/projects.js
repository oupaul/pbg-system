const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Bonus = require('../models/Bonus');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');

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
  
  const salespeople = Salesperson.findAll(true);
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

  // 計算統計資訊（對業務員和老闆角色顯示）
  let salespersonStats = null;
  if (req.user && (req.user.role === 'salesperson' || req.user.role === 'boss')) {
    salespersonStats = {
      totalPrice: 0,           // 專案價格金額總和
      totalInvoiced: 0,        // 已開立發票金額總和
      totalUninvoiced: 0,      // 未開發票金額總和
      totalReceived: 0,        // 已收款金額總和
      totalUnpaid: 0           // 未收款金額總和
    };
    
    projects.forEach(project => {
      salespersonStats.totalPrice += project.price_with_tax || 0;
      salespersonStats.totalInvoiced += project.total_invoiced || 0;
      salespersonStats.totalUninvoiced += project.uninvoiced_amount || 0;
      salespersonStats.totalReceived += project.total_received || 0;
      // 未收款金額 = 已開立發票金額 - 已收款金額 - 銷貨折讓
      salespersonStats.totalUnpaid += (project.total_invoiced || 0) - (project.total_received || 0) - (project.sales_discount || 0);
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
    sortLinks: sortLinks, // 傳遞預生成的排序連結
    sortIcons: sortIcons, // 傳遞預生成的箭頭圖示
    salespersonStats: salespersonStats, // 統計資訊（業務員和老闆）
    userRole: req.user ? req.user.role : null, // 傳遞用戶角色
    projectTypes: projectTypes, // 傳遞專案類型列表
    typeColorMap: typeColorMap // 傳遞類型顏色映射
  });
});

// 新增專案表單（需要編輯權限）
router.get('/new', requireEditPermission, (req, res) => {
  const salespeople = Salesperson.findAll();
  const customers = Customer.findAll();
  const projectTypes = getActiveProjectTypes();

  res.render('projects/form', {
    title: '新增專案',
    project: null,
    salespeople,
    customers,
    projectTypes,
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

// 專案詳情
router.get('/:id', (req, res) => {
  // 傳遞用戶資訊以進行權限檢查
  const project = Project.findById(req.params.id, req.user);
  if (!project) {
    return res.status(404).render('error', { message: '找不到專案或無權限查看', error: {} });
  }

  const invoices = Invoice.findByProject(project.id);
  const payments = Payment.findByProject(project.id);
  const bonuses = Bonus.findByProject(project.id);
  const Cost = require('../models/Cost');
  const costs = Cost.findByProject(project.id);

  // 計算每筆發票的收款狀態（與收款明細比對）
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const diffDays = (d1, d2) => Math.round((new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24));

  const invoicesWithStatus = invoices.map(inv => {
    const invPayments = payments.filter(p => p.invoice_id === inv.id);
    const expectedDate = inv.expected_payment_date || null;
    let paymentStatus = { text: '-', class: 'text-muted' };

    if (invPayments.length > 0) {
      // 有收款記錄：取最早一筆有日期的收款（若都無日期則取第一筆）
      const withDate = invPayments.filter(p => p.payment_date);
      const sortedPayments = (withDate.length ? withDate : invPayments)
        .slice().sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
      const firstPaymentDate = sortedPayments[0]?.payment_date;

      if (!firstPaymentDate) {
        paymentStatus = { text: '已收款', class: 'text-success' };
      } else if (!expectedDate) {
        paymentStatus = { text: '已收款', class: 'text-success' };
      } else if (firstPaymentDate === expectedDate) {
        paymentStatus = { text: '準時到款', class: 'text-success' };
      } else if (firstPaymentDate > expectedDate) {
        const days = diffDays(firstPaymentDate, expectedDate);
        paymentStatus = { text: `款項到帳但逾期${days}天`, class: 'text-warning' };
      } else {
        const days = diffDays(expectedDate, firstPaymentDate);
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

  // 找出已被選取的發票 ID（用於新增收款時排除）
  const usedInvoiceIds = new Set(payments.filter(p => p.invoice_id).map(p => p.invoice_id));

  // 有效發票（供收款對應選擇，僅 有效 狀態）
  const validInvoices = Invoice.findValidByProject ? Invoice.findValidByProject(project.id) : invoices.filter(i => !i.status || i.status === '有效');

  // 計算彙總（僅計有效發票）
  const totalInvoiced = Invoice.getTotalByProject(project.id);
  // 計算實際收款金額（考慮匯費差異）- 使用 Payment.calculateActualReceived 方法保持一致性
  const totalReceived = payments.reduce((sum, p) => sum + Payment.calculateActualReceived(p), 0);
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

  res.render('projects/show', {
    title: project.project_name,
    project,
    invoices: invoicesWithStatus,
    validInvoices, // 有效發票（收款對應用）
    payments,
    costs,
    bonuses,
    typeColorMap,
    usedInvoiceIds: Array.from(usedInvoiceIds), // 已使用的發票 ID 列表
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

  res.render('projects/form', {
    title: '編輯專案',
    project,
    salespeople,
    customers,
    projectTypes,
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
