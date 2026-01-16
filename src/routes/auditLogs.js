const express = require('express');
const AuditLogService = require('../services/AuditLogService');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const dayjs = require('dayjs');

const router = express.Router();

// 修改記錄列表
router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  const filters = {
    tableName: req.query.table_name || null,
    recordId: req.query.record_id ? parseInt(req.query.record_id) : null,
    action: req.query.action || null,
    startDate: req.query.start_date || null,
    endDate: req.query.end_date || null,
    limit,
    offset
  };

  const logs = AuditLogService.getLogs(filters);
  const total = AuditLogService.getTotalCount(filters);
  const totalPages = Math.ceil(total / limit);

  // 輔助函數：轉義 HTML 特殊字符
  const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // 輔助函數：格式化 JSON 並標記變更欄位（返回已轉義的 HTML）
  const formatJsonWithHighlights = (data, changedFields = [], nameMap = {}) => {
    if (!data) return '';
    
    // 先生成標準 JSON 字符串
    let jsonStr = JSON.stringify(data, null, 2);
    
    // 替換 salesperson_id 為 "ID (名稱)" 格式
    if (data.salesperson_id !== null && data.salesperson_id !== undefined && nameMap.salesperson) {
      const idPattern = `"salesperson_id": ${data.salesperson_id}`;
      const replacement = `"salesperson_id": ${data.salesperson_id} (${nameMap.salesperson})`;
      jsonStr = jsonStr.replace(idPattern, replacement);
    }
    
    // 替換 customer_id 為 "ID (名稱)" 格式
    if (data.customer_id !== null && data.customer_id !== undefined && nameMap.customer) {
      const idPattern = `"customer_id": ${data.customer_id}`;
      const replacement = `"customer_id": ${data.customer_id} (${nameMap.customer})`;
      jsonStr = jsonStr.replace(idPattern, replacement);
    }
    
    // 替換 invoice_id 為 "ID (發票號碼)" 格式
    if (data.invoice_id !== null && data.invoice_id !== undefined && nameMap.invoice) {
      const idPattern = `"invoice_id": ${data.invoice_id}`;
      const replacement = `"invoice_id": ${data.invoice_id} (${nameMap.invoice})`;
      jsonStr = jsonStr.replace(idPattern, replacement);
    }
    
    // 轉義 HTML
    let result = escapeHtml(jsonStr);
    
    if (changedFields.length === 0) {
      return result;
    }
    
    // 為每個變更的欄位添加黃色背景
    const lines = result.split('\n');
    const highlightedLines = lines.map(line => {
      let highlightedLine = line;
      
      changedFields.forEach(field => {
        const value = data[field];
        let valueStr = JSON.stringify(value);
        
        // 如果是 salesperson_id、customer_id 或 invoice_id，使用顯示格式
        if (field === 'salesperson_id' && nameMap.salesperson) {
          valueStr = JSON.stringify(`${data.salesperson_id} (${nameMap.salesperson})`);
        } else if (field === 'customer_id' && nameMap.customer) {
          valueStr = JSON.stringify(`${data.customer_id} (${nameMap.customer})`);
        } else if (field === 'invoice_id' && nameMap.invoice) {
          valueStr = JSON.stringify(`${data.invoice_id} (${nameMap.invoice})`);
        }
        
        const escapedValueStr = escapeHtml(valueStr);
        
        // 匹配 "field": value 的模式
        const fieldPattern = `"${field}"`;
        const escapedFieldPattern = escapeHtml(fieldPattern);
        
        // 檢查這一行是否包含這個欄位
        if (highlightedLine.includes(escapedFieldPattern)) {
          // 替換值部分
          const regex = new RegExp(`(${escapedFieldPattern}\\s*:\\s*)(${escapedValueStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(,?\\s*)`, 'g');
          highlightedLine = highlightedLine.replace(regex, (match, keyPart, valuePart, commaPart) => {
            return keyPart + '<span style="background-color: #fff3cd; padding: 2px 4px; border-radius: 3px; display: inline-block;">' + valuePart + '</span>' + commaPart;
          });
        }
      });
      
      return highlightedLine;
    });
    
    return highlightedLines.join('\n');
  };

  // 輔助函數：獲取 ID 對應的名稱
  const getNameMap = (data) => {
    const nameMap = {};
    
    if (!data || typeof data !== 'object') return nameMap;
    
    // 獲取業務名稱
    if (data.salesperson_id !== null && data.salesperson_id !== undefined) {
      try {
        const salesperson = Salesperson.findById(data.salesperson_id);
        if (salesperson) {
          nameMap.salesperson = salesperson.name;
        }
      } catch (e) {
        // 忽略錯誤
      }
    }
    
    // 獲取客戶名稱
    if (data.customer_id !== null && data.customer_id !== undefined) {
      try {
        const customer = Customer.findById(data.customer_id);
        if (customer) {
          nameMap.customer = customer.company_name;
        }
      } catch (e) {
        // 忽略錯誤
      }
    }
    
    // 獲取發票號碼
    if (data.invoice_id !== null && data.invoice_id !== undefined) {
      try {
        const invoice = Invoice.findById(data.invoice_id);
        if (invoice && invoice.invoice_number) {
          nameMap.invoice = invoice.invoice_number;
        }
      } catch (e) {
        // 忽略錯誤
      }
    }
    
    return nameMap;
  };

  // 解析 JSON 資料並計算變更欄位
  const logsWithParsedData = logs.map(log => {
    try {
      log.old_value_parsed = log.old_value ? JSON.parse(log.old_value) : null;
      log.new_value_parsed = log.new_value ? JSON.parse(log.new_value) : null;
      
      // 獲取名稱映射
      const oldNameMap = getNameMap(log.old_value_parsed);
      const newNameMap = getNameMap(log.new_value_parsed);
      
      // 計算變更的欄位（用於標記）
      if (log.action === 'update' && log.old_value_parsed && log.new_value_parsed) {
        log.changed_fields = [];
        const oldData = log.old_value_parsed;
        const newData = log.new_value_parsed;
        
        // 檢查所有欄位
        const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
        allKeys.forEach(key => {
          const oldVal = oldData[key];
          const newVal = newData[key];
          
          // 比較值（處理 null/undefined）
          const oldValStr = oldVal === null || oldVal === undefined ? '' : String(oldVal);
          const newValStr = newVal === null || newVal === undefined ? '' : String(newVal);
          
          if (oldValStr !== newValStr) {
            log.changed_fields.push(key);
          }
        });
        
        // 生成帶有標記和名稱的 HTML
        log.old_value_html = formatJsonWithHighlights(log.old_value_parsed, log.changed_fields, oldNameMap);
        log.new_value_html = formatJsonWithHighlights(log.new_value_parsed, log.changed_fields, newNameMap);
      } else {
        log.changed_fields = [];
        // 格式化並添加名稱
        log.old_value_html = log.old_value_parsed ? formatJsonWithHighlights(log.old_value_parsed, [], oldNameMap) : '';
        log.new_value_html = log.new_value_parsed ? formatJsonWithHighlights(log.new_value_parsed, [], newNameMap) : '';
      }
    } catch (e) {
      log.old_value_parsed = log.old_value;
      log.new_value_parsed = log.new_value;
      log.changed_fields = [];
      log.old_value_html = '';
      log.new_value_html = '';
    }
    return log;
  });

  // 建立查詢字串用於分頁
  const queryParams = new URLSearchParams();
  if (filters.tableName) queryParams.set('table_name', filters.tableName);
  if (filters.recordId) queryParams.set('record_id', filters.recordId);
  if (filters.action) queryParams.set('action', filters.action);
  if (filters.startDate) queryParams.set('start_date', filters.startDate);
  if (filters.endDate) queryParams.set('end_date', filters.endDate);
  const queryString = queryParams.toString();

  res.render('audit-logs/index', {
    title: '修改記錄',
    logs: logsWithParsedData,
    filters,
    pagination: {
      page,
      totalPages,
      total,
      limit
    },
    queryString,
    tableNames: ['projects', 'invoices', 'payments', 'bonus_calculations', 'salespeople', 'customers'],
    actions: ['create', 'update', 'delete']
  });
});

// 取得記錄的修改歷史
router.get('/record/:tableName/:recordId', (req, res) => {
  const { tableName, recordId } = req.params;
  const history = AuditLogService.getRecordHistory(tableName, parseInt(recordId));

  const historyWithParsedData = history.map(log => {
    try {
      log.old_value_parsed = log.old_value ? JSON.parse(log.old_value) : null;
      log.new_value_parsed = log.new_value ? JSON.parse(log.new_value) : null;
    } catch (e) {
      log.old_value_parsed = log.old_value;
      log.new_value_parsed = log.new_value;
    }
    return log;
  });

  res.json({
    success: true,
    history: historyWithParsedData
  });
});

// 統計資訊
router.get('/statistics', (req, res) => {
  const filters = {
    startDate: req.query.start_date || null,
    endDate: req.query.end_date || null
  };

  const statistics = AuditLogService.getStatistics(filters);
  res.json({
    success: true,
    statistics
  });
});

module.exports = router;

