const ExcelJS = require('exceljs');
const db = require('../models/db');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const Bonus = require('../models/Bonus');
const dayjs = require('dayjs');

// 轉換民國年日期
function parseROCDate(dateStr) {
  if (!dateStr) return null;
  
  const str = String(dateStr).trim();
  
  // 格式: 112/08/10 或 114/9/23
  const match = str.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const year = parseInt(match[1]) + 1911;
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // 嘗試解析其他格式
  if (dateStr instanceof Date) {
    return dayjs(dateStr).format('YYYY-MM-DD');
  }
  
  return null;
}

// 解析月份
function parseMonth(monthStr) {
  if (!monthStr) return null;
  const str = String(monthStr).trim();
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// 判斷是否為新客戶
function isNewCustomer(value) {
  return value === '新客戶';
}

// 清理數字
function cleanNumber(value) {
  if (value === null || value === undefined || value === '' || isNaN(value)) {
    return 0;
  }
  return Number(value) || 0;
}

// 安全地提取文字值（處理對象類型）
function safeExtractText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (typeof value === 'object') {
    // 如果是富文本對象，提取 text 屬性
    if (value.text !== undefined) {
      return String(value.text).trim() || null;
    }
    // 嘗試提取其他可能的屬性
    if (value.value !== undefined) {
      return String(value.value).trim() || null;
    }
    // 如果無法提取，返回 null
    return null;
  }
  return String(value).trim() || null;
}

class ExcelImportService {
  constructor() {
    this.importLog = [];
    this.errors = [];
  }

  log(message) {
    this.importLog.push({ time: new Date().toISOString(), message });
    console.log(message);
  }

  error(message) {
    this.errors.push({ time: new Date().toISOString(), message });
    console.error('錯誤:', message);
  }

