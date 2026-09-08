/**
 * 業務績效儀表板（僅 project_view_scope 為 'all' 的角色可存取，內建的 admin/user/boss 皆屬此類）
 */
const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const SalesPerformanceService = require('../services/SalesPerformanceService');
const db = require('../models/db');

// 儀表板上「洽談中/已成交」快速連結要連到目前實際設定的狀態名稱，改名後連結才不會失效
function getStatusLinkNames() {
  const open = db.prepare('SELECT status_name FROM pipeline_statuses WHERE is_won = 0 AND is_lost = 0 ORDER BY display_order ASC LIMIT 1').get();
  const won = db.prepare('SELECT status_name FROM pipeline_statuses WHERE is_won = 1 LIMIT 1').get();
  return {
    openStatusName: open ? open.status_name : '洽談中',
    wonStatusName: won ? won.status_name : '已成交'
  };
}

router.get('/', (req, res) => {
  // 比照原本 admin/user/boss 可存取、salesperson 不可存取的語意，改用角色的
  // project_view_scope 判斷（這三個內建角色皆為 'all'，salesperson 為 'own'），
  // 自訂角色也能透過設定 project_view_scope 取得對應存取權
  if (!req.user || req.user.project_view_scope !== 'all') {
    return res.status(403).render('error', { message: '無權限存取業務績效頁面', error: {} });
  }
  const years = Project.getYears();
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;

  const performance = SalesPerformanceService.getPerformanceBySalesperson(selectedYear);
  const pipelineSummary = SalesPerformanceService.getPipelineSummary();

  res.render('sales-performance/index', {
    title: '業務績效儀表板',
    performance,
    pipelineSummary,
    years,
    selectedYear: selectedYear ? selectedYear : 'all',
    ...getStatusLinkNames()
  });
});

module.exports = router;
