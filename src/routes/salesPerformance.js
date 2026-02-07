/**
 * 業務績效儀表板
 */
const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const SalesPerformanceService = require('../services/SalesPerformanceService');

router.get('/', (req, res) => {
  const years = Project.getYears();
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;

  let performance = SalesPerformanceService.getPerformanceBySalesperson(selectedYear);

  // 業務員角色僅能看自己的資料
  if (req.user && req.user.role === 'salesperson' && req.user.salesperson_id) {
    performance = performance.filter(p => p.id === req.user.salesperson_id);
  }

  res.render('sales-performance/index', {
    title: '業務績效儀表板',
    performance,
    years,
    selectedYear: selectedYear ? selectedYear : 'all'
  });
});

module.exports = router;