  // 匯入Excel檔案
  async importExcel(filePath) {
    this.importLog = [];
    this.errors = [];
    
    this.log(`開始匯入: ${filePath}`);

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const results = {
        projects: 0,
        invoices: 0,
        payments: 0,
        salespeople: 0,
        customers: 0,
        bonuses: 0
      };

      workbook.eachSheet((worksheet, sheetId) => {
        const sheetName = worksheet.name;
        
        // 跳過說明工作表
        if (sheetName === '填寫說明' || sheetName.includes('說明') || sheetName.includes('範例')) {
          this.log(`跳過說明工作表: ${sheetName}`);
          return;
        }
        
        this.log(`處理工作表: ${sheetName}`);
        
        // 將工作表轉換為二維陣列
        const data = [];
        let maxColumnCount = 0;
        
        // 先找出最大列數
        worksheet.eachRow((row, rowNumber) => {
          if (row.actualCellCount > maxColumnCount) {
            maxColumnCount = row.actualCellCount;
          }
        });
        
        // 處理合併儲存格：建立映射表
        const mergedCells = new Map();
        try {
          // 檢查是否有合併儲存格
          if (worksheet.model && worksheet.model.merges && Array.isArray(worksheet.model.merges)) {
            worksheet.model.merges.forEach(merge => {
              try {
                if (!merge || !merge.master) return;
                
                const masterCell = worksheet.getCell(merge.master);
                if (!masterCell) return;
                
                let masterValue = masterCell.value;
                
                // 處理主儲存格的值
                if (masterValue instanceof Date) {
                  masterValue = dayjs(masterValue).format('YYYY-MM-DD');
                } else if (typeof masterValue === 'object' && masterValue !== null) {
                  // 物件類型：可能是富文本儲存格或其他物件
                  if (masterValue.text !== undefined) {
                    // 富文本儲存格，提取 text 屬性
                    masterValue = String(masterValue.text).trim();
                  } else {
                    // 其他物件類型，嘗試提取有意義的屬性
                    const keys = Object.keys(masterValue);
                    if (keys.length === 0) {
                      masterValue = null;
                    } else {
                      // 嘗試提取第一個有意義的屬性
                      for (const key of keys) {
                        if (masterValue[key] !== undefined && masterValue[key] !== null && typeof masterValue[key] !== 'object') {
                          masterValue = String(masterValue[key]).trim();
                          break;
                        }
                      }
                      // 如果所有屬性都是物件或 null，設為 null
                      if (typeof masterValue === 'object') {
                        console.warn(`合併儲存格主儲存格值為複雜物件，無法處理:`, masterValue);
                        masterValue = null;
                      }
                    }
                  }
                  // 如果清理後為空字串或 "[object Object]"，設為 null
                  if (masterValue && (masterValue.length === 0 || masterValue === '[object Object]')) {
                    masterValue = null;
                  }
                } else if (typeof masterValue === 'number') {
                  // 數字類型轉為字串
                  masterValue = String(masterValue);
                } else if (masterValue !== null && masterValue !== undefined) {
                  // 確保值轉為字串（如果不是 null/undefined）
                  masterValue = String(masterValue).trim();
                  // 如果清理後為空字串，設為 null
                  if (masterValue.length === 0) {
                    masterValue = null;
                  }
                }
                
                // 將合併範圍內的所有儲存格都映射到主儲存格的值
                // ExcelJS 的 merge 對象：top/left 是 0-based，但 rowNumber 是 1-based
                // 我們需要將 merge 的索引轉換為 rowNumber 和 colNum（1-based）
                if (typeof merge.top === 'number' && typeof merge.bottom === 'number' && 
                    typeof merge.left === 'number' && typeof merge.right === 'number') {
                  // merge.top/left 是 0-based，轉換為 1-based 的 rowNumber
                  // merge.left/right 是 0-based，轉換為 1-based 的 colNum（對應 Excel 欄位）
                  for (let rowNum = merge.top + 1; rowNum <= merge.bottom + 1; rowNum++) {
                    for (let colNum = merge.left + 1; colNum <= merge.right + 1; colNum++) {
                      const key = `${rowNum}_${colNum}`;
                      // 只有在主儲存格有值時才設置映射（避免將 null/undefined 映射到合併儲存格）
                      // 但如果是空字串，也應該映射（因為可能是故意的空值）
                      mergedCells.set(key, masterValue);
                      // 調試：記錄合併儲存格映射
                      if (process.env.NODE_ENV === 'development' && rowNum <= 5) {
                        console.log(`合併儲存格映射: 行${rowNum} 欄${colNum} (${key}) = ${masterValue || '(空)'}`);
                      }
                    }
                  }
                }
              } catch (mergeErr) {
                // 忽略單個合併儲存格的錯誤，繼續處理其他
                console.warn('處理合併儲存格時發生錯誤:', mergeErr);
              }
            });
          }
        } catch (mergeErr) {
          // 如果處理合併儲存格時發生錯誤，記錄但繼續處理
          this.log(`處理合併儲存格時發生錯誤: ${mergeErr.message}，將繼續處理`);
        }
        
        // 讀取所有行的數據
        worksheet.eachRow((row, rowNumber) => {
          try {
            const rowData = [];
            // 使用 row.values，第一個元素是 rowNumber，所以從 index 1 開始
            const values = row.values || [];
            
            // 確保 maxColumnCount 至少為 1
            const actualMaxColumn = Math.max(maxColumnCount, 1);
            
            for (let i = 1; i <= actualMaxColumn; i++) {
              // i 是 1-based 的列索引（對應 Excel 欄位 A=1, B=2, C=3...）
              const key = `${rowNumber}_${i}`;
              
              let value = undefined;
              
              // 優先檢查是否為合併儲存格的一部分
              // 如果是合併儲存格，直接使用合併儲存格的值
              if (mergedCells.has(key)) {
                value = mergedCells.get(key);
                // 調試：特別檢查第 58 行和第 114 行的客戶編號欄位（第 8 欄，索引 8）
                if ((rowNumber === 58 || rowNumber === 114) && i === 8) {
                  console.log(`第 ${rowNumber} 行第 ${i} 欄（客戶編號）: 從合併儲存格取得值 = ${value}`);
                }
              } else {
                // 如果不是合併儲存格，從原始值讀取
                // row.values 的索引：values[0] 是 rowNumber，values[1] 是 A 欄，values[2] 是 B 欄...
                if (values && values[i] !== undefined) {
                  value = values[i];
                  // 調試：特別檢查第 58 行和第 114 行的客戶編號欄位（第 8 欄，索引 8）
                  if ((rowNumber === 58 || rowNumber === 114) && i === 8) {
                    console.log(`第 ${rowNumber} 行第 ${i} 欄（客戶編號）: 從原始值取得 = ${value} (類型: ${typeof value})`);
                  }
                } else {
                  // 調試：特別檢查第 58 行和第 114 行的客戶編號欄位（第 8 欄，索引 8）
                  if ((rowNumber === 58 || rowNumber === 114) && i === 8) {
                    console.log(`第 ${rowNumber} 行第 ${i} 欄（客戶編號）: values[${i}] 為 undefined`);
                  }
                }
              }
              
              // 處理值的格式
              if (value === null || value === undefined) {
                value = null;
              } else if (value instanceof Date) {
                // 日期物件轉為字串
                value = dayjs(value).format('YYYY-MM-DD');
              } else if (typeof value === 'object' && value !== null) {
                // 物件類型：可能是富文本儲存格或其他物件
                if (value.text !== undefined) {
                  // 富文本儲存格，提取 text 屬性
                  value = value.text;
                } else {
                  // 其他物件類型，嘗試轉為字串，但避免 "[object Object]"
                  // 如果是空物件，設為 null
                  const keys = Object.keys(value);
                  if (keys.length === 0) {
                    value = null;
                  } else {
                    // 嘗試提取第一個有意義的屬性
                    const firstKey = keys[0];
                    if (value[firstKey] !== undefined && value[firstKey] !== null) {
                      value = String(value[firstKey]);
                    } else {
                      value = null;
                    }
                  }
                }
              } else if (typeof value === 'number') {
                // 數字類型：如果是整數且看起來像客戶編號或統一編號，轉為字串
                // 否則保持為數字（可能是價格等數值）
                // 注意：這裡我們先轉為字串，後續處理時再判斷
                value = String(value);
              } else if (typeof value === 'string') {
                // 清理字串值
                value = value.trim();
                // 如果清理後為空字串，設為 null
                if (value.length === 0) {
                  value = null;
                }
              } else {
                // 其他類型，轉為字串
                value = String(value);
              }
              rowData.push(value);
            }
            data.push(rowData);
          } catch (rowErr) {
            this.error(`讀取第 ${rowNumber} 行時發生錯誤: ${rowErr.message}`);
            // 即使這行有錯誤，也添加一個空陣列以保持索引一致
            data.push([]);
          }
        });
        
        // 確保 data 是陣列且有資料
        if (!Array.isArray(data) || data.length < 2) {
          this.log(`工作表 ${sheetName} 資料不足，跳過`);
          return;
        }

        try {
          const sheetResults = this.processSheet(data, sheetName);
          results.projects += sheetResults.projects || 0;
          results.invoices += sheetResults.invoices || 0;
          results.payments += sheetResults.payments || 0;
          results.salespeople += sheetResults.salespeople || 0;
          results.customers += sheetResults.customers || 0;
          results.bonuses += sheetResults.bonuses || 0;
        } catch (sheetErr) {
          this.error(`處理工作表 ${sheetName} 時發生錯誤: ${sheetErr.message}`);
          console.error('工作表處理錯誤:', sheetErr);
        }
      });

      this.log('匯入完成');
      
      // 即使有錯誤，也返回結果（部分成功）
      const hasErrors = this.errors.length > 0;
      return {
        success: !hasErrors || results.projects > 0, // 如果有成功匯入專案，視為部分成功
        results,
        log: this.importLog,
        errors: this.errors,
        errorCount: this.errors.length,
        warning: hasErrors ? `匯入完成，但有 ${this.errors.length} 個錯誤` : null
      };

    } catch (err) {
      this.error(`匯入失敗: ${err.message}`);
      console.error('匯入完整錯誤:', err);
      console.error('錯誤堆疊:', err.stack);
      return {
        success: false,
        error: err.message,
        log: this.importLog,
        errors: this.errors,
        errorCount: this.errors.length
      };
    }
  }

  // 處理單一工作表
  processSheet(data, sheetName) {
    // 確保 data 是陣列
    if (!Array.isArray(data)) {
      this.error(`工作表 ${sheetName} 的資料格式錯誤`);
      return {
        projects: 0,
        invoices: 0,
        payments: 0,
        salespeople: 0,
        customers: 0,
        bonuses: 0
      };
    }
    
    const results = {
      projects: 0,
      invoices: 0,
      payments: 0,
      salespeople: 0,
      customers: 0,
      bonuses: 0
    };

    // 欄位對應（根據上傳的Excel結構）
    const COLS = {
      CONTRACT_YEAR: 0,      // 簽約年度
      STATUS: 1,             // 狀態
      PROJECT_TYPE: 2,       // 類型
      SALESPERSON: 3,        // 業務
      CONTRACT_MONTH: 4,     // 專案月份
      NEW_CUSTOMER: 5,       // 新客戶
      PROJECT_CODE: 6,       // 專案編號
      CUSTOMER_CODE: 7,      // 客戶編號
      TAX_ID: 8,             // 統一編號
      COMPANY_NAME: 9,       // 公司名稱
      PROJECT_NAME: 10,      // 專案名稱
      PRICE_WITH_TAX: 11,    // 價格(含稅)
      INVOICE_DATE: 12,      // 發票日期
      INVOICE_NUMBER: 13,    // 發票號碼
      INVOICE_AMOUNT: 14,    // 開立金額(含稅)
      UNINVOICED: 15,        // 未開立發票金額
      PAYMENT_DATE: 16,      // 收款日期
      BANK_DEPOSIT: 17,      // 銀行存款匯入金額
      PAYMENT_DIFF: 18,      // 收款差異
      PRICE_WITHOUT_TAX: 19, // 價格(未稅)
      RECOG_MONTH: 20,       // 業績認列月份
      RECOG_AMOUNT: 21,      // 認列業績金額(含稅)
      UNRECOG_AMOUNT: 22,    // 未認列業績金額(含稅)
      RECOG_NOTAX: 23,       // 認列業績金額(未稅)
      BONUS_TIER: 24,        // 獎金級距%
      LAB_BONUS_DATE: 25,    // 食驗室/純廣獎金發放日期
      LAB_NOTAX: 26,         // 食驗室未稅(不扣成本)
      LAB_BONUS: 27,         // 食驗室獎金(不扣成本)
      AD_NOTAX: 28,          // 純廣未稅90%(扣成本10%)
      AD_BONUS: 29,          // 純廣獎金(扣成本10%)
      PROJ_NOTAX: 30,        // 專案未稅60%(扣成本40%)
      PROJ_SIGN_DATE: 31,    // 專案簽約獎金發放日期
      PROJ_SIGN_BONUS: 32,   // 專案簽約獎金20%
      PROJ_CLOSE_DATE: 33,   // 專案結案獎金發放日期
      PROJ_CLOSE_BONUS: 34,  // 專案結案獎金80%
      DEV_BONUS_DATE: 35,    // 開發獎金發放日期
      DEV_BONUS: 36,         // 開發獎金
      MARKETING_ALLOC: 37,   // 行銷部佔比金額
      BRAND_ALLOC: 38        // 品牌部佔比金額
    };

    // 用於追蹤當前專案
    let currentProject = null;
    let currentProjectId = null;

    // 跳過標題列（第1行，索引0）
    // 從第2行開始處理（索引1）
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // 確保 row 是陣列
      if (!Array.isArray(row)) {
        this.error(`第 ${i + 1} 行資料格式錯誤，跳過`);
        continue;
      }
      
      // 跳過明顯的標題行
      // 檢查多個欄位來判斷是否為標題行
      const contractYearValue = row[COLS.CONTRACT_YEAR] ? String(row[COLS.CONTRACT_YEAR]).trim() : '';
      const projectCodeValue = row[COLS.PROJECT_CODE] ? String(row[COLS.PROJECT_CODE]).trim() : '';
      const statusValue = row[COLS.STATUS] ? String(row[COLS.STATUS]).trim() : '';
      
      // 如果簽約年度欄位包含標題文字，或專案編號欄位包含標題文字，則視為標題行
      const isTitleRow = 
        contractYearValue.includes('簽約年度') || 
        contractYearValue.includes('年度') ||
        projectCodeValue.includes('專案編號') ||
        projectCodeValue.includes('編號') ||
        statusValue.includes('狀態') ||
        // 如果簽約年度不是數字且不是空值，可能是標題
        (contractYearValue && !/^\d{4}$/.test(contractYearValue) && 
         (contractYearValue.includes('簽約') || contractYearValue.includes('年度')));
      
      if (isTitleRow) {
        this.log(`第 ${i + 1} 行疑似標題列，跳過`);
        continue;
      }
      
      // 如果簽約年度和專案編號都為空，可能是空行或標題行，跳過
      if (!contractYearValue && !projectCodeValue) {
        this.log(`第 ${i + 1} 行為空行，跳過`);
        continue;
      }
      
      // 檢查是否為新專案列（有簽約年度和專案編號）
      const projectCode = row[COLS.PROJECT_CODE];
      const contractYear = row[COLS.CONTRACT_YEAR];
      
      // 如果沒有專案編號和簽約年度，但當前專案存在，可能是同一專案的發票/收款明細行
      // 這種情況下，繼續使用當前專案
      if (!contractYear || !projectCode) {
        // 如果當前專案存在，可能是明細行，繼續處理
        if (currentProjectId) {
          // 處理發票和收款（見下方邏輯）
        } else {
          // 如果沒有當前專案，跳過此行
          // 但如果有專案名稱，可能是新專案但缺少專案編號或簽約年度
          const projectName = row[COLS.PROJECT_NAME] ? String(row[COLS.PROJECT_NAME]).trim() : '';
          if (projectName) {
            this.error(`第 ${i + 1} 行：有專案名稱「${projectName}」，但缺少專案編號或簽約年度，無法建立專案`);
          } else {
            this.log(`第 ${i + 1} 行：沒有專案編號、簽約年度和專案名稱，且沒有當前專案，跳過`);
          }
          continue;
        }
      }
        
      // 必須有專案編號和簽約年度才處理專案主資訊
      if (contractYear && projectCode) {
          try {
            const projectCodeStr = String(projectCode).trim();
            
        // 建立或取得業務人員
        let salesperson = null;
            const salespersonName = row[COLS.SALESPERSON] ? String(row[COLS.SALESPERSON]).trim() : null;
            
            if (salespersonName) {
              try {
                salesperson = Salesperson.findOrCreate(salespersonName);
                if (salesperson) {
          results.salespeople++;
                }
              } catch (salespersonErr) {
                this.error(`第 ${i + 1} 行：建立或取得業務人員時發生錯誤: ${salespersonErr.message}`);
                console.error('業務人員建立錯誤:', salespersonErr);
              }
            }
            
            // 重要：如果是新專案主資訊行，不應該從前一個專案繼承業務人員
            // 只有在同一專案的明細行時，才從當前專案繼承
            // 注意：isNewProject 會在後面定義，這裡先判斷專案編號是否相同
            const isSameProject = currentProject && currentProject.project_code === projectCodeStr;
            if (!salesperson && isSameProject && currentProject && currentProject.salesperson_id) {
              salesperson = { id: currentProject.salesperson_id };
              this.log(`第 ${i + 1} 行：明細行業務人員欄位為空，使用當前專案的業務人員 (ID: ${currentProject.salesperson_id})`);
        }

        // 建立或取得客戶
        let customer = null;
            // 更仔細地處理客戶資訊，確保能正確讀取
            // 檢查原始值，包括 null、undefined、空字串等情況
            const rawCustomerCode = row[COLS.CUSTOMER_CODE];
            const rawTaxId = row[COLS.TAX_ID];
            const rawCompanyName = row[COLS.COMPANY_NAME];
            
            // 調試：特別檢查第 58 行和第 114 行
            if (i + 1 === 58 || i + 1 === 114) {
              console.log(`\n=== 第 ${i + 1} 行詳細資訊 ===`);
              console.log('專案編號:', projectCodeStr);
              console.log('原始客戶編號:', rawCustomerCode, '(類型:', typeof rawCustomerCode, ')');
              console.log('原始統一編號:', rawTaxId, '(類型:', typeof rawTaxId, ')');
              console.log('原始公司名稱:', rawCompanyName, '(類型:', typeof rawCompanyName, ')');
              console.log('整行資料 (前 11 欄):', row.slice(0, 11));
              console.log('客戶編號欄位索引:', COLS.CUSTOMER_CODE, '統一編號欄位索引:', COLS.TAX_ID, '公司名稱欄位索引:', COLS.COMPANY_NAME);
            }
            
            // 處理客戶編號：如果是數字，轉為字串；如果是 null/undefined，設為 null
            // 特別處理物件類型，避免顯示 "[object Object]"
            let customerCode = null;
            if (rawCustomerCode !== null && rawCustomerCode !== undefined) {
              let str = null;
              if (typeof rawCustomerCode === 'object') {
                // 物件類型，嘗試提取文字內容
                if (rawCustomerCode.text !== undefined) {
                  str = String(rawCustomerCode.text).trim();
                } else {
                  // 嘗試提取 value 或其他屬性
                  const keys = Object.keys(rawCustomerCode);
                  for (const key of ['value', 'text', 'name']) {
                    if (rawCustomerCode[key] !== undefined && rawCustomerCode[key] !== null && typeof rawCustomerCode[key] !== 'object') {
                      str = String(rawCustomerCode[key]).trim();
                      break;
                    }
                  }
                  if (!str && keys.length > 0) {
                    const firstKey = keys[0];
                    if (rawCustomerCode[firstKey] !== undefined && rawCustomerCode[firstKey] !== null && typeof rawCustomerCode[firstKey] !== 'object') {
                      str = String(rawCustomerCode[firstKey]).trim();
                    }
                  }
                }
              } else {
                str = String(rawCustomerCode).trim();
              }
              customerCode = (str && str.length > 0 && str !== '[object Object]') ? str : null;
            }
            
            // 處理統一編號：如果是數字，轉為字串；如果是 null/undefined，設為 null
            // 特別處理物件類型，避免顯示 "[object Object]"
            let taxId = null;
            if (rawTaxId !== null && rawTaxId !== undefined) {
              let str = null;
              if (typeof rawTaxId === 'object') {
                // 物件類型，嘗試提取文字內容
                if (rawTaxId.text !== undefined) {
                  str = String(rawTaxId.text).trim();
                } else {
                  // 嘗試提取 value 或其他屬性
                  const keys = Object.keys(rawTaxId);
                  for (const key of ['value', 'text', 'name']) {
                    if (rawTaxId[key] !== undefined && rawTaxId[key] !== null && typeof rawTaxId[key] !== 'object') {
                      str = String(rawTaxId[key]).trim();
                      break;
                    }
                  }
                  if (!str && keys.length > 0) {
                    const firstKey = keys[0];
                    if (rawTaxId[firstKey] !== undefined && rawTaxId[firstKey] !== null && typeof rawTaxId[firstKey] !== 'object') {
                      str = String(rawTaxId[firstKey]).trim();
                    }
                  }
                }
              } else {
                str = String(rawTaxId).trim();
              }
              taxId = (str && str.length > 0 && str !== '[object Object]') ? str : null;
            }
            
            // 處理公司名稱：如果是 null/undefined，設為 null
            // 特別處理物件類型，避免顯示 "[object Object]"
            let companyName = null;
            if (rawCompanyName !== null && rawCompanyName !== undefined) {
              let str = null;
              // 如果是物件類型，嘗試提取文字內容
              if (typeof rawCompanyName === 'object') {
                // 如果是富文本物件，提取 text 屬性
                if (rawCompanyName.text !== undefined) {
                  str = String(rawCompanyName.text).trim();
                } else {
                  // 其他物件類型，嘗試提取有意義的屬性
                  const keys = Object.keys(rawCompanyName);
                  if (keys.length === 0) {
                    str = null;
                  } else {
                    // 嘗試提取第一個有意義的屬性（優先順序：richText, value, name, text）
                    const priorityKeys = ['richText', 'value', 'name', 'text'];
                    let found = false;
                    for (const key of priorityKeys) {
                      if (rawCompanyName[key] !== undefined && rawCompanyName[key] !== null) {
                        if (typeof rawCompanyName[key] === 'object' && rawCompanyName[key].text !== undefined) {
                          str = String(rawCompanyName[key].text).trim();
                        } else if (typeof rawCompanyName[key] !== 'object') {
                          str = String(rawCompanyName[key]).trim();
                        }
                        if (str && str.length > 0 && str !== '[object Object]') {
                          found = true;
                          break;
                        }
                      }
                    }
                    // 如果優先鍵都沒有找到，嘗試其他屬性
                    if (!found) {
                      for (const key of keys) {
                        if (rawCompanyName[key] !== undefined && rawCompanyName[key] !== null && typeof rawCompanyName[key] !== 'object') {
                          str = String(rawCompanyName[key]).trim();
                          if (str && str.length > 0 && str !== '[object Object]') {
                            found = true;
                            break;
                          }
                        }
                      }
                    }
                    // 如果還是沒找到，記錄警告
                    if (!found) {
                      console.warn(`第 ${i + 1} 行：公司名稱為複雜物件類型，無法處理:`, JSON.stringify(rawCompanyName));
                      str = null;
                    }
                  }
                }
              } else {
                // 非物件類型，直接轉為字串
                str = String(rawCompanyName).trim();
              }
              // 確保不是 "[object Object]" 或空字串
              companyName = (str && str.length > 0 && str !== '[object Object]') ? str : null;
            }
            
            // 調試：記錄客戶資訊讀取情況（針對所有專案，但特別關注有問題的專案）
            const debugProjects = ['CU20250302', 'CU20250303', 'CU20250304'];
            if (process.env.NODE_ENV === 'development' && debugProjects.includes(projectCodeStr)) {
              console.log(`第 ${i + 1} 行 (${projectCodeStr}) 客戶資訊詳細:`, {
                rawRow: {
                  customerCode: rawCustomerCode,
                  taxId: rawTaxId,
                  companyName: rawCompanyName,
                  customerCodeType: typeof rawCustomerCode,
                  taxIdType: typeof rawTaxId,
                  companyNameType: typeof rawCompanyName
                },
                processed: {
                  customerCode: customerCode || '(空)',
                  taxId: taxId || '(空)',
                  companyName: companyName || '(空)'
                },
                rowLength: row.length,
                rowData: row.slice(COLS.CUSTOMER_CODE, COLS.COMPANY_NAME + 1)
              });
            }
            
            // 判斷是否為專案主資訊行（有專案編號和簽約年度）
            const isProjectMainRow = contractYear && projectCode;
            
            // 如果有客戶編號、統一編號或公司名稱，就嘗試建立或取得客戶
            if (customerCode || taxId || companyName) {
              try {
                // 調試：特別檢查第 58 行
                if (i + 1 === 58) {
                  console.log(`第 ${i + 1} 行：準備建立或取得客戶，參數:`, {
                    customer_code: customerCode,
                    tax_id: taxId,
                    company_name: companyName
                  });
                }
                
                customer = Customer.findOrCreate({
                  customer_code: customerCode,
                  tax_id: taxId,
                  company_name: companyName,
                  is_new_customer: isNewCustomer(row[COLS.NEW_CUSTOMER])
                });
                
                // 調試：特別檢查第 58 行
                if (i + 1 === 58) {
                  console.log(`第 ${i + 1} 行：Customer.findOrCreate 返回:`, customer);
                  if (!customer) {
                    console.log(`第 ${i + 1} 行：Customer.findOrCreate 返回 null，可能的原因：`);
                    console.log(`  - 客戶編號: ${customerCode || '(空)'}`);
                    console.log(`  - 統一編號: ${taxId || '(空)'}`);
                    console.log(`  - 公司名稱: ${companyName || '(空)'}`);
                  }
                }
                
                if (customer) {
                  results.customers++;
                } else {
                  // 如果 findOrCreate 返回 null，記錄警告
                  this.log(`第 ${i + 1} 行：無法建立或取得客戶 (客戶編號: ${customerCode || '(空)'}, 統一編號: ${taxId || '(空)'}, 公司名稱: ${companyName || '(空)'})`);
                }
              } catch (customerErr) {
                this.error(`第 ${i + 1} 行：建立或取得客戶時發生錯誤: ${customerErr.message}`);
                console.error('客戶建立錯誤:', customerErr);
                console.error('錯誤堆疊:', customerErr.stack);
              }
            }
            
            // 讀取專案類型（COLS.PROJECT_TYPE = 2，對應 Excel C 欄，1-based 是 3）
            // 但 row 陣列是 0-based，所以 row[2] 對應 Excel C 欄
            let projectType = null;
            const rawProjectType = row[COLS.PROJECT_TYPE];
            
            if (rawProjectType !== null && rawProjectType !== undefined) {
              projectType = String(rawProjectType).trim();
            }
            
            // 如果專案類型為空，嘗試從上一行繼承（合併儲存格的情況）
            // 但只有在專案編號相同時才繼承類型
            if (!projectType && currentProject && currentProject.project_code === projectCodeStr) {
              // 如果當前專案存在且專案編號相同，使用當前專案的類型
              projectType = currentProject.project_type;
              this.log(`第 ${i + 1} 行：專案類型為空，使用當前專案類型: ${projectType}`);
            }
            
            // 清理和驗證專案類型
            if (projectType) {
              // 移除所有空白字符
              projectType = projectType.replace(/\s+/g, '');
              // 標準化類型名稱
              if (projectType === '食驗室' || projectType === '實驗室') {
                projectType = '食驗室';
              } else if (projectType === '純廣' || projectType === '純廣告') {
                projectType = '純廣';
              } else if (projectType === '專案' || projectType === '專案類型' || projectType === '標案') {
                // 「標案」映射到「專案」類型
                projectType = '專案';
              }
            }
            
            // 驗證專案類型是否有效（從資料庫讀取）
            let validTypes = [];
            try {
              const db = require('../models/db');
              const types = db.prepare('SELECT type_name FROM project_types WHERE is_active = 1').all();
              validTypes = types.map(t => t.type_name);
            } catch (err) {
              // 如果表不存在，使用預設類型
              console.warn('無法從資料庫讀取專案類型，使用預設類型:', err.message);
              validTypes = ['食驗室', '純廣', '專案'];
            }
            
            if (!projectType || !validTypes.includes(projectType)) {
              this.error(`第 ${i + 1} 行：專案類型無效或為空 (原始值: ${rawProjectType}, 處理後: ${projectType})，有效類型: ${validTypes.join(', ')}，跳過`);
              console.error(`第 ${i + 1} 行專案類型詳情:`, {
                rawValue: rawProjectType,
                processedValue: projectType,
                validTypes: validTypes,
                rowData: row.slice(0, 10) // 只顯示前10個欄位
              });
              continue;
            }
            
            // 確定最終的客戶 ID（用於查找專案）
            // 重要：只有在同一專案的明細行時，才從當前專案繼承客戶
            // 如果專案編號不同，或客戶欄位有值，就不應該繼承
            let finalCustomerId = customer?.id || null;
            
            // 判斷是否為新專案（需在客戶確定後進行，避免未定義）
            const isNewProject = !currentProject 
              || currentProject.project_code !== projectCodeStr 
              || currentProject.customer_id !== finalCustomerId;

            // 若偵測到不同客戶或不同專案編號，強制重置當前專案，以便為不同客戶建立獨立專案
            if (isNewProject) {
              currentProject = null;
              currentProjectId = null;
            }
            
            // 如果當前行沒有客戶，且當前專案存在且專案編號相同，才考慮繼承
            // 但這只適用於明細行（沒有專案編號的行），對於有專案編號的主資訊行，不應該繼承
            // 這裡我們已經有專案編號了，所以不應該繼承客戶
            
            // 取得當前的專案名稱（安全地處理對象類型）
            const currentProjectName = safeExtractText(row[COLS.PROJECT_NAME]);
            
            // 調試：記錄專案名稱提取結果（特別針對 CU20250504）
            if (projectCodeStr === 'CU20250504') {
              console.log(`第 ${i + 1} 行：專案編號 ${projectCodeStr}，提取的專案名稱: "${currentProjectName}" (類型: ${typeof currentProjectName})`);
              console.log(`第 ${i + 1} 行：原始專案名稱欄位值:`, row[COLS.PROJECT_NAME], `(類型: ${typeof row[COLS.PROJECT_NAME]})`);
            }
            
            // 使用專案編號 + 類型 + 客戶 + 專案名稱來查找專案
            // 這樣可以支援同一個專案編號但不同專案名稱的情況
            const existingProject = Project.findByCodeTypeCustomerAndName(projectCodeStr, projectType, finalCustomerId, currentProjectName);
            
            // 調試：記錄查找結果（特別針對 CU20250504）
            if (projectCodeStr === 'CU20250504') {
              console.log(`第 ${i + 1} 行：查找專案 ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}${currentProjectName ? ` - 專案名稱: "${currentProjectName}"` : ' - 無專案名稱'}`);
              console.log(`第 ${i + 1} 行：查找結果 - ${existingProject ? `找到現有專案 (ID: ${existingProject.id}, 名稱: "${existingProject.project_name}")` : '未找到，將建立新專案'}`);
            } else if (process.env.NODE_ENV === 'development' || projectCodeStr === 'CU20241002') {
              this.log(`第 ${i + 1} 行：查找專案 ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}${currentProjectName ? ` - 專案名稱: "${currentProjectName}"` : ' - 無專案名稱'} - ${existingProject ? '找到現有專案' : '未找到，將建立新專案'}`);
            }
        
        // 檢查是否應該使用現有專案或建立新專案
        // 如果找到現有專案（專案編號、類型、客戶ID、專案名稱都相同），使用現有專案
        if (existingProject) {
          // 找到現有專案，使用現有專案
          currentProjectId = existingProject.id;
          currentProject = existingProject;
          if (projectCodeStr === 'CU20250504') {
            console.log(`第 ${i + 1} 行：使用現有專案 - ID: ${existingProject.id}, 名稱: "${existingProject.project_name}"`);
          }
          this.log(`更新專案: ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}${currentProjectName ? ` - 專案名稱: "${currentProjectName}"` : ' - 無專案名稱'}`);
          
          // 調試：記錄專案資訊（僅在開發環境）
          if (process.env.NODE_ENV === 'development' && projectCodeStr === 'CU20250302') {
            console.log(`第 ${i + 1} 行 (${projectCodeStr}) 現有專案資訊:`, {
              id: existingProject.id,
              salesperson_id: existingProject.salesperson_id,
              customer_id: existingProject.customer_id
            });
          }
          
          // 重要：只有在專案主資訊行（有專案編號和簽約年度）時，才更新專案的業務人員和客戶資訊
          // 如果專案主資訊行的業務人員/客戶欄位為空，表示這個專案確實沒有業務人員/客戶，不應該更新
          // 明細行（沒有專案編號）不應該更新專案的業務人員/客戶資訊
          // 注意：這裡的 isProjectMainRow 已經在處理客戶時定義了
          
          if (isProjectMainRow) {
            // 這是專案主資訊行，可以更新專案的業務人員和客戶
            // 但只有在當前行確實有業務人員/客戶資訊時才更新
            // 如果當前行業務人員/客戶欄位為空，表示這個專案確實沒有業務人員/客戶，不應該更新
            let needsUpdate = false;
            const updateData = {};
            
            // 檢查當前行是否有業務人員資訊（不是從當前專案繼承的）
            // 如果當前行是專案主資訊行，且確實有業務人員資訊，就應該更新現有專案的業務人員
            const hasSalespersonInRow = row[COLS.SALESPERSON] && String(row[COLS.SALESPERSON]).trim();
            if (!existingProject.salesperson_id && salesperson?.id && hasSalespersonInRow) {
              // 如果現有專案沒有業務人員，且當前行有業務人員資訊，就更新
              updateData.salesperson_id = salesperson.id;
              needsUpdate = true;
              this.log(`更新專案 ${projectCodeStr} 的業務人員: ${salesperson.id}`);
            }
            
            // 注意：客戶ID不應該在這裡更新，因為如果客戶不同，應該建立新專案
            // 這裡只更新其他欄位（業務人員、專案名稱、價格等）
            
            if (needsUpdate) {
              try {
                Project.update(existingProject.id, updateData);
                // 重新取得更新後的專案
                currentProject = Project.findById(existingProject.id);
              } catch (updateErr) {
                this.error(`更新專案 ${projectCodeStr} 的業務人員時發生錯誤: ${updateErr.message}`);
              }
            }
          }
          // 如果是明細行（沒有專案編號），不更新專案的業務人員/客戶資訊
        } else {
          // 沒有找到現有專案（專案名稱不同或客戶ID不同），建立新專案
          // 調試：記錄建立新專案的原因（特別針對 CU20250504）
          if (projectCodeStr === 'CU20250504') {
            console.log(`第 ${i + 1} 行：未找到現有專案，將建立新專案 - 專案編號: ${projectCodeStr}, 類型: ${projectType}, 客戶ID: ${finalCustomerId}, 專案名稱: "${currentProjectName}"`);
          }
          // 建立新專案 - 確保所有值都不是 undefined
          const contractYearNum = parseInt(contractYear);
          if (isNaN(contractYearNum)) {
            this.error(`第 ${i + 1} 行：簽約年度格式錯誤 (${contractYear})，跳過`);
            continue;
          }
          
          // 清理狀態值
          let status = (row[COLS.STATUS] && String(row[COLS.STATUS]).trim()) || '未結案';
          const validStatuses = ['未結案', '已結案', '取消'];
          if (!validStatuses.includes(status)) {
            status = '未結案'; // 預設值
          }
          
          // 確定最終的業務人員 ID
          // 注意：這裡是建立新專案，所以不應該從當前專案繼承（因為可能是不同客戶）
          // 只有在明細行（沒有專案編號）時才繼承，但這裡已經有專案編號了
          // 注意：finalCustomerId 已經在上面（第 783 行）定義了，這裡不需要重新定義
          let finalSalespersonId = salesperson?.id || null;
          // finalCustomerId 已在上面定義（第 783 行），這裡直接使用
          
          const projectData = {
            project_code: projectCodeStr,
            contract_year: contractYearNum,
            contract_month: parseMonth(row[COLS.CONTRACT_MONTH]) || null,
            status: status,
            project_type: projectType, // 使用已驗證和清理的類型
            salesperson_id: finalSalespersonId,
            customer_id: finalCustomerId,
                project_name: safeExtractText(row[COLS.PROJECT_NAME]),
            price_with_tax: cleanNumber(row[COLS.PRICE_WITH_TAX]) || 0,
            price_without_tax: cleanNumber(row[COLS.PRICE_WITHOUT_TAX]) || 0,
            is_new_customer: isNewCustomer(row[COLS.NEW_CUSTOMER]) || false,
            notes: null
          };
          
          // 驗證必要欄位
          if (!projectData.project_code || !projectData.contract_year) {
            const missingFields = [];
            if (!projectData.project_code) missingFields.push('專案編號');
            if (!projectData.contract_year) missingFields.push('簽約年度');
            this.error(`第 ${i + 1} 行：缺少必要欄位 [${missingFields.join(', ')}]，專案名稱: ${projectData.project_name || '(空)'}，跳過`);
            continue;
          }
          
          // 記錄專案建立資訊（用於調試）
          if (process.env.NODE_ENV === 'development') {
            this.log(`第 ${i + 1} 行：準備建立專案 - 編號: ${projectData.project_code}, 類型: ${projectData.project_type}, 名稱: ${projectData.project_name || '(空)'}, 客戶ID: ${projectData.customer_id || '(無)'}`);
          }
          
          try {
            currentProjectId = Project.create(projectData);
            
            if (!currentProjectId) {
              // 如果返回 null，可能是 UNIQUE 約束或其他問題
              // 嘗試查找是否已存在（使用專案編號+類型+客戶+專案名稱）
              const existing = Project.findByCodeTypeCustomerAndName(projectCodeStr, projectType, finalCustomerId, projectData.project_name);
              if (existing) {
                // 找到現有專案，使用現有專案
                currentProjectId = existing.id;
                currentProject = existing;
                this.log(`專案已存在，使用現有專案: ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}`);
                // 即使專案已存在，也計入匯入結果（因為這是匯入過程中的處理）
                results.projects++;
              } else {
                this.error(`第 ${i + 1} 行：建立專案失敗 - Project.create 返回 null`);
                console.error('專案資料:', JSON.stringify(projectData, null, 2));
                continue;
              }
            } else {
              currentProject = Project.findById(currentProjectId);
              if (currentProject) {
                results.projects++;
                if (projectCodeStr === 'CU20250504') {
                  console.log(`第 ${i + 1} 行：成功建立新專案 - ID: ${currentProjectId}, 名稱: "${currentProject.project_name}"`);
                }
                this.log(`新增專案: ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}${currentProjectName ? ` - 專案名稱: "${currentProjectName}"` : ' - 無專案名稱'}`);
              } else {
                this.error(`第 ${i + 1} 行：建立專案後無法取得專案資料 (ID: ${currentProjectId})`);
                continue;
              }
            }
          } catch (createErr) {
            const errorMsg = createErr.message || '未知錯誤';
            this.error(`第 ${i + 1} 行：建立專案時發生錯誤: ${errorMsg}`);
            console.error('建立專案錯誤詳情:', createErr);
            console.error('專案資料:', JSON.stringify(projectData, null, 2));
            
            // 如果是 UNIQUE 約束錯誤，嘗試查找已存在的專案（使用專案編號+類型+客戶+專案名稱）
            if (errorMsg.includes('UNIQUE constraint')) {
              const existing = Project.findByCodeTypeCustomerAndName(projectCodeStr, projectType, finalCustomerId, projectData.project_name);
              if (existing) {
                currentProjectId = existing.id;
                currentProject = existing;
                this.log(`專案已存在（UNIQUE 約束），使用現有專案: ${projectCodeStr} (${projectType})${finalCustomerId ? ` - 客戶ID: ${finalCustomerId}` : ' - 無客戶'}`);
                // 即使專案已存在，也計入匯入結果（因為這是匯入過程中的處理）
                results.projects++;
              } else {
                this.error(`第 ${i + 1} 行：UNIQUE 約束錯誤，但無法找到已存在的專案`);
                continue;
              }
            } else if (errorMsg.includes('CHECK constraint')) {
              // 移除 project_type CHECK 約束後，此錯誤應該不會再出現
              // 但如果出現，可能是 status 欄位的約束錯誤
              this.error(`第 ${i + 1} 行：狀態 "${status}" 不符合資料庫約束（必須為：未結案、已結案、取消）`);
              continue;
            } else {
              // 其他錯誤，繼續處理下一行
              continue;
            }
          }
        }

        // 處理獎金資訊
        if (salesperson && currentProject) {
          this.processBonus(row, COLS, currentProject, salesperson, results);
        }
      } catch (err) {
        this.error(`第 ${i + 1} 行處理專案時發生錯誤: ${err.message}`);
        console.error('專案處理錯誤:', err);
      }
    }

      // 處理發票（每列都可能有發票資訊）
      if (currentProjectId && row[COLS.INVOICE_DATE]) {
        try {
          const invoiceDate = parseROCDate(row[COLS.INVOICE_DATE]);
          if (invoiceDate) {
        Invoice.create({
          project_id: currentProjectId,
              invoice_date: invoiceDate,
              invoice_number: row[COLS.INVOICE_NUMBER] ? String(row[COLS.INVOICE_NUMBER]).trim() : null,
              amount_with_tax: cleanNumber(row[COLS.INVOICE_AMOUNT]) || 0
        });
        results.invoices++;
          }
        } catch (err) {
          this.error(`第 ${i + 1} 行：處理發票時發生錯誤: ${err.message}`);
        }
      }

      // 處理收款
      if (currentProjectId && row[COLS.PAYMENT_DATE]) {
        try {
          const paymentDate = parseROCDate(row[COLS.PAYMENT_DATE]);
          if (paymentDate) {
            // 從同一行取得發票號碼，並查找對應的發票 ID
            let invoiceId = null;
            const invoiceNumber = row[COLS.INVOICE_NUMBER] ? String(row[COLS.INVOICE_NUMBER]).trim() : null;
            if (invoiceNumber) {
              const invoice = Invoice.findByNumberAndProject(invoiceNumber, currentProjectId);
              if (invoice) {
                invoiceId = invoice.id;
                this.log(`第 ${i + 1} 行：收款關聯發票 ${invoiceNumber} (ID: ${invoiceId})`);
              } else {
                this.log(`第 ${i + 1} 行：找不到發票號碼 ${invoiceNumber} 對應的發票，收款將不關聯發票`);
              }
            }
            
            Payment.create({
              project_id: currentProjectId,
              invoice_id: invoiceId,
              payment_date: paymentDate,
              bank_deposit_amount: cleanNumber(row[COLS.BANK_DEPOSIT]) || 0,
              payment_difference: cleanNumber(row[COLS.PAYMENT_DIFF]) || 0,
              difference_type: row[COLS.PAYMENT_DIFF] ? '匯費' : null
            });
            results.payments++;
          }
        } catch (err) {
          this.error(`第 ${i + 1} 行：處理收款時發生錯誤: ${err.message}`);
        }
      }
    }

    return results;
  }

  // 處理獎金資訊
  processBonus(row, COLS, project, salesperson, results) {
    // 解析獎金級距資訊
    const bonusTierStr = row[COLS.BONUS_TIER];
    let bonusStatus = '待發放';
    let forfeitureReason = null;

    // 檢查是否充公
    if (bonusTierStr && String(bonusTierStr).includes('離職充公')) {
      bonusStatus = '充公';
      forfeitureReason = bonusTierStr;
    }

    // 依專案類型建立獎金記錄
    if (project.project_type === '食驗室') {
      if (row[COLS.LAB_NOTAX] !== null || row[COLS.LAB_BONUS] !== null) {
        Bonus.create({
          project_id: project.id,
          salesperson_id: salesperson.id,
          bonus_type: '食驗室獎金',
          base_amount: cleanNumber(row[COLS.LAB_NOTAX]),
          bonus_amount: cleanNumber(row[COLS.LAB_BONUS]),
          payment_date: parseROCDate(row[COLS.LAB_BONUS_DATE]),
          status: bonusStatus,
          forfeiture_reason: forfeitureReason
        });
        results.bonuses++;
      }
    } else if (project.project_type === '純廣') {
      if (row[COLS.AD_NOTAX] !== null || row[COLS.AD_BONUS] !== null) {
        Bonus.create({
          project_id: project.id,
          salesperson_id: salesperson.id,
          bonus_type: '純廣獎金',
          base_amount: cleanNumber(row[COLS.AD_NOTAX]),
          bonus_amount: cleanNumber(row[COLS.AD_BONUS]),
          payment_date: parseROCDate(row[COLS.LAB_BONUS_DATE]),
          status: bonusStatus,
          forfeiture_reason: forfeitureReason
        });
        results.bonuses++;
      }
    } else if (project.project_type === '專案') {
      // 專案簽約獎金
      if (row[COLS.PROJ_SIGN_BONUS] !== null) {
        Bonus.create({
          project_id: project.id,
          salesperson_id: salesperson.id,
          bonus_type: '專案簽約獎金',
          base_amount: cleanNumber(row[COLS.PROJ_NOTAX]),
          bonus_percentage: 20,
          bonus_amount: cleanNumber(row[COLS.PROJ_SIGN_BONUS]),
          payment_date: parseROCDate(row[COLS.PROJ_SIGN_DATE]),
          status: bonusStatus,
          forfeiture_reason: forfeitureReason
        });
        results.bonuses++;
      }

      // 專案結案獎金
      if (row[COLS.PROJ_CLOSE_BONUS] !== null) {
        Bonus.create({
          project_id: project.id,
          salesperson_id: salesperson.id,
          bonus_type: '專案結案獎金',
          base_amount: cleanNumber(row[COLS.PROJ_NOTAX]),
          bonus_percentage: 80,
          bonus_amount: cleanNumber(row[COLS.PROJ_CLOSE_BONUS]),
          payment_date: parseROCDate(row[COLS.PROJ_CLOSE_DATE]),
          status: bonusStatus,
          forfeiture_reason: forfeitureReason
        });
        results.bonuses++;
      }
    }

    // 開發獎金
    if (row[COLS.DEV_BONUS] !== null) {
      Bonus.create({
        project_id: project.id,
        salesperson_id: salesperson.id,
        bonus_type: '開發獎金',
        base_amount: 0,
        bonus_amount: cleanNumber(row[COLS.DEV_BONUS]),
        payment_date: parseROCDate(row[COLS.DEV_BONUS_DATE]),
        status: bonusStatus,
        forfeiture_reason: forfeitureReason
      });
      results.bonuses++;
    }
  }
}

module.exports = new ExcelImportService();
