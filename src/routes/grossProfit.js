/**
 * 專案毛利分析
 */
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const Project = require('../models/Project');
const GrossProfitAnalysisService = require('../services/GrossProfitAnalysisService');
const ExcelExportService = require('../services/ExcelExportService');
const PdfExportService = require('../services/PdfExportService');

router.get('/export', async (req, res) => {
  try {
    const yearParam = req.query.year;
    const year = yearParam && yearParam !== 'all' ? parseInt(yearParam) : null;
    const workbook = ExcelExportService.exportGrossProfit(year, req.user);
    const buffer = await ExcelExportService.writeToBuffer(workbook);
    const filename = year ? `毛利分析_${year}.xlsx` : '毛利分析_全部.xlsx';
    const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
    const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Length', nodeBuffer.length);
    res.send(nodeBuffer);
  } catch (err) {
    console.error('匯出毛利分析 Excel 錯誤:', err);
    res.redirect('/gross-profit?error=' + encodeURIComponent(err.message));
  }
});

router.get('/export/pdf', async (req, res) => {
  try {
    const yearParam = req.query.year;
    const year = yearParam && yearParam !== 'all' ? parseInt(yearParam) : null;
    const buffer = await PdfExportService.exportGrossProfit(year, req.user);
    const filename = year ? `毛利分析_${year}.pdf` : '毛利分析_全部.pdf';
    const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err) {
    console.error('匯出毛利分析 PDF 錯誤:', err);
    res.redirect('/gross-profit?error=' + encodeURIComponent(err.message));
  }
});

router.get('/', (req, res) => {
  const years = Project.getYears();
  const selectedYear = req.query.year && req.query.year !== 'all' ? parseInt(req.query.year) : null;

  const byProject = GrossProfitAnalysisService.getAnalysisByProject(selectedYear, req.user);
  const bySalesperson = GrossProfitAnalysisService.getAnalysisBySalesperson(selectedYear, req.user);
  const byType = GrossProfitAnalysisService.getAnalysisByType(selectedYear, req.user);
  const byGroup = GrossProfitAnalysisService.getAnalysisByReportGroup(selectedYear, req.user);

  // 讀取各專案類型的毛利警示閾值（毛利率低於此值時顯示警示）
  let alertThresholdByType = {};
  try {
    const types = db.prepare('SELECT type_name, alert_margin_threshold FROM project_types').all();
    types.forEach(t => {
      if (t.alert_margin_threshold != null && !isNaN(t.alert_margin_threshold)) {
        alertThresholdByType[t.type_name] = parseFloat(t.alert_margin_threshold);
      }
    });
  } catch (e) {
    // project_types 可能尚未有 alert_margin_threshold 欄位
  }

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
    byGroup,
    totals,
    years,
    selectedYear: selectedYear ? selectedYear : 'all',
    alertThresholdByType
  });
});

module.exports = router;
