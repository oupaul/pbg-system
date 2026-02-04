const express = require('express');
const AuditLogService = require('../services/AuditLogService');
const Project = require('../models/Project');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const dayjs = require('dayjs');

const router = express.Router();

// 資料庫欄位對應中文顯示名稱（供修改記錄易讀）
const FIELD_LABELS = {
  projects: {
    id: 'ID', project_code: '專案編號', contract_year: '簽約年度', contract_month: '簽約月份',
    status: '狀態', project_type: '專案類型', salesperson_id: '業務人員', customer_id: '客戶',
    project_name: '專案名稱', price_with_tax: '價格(含稅)', price_without_tax: '價格(未稅)',
    sales_discount: '銷貨折讓', is_new_customer: '新客戶', expected_invoice_year_month: '預計開票年月',
    notes: '備註', created_at: '建立時間', updated_at: '更新時間'
  },
  invoices: {
    id: 'ID', project_id: '專案', invoice_date: '發票日期', invoice_number: '發票號碼',
    amount_with_tax: '金額(含稅)', expected_payment_date: '預計收款日',
    created_at: '建立時間', updated_at: '更新時間'
  },
  payments: {
    id: 'ID', project_id: '專案', invoice_id: '對應發票', payment_date: '收款日期',
    bank_deposit_amount: '匯入金額', payment_difference: '差異金額', difference_type: '差異類型',
    notes: '備註', created_at: '建立時間', updated_at: '更新時間'
  },
  bonus_calculations: {
    id: 'ID', project_id: '專案', salesperson_id: '業務人員', bonus_type: '獎金類型',
    base_amount: '計算基礎', bonus_percentage: '比例', bonus_amount: '獎金金額',
    payment_date: '發放日期', status: '狀態', forfeiture_reason: '充公原因',
    created_at: '建立時間', updated_at: '更新時間'
  },
  salespeople: {
    id: 'ID', name: '姓名', status: '狀態', resigned_date: '離職日期',
    created_at: '建立時間', updated_at: '更新時間'
  },
  customers: {
    id: 'ID', customer_code: '客戶編號', tax_id: '統一編號', company_name: '公司名稱',
    is_new_customer: '新客戶', created_at: '建立時間', updated_at: '更新時間'
  }
};

