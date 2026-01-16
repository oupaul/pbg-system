const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Project = require('../models/Project');
const db = require('../models/db');
const { getUserInfo } = require('../utils/authHelper');

// 客戶列表
router.get('/', (req, res) => {
  try {
    // 排序參數
    const sortBy = req.query.sortBy || 'company_name';
    const sortOrder = req.query.sortOrder || 'ASC';
    // 搜尋關鍵字
    const searchKeyword = req.query.search || '';

    // 根據是否有搜尋關鍵字決定使用哪個方法
    let customers = searchKeyword ? Customer.search(searchKeyword) : Customer.findAll();
    
    // 確保 customers 是陣列
    if (!Array.isArray(customers)) {
      customers = [];
    }

    // 排序
    const sortFieldMap = {
      'customer_code': 'customer_code',
      'tax_id': 'tax_id',
      'company_name': 'company_name',
      'project_count': 'project_count'
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

    // 生成排序連結的輔助函數
    const buildQueryString = (newSortBy, newSortOrder) => {
      const params = new URLSearchParams();
      if (searchKeyword) {
        params.append('search', searchKeyword);
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
      project_count: getSortLink('project_count')
    };

    const sortIcons = {
      customer_code: getSortIcon('customer_code'),
      tax_id: getSortIcon('tax_id'),
      company_name: getSortIcon('company_name'),
      project_count: getSortIcon('project_count')
    };
  
    res.render('customers/index', {
      title: '客戶管理',
      customers: customers || [],
      sortLinks: sortLinks || {},
      sortIcons: sortIcons || {},
      searchKeyword: searchKeyword || '',
      req: req
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

// 快速新增客戶（API，返回 JSON）
router.post('/quick-add', (req, res) => {
  try {
    const customerId = Customer.create({
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1',
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
        tax_id: customer.tax_id
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
router.post('/', (req, res) => {
  try {
    Customer.create({
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1',
      userInfo: getUserInfo(req)
    });
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

  // 客戶的專案
  const projects = db.prepare(`
    SELECT p.*, s.name as salesperson_name
    FROM projects p
    LEFT JOIN salespeople s ON p.salesperson_id = s.id
    WHERE p.customer_id = ?
    ORDER BY p.contract_year DESC, p.contract_month DESC
  `).all(customer.id);

  // 統計
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as project_count,
      SUM(price_with_tax) as total_amount,
      SUM(CASE WHEN status = '已結案' THEN 1 ELSE 0 END) as closed_count
    FROM projects
    WHERE customer_id = ?
  `).get(customer.id);

  res.render('customers/show', {
    title: customer.company_name,
    customer,
    projects,
    stats
  });
});

// 更新客戶
router.post('/:id', (req, res) => {
  try {
    Customer.update(req.params.id, {
      customer_code: req.body.customer_code,
      tax_id: req.body.tax_id,
      company_name: req.body.company_name,
      is_new_customer: req.body.is_new_customer === '1' ? 1 : 0,
      userInfo: getUserInfo(req)
    });
    res.redirect(`/customers/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/customers/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
