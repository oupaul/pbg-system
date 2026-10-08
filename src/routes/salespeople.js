const express = require('express');
const router = express.Router();
const Salesperson = require('../models/Salesperson');
const Project = require('../models/Project');
const Bonus = require('../models/Bonus');
const { getUserInfo } = require('../utils/authHelper');
const { requireEditPermission } = require('../middleware/auth');
const cache = require('../services/CacheService');
const db = require('../models/db');

// 專案類型（含顏色），供類型金額欄位與徽章顏色使用
function getProjectTypeRows() {
  try {
    return db.prepare(`SELECT type_name, badge_color, display_order FROM project_types WHERE is_active = 1 ORDER BY display_order ASC, type_name ASC`).all();
  } catch (err) {
    return [];
  }
}
function getTypeColorMap() {
  const map = {};
  try {
    db.prepare('SELECT type_name, badge_color FROM project_types').all().forEach(t => { map[t.type_name] = t.badge_color; });
  } catch (err) { /* 表不存在時不預載 */ }
  return map;
}

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
  const typeAmountsBySp = Salesperson.getTypeAmounts(selectedYear);
  let salespeopleWithStats = salespeople.map(sp => {
    const perf = Salesperson.getPerformance(sp.id, selectedYear);
    return { ...sp, ...perf };
  });

  // 專案類型金額欄位：依「專案類型管理」目前啟用的類型自動產生（不寫死類型名稱），
  // 依全體業務該類型的總金額由大到小排序；超過上限的類型、已停用或沒有對應的類型合併為「其他類型」
  const MAX_TYPE_COLUMNS = 5;
  const typeRows = getProjectTypeRows();
  const activeNames = new Set(typeRows.map(t => t.type_name));
  const typeTotals = {};
  Object.values(typeAmountsBySp).forEach(m => Object.entries(m).forEach(([name, amt]) => { typeTotals[name] = (typeTotals[name] || 0) + amt; }));
  const rankedTypes = typeRows
    .filter(t => (typeTotals[t.type_name] || 0) > 0 || typeRows.length <= MAX_TYPE_COLUMNS)
    .sort((a, b) => (typeTotals[b.type_name] || 0) - (typeTotals[a.type_name] || 0) || a.display_order - b.display_order)
    .slice(0, MAX_TYPE_COLUMNS);
  const typeColumns = rankedTypes.map((t, i) => ({ key: 'type_' + i, name: t.type_name, color: t.badge_color }));
  const shownNames = new Set(rankedTypes.map(t => t.type_name));
  const hasOther = Object.keys(typeTotals).some(name => !shownNames.has(name) && typeTotals[name] > 0);
  if (hasOther) typeColumns.push({ key: 'type_other', name: '其他類型', color: 'secondary' });
  salespeopleWithStats.forEach(sp => {
    const m = typeAmountsBySp[sp.id] || {};
    typeColumns.forEach(col => {
      sp[col.key] = col.key === 'type_other'
        ? Object.entries(m).filter(([n]) => !shownNames.has(n)).reduce((s, [, a]) => s + a, 0)
        : (m[col.name] || 0);
    });
  });

  // 排序
  const sortFieldMap = {
    'name': 'name',
    'status': 'status',
    'project_count': 'project_count',
    'total_amount': 'total_amount'
  };
  typeColumns.forEach(col => { sortFieldMap[col.key] = col.key; });

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
    total_amount: getSortLink('total_amount')
  };
  typeColumns.forEach(col => { sortLinks[col.key] = getSortLink(col.key); });

  const sortIcons = {
    name: getSortIcon('name'),
    status: getSortIcon('status'),
    project_count: getSortIcon('project_count'),
    total_amount: getSortIcon('total_amount')
  };
  typeColumns.forEach(col => { sortIcons[col.key] = getSortIcon(col.key); });

  res.render('salespeople/index', {
    title: '業務管理',
    salespeople: salespeopleWithStats,
    years,
    selectedYear: selectedYear || 'all', // 傳遞給視圖，'all' 表示全部年度
    sortLinks,
    sortIcons,
    typeColumns
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
    typeColorMap: getTypeColorMap(),
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

  // 已綁定此業務的登入帳號（供詳情頁顯示／提供「建立登入帳號」捷徑）
  let linkedUsers = [];
  try {
    linkedUsers = db.prepare('SELECT id, username, name, is_active FROM users WHERE salesperson_id = ? ORDER BY id').all(salesperson.id);
  } catch (err) { /* 舊版資料庫沒有 salesperson_id 欄位時略過 */ }

  res.render('salespeople/show', {
    title: salesperson.name,
    salesperson,
    linkedUsers,
    projects,
    bonuses,
    performance,
    typeColorMap: getTypeColorMap(),
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
