const express = require('express');
const router = express.Router();
const Bonus = require('../models/Bonus');
const Project = require('../models/Project');
const Salesperson = require('../models/Salesperson');
const db = require('../models/db');
const { getUserInfo } = require('../utils/authHelper');

// 獎金總覽
router.get('/', (req, res) => {
  const years = Project.getYears();
  const selectedYear = req.query.year || years[0] || new Date().getFullYear();

  // 排序參數
  const sortBy = req.query.sortBy || 'salesperson_name';
  const sortOrder = req.query.sortOrder || 'ASC';

  // 角色過濾邏輯
  let salespersonFilter = '';
  let filterParams = [selectedYear];
  
  if (req.user && req.user.role === 'salesperson' && req.user.salesperson_id) {
    // 業務員只能看到自己的獎金
    salespersonFilter = ' AND b.salesperson_id = ?';
    filterParams.push(req.user.salesperson_id);
  }

  // 獎金統計
  const stats = req.user && req.user.role === 'salesperson' && req.user.salesperson_id
    ? Bonus.getStatisticsBySalesperson(selectedYear, req.user.salesperson_id)
    : Bonus.getStatistics(selectedYear);
  
  // 業務獎金彙總
  const salespersonSummary = req.user && req.user.role === 'salesperson' && req.user.salesperson_id
    ? Bonus.getSalespersonSummary(selectedYear).filter(s => s.salesperson_id === req.user.salesperson_id)
    : Bonus.getSalespersonSummary(selectedYear);

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
router.post('/', (req, res) => {
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

// 更新獎金狀態
router.post('/:id', (req, res) => {
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

    const redirectTo = req.body.redirect || `/projects/${bonus.project_id}`;
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    const bonus = Bonus.findById(req.params.id);
    if (bonus) {
      const redirectTo = req.body.redirect || `/projects/${bonus.project_id}`;
      res.redirect(redirectTo + '?error=' + encodeURIComponent(err.message));
    } else {
      res.redirect('/projects?error=' + encodeURIComponent(err.message));
    }
  }
});

// 批次更新獎金狀態
router.post('/batch-update', (req, res) => {
  try {
    const ids = req.body.ids;
    const status = req.body.status;
    const paymentDate = req.body.payment_date;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: '請選擇要更新的獎金' });
    }

    for (const id of ids) {
      Bonus.update(id, { status, payment_date: paymentDate });
    }

    res.redirect('/bonuses?year=' + req.body.year);
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// 批次刪除獎金（需要編輯權限）
router.post('/batch-delete', (req, res) => {
  // 檢查編輯權限
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'user')) {
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
        if (bonus) {
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

// 刪除獎金
router.post('/:id/delete', (req, res) => {
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
