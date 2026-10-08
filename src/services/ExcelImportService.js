const ExcelJS = require('exceljs');
const db = require('../models/db');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Salesperson = require('../models/Salesperson');
const Customer = require('../models/Customer');
const Activity = require('../models/Activity');
const AuditLogService = require('./AuditLogService');
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


// 活動日期解析：接受 Excel 日期、Excel 序號、YYYY-MM-DD / YYYY/M/D、民國年 113/07/10；回傳 YYYY-MM-DD 或 null
function parseActivityDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const isRealDate = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'object') {
    const inner = raw.result !== undefined ? raw.result : (raw.text !== undefined ? raw.text : raw.value);
    return inner === raw ? null : parseActivityDate(inner);
  }
  if (typeof raw === 'number') {
    if (raw < 1 || raw > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000).toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  let m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) {
    const [y, mo, d] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    return isRealDate(y, mo, d) ? fmt(y, mo, d) : null;
  }
  m = str.match(/^(\d{2,3})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) {
    const [y, mo, d] = [parseInt(m[1]) + 1911, parseInt(m[2]), parseInt(m[3])];
    return isRealDate(y, mo, d) ? fmt(y, mo, d) : null;
  }
  return null;
}

// 獎金明細工作表名稱（匯出/範本/匯入共用）
const BONUS_SHEET_NAME = '獎金明細';

// 舊版 39 欄版面的獎金欄位對照（僅供相容原公司的歷史 Excel；新版檔案這些欄位不存在，自然不會產生獎金）。
// 只要該欄有值就建立，不再依專案類型判斷。獎金類型須存在於「獎金類型管理」。
const LEGACY_BONUS_COLUMNS = [
  { bonus_type: '食驗室獎金', base: 26, amount: 27, date: 25, baseOnlyCounts: true },
  { bonus_type: '純廣獎金', base: 28, amount: 29, date: 25, baseOnlyCounts: true },
  { bonus_type: '專案簽約獎金', base: 30, amount: 32, date: 31, percentage: 20 },
  { bonus_type: '專案結案獎金', base: 30, amount: 34, date: 33, percentage: 80 },
  { bonus_type: '開發獎金', base: null, amount: 36, date: 35 }
];
const LEGACY_BONUS_TIER_COL = 24;

function hasValue(v) {
  return v !== null && v !== undefined && v !== '';
}

class ExcelImportService {
  constructor() {
    this.importLog = [];
    this.errors = [];
    this.resetDedupe();
  }

  // 重複匯入防護：同一份檔案重複匯入時，內容完全相同的發票/收款/獎金不重複建立。
  // 以「鍵」計數而不是單純比對有無：檔案內本來就有兩筆完全相同的合法資料（例如同日同額兩次收款）
  // 第一次匯入兩筆都要建立；重新匯入時，資料庫已有幾筆就略過幾筆。
  resetDedupe() {
    this.fileKeyCounts = {};
    this.createdKeyCounts = {};
    this.duplicateCount = 0;
  }

  isDuplicateRow(key, dbCount) {
    this.fileKeyCounts[key] = (this.fileKeyCounts[key] || 0) + 1;
    const preExisting = dbCount - (this.createdKeyCounts[key] || 0);
    if (this.fileKeyCounts[key] <= preExisting) {
      this.duplicateCount++;
      return true;
    }
    return false;
  }

