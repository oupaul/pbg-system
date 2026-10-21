const express = require('express');
const router = express.Router();
const Bonus = require('../models/Bonus');
const Project = require('../models/Project');
const Salesperson = require('../models/Salesperson');
const db = require('../models/db');
const { getUserInfo } = require('../utils/authHelper');
const safeRedirect = require('../utils/safeRedirect');
const { requireEditPermission } = require('../middleware/auth');
const { requireProjectScopeFromBody, requireProjectScopeFromRecord, userCanAccessProject, getVisibleSalespersonIds } = require('../utils/projectScope');

// 寫入獎金需要編輯權限，且操作的專案必須在使用者的專案範圍內
const bonusScope = requireProjectScopeFromRecord(id => Bonus.findById(id));

// 獎金總覽
router.get('/', (req, res) => {
  const years = Project.getYears();
  const selectedYear = req.query.year || years[0] || new Date().getFullYear();

  // 排序參數
  const sortBy = req.query.sortBy || 'salesperson_name';
  const sortOrder = req.query.sortOrder || 'ASC';

  // 角色過濾邏輯：依專案檢視範圍限制可看到的業務（自己／指派／無；預設拒絕）
  const visibleIds = getVisibleSalespersonIds(req.user); // null = 不限制
  let salespersonFilter = '';
  let filterParams = [selectedYear];

  if (visibleIds !== null) {
    salespersonFilter = visibleIds.length
      ? ` AND b.salesperson_id IN (${visibleIds.map(() => '?').join(',')})`
      : ' AND 1=0';
    filterParams.push(...visibleIds);
  }

  // 獎金統計（有範圍限制時逐一業務查詢後依獎金類型合併）
  let stats;
  if (visibleIds === null) {
    stats = Bonus.getStatistics(selectedYear);
  } else {
    const merged = {};
    visibleIds.forEach(id => {
      Bonus.getStatisticsBySalesperson(selectedYear, id).forEach(r => {
        const m = merged[r.bonus_type] || (merged[r.bonus_type] = { bonus_type: r.bonus_type, count: 0, total_amount: 0, paid_amount: 0, pending_amount: 0, forfeited_amount: 0 });
        m.count += r.count || 0;
        m.total_amount += r.total_amount || 0;
        m.paid_amount += r.paid_amount || 0;
        m.pending_amount += r.pending_amount || 0;
        m.forfeited_amount += r.forfeited_amount || 0;
      });
    });
    stats = Object.values(merged);
  }

  // 業務獎金彙總
  const salespersonSummary = visibleIds === null
    ? Bonus.getSalespersonSummary(selectedYear)
    : Bonus.getSalespersonSummary(selectedYear).filter(s => visibleIds.includes(s.id));

  // 允許的排序欄位
  const allowedSortFields = {
    'salesperson_name': 'b.salesperson_name',
    'project_code': 'b.project_code',
    'project_name': 'b.project_name',
    'project_type': 'b.project_type',
    'bonus_type': 'b.bonus_type',
    'bonus_amount': 'b.bonus_amount',
    'payment_date': 'b.payment_date',
    'status': 'b.status'
  };

  // 構建排序 SQL
  const sortField = allowedSortFields[sortBy] || 'b.salesperson_name';
  const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const orderBy = `ORDER BY ${sortField} ${order}`;

  // 獎金明細
  const bonuses = db.prepare(`
    SELECT b.*, p.contract_year
    FROM v_bonus_summary b
    JOIN projects p ON b.project_id = p.id
    WHERE p.contract_year = ?${salespersonFilter}
    ${orderBy}
  `).all(...filterParams);

  // 生成排序連結的輔助函數
  const buildQueryString = (newSortBy, newSortOrder) => {
    const params = new URLSearchParams();
    params.append('year', selectedYear);
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
    salesperson_name: getSortLink('salesperson_name'),
    project_code: getSortLink('project_code'),
    project_name: getSortLink('project_name'),
    project_type: getSortLink('project_type'),
    bonus_type: getSortLink('bonus_type'),
    bonus_amount: getSortLink('bonus_amount'),
    payment_date: getSortLink('payment_date'),
    status: getSortLink('status')
  };

  const sortIcons = {
    salesperson_name: getSortIcon('salesperson_name'),
    project_code: getSortIcon('project_code'),
    project_name: getSortIcon('project_name'),
    project_type: getSortIcon('project_type'),
    bonus_type: getSortIcon('bonus_type'),
    bonus_amount: getSortIcon('bonus_amount'),
    payment_date: getSortIcon('payment_date'),
    status: getSortIcon('status')
  };

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
  
  res.render('bonuses/index', {
    title: '獎金管理',
    years,
    selectedYear,
    stats,
    salespersonSummary,
    bonuses,
    sortLinks,
    sortIcons,
    typeColorMap,
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

// 新增獎金
router.post('/', requireEditPermission, requireProjectScopeFromBody, (req, res) => {
  try {
    Bonus.create({
      project_id: req.body.project_id,
      salesperson_id: req.body.salesperson_id,
      bonus_type: req.body.bonus_type,
      base_amount: parseFloat(req.body.base_amount) || 0,
      bonus_percentage: parseFloat(req.body.bonus_percentage) || 0,
      bonus_amount: parseFloat(req.body.bonus_amount) || 0,
      payment_date: req.body.payment_date || null,
      status: req.body.status || '待發放',
      forfeiture_reason: req.body.forfeiture_reason,
      userInfo: getUserInfo(req)
    });

    res.redirect(`/projects/${req.body.project_id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${req.body.project_id}?error=` + encodeURIComponent(err.message));
  }
});

// 注意：/batch-update、/batch-delete 必須定義在 /:id 之前，否則會被 /:id 當成 id 吃掉而回 404
// 批次更新獎金狀態
router.post('/batch-update', requireEditPermission, (req, res) => {
  try {
    // 表單只勾一筆時 ids 會是字串而不是陣列，統一轉成陣列
    const ids = [].concat(req.body.ids || []).filter(Boolean);
    const status = req.body.status;
    const paymentDate = req.body.payment_date;

    if (ids.length === 0) {
      return res.status(400).json({ error: '請選擇要更新的獎金' });
    }
    if (!['待發放', '已發放', '充公'].includes(status)) {
      return res.status(400).json({ error: '無效的獎金狀態' });
    }

    // 先全部檢查範圍再更新，任何一筆不在範圍內就整批拒絕
    for (const id of ids) {
      const bonus = Bonus.findById(id);
      if (bonus && !userCanAccessProject(req.user, bonus.project_id)) {
        return res.status(403).json({ error: '部分獎金所屬專案不在您的權限範圍內' });
      }
    }
    for (const id of ids) {
      Bonus.update(id, { status, payment_date: paymentDate });
    }

    res.redirect('/bonuses?year=' + encodeURIComponent(req.body.year || ''));
  } catch (err) {
    console.error(err);
    res.redirect('/bonuses?error=' + encodeURIComponent('批次更新失敗'));
  }
});

// 批次刪除獎金（需要刪除權限）
router.post('/batch-delete', requireEditPermission, (req, res) => {
  if (!req.user || !req.user.canDelete) {
    return res.redirect('/bonuses?error=' + encodeURIComponent('權限不足'));
  }

  try {
    const bonusIds = req.body.bonus_ids;
    
    if (!bonusIds || bonusIds.length === 0) {
      return res.redirect('/bonuses?error=' + encodeURIComponent('請至少選擇一筆獎金記錄'));
    }

    // 確保 bonusIds 是陣列
    const idsToDelete = Array.isArray(bonusIds) ? bonusIds : [bonusIds];
    
    let deletedCount = 0;
    let failedCount = 0;
    
    idsToDelete.forEach(id => {
      try {
        const bonus = Bonus.findById(id);
        if (bonus && userCanAccessProject(req.user, bonus.project_id)) {
          Bonus.delete(id, getUserInfo(req));
          deletedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        console.error('刪除獎金失敗:', id, err);
        failedCount++;
      }
    });

    if (deletedCount > 0) {
      return res.redirect('/bonuses?success=' + encodeURIComponent(`成功刪除 ${deletedCount} 筆獎金記錄${failedCount > 0 ? '，' + failedCount + ' 筆失敗' : ''}`));
    } else {
      return res.redirect('/bonuses?error=' + encodeURIComponent('刪除失敗，請稍後再試'));
    }
  } catch (err) {
    console.error('批次刪除錯誤:', err);
    res.redirect('/bonuses?error=' + encodeURIComponent('批次刪除失敗：' + err.message));
  }
});

// 更新獎金狀態
router.post('/:id', requireEditPermission, bonusScope, (req, res) => {
  try {
    const bonus = Bonus.findById(req.params.id);
    if (!bonus) {
      return res.status(404).render('error', { 
        title: '找不到獎金記錄',
        message: '找不到獎金記錄', 
        error: {} 
      });
    }

    Bonus.update(req.params.id, {
      base_amount: parseFloat(req.body.base_amount) || 0,
      bonus_percentage: parseFloat(req.body.bonus_percentage) || 0,
      bonus_amount: parseFloat(req.body.bonus_amount) || 0,
      payment_date: req.body.payment_date || null,
      status: req.body.status || '待發放',
      forfeiture_reason: req.body.forfeiture_reason || null
    });

    const redirectTo = safeRedirect(req.body.redirect, `/projects/${bonus.project_id}`);
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    const bonus = Bonus.findById(req.params.id);
    if (bonus) {
      const redirectTo = safeRedirect(req.body.redirect, `/projects/${bonus.project_id}`);
      res.redirect(redirectTo + '?error=' + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 刪除獎金
router.post('/:id/delete', requireEditPermission, bonusScope, (req, res) => {
  try {
    const bonus = Bonus.findById(req.params.id);
    if (!bonus) {
      return res.status(404).json({ error: '找不到獎金記錄' });
    }

    const projectId = bonus.project_id;
    Bonus.delete(req.params.id, getUserInfo(req));

    res.redirect(`/projects/${projectId}`);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
