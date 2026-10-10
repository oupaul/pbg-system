const ExcelJS = require('exceljs');
const db = require('../models/db');
const dayjs = require('dayjs');
const ReceivablesAgingService = require('./ReceivablesAgingService');
const GrossProfitAnalysisService = require('./GrossProfitAnalysisService');

// 格式化為民國年
function formatROCDate(dateStr) {
  if (!dateStr) return '';
  const d = dayjs(dateStr);
  if (!d.isValid()) return '';
  const rocYear = d.year() - 1911;
  return `${rocYear}/${d.format('MM/DD')}`;
}

// 格式化金額
function formatCurrency(num) {
  if (num === null || num === undefined) return '';
  return Math.round(num);
}

// 專案總表欄位（匯出與範本共用，與匯入的 COLS 索引 0–19 一致）。
// 獎金不在這張表，改放「獎金明細」工作表（任意獎金類型、任意筆數）。
const PROJECT_HEADERS = [
  '簽約年度', '狀態', '類型', '業務', '專案月份', '新客戶',
  '專案編號', '客戶編號', '統一編號', '公司名稱', '專案名稱',
  '價格(含稅)', '發票日期', '發票號碼', '開立金額(含稅)', '未開立發票金額',
  '收款日期', '銀行存款匯入金額', '收款差異', '價格(未稅)'
];

const COST_SHEET_NAME = '成本明細';
// 成本明細欄位（匯出與匯入範本共用，順序需與 ExcelImportService.processCostWorksheet 的 COLS 一致）
const COST_HEADERS = [
  '專案編號', '類型', '客戶編號', '專案名稱', '進項編號', '成本名稱', '成本日期',
  '成本類型', '費用類別', '廠商', '付款辦法', '付款條件', '下單狀態', '預估金額', '實際金額', '備註'
];
const COST_COLUMN_WIDTHS = [14, 10, 12, 24, 20, 24, 12, 12, 12, 16, 12, 12, 12, 12, 12, 24];
// 客戶/廠商欄位（匯出與匯入範本共用，順序需與 ExcelImportService.importCustomers 的 COLS 一致）
const CUSTOMER_HEADERS = [
  '客戶編號', '統一編號', '公司名稱', '客戶/廠商類型', '廠商類型',
  '客戶等級', '產業別', '往來狀態', '新/舊客戶', '客戶關係負責人',
  '聯絡人姓名', '聯絡電話', '聯絡Email', '銀行', '銀行帳號', '地址'
];
const CUSTOMER_COLUMN_WIDTHS = [12, 12, 24, 12, 10, 10, 14, 10, 10, 14, 12, 14, 22, 14, 18, 30];
// 活動紀錄欄位（匯出與匯入範本共用，順序需與 ExcelImportService.importActivities 的 COLS 一致）
const ACTIVITY_HEADERS = ['客戶編號', '公司名稱', '活動日期', '活動類型', '活動內容', '關聯銷售機會', '記錄人'];
const ACTIVITY_COLUMN_WIDTHS = [12, 24, 14, 12, 50, 24, 12];
// 銷售機會匯出欄位
const PIPELINE_HEADERS = [
  '客戶編號', '公司名稱', '商機名稱', '預估專案類型', '預估金額', '成交機率%', '預計成交月份', '狀態', '流失原因',
  '業務', '負責人員', '已轉專案編號', '轉專案日期', '活動紀錄筆數', '備註', '建立日期', '更新日期'
];
const PIPELINE_COLUMN_WIDTHS = [12, 24, 28, 16, 14, 10, 12, 10, 20, 12, 12, 16, 12, 10, 40, 12, 12];
// 業務績效匯出欄位（與業務績效儀表板一致）
const SALES_PERFORMANCE_HEADERS = [
  '業務', '專案數', '專案金額', '已開發票', '未開發票', '已收款', '未收款',
  '總獎金', '已發放', '待發放', '洽談中銷售機會', '預估金額'
];
const BONUS_SHEET_NAME = '獎金明細';
const BONUS_HEADERS = [
  '專案編號', '類型', '客戶編號', '專案名稱', '業務', '獎金類型',
  '計算基礎(未稅)', '比例%', '獎金金額', '發放日期', '狀態', '充公原因'
];
const BONUS_COLUMN_WIDTHS = [14, 10, 12, 30, 10, 16, 14, 8, 12, 12, 10, 24];

