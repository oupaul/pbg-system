const express = require('express');
const path = require('path');
const ExcelImportService = require('../services/ExcelImportService');
const ExcelExportService = require('../services/ExcelExportService');
const PdfExportService = require('../services/PdfExportService');
const Project = require('../models/Project');
const db = require('../models/db');
const { getUserInfo } = require('../utils/authHelper');

const { guardedSingleUpload, XLSX_EXTENSIONS } = require('../utils/uploadValidation');
const { mountImportFlow } = require('../utils/importFlow');
const { requireFullProjectScope } = require('../utils/projectScope');
const { requireImport } = require('../middleware/auth');
const summaries = require('../utils/importSummaries');

module.exports = function(upload) {
  // Excel 匯入：只接受內容確實是 .xlsx 的檔案（檢查副檔名、檔頭與 zip 結構）
  const xlsxUploadGuard = guardedSingleUpload({
    multer: upload,
    allowed: XLSX_EXTENSIONS,
    xlsxStructure: true,
    onReject: (req, res, message) => res.redirect('/import-export?error=' + encodeURIComponent(message))
  });

  const router = express.Router();

  // 發票/成本明細匯出依「發票日期/成本日期」年度篩選，年度清單取自實際有資料的年份（所有 render 都需要，統一放 locals）
  router.use((req, res, next) => {
    try {
      res.locals.invoiceYears = db.prepare(`
        SELECT DISTINCT substr(invoice_date, 1, 4) AS y FROM invoices
        WHERE deleted_at IS NULL AND invoice_date IS NOT NULL AND length(invoice_date) >= 4 ORDER BY y DESC
      `).all().map(r => r.y);
      res.locals.costYears = db.prepare(`
        SELECT DISTINCT substr(cost_date, 1, 4) AS y FROM costs
        WHERE cost_date IS NOT NULL AND length(cost_date) >= 4 ORDER BY y DESC
      `).all().map(r => r.y);
    } catch (err) {
      res.locals.invoiceYears = [];
      res.locals.costYears = [];
    }
    next();
  });

  // 匯入匯出頁面
  router.get('/', (req, res) => {
    const years = Project.getYears();
    let result = null;
    
    // 匯入結果改放 session（一次性顯示後即清除），不再從網址參數解析 JSON：
    // 網址參數可被任何人偽造成惡意內容，且匯入結果可能含 Excel 內容
    if (req.session && req.session.importResult) {
      result = req.session.importResult;
      delete req.session.importResult;
    } else if (req.query.error) {
      // 如果有 error 參數，建立錯誤結果
      result = {
        success: false,
        error: String(req.query.error)
      };
    }

    // 正規化結果物件，避免模板存取 undefined
    if (result) {
      result.errors = Array.isArray(result.errors) ? result.errors : [];
      result.log = Array.isArray(result.log) ? result.log : [];
      result.results = result.results || {};
      result.errorCount = result.errorCount || result.errors.length || 0;
      result.warning = result.warning || null;
      result.success = result.success !== false;
    }
    
    res.render('import-export/index', {
      title: '匯入/匯出',
      years,
      result
    });
  });

  // 下載範例檔案
  router.get('/template', async (req, res) => {
    try {
      const workbook = ExcelExportService.generateTemplate();
      const buffer = await ExcelExportService.writeToBuffer(workbook);

      const filename = '專案總表範例.xlsx';
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('下載範例檔案錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 成本明細批次匯入範本
  router.get('/template/costs', async (req, res) => {
    try {
      const workbook = ExcelExportService.generateCostTemplate();
      const buffer = await ExcelExportService.writeToBuffer(workbook);
      const encodedFilename = encodeURIComponent('成本明細匯入範本.xlsx').replace(/'/g, '%27');
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('下載成本明細匯入範本失敗:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 匯入（上傳 → 試跑預覽 → 確認才寫入）：流程見 utils/importFlow.js
  mountImportFlow(router, {
    kind: 'costs',
    label: '成本明細',
    urlBase: '/import-export/import-costs',
    routePath: '/import-costs',
    backUrl: '/import-export',
    guards: [requireImport],
    upload: xlsxUploadGuard,
    run: (filePath, req, opts) => ExcelImportService.importCosts(filePath, getUserInfo(req), opts),
    summarize: summaries.summarizeCosts,
    finish: (req, raw) => { req.session.importResult = summaries.shapeCosts(raw); }
  });

  mountImportFlow(router, {
    kind: 'projects',
    label: '專案總表',
    urlBase: '/import-export/import',
    routePath: '/import',
    backUrl: '/import-export',
    guards: [requireImport],
    upload: xlsxUploadGuard,
    longTimeout: true, // 大檔案匯入可能超過預設逾時（沿用原本的 10 分鐘）
    run: (filePath, req, opts) => ExcelImportService.importExcel(filePath, getUserInfo(req), opts),
    summarize: summaries.summarizeProjects,
    finish: (req, raw) => { req.session.importResult = summaries.shapeProjects(raw); }
  });

  // 以下匯出都是全公司範圍的報表，只開放專案檢視範圍為「全部」的角色（見 utils/projectScope.js）
  router.use('/export', requireFullProjectScope);

  // 匯出專案總表
  router.get('/export/projects/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const workbook = ExcelExportService.exportProjectSummary(year);
      const buffer = await ExcelExportService.writeToBuffer(workbook);

      // 正確處理中文檔案名稱編碼
      const filename = `專案總表_${year}.xlsx`;
      // 使用 RFC 5987 格式編碼檔案名稱
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      
      // 確保 buffer 是 Node.js Buffer
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      // 使用 RFC 5987 格式，並提供 ASCII fallback
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('匯出專案總表錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 匯出獎金報表
  router.get('/export/bonuses/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const workbook = ExcelExportService.exportBonusReport(year);
      const buffer = await ExcelExportService.writeToBuffer(workbook);

      // 正確處理中文檔案名稱編碼
      const filename = `獎金報表_${year}.xlsx`;
      // 使用 RFC 5987 格式編碼檔案名稱
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      
      // 確保 buffer 是 Node.js Buffer
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      // 使用 RFC 5987 格式，並提供 ASCII fallback
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('匯出獎金報表錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 發票明細匯出（year 為 'all' 代表全部年度；依發票日期年度篩選）
  router.get('/export/invoices/:year', async (req, res) => {
    try {
      const year = /^\d{4}$/.test(req.params.year) ? parseInt(req.params.year) : null;
      const workbook = ExcelExportService.exportInvoices(year);
      const buffer = await ExcelExportService.writeToBuffer(workbook);
      const encodedFilename = encodeURIComponent(`發票明細_${year || '全部'}.xlsx`).replace(/'/g, '%27');
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('匯出發票明細錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 成本明細匯出（year 為 'all' 代表全部；依成本日期年度篩選，匯出檔可直接用「成本明細匯入」重新匯入）
  router.get('/export/costs/:year', async (req, res) => {
    try {
      const year = /^\d{4}$/.test(req.params.year) ? parseInt(req.params.year) : null;
      const workbook = ExcelExportService.exportCosts(year);
      const buffer = await ExcelExportService.writeToBuffer(workbook);
      const encodedFilename = encodeURIComponent(`成本明細_${year || '全部'}.xlsx`).replace(/'/g, '%27');
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('匯出成本明細錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // PDF 匯出：專案總表
  router.get('/export/pdf/projects/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const buffer = await PdfExportService.exportProjectSummary(year);
      const filename = `專案總表_${year}.pdf`;
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.send(buffer);
    } catch (err) {
      console.error('PDF 匯出專案總表錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // PDF 匯出：獎金報表
  router.get('/export/pdf/bonuses/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const buffer = await PdfExportService.exportBonusReport(year);
      const filename = `獎金報表_${year}.pdf`;
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.send(buffer);
    } catch (err) {
      console.error('PDF 匯出獎金報表錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // 匯出帳齡分析 Excel
  router.get('/export/aging', async (req, res) => {
    try {
      const yearParam = req.query.year;
      const year = yearParam && yearParam !== 'all' ? parseInt(yearParam) : null;
      const workbook = ExcelExportService.exportReceivablesAging(year);
      const buffer = await ExcelExportService.writeToBuffer(workbook);
      const filename = year ? `應收帳款帳齡分析_${year}.xlsx` : '應收帳款帳齡分析_全部.xlsx';
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Length', nodeBuffer.length);
      res.send(nodeBuffer);
    } catch (err) {
      console.error('匯出帳齡分析 Excel 錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  // PDF 匯出：帳齡分析（query: ?year=2024 或省略為全部）
  router.get('/export/pdf/aging', async (req, res) => {
    try {
      const yearParam = req.query.year;
      const year = yearParam && yearParam !== 'all' ? parseInt(yearParam) : null;
      const buffer = await PdfExportService.exportReceivablesAging(year);
      const filename = year ? `應收帳款帳齡分析_${year}.pdf` : '應收帳款帳齡分析_全部.pdf';
      const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      res.send(buffer);
    } catch (err) {
      console.error('PDF 匯出帳齡分析錯誤:', err);
      res.redirect('/import-export?error=' + encodeURIComponent(err.message));
    }
  });

  return router;
};