  markCreated(key) {
    this.createdKeyCounts[key] = (this.createdKeyCounts[key] || 0) + 1;
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
    this.resetDedupe();
    
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

      const bonusSheets = [];

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

        // 獎金明細需等所有專案工作表處理完才能比對專案
        if (sheetName === BONUS_SHEET_NAME) {
          bonusSheets.push(data);
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

      for (const bonusData of bonusSheets) {
        try {
          results.bonuses += this.processBonusSheet(bonusData);
        } catch (bonusErr) {
          this.error(`處理工作表 ${BONUS_SHEET_NAME} 時發生錯誤: ${bonusErr.message}`);
        }
      }

      results.duplicates = this.duplicateCount;
      this.log(`匯入完成${this.duplicateCount ? `（略過 ${this.duplicateCount} 筆已存在的重複資料）` : ''}`);
      
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
      // 索引 20 以後為舊版版面的認列/獎金/佔比欄位：獎金見 LEGACY_BONUS_COLUMNS，其餘匯入時忽略
    };

    // 有效專案類型：每個工作表只查一次
    const validTypes = db.prepare('SELECT type_name FROM project_types WHERE is_active = 1').all().map(t => t.type_name);

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
            
            // 類型一律完全比對「專案類型管理」的啟用類型（只去除前後空白，不做別名轉換）
            if (projectType) {
              projectType = projectType.trim();
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
            const invoiceNumber = row[COLS.INVOICE_NUMBER] ? String(row[COLS.INVOICE_NUMBER]).trim() : null;
            const invoiceAmount = cleanNumber(row[COLS.INVOICE_AMOUNT]) || 0;
            // 去重：有發票號碼用「專案＋號碼」；沒號碼用「專案＋日期＋金額」（只比對未刪除）
            const invKey = invoiceNumber ? `inv|${currentProjectId}|${invoiceNumber}` : `inv|${currentProjectId}|${invoiceDate}|${invoiceAmount}`;
            const invCount = invoiceNumber
              ? db.prepare('SELECT COUNT(*) c FROM invoices WHERE project_id = ? AND invoice_number = ? AND deleted_at IS NULL').get(currentProjectId, invoiceNumber).c
              : db.prepare('SELECT COUNT(*) c FROM invoices WHERE project_id = ? AND invoice_number IS NULL AND invoice_date = ? AND amount_with_tax = ? AND deleted_at IS NULL').get(currentProjectId, invoiceDate, invoiceAmount).c;
            if (this.isDuplicateRow(invKey, invCount)) {
              this.log(`第 ${i + 1} 行：發票${invoiceNumber ? ` ${invoiceNumber}` : ''}已存在，略過`);
            } else {
              Invoice.create({
                project_id: currentProjectId,
                invoice_date: invoiceDate,
                invoice_number: invoiceNumber,
                amount_with_tax: invoiceAmount,
                _skipOverInvoiceCheck: true  // 匯入歷史資料，跳過超額開票驗證
              });
              this.markCreated(invKey);
              results.invoices++;
            }
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
            
            const depositAmount = cleanNumber(row[COLS.BANK_DEPOSIT]) || 0;
            const differenceAmount = cleanNumber(row[COLS.PAYMENT_DIFF]) || 0;
            // 去重：同專案＋發票＋收款日期＋金額＋差異（只比對未刪除）
            const payKey = `pay|${currentProjectId}|${invoiceId || ''}|${paymentDate}|${depositAmount}|${differenceAmount}`;
            const payCount = db.prepare(`
              SELECT COUNT(*) c FROM payments
              WHERE project_id = ? AND invoice_id IS ? AND payment_date = ?
                AND bank_deposit_amount = ? AND payment_difference = ? AND deleted_at IS NULL
            `).get(currentProjectId, invoiceId, paymentDate, depositAmount, differenceAmount).c;
            if (this.isDuplicateRow(payKey, payCount)) {
              this.log(`第 ${i + 1} 行：收款（${paymentDate}、${depositAmount}）已存在，略過`);
            } else {
              Payment.create({
                project_id: currentProjectId,
                invoice_id: invoiceId,
                payment_date: paymentDate,
                bank_deposit_amount: depositAmount,
                payment_difference: differenceAmount,
                difference_type: row[COLS.PAYMENT_DIFF] ? '匯費' : null
              });
              this.markCreated(payKey);
              results.payments++;
            }
          }
        } catch (err) {
          this.error(`第 ${i + 1} 行：處理收款時發生錯誤: ${err.message}`);
        }
      }
    }

    return results;
  }

  // 處理獎金資訊（舊版 39 欄版面相容）：欄位對照見 LEGACY_BONUS_COLUMNS，與專案類型無關，有填就建立。
  // 新版檔案的獎金放在「獎金明細」工作表（processBonusSheet）。
  processBonus(row, COLS, project, salesperson, results) {
    // 解析獎金級距資訊
    const bonusTierStr = row[LEGACY_BONUS_TIER_COL];
    let bonusStatus = '待發放';
    let forfeitureReason = null;

    // 檢查是否充公
    if (bonusTierStr && String(bonusTierStr).includes('離職充公')) {
      bonusStatus = '充公';
      forfeitureReason = bonusTierStr;
    }

    for (const col of LEGACY_BONUS_COLUMNS) {
      const hasAmount = hasValue(row[col.amount]);
      const hasBase = col.base !== null && hasValue(row[col.base]);
      // 食驗室/純廣獎金原本只填未稅基礎也算一筆；其餘需有獎金金額
      if (!hasAmount && !(col.baseOnlyCounts && hasBase)) continue;

      try {
        const bonusAmount = cleanNumber(row[col.amount]);
        const paymentDate = parseROCDate(row[col.date]);
        // 去重（與「獎金明細」同規則）：重複匯入同一份舊版檔案不會讓獎金翻倍
        const bonusKey = `bonus|${project.id}|${salesperson.id}|${col.bonus_type}|${bonusAmount}|${paymentDate || ''}`;
        const bonusCount = db.prepare(`
          SELECT COUNT(*) c FROM bonus_calculations
          WHERE project_id = ? AND salesperson_id = ? AND bonus_type = ?
            AND bonus_amount = ? AND IFNULL(payment_date, '') = ?
        `).get(project.id, salesperson.id, col.bonus_type, bonusAmount, paymentDate || '').c;
        if (this.isDuplicateRow(bonusKey, bonusCount)) {
          this.log(`專案 ${project.project_code}：「${col.bonus_type}」已存在，略過`);
          continue;
        }
        Bonus.create({
          project_id: project.id,
          salesperson_id: salesperson.id,
          bonus_type: col.bonus_type,
          base_amount: col.base !== null ? cleanNumber(row[col.base]) : 0,
          bonus_percentage: col.percentage,
          bonus_amount: bonusAmount,
          payment_date: paymentDate,
          status: bonusStatus,
          forfeiture_reason: forfeitureReason
        });
        this.markCreated(bonusKey);
        results.bonuses++;
      } catch (bonusErr) {
        this.error(`專案 ${project.project_code}：建立「${col.bonus_type}」失敗: ${bonusErr.message}`);
      }
    }
  }

  // 處理「獎金明細」工作表：一筆獎金一列，支援任意獎金類型與筆數。回傳成功建立的筆數。
  // 欄位：專案編號 | 類型 | 客戶編號 | 專案名稱 | 業務 | 獎金類型 | 計算基礎(未稅) | 比例% | 獎金金額 | 發放日期 | 狀態 | 充公原因
  processBonusSheet(data) {
    const validStatuses = ['待發放', '已發放', '充公'];
    let created = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!Array.isArray(row)) continue;
      const text = (idx) => {
        const v = safeExtractText(row[idx]);
        return v === null ? null : v;
      };

      const projectCode = text(0);
      const bonusTypeName = text(5);
      // 空白列（以及重複的標題列）直接略過
      if (!projectCode && !bonusTypeName) continue;
      if (projectCode === '專案編號') continue;

      const rowLabel = `${BONUS_SHEET_NAME} 第 ${i + 1} 行`;
      try {
        if (!projectCode) { this.error(`${rowLabel}：缺少專案編號，跳過`); continue; }
        if (!bonusTypeName) { this.error(`${rowLabel}：缺少獎金類型，跳過`); continue; }

        const projectType = text(1);
        if (!projectType) { this.error(`${rowLabel}：缺少專案類型，跳過`); continue; }

        // 客戶（可空：專案本身沒有客戶時）
        const customerCode = text(2);
        let customerId = null;
        if (customerCode) {
          const customer = Customer.findByCode(customerCode);
          if (!customer) { this.error(`${rowLabel}：找不到客戶編號「${customerCode}」，跳過`); continue; }
          customerId = customer.id;
        }

        const project = Project.findByCodeTypeCustomerAndName(projectCode, projectType, customerId, text(3));
        if (!project) {
          this.error(`${rowLabel}：找不到專案（專案編號 ${projectCode}、類型 ${projectType}${customerCode ? `、客戶 ${customerCode}` : ''}），跳過`);
          continue;
        }

        // 獎金對象：有填業務姓名用該業務，留空用專案的業務
        let salespersonId = project.salesperson_id;
        const salespersonName = text(4);
        if (salespersonName) {
          const sp = db.prepare('SELECT id FROM salespeople WHERE name = ?').get(salespersonName);
          if (!sp) { this.error(`${rowLabel}：找不到業務「${salespersonName}」，跳過`); continue; }
          salespersonId = sp.id;
        }
        if (!salespersonId) { this.error(`${rowLabel}：專案沒有業務且未填業務，跳過`); continue; }

        const status = text(10) || '待發放';
        if (!validStatuses.includes(status)) {
          this.error(`${rowLabel}：狀態「${status}」無效，只能是 ${validStatuses.join('、')}，跳過`);
          continue;
        }

        const dateRaw = row[9];
        let paymentDate = null;
        if (hasValue(dateRaw)) {
          paymentDate = parseActivityDate(dateRaw);
          if (!paymentDate) { this.error(`${rowLabel}：發放日期「${dateRaw}」格式無法辨識，跳過`); continue; }
        }

        for (const [idx, label] of [[6, '計算基礎'], [7, '比例'], [8, '獎金金額']]) {
          if (hasValue(row[idx]) && isNaN(row[idx])) {
            this.error(`${rowLabel}：${label}「${row[idx]}」不是數字，跳過`);
            throw new Error('__skip__');
          }
        }

        const baseAmount = cleanNumber(row[6]);
        const percentage = cleanNumber(row[7]);
        const bonusAmount = cleanNumber(row[8]);

        // 去重：同專案＋業務＋獎金類型＋金額＋發放日期已存在就略過（重複匯入不會翻倍）
        const bonusKey = `bonus|${project.id}|${salespersonId}|${bonusTypeName}|${bonusAmount}|${paymentDate || ''}`;
        const bonusCount = db.prepare(`
          SELECT COUNT(*) c FROM bonus_calculations
          WHERE project_id = ? AND salesperson_id = ? AND bonus_type = ?
            AND bonus_amount = ? AND IFNULL(payment_date, '') = ?
        `).get(project.id, salespersonId, bonusTypeName, bonusAmount, paymentDate || '').c;
        if (this.isDuplicateRow(bonusKey, bonusCount)) {
          this.log(`${rowLabel}：相同獎金已存在，略過`);
          continue;
        }

        Bonus.create({
          project_id: project.id,
          salesperson_id: salespersonId,
          bonus_type: bonusTypeName,
          base_amount: baseAmount,
          bonus_percentage: percentage,
          bonus_amount: bonusAmount,
          payment_date: paymentDate,
          status,
          forfeiture_reason: status === '充公' ? text(11) : null
        });
        this.markCreated(bonusKey);
        created++;
      } catch (err) {
        if (err.message !== '__skip__') {
          this.error(`${rowLabel}：${err.message}`);
        }
      }
    }
    return created;
  }

  // 客戶/廠商批次匯入（管理者專用）：直接呼叫 Customer.create()，不經過新增客戶的審核流程
  async importCustomers(filePath) {
    this.importLog = [];
    this.errors = [];
    this.log(`開始匯入客戶/廠商: ${filePath}`);

    const COLS = {
      CUSTOMER_CODE: 0, TAX_ID: 1, COMPANY_NAME: 2, PARTY_TYPE: 3, VENDOR_TYPE: 4,
      CUSTOMER_LEVEL: 5, INDUSTRY: 6, STATUS: 7, NEW_CUSTOMER: 8, OWNER_NAME: 9,
      CONTACT_NAME: 10, CONTACT_PHONE: 11, CONTACT_EMAIL: 12, BANK_NAME: 13, BANK_ACCOUNT: 14, ADDRESS: 15
    };

    let createdCount = 0;
    let skippedCount = 0;

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        this.error('找不到工作表，請確認上傳的是有效的 Excel 檔案');
        return { success: false, createdCount, skippedCount, errors: this.errors, errorCount: this.errors.length, log: this.importLog };
      }

      const totalRows = worksheet.rowCount;
      for (let rowNumber = 2; rowNumber <= totalRows; rowNumber++) {
        const excelRow = worksheet.getRow(rowNumber);
        const row = [];
        for (let c = 0; c < 16; c++) {
          row[c] = safeExtractText(excelRow.getCell(c + 1).value);
        }

        const customerCode = row[COLS.CUSTOMER_CODE];
        const companyName = row[COLS.COMPANY_NAME];
        if (!customerCode && !companyName) {
          continue; // 空白列（含範本裡的空白隔行），跳過不記錄
        }

        try {
          if (!customerCode) throw new Error('客戶編號為必填欄位');
          if (!companyName) throw new Error('公司名稱為必填欄位');

          let ownerSalespersonId = null;
          const ownerName = row[COLS.OWNER_NAME];
          if (ownerName) {
            const user = db.prepare('SELECT id FROM users WHERE name = ?').get(ownerName);
            if (user) {
              ownerSalespersonId = user.id;
            } else {
              this.log(`第 ${rowNumber} 列：找不到姓名為「${ownerName}」的使用者，客戶關係負責人先留空，可日後手動編輯補上`);
            }
          }

          Customer.create({
            customer_code: customerCode,
            tax_id: row[COLS.TAX_ID],
            company_name: companyName,
            is_new_customer: row[COLS.NEW_CUSTOMER] === '新客戶',
            contact_name: row[COLS.CONTACT_NAME],
            contact_phone: row[COLS.CONTACT_PHONE],
            contact_email: row[COLS.CONTACT_EMAIL],
            owner_salesperson_id: ownerSalespersonId,
            customer_level: row[COLS.CUSTOMER_LEVEL] || null,
            industry: row[COLS.INDUSTRY],
            status: row[COLS.STATUS] || undefined,
            party_type: row[COLS.PARTY_TYPE],
            vendor_type: row[COLS.VENDOR_TYPE],
            bank_name: row[COLS.BANK_NAME],
            bank_account: row[COLS.BANK_ACCOUNT],
            address: row[COLS.ADDRESS]
          });
          createdCount++;
        } catch (rowErr) {
          skippedCount++;
          this.error(`第 ${rowNumber} 列（客戶編號：${customerCode || '未填'}）：${rowErr.message}`);
        }
      }

      this.log(`匯入完成：成功 ${createdCount} 筆，失敗 ${skippedCount} 筆`);
      return {
        success: this.errors.length === 0 || createdCount > 0,
        createdCount, skippedCount,
        errors: this.errors, errorCount: this.errors.length,
        log: this.importLog
      };
    } catch (err) {
      this.error(`匯入失敗: ${err.message}`);
      return { success: false, createdCount, skippedCount, error: err.message, errors: this.errors, errorCount: this.errors.length, log: this.importLog };
    }
  }

  // 客戶活動紀錄批次匯入（管理者專用）：
  // 依客戶編號（或公司名稱）對應客戶；缺少的活動類型自動新增；同客戶＋同日期＋同類型＋同內容已存在則略過
  async importActivities(filePath, userInfo) {
    this.importLog = [];
    this.errors = [];
    this.log(`開始匯入活動紀錄: ${filePath}`);

    const COLS = { CODE: 0, NAME: 1, DATE: 2, TYPE: 3, CONTENT: 4, PIPELINE: 5, RECORDER: 6 };
    const MAX_TYPE_LENGTH = 20;
    let createdCount = 0;
    let duplicateCount = 0;
    let linkedCount = 0;
    let failedCount = 0;
    const warnings = [];
    const createdTypes = [];

    const typeCache = {};
    db.prepare('SELECT type_name, is_active FROM activity_types').all().forEach(t => { typeCache[t.type_name] = t.is_active; });

    const fail = (rowNumber, label, message) => {
      failedCount++;
      this.error(`第 ${rowNumber} 列${label ? `（${label}）` : ''}：${message}`);
    };

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        this.error('找不到工作表，請確認上傳的是有效的 Excel 檔案');
        return { success: false, createdCount, duplicateCount, failedCount, errors: this.errors, errorCount: this.errors.length, warnings, createdTypes };
      }

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const excelRow = worksheet.getRow(rowNumber);
        const code = safeExtractText(excelRow.getCell(COLS.CODE + 1).value);
        const name = safeExtractText(excelRow.getCell(COLS.NAME + 1).value);
        const rawDate = excelRow.getCell(COLS.DATE + 1).value;
        const typeText = safeExtractText(excelRow.getCell(COLS.TYPE + 1).value);
        const content = safeExtractText(excelRow.getCell(COLS.CONTENT + 1).value);
        const pipelineName = safeExtractText(excelRow.getCell(COLS.PIPELINE + 1).value);
        const recorder = safeExtractText(excelRow.getCell(COLS.RECORDER + 1).value);

        if (!code && !name && !content && (rawDate === null || rawDate === undefined || rawDate === '')) continue;
        const label = code || name || '';

        try {
          // 1. 對應客戶
          let customer;
          if (code) {
            customer = db.prepare('SELECT id, company_name FROM customers WHERE customer_code = ? AND deleted_at IS NULL').get(code);
            if (!customer) { fail(rowNumber, label, `找不到客戶編號「${code}」`); continue; }
          } else if (name) {
            const matches = db.prepare('SELECT id, company_name FROM customers WHERE company_name = ? AND deleted_at IS NULL').all(name);
            if (matches.length === 0) { fail(rowNumber, label, `找不到公司名稱「${name}」的客戶`); continue; }
            if (matches.length > 1) { fail(rowNumber, label, `公司名稱「${name}」對應到 ${matches.length} 位客戶，請改填客戶編號`); continue; }
            customer = matches[0];
          } else {
            fail(rowNumber, label, '客戶編號與公司名稱至少要填一項'); continue;
          }

          // 2. 日期與內容
          const activityDate = parseActivityDate(rawDate);
          if (!activityDate) { fail(rowNumber, label, '活動日期為必填，或格式無法辨識'); continue; }
          if (!content) { fail(rowNumber, label, '活動內容為必填欄位'); continue; }

          // 3. 活動類型（缺少的自動新增）
          const typeName = typeText || '其他';
          if (typeName.length > MAX_TYPE_LENGTH) { fail(rowNumber, label, `活動類型「${typeName}」超過 ${MAX_TYPE_LENGTH} 個字`); continue; }
          if (typeCache[typeName] === 0) {
            fail(rowNumber, label, `活動類型「${typeName}」已停用，請至「活動類型管理」啟用後再匯入`); continue;
          }
          if (typeCache[typeName] === undefined) {
            const maxOrder = db.prepare('SELECT MAX(display_order) AS m FROM activity_types').get();
            db.prepare(`INSERT INTO activity_types (type_name, badge_color, display_order, is_active, updated_at)
              VALUES (?, 'secondary', ?, 1, datetime('now', 'localtime'))`).run(typeName, ((maxOrder && maxOrder.m) || 0) + 1);
            typeCache[typeName] = 1;
            createdTypes.push(typeName);
          }

          // 4. 關聯銷售機會（找不到只警告，不擋列）
          let pipelineId = null;
          let pipelineMissing = false;
          if (pipelineName) {
            const pipe = db.prepare(`
              SELECT id FROM pipelines WHERE customer_id = ? AND opportunity_name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1
            `).get(customer.id, pipelineName);
            if (pipe) pipelineId = pipe.id;
            else pipelineMissing = true;
          }

          // 5. 去重：已存在就略過；但若已存在的紀錄原本沒有關聯商機、這次有對應到商機，只補上關聯
          //（已經有關聯的紀錄不覆蓋，日期/類型/內容/記錄人都不更新）
          const existing = db.prepare(`
            SELECT id, pipeline_id FROM activities
            WHERE customer_id = ? AND substr(activity_date, 1, 10) = ? AND activity_type = ? AND TRIM(content) = ? AND deleted_at IS NULL
            ORDER BY (pipeline_id IS NULL) DESC, id LIMIT 1
          `).get(customer.id, activityDate, typeName, content);
          if (existing) {
            if (pipelineId && !existing.pipeline_id) {
              db.prepare('UPDATE activities SET pipeline_id = ? WHERE id = ?').run(pipelineId, existing.id);
              AuditLogService.logUpdate('activities', existing.id, { pipeline_id: null }, { pipeline_id: pipelineId }, userInfo);
              linkedCount++;
            } else {
              duplicateCount++;
              if (pipelineMissing) warnings.push(`第 ${rowNumber} 列（${label}）：紀錄已存在，且找不到銷售機會「${pipelineName}」，未補上關聯`);
            }
            continue;
          }
          if (pipelineMissing) warnings.push(`第 ${rowNumber} 列（${label}）：找不到銷售機會「${pipelineName}」，已匯入但未關聯`);

          const activityId = Activity.create({
            customer_id: customer.id,
            pipeline_id: pipelineId,
            activity_type: typeName,
            content,
            activity_date: activityDate,
            userInfo
          });
          if (recorder) {
            db.prepare('UPDATE activities SET created_by = ? WHERE id = ?').run(recorder, activityId);
          }
          createdCount++;
        } catch (rowErr) {
          fail(rowNumber, label, rowErr.message);
        }
      }

      this.log(`活動紀錄匯入完成：成功 ${createdCount}、補上關聯 ${linkedCount}、略過重複 ${duplicateCount}、失敗 ${failedCount}`);
      return {
        success: failedCount === 0 || createdCount > 0 || duplicateCount > 0 || linkedCount > 0,
        createdCount, linkedCount, duplicateCount, failedCount,
        errors: this.errors, errorCount: this.errors.length,
        warnings, createdTypes
      };
    } catch (err) {
      this.error(`匯入失敗: ${err.message}`);
      return { success: false, createdCount, duplicateCount, failedCount, error: err.message, errors: this.errors, errorCount: this.errors.length, warnings, createdTypes };
    }
  }
}

module.exports = new ExcelImportService();
