const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelImportService = require('../services/ExcelImportService');
const ExcelExportService = require('../services/ExcelExportService');
const PdfExportService = require('../services/PdfExportService');
const Project = require('../models/Project');

module.exports = function(upload) {
  const router = express.Router();

  // 匯入匯出頁面
  router.get('/', (req, res) => {
    const years = Project.getYears();
    let result = null;
    
    // 安全地解析結果參數
    if (req.query.result) {
      try {
        const decoded = decodeURIComponent(req.query.result);
        result = JSON.parse(decoded);
      } catch (parseErr) {
        console.error('解析匯入結果失敗:', parseErr.message);
        console.error('原始參數:', req.query.result?.substring(0, 100));
        // 解析失敗時，嘗試從 error 參數取得錯誤訊息
        if (req.query.error) {
          result = {
            success: false,
            error: decodeURIComponent(req.query.error)
          };
        } else {
          result = {
            success: false,
            error: '匯入結果解析失敗，但匯入可能已成功完成'
          };
        }
      }
    } else if (req.query.error) {
      // 如果有 error 參數，建立錯誤結果
      result = {
        success: false,
        error: decodeURIComponent(req.query.error)
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

  // 匯入Excel
  router.post('/import', upload.single('file'), async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) {
        return res.redirect('/import-export?error=請選擇檔案');
      }

      filePath = req.file.path;
      
      // 設定較長的超時時間（10分鐘）
      req.setTimeout(600000);
      res.setTimeout(600000);
      
      console.log('開始匯入 Excel 檔案:', filePath);
      const result = await ExcelImportService.importExcel(filePath);
      console.log('匯入完成，結果:', {
        success: result.success,
        projects: result.results?.projects || 0,
        errors: result.errorCount || 0
      });

      // 刪除上傳的暫存檔
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          console.error('刪除暫存檔失敗:', unlinkErr);
        }
      }

      // 限制結果資料大小，避免 URL 過長
      // 只保留必要的資訊，錯誤訊息限制長度
      const limitedResult = {
        success: result.success !== false, // 確保是布林值
        results: result.results || {},
        errorCount: result.errorCount || 0,
        // 只保留前 50 個錯誤訊息，每個錯誤訊息限制 200 字元
        errors: (result.errors || []).slice(0, 50).map(err => {
          // 處理錯誤物件格式：{ time, message } 或字串
          if (typeof err === 'object' && err !== null) {
            const errMsg = err.message || err.time || String(err);
            return errMsg.length > 200 ? errMsg.substring(0, 200) + '...' : errMsg;
          }
          const errStr = String(err);
          return errStr.length > 200 ? errStr.substring(0, 200) + '...' : errStr;
        }),
        // 只保留前 100 個日誌，每個日誌限制 200 字元
        log: (result.log || []).slice(0, 100).map(log => {
          // 處理日誌物件格式：{ time, message } 或字串
          if (typeof log === 'object' && log !== null) {
            const logMsg = log.message || log.time || String(log);
            return logMsg.length > 200 ? logMsg.substring(0, 200) + '...' : logMsg;
          }
          const logStr = String(log);
          return logStr.length > 200 ? logStr.substring(0, 200) + '...' : logStr;
        }),
        warning: result.warning || null
      };

      // 確保返回結果，即使有錯誤也要返回
      // 使用 try-catch 確保 redirect 不會失敗
      try {
        // 安全地序列化 JSON，處理可能的循環引用或特殊值
        let resultStr;
        try {
          resultStr = encodeURIComponent(JSON.stringify(limitedResult));
        } catch (stringifyErr) {
          console.error('JSON 序列化失敗:', stringifyErr);
          // 如果序列化失敗，使用簡化版本
          const simplifiedResult = {
            success: limitedResult.success,
            results: limitedResult.results,
            errorCount: limitedResult.errorCount,
            message: limitedResult.errorCount > 0 
              ? `匯入完成，但有 ${limitedResult.errorCount} 個錯誤` 
              : '匯入完成'
          };
          resultStr = encodeURIComponent(JSON.stringify(simplifiedResult));
        }
        
        // 檢查 URL 長度，如果太長則使用簡化版本
        if (resultStr.length > 2000) {
          // URL 太長，改用簡化版本
          const simplifiedResult = {
            success: limitedResult.success,
            results: limitedResult.results,
            errorCount: limitedResult.errorCount,
            // 保留前 10 筆錯誤，讓頁面可顯示詳細資訊
            errors: limitedResult.errors.slice(0, 10),
            // 保留警告訊息
            warning: limitedResult.warning,
            message: limitedResult.errorCount > 0 
              ? `匯入完成，但有 ${limitedResult.errorCount} 個錯誤` 
              : '匯入完成'
          };
          resultStr = encodeURIComponent(JSON.stringify(simplifiedResult));
        }
        
        res.redirect('/import-export?result=' + resultStr);
      } catch (redirectErr) {
        console.error('重定向錯誤:', redirectErr);
        console.error('錯誤堆疊:', redirectErr.stack);
        // 如果 redirect 失敗，直接渲染頁面
        try {
          const years = Project.getYears();
          res.render('import-export/index', {
            title: '匯入/匯出',
            years,
            result: limitedResult
          });
        } catch (renderErr) {
          console.error('渲染頁面失敗:', renderErr);
          // 最後的備援方案：返回簡單的成功訊息
          res.redirect('/import-export?error=' + encodeURIComponent(
            limitedResult.success 
              ? `匯入完成！專案: ${limitedResult.results.projects || 0} 筆` 
              : '匯入過程中發生錯誤'
          ));
        }
      }
    } catch (err) {
      console.error('匯入錯誤:', err);
      console.error('錯誤堆疊:', err.stack);
      
      // 清理暫存檔
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          console.error('刪除暫存檔失敗:', unlinkErr);
        }
      }
      
      // 返回錯誤訊息
      const errorMsg = err.message || '匯入過程中發生未知錯誤';
      try {
        res.redirect('/import-export?error=' + encodeURIComponent(errorMsg));
      } catch (redirectErr) {
        console.error('重定向錯誤:', redirectErr);
        // 如果 redirect 失敗，直接渲染頁面
        const years = Project.getYears();
        res.render('import-export/index', {
          title: '匯入/匯出',
          years,
          error: errorMsg
        });
      }
    }
  });

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
