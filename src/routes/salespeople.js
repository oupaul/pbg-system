const express = require('express');
const router = express.Router();
const Salesperson = require('../models/Salesperson');
const Project = require('../models/Project');
const Bonus = require('../models/Bonus');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');
const cache = require('../services/CacheService');

// 業務列表
router.get('/', (req, res) => {
  const salespeople = Salesperson.findAll(true);
  const years = Project.getYears();
  const yearFilter = req.query.year;
  // 支援 "all" 選項，表示全部年度
  const selectedYear = yearFilter && yearFilter !== 'all' ? parseInt(yearFilter) : null;

  // 排序參數
  const sortBy = req.query.sortBy || 'name';
  const sortOrder = req.query.sortOrder || 'ASC';

  // 計算每位業務的業績
  let salespeopleWithStats = salespeople.map(sp => {
    const perf = Salesperson.getPerformance(sp.id, selectedYear);
    return { ...sp, ...perf };
  });

  // 排序
  const sortFieldMap = {
    'name': 'name',
    'status': 'status',
    'project_count': 'project_count',
    'total_amount': 'total_amount',
    'lab_amount': 'lab_amount',
    'ad_amount': 'ad_amount',
    'project_amount': 'project_amount'
  };

  const sortField = sortFieldMap[sortBy] || 'name';
  salespeopleWithStats.sort((a, b) => {
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
    if (yearFilter) params.append('year', yearFilter);
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
    name: getSortLink('name'),
    status: getSortLink('status'),
    project_count: getSortLink('project_count'),
    total_amount: getSortLink('total_amount'),
    lab_amount: getSortLink('lab_amount'),
    ad_amount: getSortLink('ad_amount'),
    project_amount: getSortLink('project_amount')
  };

  const sortIcons = {
    name: getSortIcon('name'),
    status: getSortIcon('status'),
    project_count: getSortIcon('project_count'),
    total_amount: getSortIcon('total_amount'),
    lab_amount: getSortIcon('lab_amount'),
    ad_amount: getSortIcon('ad_amount'),
    project_amount: getSortIcon('project_amount')
  };

  res.render('salespeople/index', {
    title: '業務管理',
    salespeople: salespeopleWithStats,
    years,
    selectedYear: selectedYear || 'all', // 傳遞給視圖，'all' 表示全部年度
    sortLinks,
    sortIcons
  });
});

// 新增業務
router.post('/', (req, res) => {
  try {
    Salesperson.create({
      name: req.body.name,
      status: req.body.status || 'active',
      resigned_date: req.body.resigned_date || null,
      userInfo: getUserInfo(req)
    });
    res.redirect('/salespeople');
  } catch (err) {
    console.error(err);
    res.redirect('/salespeople?error=' + encodeURIComponent(err.message));
  }
});

// 整批移轉專案 - 表單頁
router.get('/:id/transfer-projects', requireEditPermission, (req, res) => {
  const salesperson = Salesperson.findById(req.params.id);
  if (!salesperson) {
    return res.status(404).render('error', { title: '找不到業務人員', message: '找不到業務人員', error: {} });
  }

  // 供目標業務下拉（排除自己）
  const activeSalespeople = Salesperson.findAll(false).filter(s => s.id !== salesperson.id);

  // 全部專案（供前端 JS 動態篩選預覽）
  const allProjects = Project.findAll({ salesperson: salesperson.name });

  // 可選年度
  const years = Project.getYears();

  res.render('salespeople/transfer', {
    title: `移轉專案 - ${salesperson.name}`,
    salesperson,
    activeSalespeople,
    allProjects,
    years,
    success: req.query.success ? decodeURIComponent(req.query.success) : null,
    error: req.query.error   ? decodeURIComponent(req.query.error)   : null
  });
});

// 整批移轉專案 - 執行
router.post('/:id/transfer-projects', requireEditPermission, (req, res) => {
  const fromId = req.params.id;
  try {
    const { to_salesperson_id, scope, year } = req.body;

    if (!to_salesperson_id) {
      return res.redirect(`/salespeople/${fromId}/transfer-projects?error=` +
        encodeURIComponent('請選擇目標業務'));
    }
    if (!['all', 'open', 'year'].includes(scope)) {
      return res.redirect(`/salespeople/${fromId}/transfer-projects?error=` +
        encodeURIComponent('移轉範圍參數無效'));
    }
    if (scope === 'year' && !year) {
      return res.redirect(`/salespeople/${fromId}/transfer-projects?error=` +
        encodeURIComponent('請選擇要移轉的年度'));
    }

    const count = Salesperson.transferProjects(
      fromId,
      to_salesperson_id,
      { scope, year: year || null },
      getUserInfo(req)
    );

    // 清除儀表板快取
    cache.delByPrefix('dashboard:');

    const to = Salesperson.findById(to_salesperson_id);
    const toName = to ? to.name : `#${to_salesperson_id}`;
    const successMsg = `已成功移轉 ${count} 筆專案給 ${toName}`;

    res.redirect(`/salespeople/${fromId}?success=` + encodeURIComponent(successMsg));
  } catch (err) {
    console.error('[移轉專案] 錯誤:', err);
    res.redirect(`/salespeople/${fromId}/transfer-projects?error=` +
      encodeURIComponent('移轉失敗：' + err.message));
  }
});

// 業務詳情
router.get('/:id', (req, res) => {
  const salesperson = Salesperson.findById(req.params.id);
  if (!salesperson) {
    return res.status(404).render('error', { 
      title: '找不到業務人員',
      message: '找不到業務人員', 
      error: {} 
    });
  }

  const years = Project.getYears();
  const yearFilter = req.query.year;
  // 支援 "all" 選項，表示全部年度
  const selectedYear = yearFilter && yearFilter !== 'all' ? parseInt(yearFilter) : null;

  // 業務的專案
  const projects = Project.findAll({
    year: selectedYear,
    salesperson: salesperson.name
  });

  // 業務的獎金
  const bonuses = Bonus.findBySalesperson(salesperson.id, selectedYear);

  // 業績統計
  const performance = Salesperson.getPerformance(salesperson.id, selectedYear);

  res.render('salespeople/show', {
    title: salesperson.name,
    salesperson,
    projects,
    bonuses,
    performance,
    years,
    selectedYear: selectedYear || 'all',
    success: req.query.success ? decodeURIComponent(req.query.success) : null,
    error: req.query.error   ? decodeURIComponent(req.query.error)   : null
  });
});

// 更新業務
router.post('/:id', (req, res) => {
  try {
    Salesperson.update(req.params.id, {
      name: req.body.name,
      status: req.body.status,
      resigned_date: req.body.resigned_date,
      show_separate_dashboard: req.body.show_separate_dashboard === '1',
      userInfo: getUserInfo(req)
    });
    res.redirect(`/salespeople/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/salespeople/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
