/**
 * 業務績效儀表板（僅 admin、user、boss 可存取）
 */
const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const SalesPerformanceService = require('../services/SalesPerformanceService');

const allowedRoles = ['admin', 'user', 'boss'];
router.get('/', (req, res) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
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
    selectedYear: selectedYear ? selectedYear : 'all'
  });
});

module.exports = router;