const TABLE_LABELS = {
  projects: '專案', invoices: '發票', payments: '收款', bonus_calculations: '獎金',
  salespeople: '業務', customers: '客戶'
};

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

  // 將資料庫欄位轉換為中文標籤顯示
  const transformDataForDisplay = (data, tableName) => {
    if (!data || typeof data !== 'object') return data;
    const labels = FIELD_LABELS[tableName] || {};
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[labels[key] || key] = value;
    }
    return result;
  };

  // 輔助函數：格式化 JSON 並標記變更欄位（返回已轉義的 HTML）
  const formatJsonWithHighlights = (data, changedFields = [], nameMap = {}, tableName = '') => {
    if (!data) return '';
    
    const labels = FIELD_LABELS[tableName] || {};
    const dataDisplay = transformDataForDisplay(data, tableName);
    
    // 替換 ID 欄位為 "ID (名稱)" 格式（使用顯示後的 key）
    if (data.project_id != null && nameMap.project) {
      const key = labels.project_id || 'project_id';
      dataDisplay[key] = `${data.project_id} (${nameMap.project})`;
    }
    if (tableName === 'projects' && data.id != null && nameMap.project) {
      const key = labels.id || 'id';
      dataDisplay[key] = `${data.id} (${nameMap.project})`;
    }
    if (data.salesperson_id != null && nameMap.salesperson) {
      const key = labels.salesperson_id || 'salesperson_id';
      dataDisplay[key] = `${data.salesperson_id} (${nameMap.salesperson})`;
    }
    if (data.customer_id != null && nameMap.customer) {
      const key = labels.customer_id || 'customer_id';
      dataDisplay[key] = `${data.customer_id} (${nameMap.customer})`;
    }
    if (data.invoice_id != null && nameMap.invoice) {
      const key = labels.invoice_id || 'invoice_id';
      dataDisplay[key] = `${data.invoice_id} (${nameMap.invoice})`;
    }
    
    let jsonStr = JSON.stringify(dataDisplay, null, 2);
    
    // 轉義 HTML
    let result = escapeHtml(jsonStr);
    
    if (changedFields.length === 0) {
      return result;
    }
    
    // 為每個變更的欄位添加黃色背景（使用顯示後的 key）
    const lines = result.split('\n');
    const highlightedLines = lines.map(line => {
      let highlightedLine = line;
      
      changedFields.forEach(field => {
        const displayKey = labels[field] || field;
        let value = data[field];
        if (field === 'project_id' && nameMap.project) {
          value = `${data.project_id} (${nameMap.project})`;
        } else if (field === 'id' && tableName === 'projects' && nameMap.project) {
          value = `${data.id} (${nameMap.project})`;
        } else if (field === 'salesperson_id' && nameMap.salesperson) {
          value = `${data.salesperson_id} (${nameMap.salesperson})`;
        } else if (field === 'customer_id' && nameMap.customer) {
          value = `${data.customer_id} (${nameMap.customer})`;
        } else if (field === 'invoice_id' && nameMap.invoice) {
          value = `${data.invoice_id} (${nameMap.invoice})`;
        }
        let valueStr = JSON.stringify(value);
        const escapedValueStr = escapeHtml(valueStr);
        const escapedFieldPattern = escapeHtml(`"${displayKey}"`);
        
        if (highlightedLine.includes(escapedFieldPattern)) {
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

  // 輔助函數：取得專案識別字串（專案編號 專案類型 - 專案名稱）
  const getProjectDisplay = (projectId) => {
    if (projectId == null) return null;
    try {
      const project = Project.findById(projectId, null);
      if (!project) return null;
      const parts = [(project.project_code || ''), (project.project_type || '')].filter(Boolean);
      const codeType = parts.join(' ');
      const name = project.project_name ? ` - ${project.project_name}` : '';
      return codeType ? `${codeType}${name}` : null;
    } catch (e) {
      return null;
    }
  };

  // 輔助函數：獲取 ID 對應的名稱
  const getNameMap = (data, tableName = '') => {
    const nameMap = {};
    
    if (!data || typeof data !== 'object') return nameMap;
    
    // 獲取專案識別（project_id 或 projects 表的 id）
    const projectId = data.project_id ?? (tableName === 'projects' ? data.id : null);
    if (projectId != null) {
      const projectDisplay = getProjectDisplay(projectId);
      if (projectDisplay) nameMap.project = projectDisplay;
    }
    
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
      
      // 獲取名稱映射（傳入 tableName 以解析專案 ID）
      const oldNameMap = getNameMap(log.old_value_parsed, log.table_name);
      const newNameMap = getNameMap(log.new_value_parsed, log.table_name);
      
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
        
        // 生成帶有標記和名稱的 HTML（使用中文欄位名稱）
        log.old_value_html = formatJsonWithHighlights(log.old_value_parsed, log.changed_fields, oldNameMap, log.table_name);
        log.new_value_html = formatJsonWithHighlights(log.new_value_parsed, log.changed_fields, newNameMap, log.table_name);
      } else {
        log.changed_fields = [];
        // 格式化並添加名稱（使用中文欄位名稱）
        log.old_value_html = log.old_value_parsed ? formatJsonWithHighlights(log.old_value_parsed, [], oldNameMap, log.table_name) : '';
        log.new_value_html = log.new_value_parsed ? formatJsonWithHighlights(log.new_value_parsed, [], newNameMap, log.table_name) : '';
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
    tableLabels: TABLE_LABELS,
    actions: ['create', 'update', 'delete'],
    actionLabels: { create: '新增', update: '更新', delete: '刪除' }
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

