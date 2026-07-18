const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Project = require('../models/Project');
const Pipeline = require('../models/Pipeline');
const Activity = require('../models/Activity');
const DeletionRequest = require('../models/DeletionRequest');
const CustomerCreationRequest = require('../models/CustomerCreationRequest');
const User = require('../models/User');
const db = require('../models/db');
const { getUserInfo } = require('../utils/authHelper');
const { requireCrmEditPermission } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

// 新增客戶/廠商是否需要送審：僅系統管理員（admin）與專案管理員（user）可直接建立，
// 其餘角色（業務員、自訂角色等）一律先送審，核准後才會真正進入系統
function canCreateCustomerDirectly(user) {
  return !!(user && (user.role === 'admin' || user.role === 'user'));
}

// 客戶列表
router.get('/', (req, res) => {
  try {
    // 排序參數
    const sortBy = req.query.sortBy || 'company_name';
    const sortOrder = req.query.sortOrder || 'ASC';
    // 搜尋關鍵字
    const searchKeyword = req.query.search || '';
    // 往來狀態篩選
    const statusFilter = req.query.status || '';
    // 客戶/廠商身份篩選
    const partyTypeFilter = req.query.party_type || '';
    // 廠商類型篩選（個人/公司，僅在篩選廠商時有意義）
    const vendorTypeFilter = req.query.vendor_type || '';

    // 客戶/廠商資料對所有登入者開放（僅專案依權限範圍過濾），根據是否有搜尋關鍵字決定使用哪個方法
    let customers = searchKeyword
      ? Customer.search(searchKeyword, { status: statusFilter, party_type: partyTypeFilter, vendor_type: vendorTypeFilter }, req.user)
      : Customer.findAll({ status: statusFilter, party_type: partyTypeFilter, vendor_type: vendorTypeFilter }, req.user);
    
    // 確保 customers 是陣列
    if (!Array.isArray(customers)) {
      customers = [];
    }

    // 排序
    const sortFieldMap = {
      'customer_code': 'customer_code',
      'tax_id': 'tax_id',
      'company_name': 'company_name',
      'project_count': 'project_count',
      'total_project_amount': 'total_project_amount',
      'salesperson_names': 'salesperson_names',
      'party_type': 'party_type',
      'owner_salesperson_name': 'owner_salesperson_name',
      'customer_level': 'customer_level',
      'status': 'status'
    };

    const sortField = sortFieldMap[sortBy] || 'company_name';
    customers.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      // 處理 null/undefined
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';
      
      // 數值排序
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'ASC' ? aVal - bVal : bVal - aVal;
      }
      
      // 字串排序
      const aStr = String(aVal);
      const bStr = String(bVal);
      if (sortOrder === 'ASC') {
        return aStr.localeCompare(bStr, 'zh-TW');
      } else {
        return bStr.localeCompare(aStr, 'zh-TW');
      }
    });

    // 生成排序連結的輔助函數（保留目前的搜尋關鍵字與篩選條件）
    const buildQueryString = (newSortBy, newSortOrder) => {
      const params = new URLSearchParams();
      if (searchKeyword) {
        params.append('search', searchKeyword);
      }
      if (statusFilter) {
        params.append('status', statusFilter);
      }
      if (partyTypeFilter) {
        params.append('party_type', partyTypeFilter);
      }
      if (vendorTypeFilter) {
        params.append('vendor_type', vendorTypeFilter);
      }
      params.append('sortBy', newSortBy);
      params.append('sortOrder', newSortOrder);
      return params.toString();
    };

    const getSortLink = (field) => {
      const newOrder = sortBy === field && sortOrder === 'ASC' ? 'DESC' : 'ASC';
      return buildQueryString(field, newOrder);
    };

    const getSortIcon = (field) => {
      if (sortBy === field) {
        return sortOrder === 'ASC' ? '<i class="bi bi-arrow-up"></i>' : '<i class="bi bi-arrow-down"></i>';
      }
      return '';
    };

    const sortLinks = {
      customer_code: getSortLink('customer_code'),
      tax_id: getSortLink('tax_id'),
      company_name: getSortLink('company_name'),
      project_count: getSortLink('project_count'),
      total_project_amount: getSortLink('total_project_amount'),
      salesperson_names: getSortLink('salesperson_names'),
      party_type: getSortLink('party_type'),
      owner_salesperson_name: getSortLink('owner_salesperson_name'),
      customer_level: getSortLink('customer_level'),
      status: getSortLink('status')
    };

    const sortIcons = {
      customer_code: getSortIcon('customer_code'),
      tax_id: getSortIcon('tax_id'),
      company_name: getSortIcon('company_name'),
      project_count: getSortIcon('project_count'),
      total_project_amount: getSortIcon('total_project_amount'),
      salesperson_names: getSortIcon('salesperson_names'),
      party_type: getSortIcon('party_type'),
      owner_salesperson_name: getSortIcon('owner_salesperson_name'),
      customer_level: getSortIcon('customer_level'),
      status: getSortIcon('status')
    };
  
    res.render('customers/index', {
      title: '客戶與廠商管理',
      customers: customers || [],
      sortLinks: sortLinks || {},
      sortIcons: sortIcons || {},
      searchKeyword: searchKeyword || '',
      statusFilter,
      partyTypeFilter,
      vendorTypeFilter,
      staffUsers: User.findActiveNonAdmin(),
      req: req,
      error: req.query.error || '',
      success: req.query.success || ''
    });
  } catch (err) {
    console.error('客戶列表錯誤:', err);
    console.error('錯誤堆疊:', err.stack);
    res.status(500).render('error', {
      title: '系統錯誤',
      message: '載入客戶列表時發生錯誤',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
});

// 快速新增客戶/廠商（API，返回 JSON）
// 非管理員/專案管理員送出的申請不會直接建立客戶，而是進入審核佇列
router.post('/quick-add', requireCrmEditPermission, (req, res) => {
  try {
    if (!canCreateCustomerDirectly(req.user)) {
      // 若是在「新增銷售機會」表單中使用快速新增（見 pipelines/form.ejs），
      // pipeline_data 會帶有使用者已填寫的銷售機會欄位，一併存入同一筆申請，
      // 核准客戶時會一併建立該銷售機會（見 CustomerCreationRequest.approve）
      const pipelineData = req.body.pipeline_data || null;

      const requestId = CustomerCreationRequest.create({
        customer_code: req.body.customer_code,
        tax_id: req.body.tax_id,
        company_name: req.body.company_name,
        is_new_customer: req.body.is_new_customer === '1',
        party_type: req.body.party_type,
        vendor_type: req.body.vendor_type,
        requested_by: req.user.id,
        requested_by_name: getUserInfo(req),
        ...(pipelineData ? {
          pipeline_opportunity_name: pipelineData.opportunity_name,
          pipeline_project_type: pipelineData.project_type,
          pipeline_estimated_amount: pipelineData.estimated_amount,
          pipeline_win_probability: pipelineData.win_probability,
          pipeline_expected_close_year_month: pipelineData.expected_close_year_month,
          pipeline_salesperson_id: pipelineData.salesperson_id,
          pipeline_notes: pipelineData.notes
        } : {})
      });
      NotificationService.notifyCustomerApprovers({
        type: 'customer_approval_pending',
        title: pipelineData
          ? `新客戶/廠商＋銷售機會待審核：${req.body.company_name}`
          : `新客戶/廠商待審核：${req.body.company_name}`,
        message: `申請人：${getUserInfo(req)}`,
        link: '/customer-approvals',
        related_type: 'customer_creation_request',
        related_id: requestId
      }, req.user.id);
      return res.json({
        success: true,
        pending: true,
        message: pipelineData
          ? '已送出客戶/廠商與銷售機會審核申請，待專案管理員或系統管理員核准後才會建立'
          : '已送出審核申請，待專案管理員或系統管理員核准後才會建立此客戶/廠商'
      });
    }

    const customerId = Customer.create({
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1',
      party_type: req.body.party_type,
      vendor_type: req.body.vendor_type,
      userInfo: getUserInfo(req)
    });

    // 獲取新建的客戶資料
    const customer = Customer.findById(customerId);

    res.json({
      success: true,
      customer: {
        id: customer.id,
        customer_code: customer.customer_code,
        company_name: customer.company_name,
        tax_id: customer.tax_id,
        party_type: customer.party_type,
        vendor_type: customer.vendor_type
      }
    });
  } catch (err) {
    console.error('快速新增客戶錯誤:', err);
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// 新增客戶（傳統表單提交）
// 非管理員/專案管理員送出的申請不會直接建立客戶，而是進入審核佇列，待核准後才會真正進入系統
router.post('/', requireCrmEditPermission, (req, res) => {
  try {
    const customerData = {
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1',
      contact_name: req.body.contact_name,
      contact_phone: req.body.contact_phone,
      contact_email: req.body.contact_email,
      owner_salesperson_id: req.body.owner_salesperson_id || null,
      customer_level: req.body.customer_level || null,
      industry: req.body.industry,
      status: req.body.status,
      party_type: req.body.party_type,
      vendor_type: req.body.vendor_type,
      bank_name: req.body.bank_name,
      bank_account: req.body.bank_account,
      address: req.body.address
    };

    if (!canCreateCustomerDirectly(req.user)) {
      const requestId = CustomerCreationRequest.create({
        ...customerData,
        requested_by: req.user.id,
        requested_by_name: getUserInfo(req)
      });
      NotificationService.notifyCustomerApprovers({
        type: 'customer_approval_pending',
        title: `新客戶/廠商待審核：${customerData.company_name}`,
        message: `申請人：${getUserInfo(req)}`,
        link: '/customer-approvals',
        related_type: 'customer_creation_request',
        related_id: requestId
      }, req.user.id);
      return res.redirect('/customers?success=' + encodeURIComponent('已送出新增申請，待專案管理員或系統管理員核准後才會建立此客戶/廠商'));
    }

    Customer.create({ ...customerData, userInfo: getUserInfo(req) });
    res.redirect('/customers');
  } catch (err) {
    console.error(err);
    res.redirect('/customers?error=' + encodeURIComponent(err.message));
  }
});

// 客戶詳情
router.get('/:id', (req, res) => {
  const customer = Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).render('error', { message: '找不到客戶', error: {} });
  }

  // 客戶的專案：所有看得到此客戶的人都能看到專案「列表」基本資訊，
  // 但範圍外（project_view_scope 之外）的專案會被標記為 _locked（金額清空、前端不可點入查看更多）
  const projects = Project.findByCustomerId(customer.id, req.user);

  // 統計：件數為目前看得到的全部列表筆數，總金額只加總未被鎖定（有權限查看金額）的專案，
  // 避免鎖定專案的金額透過加總洩漏
  const stats = {
    project_count: projects.length,
    total_amount: projects.reduce((sum, p) => sum + (p._locked ? 0 : (p.price_with_tax || 0)), 0),
    closed_count: projects.filter(p => p.status === '已結案').length
  };

  // 銷售機會（依角色權限範圍過濾）
  const pipelines = Pipeline.findAll({ customer_id: customer.id }, req.user);

  // 活動時間軸
  const activities = Activity.findByCustomer(customer.id);

  // 活動紀錄的待審核刪除申請（避免逐筆查詢，先查出這個客戶底下所有待審核的活動刪除申請）
  const pendingActivityDeletionIds = activities.length
    ? db.prepare(`
        SELECT target_id FROM deletion_requests
        WHERE target_type = 'activity' AND status = 'pending'
          AND target_id IN (${activities.map(() => '?').join(',')})
      `).all(...activities.map(a => a.id)).map(r => r.target_id)
    : [];

  res.render('customers/show', {
    title: customer.company_name,
    customer,
    projects,
    stats,
    pipelines,
    activities,
    pendingActivityDeletionIds,
    staffUsers: User.findActiveNonAdmin(),
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 新增活動紀錄
router.post('/:id/activities', requireCrmEditPermission, (req, res) => {
  try {
    const customer = Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).render('error', { message: '找不到客戶', error: {} });
    }

    Activity.create({
      customer_id: req.params.id,
      activity_type: req.body.activity_type,
      content: req.body.content,
      activity_date: req.body.activity_date,
      userInfo: getUserInfo(req)
    });
    NotificationService.notifyBusinessWatchers({
      type: 'activity_created',
      title: `客戶活動紀錄更新：${customer.company_name}`,
      message: `記錄人：${getUserInfo(req)}\n\n${NotificationService.formatActivitySummary({
        customerName: customer.company_name,
        activityType: req.body.activity_type,
        activityDate: req.body.activity_date,
        content: req.body.content
      })}`,
      link: `/customers/${req.params.id}`,
      related_type: 'customer',
      related_id: req.params.id
    }, req.user.id);
    res.redirect(`/customers/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 刪除活動紀錄
// 有 can_delete 權限者直接刪除；否則送出刪除申請，待管理員核准後才真正刪除
router.post('/:id/activities/:activityId/delete', requireCrmEditPermission, (req, res) => {
  try {
    if (!Customer.findById(req.params.id)) {
      return res.status(404).render('error', { message: '找不到客戶', error: {} });
    }

    if (req.user.canDelete) {
      Activity.softDelete(req.params.activityId, getUserInfo(req));
      return res.redirect(`/customers/${req.params.id}`);
    }

    const activity = Activity.findById(req.params.activityId);
    if (!activity) {
      return res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent('找不到此活動紀錄'));
    }

    const existing = DeletionRequest.findPendingByTarget('activity', activity.id);
    if (existing) {
      return res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent('此活動紀錄已送出過刪除申請，待審核中'));
    }

    const requestId = DeletionRequest.create({
      target_type: 'activity',
      target_id: activity.id,
      target_summary: `${activity.activity_type}：${activity.content}`,
      requested_by: req.user.id,
      requested_by_name: getUserInfo(req)
    });
    NotificationService.notifyDeletionApprovers({
      type: 'deletion_request_pending',
      title: `刪除申請待審核：${activity.activity_type}`,
      message: `申請人：${getUserInfo(req)}`,
      link: '/deletion-requests',
      related_type: 'deletion_request',
      related_id: requestId
    }, req.user.id);
    res.redirect(`/customers/${req.params.id}?success=` + encodeURIComponent('已送出刪除申請，待管理員審核後才會真正刪除'));
  } catch (err) {
    console.error(err);
    res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// 更新客戶
router.post('/:id', requireCrmEditPermission, (req, res) => {
  try {
    if (!Customer.findById(req.params.id)) {
      return res.status(404).render('error', { message: '找不到客戶', error: {} });
    }

    Customer.update(req.params.id, {
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1' ? 1 : 0,
      contact_name: req.body.contact_name,
      contact_phone: req.body.contact_phone,
      contact_email: req.body.contact_email,
      owner_salesperson_id: req.body.owner_salesperson_id || null,
      customer_level: req.body.customer_level || null,
      industry: req.body.industry,
      status: req.body.status,
      party_type: req.body.party_type,
      vendor_type: req.body.vendor_type,
      bank_name: req.body.bank_name,
      bank_account: req.body.bank_account,
      address: req.body.address,
      userInfo: getUserInfo(req)
    });
    res.redirect(`/customers/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
