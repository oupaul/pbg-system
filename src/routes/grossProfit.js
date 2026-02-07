/**
 * 專案毛利分析
 */
const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const GrossProfitAnalysisService = require('../services/GrossProfitAnalysisService');

router.get('/', (req, res) => {
  const years = Project.getYears();
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;

  const byProject = GrossProfitAnalysisService.getAnalysisByProject(selectedYear);
  const bySalesperson = GrossProfitAnalysisService.getAnalysisBySalesperson(selectedYear);
  const byType = GrossProfitAnalysisService.getAnalysisByType(selectedYear);

  const totals = {
    revenue: byProject.reduce((s, r) => s + (r.revenue || 0), 0),
    cost: byProject.reduce((s, r) => s + (r.total_cost || 0), 0),
    grossProfit: byProject.reduce((s, r) => s + (r.gross_profit || 0), 0)
  };
  totals.grossMarginPct = totals.revenue > 0
    ? Math.round((totals.grossProfit / totals.revenue) * 1000) / 10
    : 0;

  res.render('gross-profit/index', {
    title: '專案毛利分析',
    byProject,
    bySalesperson,
    byType,
    totals,
    years,
    selectedYear: selectedYear ? selectedYear : 'all'
  });
});

module.exports = router;