function styleHeaderRow(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

class ExcelExportService {
  // 匯出專案總表
  exportProjectSummary(year) {
    const projects = db.prepare(`
      SELECT 
        p.*,
        s.name as salesperson_name,
        c.customer_code,
        c.tax_id,
        c.company_name
      FROM projects p
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN customers c ON p.customer_id = c.id
      WHERE p.contract_year = ?
      ORDER BY p.contract_month, p.project_code
    `).all(year);

    const workbook = new ExcelJS.Workbook();
    
    const headers = PROJECT_HEADERS;

    const data = [headers];

    for (const project of projects) {
      // 取得發票明細（排除軟刪除；有效與作廢均列出，供第一列判斷用）
      const allInvoices = db.prepare(`
        SELECT * FROM invoices WHERE project_id = ? AND deleted_at IS NULL ORDER BY invoice_date
      `).all(project.id);
      // 有效發票：status 為 NULL 或 '有效'（含部分折讓，以認列金額計）
      const validInvoices = allInvoices.filter(i => !i.status || i.status === '有效');
      // 非有效發票（作廢、整筆折讓）僅用於附加列展示，不計入金額
      const invalidInvoices = allInvoices.filter(i => i.status && i.status !== '有效');

      // 取得收款明細（排除軟刪除）
      const payments = db.prepare(`
        SELECT * FROM payments WHERE project_id = ? AND deleted_at IS NULL ORDER BY payment_date
      `).all(project.id);

      // 計算彙總（僅計有效發票，認列金額 = amount_with_tax - allowance_amount）
      const totalInvoiced = validInvoices.reduce(
        (sum, i) => sum + (i.amount_with_tax || 0) - (i.allowance_amount || 0), 0
      );
      const uninvoiced = Math.max(0, project.price_with_tax - totalInvoiced);

      // 第一列（含專案主資訊）
      const firstRow = [
        project.contract_year,
        project.status,
        project.project_type,
        project.salesperson_name,
        project.contract_month ? `${project.contract_month}月` : '',
        project.is_new_customer ? '新客戶' : '舊客戶',
        project.project_code,
        project.customer_code,
        project.tax_id,
        project.company_name,
        project.project_name,
        formatCurrency(project.price_with_tax),
        validInvoices[0] ? formatROCDate(validInvoices[0].invoice_date) : '',
        validInvoices[0]?.invoice_number || '',
        validInvoices[0] ? formatCurrency((validInvoices[0].amount_with_tax || 0) - (validInvoices[0].allowance_amount || 0)) : '',
        formatCurrency(uninvoiced),
        payments[0] ? formatROCDate(payments[0].payment_date) : '',
        payments[0] ? formatCurrency(payments[0].bank_deposit_amount) : '',
        payments[0] ? formatCurrency(payments[0].payment_difference) : '',
        formatCurrency(project.price_without_tax)
      ];

      data.push(firstRow);

      // 額外有效發票列（從第 2 筆起）與收款列（從第 2 筆起）
      const maxValidRows = Math.max(validInvoices.length, payments.length);
      for (let i = 1; i < maxValidRows; i++) {
        const extraRow = new Array(headers.length).fill('');
        extraRow[6]  = project.project_code;
        extraRow[7]  = project.customer_code;
        extraRow[8]  = project.tax_id;
        extraRow[9]  = project.company_name;
        extraRow[10] = project.project_name;

        if (validInvoices[i]) {
          const inv = validInvoices[i];
          extraRow[12] = formatROCDate(inv.invoice_date);
          extraRow[13] = inv.invoice_number || '';
          extraRow[14] = formatCurrency((inv.amount_with_tax || 0) - (inv.allowance_amount || 0));
        }

        if (payments[i]) {
          extraRow[16] = formatROCDate(payments[i].payment_date);
          extraRow[17] = formatCurrency(payments[i].bank_deposit_amount);
          extraRow[18] = formatCurrency(payments[i].payment_difference);
        }

        data.push(extraRow);
      }

      // 作廢/整筆折讓發票附加在最後（標記狀態，僅供參考，匯入時不處理）
      for (const inv of invalidInvoices) {
        const voidRow = new Array(headers.length).fill('');
        voidRow[6]  = project.project_code;
        voidRow[7]  = project.customer_code;
        voidRow[8]  = project.tax_id;
        voidRow[9]  = project.company_name;
        voidRow[10] = project.project_name;
        voidRow[12] = formatROCDate(inv.invoice_date);
        voidRow[13] = `[${inv.status}] ${inv.invoice_number || ''}`.trim();
        voidRow[14] = formatCurrency(inv.amount_with_tax);
        data.push(voidRow);
      }
    }

    const worksheet = workbook.addWorksheet(`專案總表-${year}`);
    worksheet.addRows(data);
    
    // 設定欄寬
    const columnWidths = [
      8,   // 簽約年度
      8,   // 狀態
      8,   // 類型
      10,  // 業務
      8,   // 專案月份
      8,   // 新客戶
      14,  // 專案編號
      12,  // 客戶編號
      12,  // 統一編號
      20,  // 公司名稱
      30,  // 專案名稱
      12,  // 價格(含稅)
      12,  // 發票日期
      14,  // 發票號碼
      12,  // 開立金額
      12,  // 未開立發票金額
      12,  // 收款日期
      12,  // 銀行存款匯入金額
      10,  // 收款差異
      12,  // 價格(未稅)
    ];
    
    columnWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    // 獎金明細：該年度所有專案的全部獎金，一筆一列（任意獎金類型、任意筆數）
    const bonusRows = db.prepare(`
      SELECT p.project_code, p.project_type, p.project_name,
             c.customer_code, s.name AS salesperson_name,
             b.bonus_type, b.base_amount, b.bonus_percentage, b.bonus_amount,
             b.payment_date, b.status, b.forfeiture_reason
      FROM bonus_calculations b
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN salespeople s ON b.salesperson_id = s.id
      WHERE p.contract_year = ?
      ORDER BY p.contract_month, p.project_code, b.id
    `).all(year);

    const bonusSheet = workbook.addWorksheet(BONUS_SHEET_NAME);
    bonusSheet.addRow(BONUS_HEADERS);
    for (const b of bonusRows) {
      bonusSheet.addRow([
        b.project_code,
        b.project_type,
        b.customer_code || '',
        b.project_name || '',
        b.salesperson_name || '',
        b.bonus_type,
        formatCurrency(b.base_amount),
        b.bonus_percentage || 0,
        formatCurrency(b.bonus_amount),
        b.payment_date ? formatROCDate(b.payment_date) : '',
        b.status,
        b.forfeiture_reason || ''
      ]);
    }
    styleHeaderRow(bonusSheet);
    BONUS_COLUMN_WIDTHS.forEach((w, i) => { bonusSheet.getColumn(i + 1).width = w; });

    // 成本明細：該年度所有專案的全部成本，欄位與「成本明細匯入範本」一致，可直接重新匯入
    const costRows = db.prepare(`
      SELECT p.project_code, p.project_type, p.project_name, c.customer_code,
             co.item_code, co.item_name, co.cost_date, co.cost_type, co.cost_category,
             v.customer_code AS vendor_code, co.payment_method, co.payment_term, co.order_status,
             co.estimated_amount, co.actual_amount, co.notes
      FROM costs co
      JOIN projects p ON co.project_id = p.id
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN customers v ON co.vendor_id = v.id
      WHERE p.contract_year = ?
      ORDER BY p.contract_month, p.project_code, co.cost_date, co.id
    `).all(year);

    const costSheet = workbook.addWorksheet(COST_SHEET_NAME);
    costSheet.addRow(COST_HEADERS);
    for (const co of costRows) {
      costSheet.addRow([
        co.project_code, co.project_type, co.customer_code || '', co.project_name || '',
        co.item_code || '', co.item_name || '', co.cost_date ? formatROCDate(co.cost_date) : '',
        co.cost_type || '', co.cost_category || '', co.vendor_code || '',
        co.payment_method || '', co.payment_term || '', co.order_status || '',
        formatCurrency(co.estimated_amount), formatCurrency(co.actual_amount), co.notes || ''
      ]);
    }
    styleHeaderRow(costSheet);
    COST_COLUMN_WIDTHS.forEach((w, i) => { costSheet.getColumn(i + 1).width = w; });

    return workbook;
  }

  // 匯出獎金報表
  exportBonusReport(year) {
    const bonuses = db.prepare(`
      SELECT 
        b.*,
        p.project_code,
        p.project_name,
        p.project_type,
        s.name as salesperson_name
      FROM bonus_calculations b
      JOIN projects p ON b.project_id = p.id
      JOIN salespeople s ON b.salesperson_id = s.id
      WHERE p.contract_year = ?
      ORDER BY s.name, b.bonus_type, p.project_code
    `).all(year);

    const workbook = new ExcelJS.Workbook();

    const headers = [
      '業務', '專案編號', '專案名稱', '專案類型',
      '獎金類型', '計算基礎', '獎金比例%', '獎金金額',
      '發放日期', '狀態', '備註'
    ];

    const data = [headers];

    for (const bonus of bonuses) {
      data.push([
        bonus.salesperson_name,
        bonus.project_code,
        bonus.project_name,
        bonus.project_type,
        bonus.bonus_type,
        formatCurrency(bonus.base_amount),
        bonus.bonus_percentage || '',
        formatCurrency(bonus.bonus_amount),
        formatROCDate(bonus.payment_date),
        bonus.status,
        bonus.forfeiture_reason || ''
      ]);
    }

    const worksheet = workbook.addWorksheet(`獎金報表-${year}`);
    worksheet.addRows(data);
    
    const columnWidths = [
      10,  // 業務
      14,  // 專案編號
      30,  // 專案名稱
      10,  // 專案類型
      14,  // 獎金類型
      12,  // 計算基礎
      10,  // 獎金比例
      12,  // 獎金金額
      12,  // 發放日期
      8,   // 狀態
      20,  // 備註
    ];
    
    columnWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    return workbook;
  }

  // 匯出應收帳款帳齡分析
  exportReceivablesAging(year = null) {
    const aging = ReceivablesAgingService.getAgingReport(year);

    const workbook = new ExcelJS.Workbook();
    const sheetName = year ? `帳齡分析-${year}` : '帳齡分析-全部';
    const worksheet = workbook.addWorksheet(sheetName);

    const bucketLabels = [
      { key: 'notYetDue', label: '未到期' },
      { key: 'days1_30', label: '1-30 天' },
      { key: 'days31_60', label: '31-60 天' },
      { key: 'days61_90', label: '61-90 天' },
      { key: 'over90', label: '90 天以上' },
      { key: 'noDate', label: '未設預計日' }
    ];

    const allItems = bucketLabels.flatMap(({ key }) => {
      const b = aging.buckets[key];
      return (b?.items || []).map(item => ({ ...item, bucketLabel: aging.buckets[key].label }));
    });

    worksheet.addRow([year ? `應收帳款帳齡分析 - ${year} 年度` : '應收帳款帳齡分析 - 全部']);
    worksheet.addRow([`總未收款：$${formatCurrency(aging.total)} (${aging.totalCount} 筆)`]);
    worksheet.addRow([]);

    const headers = ['帳齡', '專案編號', '專案名稱', '發票號碼', '業務', '未收金額', '預計收款日'];
    worksheet.addRow(headers);

    for (const item of allItems) {
      worksheet.addRow([
        item.bucketLabel || '',
        item.project_code || '',
        item.project_name || '',
        item.invoice_number || '-',
        item.salesperson_name || '-',
        formatCurrency(item.amount),
        item.expected_payment_date ? formatROCDate(item.expected_payment_date) : ''
      ]);
    }

    const columnWidths = [12, 18, 35, 18, 15, 14, 14];
    columnWidths.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

    return workbook;
  }

  // 匯出毛利分析報表（專案明細、依業務彙總、依類型彙總、依群組彙總）
  exportGrossProfit(year = null, user = null, statusFilter = null) {
    const byProject = GrossProfitAnalysisService.getAnalysisByProject(year, user, statusFilter);
    const bySalesperson = GrossProfitAnalysisService.getAnalysisBySalesperson(year, user, statusFilter);
    const byType = GrossProfitAnalysisService.getAnalysisByType(year, user, statusFilter);
    const byGroup = GrossProfitAnalysisService.getAnalysisByReportGroup(year, user, statusFilter);

    const workbook = new ExcelJS.Workbook();
    const yearLabel = year ? `${year} 年度` : '全部年度';
    const statusLabel = statusFilter === '未結案' ? '（未結案）' : statusFilter === '已結案' ? '（已結案）' : '';
    const sheetNameSuffix = year ? `-${year}` : '-全部';

    // Sheet 1: 專案明細
    const wsProject = workbook.addWorksheet(`專案明細${sheetNameSuffix}`);
    wsProject.addRow(['專案毛利分析 - 專案明細', yearLabel + statusLabel]);
    wsProject.addRow([]);
    wsProject.addRow(['專案編號', '客戶', '專案名稱', '類型', '毛利率%', '毛利', '收入（未稅）', '成本', '簽約年度', '狀態']);
    for (const r of byProject) {
      wsProject.addRow([
        r.project_code || '',
        r.customer_name || '',
        r.project_name || '',
        r.project_type || '',
        r.gross_margin_pct != null ? r.gross_margin_pct : '',
        formatCurrency(r.gross_profit),
        formatCurrency(r.revenue),
        formatCurrency(r.total_cost),
        r.contract_year || '',
        r.status || ''
      ]);
    }
    [14, 32, 32, 10, 10, 14, 14, 14, 10, 8].forEach((w, i) => { wsProject.getColumn(i + 1).width = w; });

    // Sheet 2: 依業務彙總
    const wsSalesperson = workbook.addWorksheet(`依業務彙總${sheetNameSuffix}`);
    wsSalesperson.addRow(['專案毛利分析 - 依業務彙總', yearLabel + statusLabel]);
    wsSalesperson.addRow([]);
    wsSalesperson.addRow(['業務', '專案數', '總收入', '總成本', '總毛利', '毛利率%']);
    for (const r of bySalesperson) {
      wsSalesperson.addRow([
        r.name || '',
        r.project_count || 0,
        formatCurrency(r.total_revenue),
        formatCurrency(r.total_cost),
        formatCurrency(r.gross_profit),
        r.gross_margin_pct != null ? r.gross_margin_pct : ''
      ]);
    }
    [15, 10, 14, 14, 14, 10].forEach((w, i) => { wsSalesperson.getColumn(i + 1).width = w; });

    // Sheet 3: 依類型彙總
    const wsType = workbook.addWorksheet(`依類型彙總${sheetNameSuffix}`);
    wsType.addRow(['專案毛利分析 - 依類型彙總', yearLabel + statusLabel]);
    wsType.addRow([]);
    wsType.addRow(['專案類型', '專案數', '總收入', '總成本', '總毛利', '毛利率%']);
    for (const r of byType) {
      wsType.addRow([
        r.project_type || '',
        r.project_count || 0,
        formatCurrency(r.total_revenue),
        formatCurrency(r.total_cost),
        formatCurrency(r.gross_profit),
        r.gross_margin_pct != null ? r.gross_margin_pct : ''
      ]);
    }
    [15, 10, 14, 14, 14, 10].forEach((w, i) => { wsType.getColumn(i + 1).width = w; });

    // Sheet 4: 依群組彙總
    const wsGroup = workbook.addWorksheet(`依群組彙總${sheetNameSuffix}`);
    wsGroup.addRow(['專案毛利分析 - 依群組彙總', yearLabel + statusLabel]);
    wsGroup.addRow([]);
    wsGroup.addRow(['報表群組', '專案數', '總收入', '總成本', '總毛利', '毛利率%']);
    for (const r of byGroup) {
      wsGroup.addRow([
        r.report_group_name || '未分群',
        r.project_count || 0,
        formatCurrency(r.total_revenue),
        formatCurrency(r.total_cost),
        formatCurrency(r.gross_profit),
        r.gross_margin_pct != null ? r.gross_margin_pct : ''
      ]);
    }
    [20, 10, 14, 14, 14, 10].forEach((w, i) => { wsGroup.getColumn(i + 1).width = w; });

    return workbook;
  }

  // 生成範例 Excel 檔案（專案類型、獎金類型皆讀取系統目前的啟用設定，不含任何公司專屬字串）
  generateTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('專案總表');

    // 目前啟用的專案類型／獎金類型
    const readNames = (table) => {
      try {
        return db.prepare(`SELECT type_name FROM ${table} WHERE is_active = 1 ORDER BY display_order, type_name`).all().map(r => r.type_name);
      } catch (e) {
        return [];
      }
    };
    const activeProjectTypes = readNames('project_types');
    const activeBonusTypes = readNames('bonus_types');
    const typeListStr = activeProjectTypes.length > 0
      ? activeProjectTypes.map(t => `「${t}」`).join('、')
      : '（請先到「專案類型管理」新增類型）';
    const bonusTypeListStr = activeBonusTypes.length > 0
      ? activeBonusTypes.map(t => `「${t}」`).join('、')
      : '（請先到「獎金類型管理」新增類型）';
    const exampleType = (n) => activeProjectTypes.length > 0 ? activeProjectTypes[n % activeProjectTypes.length] : '（專案類型）';

    // 範例資料：沿用前幾個啟用的類型，專案名稱使用中性字串
    const exampleRows = [
      [2024, '未結案', exampleType(0), '王小明', '7月', '新客戶',
        'PJ20240706', 'C001', '12345678', 'XX股份有限公司', '範例專案 A',
        651000, '113/07/10', 'AB12345678', 651000, 0,
        '113/08/15', 651000, 0, 620000],
      [2024, '已結案', exampleType(1), '李美麗', '8月', '舊客戶',
        'PJ20240815', 'C002', '87654321', 'YY企業有限公司', '範例專案 B',
        1050000, '113/08/20', 'CD87654321', 1050000, 0,
        '113/09/10', 1050000, 0, 1000000],
      [2024, '未結案', exampleType(2), '張三', '9月', '新客戶',
        'PJ20240901', 'C003', '98765432', 'ZZ科技股份有限公司', '範例專案 C',
        2000000, '113/09/15', 'EF11223344', 1000000, 1000000,
        '113/10/05', 1000000, 0, 1904762]
    ];

    worksheet.addRow(PROJECT_HEADERS);
    exampleRows.forEach(r => worksheet.addRow(r));
    styleHeaderRow(worksheet);

    [10, 8, 8, 10, 10, 8,
      14, 12, 12, 20, 30,
      12, 12, 14, 12, 12,
      12, 12, 10, 12
    ].forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    // 獎金明細範例：沿用前 2 個啟用的獎金類型，對應範例專案
    const bonusSheet = workbook.addWorksheet(BONUS_SHEET_NAME);
    bonusSheet.addRow(BONUS_HEADERS);
    const bonusTypeName = (n) => activeBonusTypes.length > 0 ? activeBonusTypes[n % activeBonusTypes.length] : '（請先建立獎金類型）';
    bonusSheet.addRow(['PJ20240706', exampleType(0), 'C001', '範例專案 A', '王小明', bonusTypeName(0), 620000, 4, 24800, '113/08/20', '待發放', '']);
    bonusSheet.addRow(['PJ20240815', exampleType(1), 'C002', '範例專案 B', '李美麗', bonusTypeName(1), 1000000, 5, 50000, '113/09/25', '已發放', '']);
    styleHeaderRow(bonusSheet);
    BONUS_COLUMN_WIDTHS.forEach((w, i) => { bonusSheet.getColumn(i + 1).width = w; });

    // 添加說明工作表
    const infoSheet = workbook.addWorksheet('填寫說明');
    infoSheet.addRow(['欄位說明（工作表「專案總表」）']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['欄位名稱', '說明', '範例', '必填']);
    infoSheet.addRow(['簽約年度', '西元年', '2024', '是']);
    infoSheet.addRow(['狀態', '未結案 或 已結案 或 取消', '未結案', '是']);
    infoSheet.addRow(['類型', activeProjectTypes.join(' 或 ') || '（尚未設定專案類型）', exampleType(0), '是']);
    infoSheet.addRow(['業務', '業務人員姓名', '王小明', '是']);
    infoSheet.addRow(['專案月份', '數字或X月格式', '7月', '否']);
    infoSheet.addRow(['新客戶', '新客戶 或 舊客戶', '新客戶', '是']);
    infoSheet.addRow(['專案編號', '專案唯一識別碼', 'PJ20240706', '是']);
    infoSheet.addRow(['客戶編號', '客戶代碼', 'C001', '是']);
    infoSheet.addRow(['統一編號', '8碼統編', '12345678', '否']);
    infoSheet.addRow(['公司名稱', '客戶全名', 'XX股份有限公司', '是']);
    infoSheet.addRow(['專案名稱', '專案說明', '範例專案 A', '是']);
    infoSheet.addRow(['價格(含稅)', '合約金額（含稅）', '651000', '是']);
    infoSheet.addRow(['發票日期', '民國年格式：113/07/10', '113/07/10', '否']);
    infoSheet.addRow(['發票號碼', '發票號碼', 'AB12345678', '否']);
    infoSheet.addRow(['開立金額(含稅)', '發票金額', '651000', '否']);
    infoSheet.addRow(['未開立發票金額', '(匯出計算值，匯入時忽略)', '', '否']);
    infoSheet.addRow(['收款日期', '民國年格式：113/08/15', '113/08/15', '否']);
    infoSheet.addRow(['銀行存款匯入金額', '實際收款金額', '651000', '否']);
    infoSheet.addRow(['收款差異', '收款差異金額', '0', '否']);
    infoSheet.addRow(['價格(未稅)', '合約金額（未稅）', '620000', '是']);
    infoSheet.addRow(['']);
    infoSheet.addRow([`欄位說明（工作表「${BONUS_SHEET_NAME}」，一筆獎金一列，選填）`]);
    infoSheet.addRow(['']);
    infoSheet.addRow(['欄位名稱', '說明', '範例', '必填']);
    infoSheet.addRow(['專案編號 / 類型 / 客戶編號 / 專案名稱', '用來對應「專案總表」中的專案，需與專案總表一致', 'PJ20240706', '是（專案名稱、客戶編號若該專案沒有可留空）']);
    infoSheet.addRow(['業務', '領取獎金的業務姓名；留空則使用專案的業務', '王小明', '否']);
    infoSheet.addRow(['獎金類型', `需為系統啟用的獎金類型：${bonusTypeListStr}`, bonusTypeName(0), '是']);
    infoSheet.addRow(['計算基礎(未稅)', '計算獎金的基礎金額', '620000', '否']);
    infoSheet.addRow(['比例%', '獎金比例，例如 4 代表 4%', '4', '否']);
    infoSheet.addRow(['獎金金額', '實際獎金金額', '24800', '是']);
    infoSheet.addRow(['發放日期', '民國年或西元年格式皆可', '113/08/20', '否']);
    infoSheet.addRow(['狀態', '待發放、已發放 或 充公（留空視為待發放）', '待發放', '否']);
    infoSheet.addRow(['充公原因', '狀態為「充公」時填寫', '', '否']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['注意事項：']);
    infoSheet.addRow(['1. 日期格式請使用民國年格式，例如：113/07/10（西元2024年7月10日）']);
    infoSheet.addRow(['2. 金額欄位請填入數字，不需包含千分位符號']);
    infoSheet.addRow(['3. 狀態欄位可填入「未結案」、「已結案」或「取消」，其餘值一律視為「未結案」']);
    infoSheet.addRow([`4. 類型欄位必須與系統「專案類型管理」中啟用的名稱完全一致：${typeListStr}`]);
    infoSheet.addRow(['5. 新客戶欄位只能填入「新客戶」或「舊客戶」']);
    infoSheet.addRow(['6. 如果有多筆發票或收款，請在下一列填入，專案編號等主資訊欄位需重複填入']);
    infoSheet.addRow(['7. 標示「匯出計算欄位，匯入時忽略」的欄位填入任何值均無效，系統不會讀取']);
    infoSheet.addRow([`8. 獎金請填在「${BONUS_SHEET_NAME}」工作表，同一專案可有多筆、任意獎金類型；重複匯入同一份檔案時，內容完全相同的獎金會自動略過`]);
    infoSheet.addRow([`9. 獎金類型需為系統「獎金類型管理」中啟用的名稱：${bonusTypeListStr}`]);
    infoSheet.addRow([`10. 成本請填在「${COST_SHEET_NAME}」工作表（欄位與用法見「成本明細匯入範本」）；匯入時會在專案處理完成後依專案編號對應`]);

    // 設定說明工作表樣式（兩段表頭）
    infoSheet.eachRow((row) => {
      if (row.getCell(1).value === '欄位名稱') {
        row.font = { bold: true };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
      }
    });

    infoSheet.getColumn(1).width = 34;
    infoSheet.getColumn(2).width = 50;
    infoSheet.getColumn(3).width = 20;
    infoSheet.getColumn(4).width = 24;

    return workbook;
  }

  // 成本明細批次匯入範本（選項值皆取自系統目前啟用的管理清單）
  generateCostTemplate() {
    const workbook = new ExcelJS.Workbook();
    const readNames = (table, column) => {
      try {
        return db.prepare(`SELECT ${column} AS name FROM ${table} WHERE is_active = 1 ORDER BY display_order, ${column}`).all().map(r => r.name);
      } catch (e) {
        return [];
      }
    };
    const costTypes = readNames('cost_types', 'type_name');
    const categories = readNames('cost_categories', 'category_name');
    const methods = readNames('payment_methods', 'method_name');
    const terms = readNames('payment_terms', 'term_name');
    const statuses = readNames('order_statuses', 'status_name');
    const pick = (list, n) => list.length > 0 ? list[n % list.length] : '';
    const listStr = (list, manage) => list.length > 0 ? list.map(v => `「${v}」`).join('、') : `（尚未設定，請先到「${manage}」新增；不填也可以）`;

    let vendorName = '';
    try {
      const v = db.prepare(`SELECT customer_code, company_name FROM customers WHERE deleted_at IS NULL AND party_type IN ('廠商', '兩者皆是') ORDER BY id LIMIT 1`).get();
      if (v) vendorName = v.customer_code || v.company_name;
    } catch (e) { /* 忽略 */ }
    let sampleProject = { project_code: 'PJ20240706', project_type: '', customer_code: '', project_name: '' };
    try {
      const p = db.prepare(`SELECT p.project_code, p.project_type, p.project_name, c.customer_code FROM projects p LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.id DESC LIMIT 1`).get();
      if (p) sampleProject = { project_code: p.project_code, project_type: p.project_type || '', customer_code: p.customer_code || '', project_name: p.project_name || '' };
    } catch (e) { /* 忽略 */ }

    const worksheet = workbook.addWorksheet(COST_SHEET_NAME);
    worksheet.addRow(COST_HEADERS);
    worksheet.addRow([
      sampleProject.project_code, '', '', '', 'PJ-C-001', '範例成本 A', '113/09/25',
      pick(costTypes, 0), pick(categories, 0), vendorName, pick(methods, 0), pick(terms, 0), pick(statuses, 0), 8925, 0, '範例備註'
    ]);
    worksheet.addRow([
      sampleProject.project_code, '', '', '', '', '範例成本 B', '2026-03-01',
      pick(costTypes, 1), pick(categories, 1), '', '', '', '', 28245, 28000, ''
    ]);
    styleHeaderRow(worksheet);
    COST_COLUMN_WIDTHS.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

    const info = workbook.addWorksheet('填寫說明');
    info.addRow(['欄位名稱', '說明', '必填']);
    info.addRow(['專案編號', '成本所屬專案的專案編號', '是']);
    info.addRow(['類型 / 客戶編號 / 專案名稱', '同一專案編號對應到多個專案時（例如同編號不同類型或不同客戶），用這三欄指定是哪一個；只有一個專案時可留空', '否']);
    info.addRow(['進項編號', '採購/進項的唯一識別碼；有填時，同專案相同進項編號視為同一筆，重複匯入會略過', '否']);
    info.addRow(['成本名稱', '這筆成本的名稱', '是']);
    info.addRow(['成本日期', '民國年（113/09/25）或西元年（2026-09-25）皆可', '否']);
    info.addRow(['成本類型', `需為系統啟用的成本類型：${listStr(costTypes, '成本類型管理')}`, '否']);
    info.addRow(['費用類別', `需為系統啟用的費用類別：${listStr(categories, '費用類別管理')}`, '否']);
    info.addRow(['廠商', '廠商編號或公司名稱；需為系統中身份是「廠商」或「兩者皆是」的資料，找不到會整列報錯（可先用客戶/廠商批次匯入建立）', '否']);
    info.addRow(['付款辦法', `需為系統啟用的付款辦法：${listStr(methods, '付款辦法管理')}`, '否']);
    info.addRow(['付款條件', `需為系統啟用的付款條件：${listStr(terms, '付款條件管理')}`, '否']);
    info.addRow(['下單狀態', `需為系統啟用的下單狀態：${listStr(statuses, '下單狀態管理')}`, '否']);
    info.addRow(['預估金額 / 實際金額', '數字，不需千分位；留空視為 0', '否']);
    info.addRow(['備註', '自由文字', '否']);
    info.addRow(['']);
    info.addRow(['注意事項：']);
    info.addRow(['1. 成本類型、費用類別、付款辦法、付款條件、下單狀態若不在上述清單內，該列會失敗並說明原因；請先到對應的管理頁新增，或修正 Excel 後重新匯入']);
    info.addRow(['2. 有進項編號時以「專案＋進項編號」判斷重複；沒有進項編號時以「專案＋成本名稱＋日期＋預估金額＋實際金額」判斷。重複的成本會略過，不會覆蓋既有資料']);
    info.addRow(['3. 失敗的列不影響其他列，修正後可重新匯入同一份檔案（已匯入的會被視為重複略過）']);
    const infoHeader = info.getRow(1);
    infoHeader.font = { bold: true };
    infoHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    info.getColumn(1).width = 28;
    info.getColumn(2).width = 80;
    info.getColumn(3).width = 8;

    return workbook;
  }

  // 客戶活動紀錄匯出：欄位與「活動紀錄匯入範本」一致，可直接重新匯入（已軟刪除的不匯出）。
  exportActivities() {
    const rows = db.prepare(`
      SELECT c.customer_code, c.company_name, a.activity_date, a.activity_type, a.content,
             p.opportunity_name, a.created_by
      FROM activities a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN pipelines p ON p.id = a.pipeline_id
      WHERE a.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.customer_code, a.activity_date, a.id
    `).all();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('活動紀錄');
    worksheet.addRow(ACTIVITY_HEADERS);
    for (const r of rows) {
      worksheet.addRow([
        r.customer_code || '',
        r.company_name || '',
        r.activity_date ? String(r.activity_date).slice(0, 10) : '',
        r.activity_type || '',
        r.content || '',
        r.opportunity_name || '',
        r.created_by || ''
      ]);
    }
    styleHeaderRow(worksheet);
    ACTIVITY_COLUMN_WIDTHS.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
    worksheet.getColumn('A').numFmt = '@';
    return workbook;
  }

  // 銷售機會匯出：pipelines 為 Pipeline.findAll 的結果（已排除軟刪除，含客戶/業務/負責人名稱）。
  // 另外補上已轉換專案的編號與活動紀錄筆數；日期欄位統一輸出西元格式。
  exportPipelines(pipelines, filterLabel = '') {
    const projectCodeById = {};
    const activityCountById = {};
    try {
      db.prepare('SELECT id, project_code FROM projects').all().forEach(p => { projectCodeById[p.id] = p.project_code; });
      db.prepare('SELECT pipeline_id, COUNT(*) AS c FROM activities WHERE pipeline_id IS NOT NULL AND deleted_at IS NULL GROUP BY pipeline_id')
        .all().forEach(a => { activityCountById[a.pipeline_id] = a.c; });
    } catch (e) { /* 資料表不存在時略過 */ }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(filterLabel ? `銷售機會-${filterLabel}` : '銷售機會');
    worksheet.addRow(PIPELINE_HEADERS);
    for (const p of pipelines) {
      worksheet.addRow([
        p.customer_code || '',
        p.customer_name || '',
        p.opportunity_name || '',
        p.project_type || '',
        p.estimated_amount !== null && p.estimated_amount !== undefined ? Math.round(p.estimated_amount) : '',
        p.win_probability !== null && p.win_probability !== undefined ? p.win_probability : '',
        p.expected_close_year_month || '',
        p.status || '',
        p.lost_reason || '',
        p.salesperson_name || '',
        p.owner_user_name || '',
        p.converted_project_id ? (projectCodeById[p.converted_project_id] || '') : '',
        p.converted_at ? String(p.converted_at).slice(0, 10) : '',
        activityCountById[p.id] || 0,
        p.notes || '',
        p.created_at ? String(p.created_at).slice(0, 10) : '',
        p.updated_at ? String(p.updated_at).slice(0, 10) : ''
      ]);
    }
    styleHeaderRow(worksheet);
    PIPELINE_COLUMN_WIDTHS.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
    worksheet.getColumn('A').numFmt = '@';
    return workbook;
  }

  // 業務績效匯出：與業務績效儀表板同一份彙總資料（SalesPerformanceService），加上合計列、
  // 銷售機會總覽，以及依專案類型（取自實際資料，不寫死類型名稱）拆分的業績金額。
  exportSalesPerformance(year = null) {
    const SalesPerformanceService = require('./SalesPerformanceService');
    const Salesperson = require('../models/Salesperson');
    const performance = SalesPerformanceService.getPerformanceBySalesperson(year);
    const pipelineSummary = SalesPerformanceService.getPipelineSummary();
    const yearLabel = year ? `${year}年度` : '全部年度';
    const suffix = year ? `-${year}` : '-全部';

    const workbook = new ExcelJS.Workbook();

    // 1. 業務績效彙總（欄位與儀表板一致）
    const ws = workbook.addWorksheet(`業務績效${suffix}`);
    ws.addRow(SALES_PERFORMANCE_HEADERS);
    const totals = { project_count: 0, total_price: 0, total_invoiced: 0, uninvoiced_amount: 0, total_received: 0, total_unpaid: 0, total_bonus: 0, paid_bonus: 0, pending_bonus: 0, pipeline_count: 0, pipeline_amount: 0 };
    for (const p of performance) {
      Object.keys(totals).forEach(k => { totals[k] += p[k] || 0; });
      ws.addRow([
        p.name, p.project_count || 0,
        formatCurrency(p.total_price || 0), formatCurrency(p.total_invoiced || 0), formatCurrency(p.uninvoiced_amount || 0),
        formatCurrency(p.total_received || 0), formatCurrency(p.total_unpaid || 0),
        formatCurrency(p.total_bonus || 0), formatCurrency(p.paid_bonus || 0), formatCurrency(p.pending_bonus || 0),
        p.pipeline_count || 0, formatCurrency(p.pipeline_amount || 0)
      ]);
    }
    const totalRow = ws.addRow([
      '合計', totals.project_count,
      formatCurrency(totals.total_price), formatCurrency(totals.total_invoiced), formatCurrency(totals.uninvoiced_amount),
      formatCurrency(totals.total_received), formatCurrency(totals.total_unpaid),
      formatCurrency(totals.total_bonus), formatCurrency(totals.paid_bonus), formatCurrency(totals.pending_bonus),
      totals.pipeline_count, formatCurrency(totals.pipeline_amount)
    ]);
    totalRow.font = { bold: true };
    styleHeaderRow(ws);
    [14, 8, 14, 14, 14, 14, 14, 14, 14, 14, 12, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // 2. 依專案類型拆分的專案金額（含稅）
    const typeAmounts = Salesperson.getTypeAmounts(year);
    const typeNames = [...new Set(Object.values(typeAmounts).flatMap(m => Object.keys(m)))].sort((a, b) => a.localeCompare(b, 'zh-TW'));
    const wsType = workbook.addWorksheet(`依專案類型${suffix}`);
    wsType.addRow(['業務', ...typeNames, '合計']);
    for (const p of performance) {
      const m = typeAmounts[p.id] || {};
      const amounts = typeNames.map(n => formatCurrency(m[n] || 0));
      wsType.addRow([p.name, ...amounts, formatCurrency(typeNames.reduce((sum, n) => sum + (m[n] || 0), 0))]);
    }
    styleHeaderRow(wsType);
    wsType.getColumn(1).width = 14;
    for (let i = 0; i <= typeNames.length; i++) wsType.getColumn(i + 2).width = 16;

    // 3. 銷售機會總覽
    const wsPipe = workbook.addWorksheet('銷售機會總覽');
    wsPipe.addRow(['項目', '筆數', '預估金額']);
    wsPipe.addRow(['洽談中（全公司，不分年度）', pipelineSummary.open_count, formatCurrency(pipelineSummary.open_amount)]);
    wsPipe.addRow(['已成交但尚未轉入專案', pipelineSummary.won_pending_count, formatCurrency(pipelineSummary.won_pending_amount)]);
    styleHeaderRow(wsPipe);
    [30, 10, 16].forEach((w, i) => { wsPipe.getColumn(i + 1).width = w; });

    ws.insertRow(1, [`業務績效（${yearLabel}）`]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    ws.getRow(2).alignment = { vertical: 'middle', horizontal: 'center' };
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    return workbook;
  }

  // 客戶活動紀錄批次匯入範本（管理者專用）
  generateActivityTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('活動紀錄');

    worksheet.addRow(ACTIVITY_HEADERS);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    let activeTypes = [];
    try {
      activeTypes = db.prepare('SELECT type_name FROM activity_types WHERE is_active = 1 ORDER BY display_order, type_name').all().map(r => r.type_name);
    } catch { /* activity_types 表不存在時保持空陣列 */ }
    const firstType = activeTypes[0] || '拜訪';

    worksheet.addRow(['CU001', 'XX股份有限公司', '2026-03-01', firstType, '拜訪客戶討論明年度合作方案', '', '王小明']);
    worksheet.addRow(['', 'YY企業有限公司', '115/03/05', firstType, '電話追蹤報價進度', 'YY年度專案', '']);

    ACTIVITY_COLUMN_WIDTHS.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    const typeListStr = activeTypes.length ? activeTypes.map(t => `「${t}」`).join('、') : '（目前尚未設定任何活動類型，匯入時會依 Excel 內容自動建立）';

    const infoSheet = workbook.addWorksheet('填寫說明');
    infoSheet.addRow(['欄位說明']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['欄位名稱', '說明', '範例', '必填']);
    infoSheet.addRow(['客戶編號', '優先用客戶編號對應客戶；沒填才用公司名稱', 'CU001', '擇一']);
    infoSheet.addRow(['公司名稱', '需與系統內客戶名稱完全一致，且只能對應到一位客戶', 'XX股份有限公司', '擇一']);
    infoSheet.addRow(['活動日期', '可填 Excel 日期、2026-03-01、2026/3/1 或民國年 115/03/01', '2026-03-01', '是']);
    infoSheet.addRow(['活動類型', `目前可用：${typeListStr}。填入系統沒有的類型會自動新增；留空視為「其他」`, firstType, '否']);
    infoSheet.addRow(['活動內容', '活動紀錄的文字內容', '拜訪客戶討論明年度合作方案', '是']);
    infoSheet.addRow(['關聯銷售機會', '填該客戶底下的銷售機會名稱（需完全一致），找不到時仍會匯入但不會關聯', 'YY年度專案', '否']);
    infoSheet.addRow(['記錄人', '原本記錄這筆活動的人，留空則記為執行匯入的人', '王小明', '否']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['注意事項：']);
    infoSheet.addRow(['1. 同一客戶、同日期、同類型、同內容的紀錄若已存在，會自動略過，可以放心重複匯入；若該紀錄原本沒有關聯銷售機會、這次有填「關聯銷售機會」，會補上關聯（已有關聯的不會被改動）']);
    infoSheet.addRow(['2. 請刪除範本內的兩列範例資料，再填入您的資料']);
    infoSheet.addRow(['3. 這份匯入僅供管理者使用']);

    const infoHeaderRow = infoSheet.getRow(3);
    infoHeaderRow.font = { bold: true };
    infoHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    infoSheet.getColumn(1).width = 16;
    infoSheet.getColumn(2).width = 70;
    infoSheet.getColumn(3).width = 28;
    infoSheet.getColumn(4).width = 8;

    return workbook;
  }

  // 客戶/廠商資料匯出：欄位與「客戶/廠商批次匯入範本」一致，可直接重新匯入。
  // customers 為 Customer.findAll/search 的結果（已排除軟刪除、含 owner_salesperson_name）。
  // 內含銀行帳號等敏感資料，呼叫端必須限制為管理者。
  exportCustomers(customers) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('客戶廠商總表');
    worksheet.addRow(CUSTOMER_HEADERS);
    for (const c of customers) {
      worksheet.addRow([
        c.customer_code || '',
        c.tax_id || '',
        c.company_name || '',
        c.party_type || '客戶',
        c.vendor_type || '',
        c.customer_level || '',
        c.industry || '',
        c.status || '',
        c.is_new_customer ? '新客戶' : '舊客戶',
        c.owner_salesperson_name || '',
        c.contact_name || '',
        c.contact_phone || '',
        c.contact_email || '',
        c.bank_name || '',
        c.bank_account || '',
        c.address || ''
      ]);
    }
    styleHeaderRow(worksheet);
    CUSTOMER_COLUMN_WIDTHS.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
    // 統編、客戶編號、銀行帳號等長數字當文字存放，避免 Excel 開啟時轉成科學記號或掉前導零
    ['A', 'B', 'L', 'O'].forEach(col => { worksheet.getColumn(col).numFmt = '@'; });
    return workbook;
  }

  // 客戶/廠商批次匯入範本（管理者專用），欄位對應 Customer.create() 支援的欄位
  generateCustomerTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('客戶廠商總表');

    const headers = CUSTOMER_HEADERS;

    const exampleRow1 = [
      'CU001', '12345678', 'XX股份有限公司', '客戶', '',
      '', '', '', '新客戶', '王小明',
      '陳小華', '02-12345678', 'test@example.com', '', '', '台北市信義區'
    ];
    const exampleRow2 = [
      'VD001', '87654321', 'YY企業有限公司', '廠商', '公司',
      '', '', '', '', '',
      '林小明', '', '', '玉山銀行', '1234567890123', ''
    ];

    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.addRow(exampleRow1);
    worksheet.addRow(exampleRow2);

    CUSTOMER_COLUMN_WIDTHS.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // 動態撈目前啟用的客戶等級/往來狀態選項，避免範本寫死其他公司安裝已改掉的選項
    let activeLevels = [];
    let activeStatuses = [];
    try {
      activeLevels = db.prepare('SELECT level_name FROM customer_levels WHERE is_active = 1 ORDER BY display_order, level_name').all().map(r => r.level_name);
    } catch { /* customer_levels 表不存在或尚無資料時保持空陣列 */ }
    try {
      activeStatuses = db.prepare('SELECT status_name FROM customer_statuses WHERE is_active = 1 ORDER BY display_order, status_name').all().map(r => r.status_name);
    } catch { /* customer_statuses 表不存在或尚無資料時保持空陣列 */ }
    const levelListStr = activeLevels.length ? activeLevels.map(l => `「${l}」`).join('、') : '（目前尚未設定任何客戶等級，留空即可，或先至「客戶等級管理」新增）';
    const statusListStr = activeStatuses.length ? activeStatuses.map(s => `「${s}」`).join('、') : '（目前尚未設定，留空則使用系統預設值）';

    const infoSheet = workbook.addWorksheet('填寫說明');
    infoSheet.addRow(['欄位說明']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['欄位名稱', '說明', '範例', '必填']);
    infoSheet.addRow(['客戶編號', '客戶/廠商唯一代碼，不可與既有資料重複', 'CU001', '是']);
    infoSheet.addRow(['統一編號', '8碼統編', '12345678', '否']);
    infoSheet.addRow(['公司名稱', '客戶/廠商全名', 'XX股份有限公司', '是']);
    infoSheet.addRow(['客戶/廠商類型', '客戶 或 廠商 或 兩者皆是（留空視為「客戶」）', '客戶', '否']);
    infoSheet.addRow(['廠商類型', '個人 或 公司（僅類型為「廠商」或「兩者皆是」時有意義）', '公司', '否']);
    infoSheet.addRow(['客戶等級', levelListStr, '', '否']);
    infoSheet.addRow(['產業別', '自由文字', '批發零售', '否']);
    infoSheet.addRow(['往來狀態', statusListStr, '', '否']);
    infoSheet.addRow(['新/舊客戶', '新客戶 或 舊客戶（留空視為舊客戶）', '新客戶', '否']);
    infoSheet.addRow(['客戶關係負責人', '負責此客戶的使用者姓名，需與「使用者管理」裡的姓名完全一致，找不到只會警告、不影響這筆資料建立', '王小明', '否']);
    infoSheet.addRow(['聯絡人姓名／電話／Email', '對方窗口聯絡資訊', '', '否']);
    infoSheet.addRow(['銀行／銀行帳號', '廠商付款用', '', '否']);
    infoSheet.addRow(['地址', '自由文字', '', '否']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['注意事項：']);
    infoSheet.addRow(['1. 客戶編號、統一編號重複的資料整列會匯入失敗，其餘列不受影響']);
    infoSheet.addRow(['2. 客戶等級／往來狀態若填入系統目前沒有設定的值，整列會匯入失敗並提示到「客戶等級管理」/「客戶狀態管理」確認']);
    infoSheet.addRow(['3. 這份匯入僅供管理者使用，匯入的資料會直接建立，不會進入一般新增客戶的審核流程']);

    const infoHeaderRow = infoSheet.getRow(3);
    infoHeaderRow.font = { bold: true };
    infoHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

    infoSheet.getColumn(1).width = 25;
    infoSheet.getColumn(2).width = 45;
    infoSheet.getColumn(3).width = 20;
    infoSheet.getColumn(4).width = 10;

    return workbook;
  }

  // 將workbook寫入buffer
  async writeToBuffer(workbook) {
    const buffer = await workbook.xlsx.writeBuffer();
    // 確保返回 Node.js Buffer
    if (Buffer.isBuffer(buffer)) {
      return buffer;
    }
    // 如果是 ArrayBuffer 或其他類型，轉換為 Buffer
    return Buffer.from(buffer);
  }
}

module.exports = new ExcelExportService();
