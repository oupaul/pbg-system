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
    
    // 標題列
    const headers = [
      '簽約年度', '狀態', '類型', '業務', '專案月份', '新客戶',
      '專案編號', '客戶編號', '統一編號', '公司名稱', '專案名稱',
      '價格(含稅)', '發票日期', '發票號碼', '開立金額(含稅)', '未開立發票金額',
      '收款日期', '銀行存款匯入金額', '收款差異', '價格(未稅)',
      '業績認列月份', '認列業績金額(含稅)', '未認列業績金額(含稅)', '認列業績金額(未稅)',
      '獎金級距%', '食驗室/純廣獎金發放日期', '食驗室未稅(不扣成本)', '食驗室獎金(不扣成本)',
      '純廣未稅90%(扣成本10%)', '純廣獎金(扣成本10%)', '專案未稅60%(扣成本40%)',
      '專案簽約獎金發放日期', '專案簽約獎金20%', '專案結案獎金發放日期', '專案結案獎金80%',
      '開發獎金發放日期', '開發獎金', '行銷部佔比金額', '品牌部佔比金額'
    ];

    const data = [headers];

    for (const project of projects) {
      // 取得發票明細
      const invoices = db.prepare(`
        SELECT * FROM invoices WHERE project_id = ? ORDER BY invoice_date
      `).all(project.id);
      const validInvoices = invoices.filter(i => !i.status || i.status === '有效');

      // 取得收款明細
      const payments = db.prepare(`
        SELECT * FROM payments WHERE project_id = ? ORDER BY payment_date
      `).all(project.id);

      // 取得獎金明細
      const bonuses = db.prepare(`
        SELECT * FROM bonus_calculations WHERE project_id = ?
      `).all(project.id);

      // 計算彙總（僅計有效發票）
      const totalInvoiced = validInvoices.reduce((sum, i) => sum + (i.amount_with_tax || 0), 0);
      const uninvoiced = project.price_with_tax - totalInvoiced;

      // 找出各類獎金
      const labBonus = bonuses.find(b => b.bonus_type === '食驗室獎金');
      const adBonus = bonuses.find(b => b.bonus_type === '純廣獎金');
      const signBonus = bonuses.find(b => b.bonus_type === '專案簽約獎金');
      const closeBonus = bonuses.find(b => b.bonus_type === '專案結案獎金');
      const devBonus = bonuses.find(b => b.bonus_type === '開發獎金');

      // 獎金級距文字
      let bonusTierText = '';
      if (labBonus?.status === '充公' || adBonus?.status === '充公') {
        bonusTierText = labBonus?.forfeiture_reason || adBonus?.forfeiture_reason || '';
      }

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
        invoices[0] ? formatROCDate(invoices[0].invoice_date) : '',
        invoices[0]?.invoice_number || '',
        invoices[0] ? formatCurrency(invoices[0].amount_with_tax) : '',
        formatCurrency(uninvoiced),
        payments[0] ? formatROCDate(payments[0].payment_date) : '',
        payments[0] ? formatCurrency(payments[0].bank_deposit_amount) : '',
        payments[0] ? formatCurrency(payments[0].payment_difference) : '',
        formatCurrency(project.price_without_tax),
        '', // 業績認列月份
        '', // 認列業績金額(含稅)
        '', // 未認列業績金額(含稅)
        '', // 認列業績金額(未稅)
        bonusTierText,
        labBonus ? formatROCDate(labBonus.payment_date) : (adBonus ? formatROCDate(adBonus.payment_date) : ''),
        labBonus ? formatCurrency(labBonus.base_amount) : '',
        labBonus ? formatCurrency(labBonus.bonus_amount) : '',
        adBonus ? formatCurrency(adBonus.base_amount) : '',
        adBonus ? formatCurrency(adBonus.bonus_amount) : '',
        signBonus ? formatCurrency(signBonus.base_amount) : '',
        signBonus ? formatROCDate(signBonus.payment_date) : '',
        signBonus ? formatCurrency(signBonus.bonus_amount) : '',
        closeBonus ? formatROCDate(closeBonus.payment_date) : '',
        closeBonus ? formatCurrency(closeBonus.bonus_amount) : '',
        devBonus ? formatROCDate(devBonus.payment_date) : '',
        devBonus ? formatCurrency(devBonus.bonus_amount) : '',
        '', // 行銷部佔比金額
        ''  // 品牌部佔比金額
      ];

      data.push(firstRow);

      // 額外發票/收款列
      const maxRows = Math.max(invoices.length, payments.length);
      for (let i = 1; i < maxRows; i++) {
        const extraRow = new Array(39).fill('');
        extraRow[6] = project.project_code;
        extraRow[7] = project.customer_code;
        extraRow[8] = project.tax_id;
        extraRow[9] = project.company_name;
        extraRow[10] = project.project_name;

        if (invoices[i]) {
          extraRow[12] = formatROCDate(invoices[i].invoice_date);
          extraRow[13] = invoices[i].invoice_number;
          extraRow[14] = formatCurrency(invoices[i].amount_with_tax);
        }

        if (payments[i]) {
          extraRow[16] = formatROCDate(payments[i].payment_date);
          extraRow[17] = formatCurrency(payments[i].bank_deposit_amount);
          extraRow[18] = formatCurrency(payments[i].payment_difference);
        }

        data.push(extraRow);
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

  // 生成範例 Excel 檔案
  generateTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('專案總表');

    // 標題列
    const headers = [
      '簽約年度', '狀態', '類型', '業務', '專案月份', '新客戶',
      '專案編號', '客戶編號', '統一編號', '公司名稱', '專案名稱',
      '價格(含稅)', '發票日期', '發票號碼', '開立金額(含稅)', '未開立發票金額',
      '收款日期', '銀行存款匯入金額', '收款差異', '價格(未稅)',
      '業績認列月份', '認列業績金額(含稅)', '未認列業績金額(含稅)', '認列業績金額(未稅)',
      '獎金級距%', '食驗室/純廣獎金發放日期', '食驗室未稅(不扣成本)', '食驗室獎金(不扣成本)',
      '純廣未稅90%(扣成本10%)', '純廣獎金(扣成本10%)', '專案未稅60%(扣成本40%)',
      '專案簽約獎金發放日期', '專案簽約獎金20%', '專案結案獎金發放日期', '專案結案獎金80%',
      '開發獎金發放日期', '開發獎金', '行銷部佔比金額', '品牌部佔比金額'
    ];

    // 範例資料（食驗室專案）
    const exampleRow1 = [
      2024, '未結案', '食驗室', '王小明', '7月', '新客戶',
      'CU20240706', '90546191', '90546191', 'XX股份有限公司', 'XX年度食驗室',
      651000, '113/07/10', 'AB12345678', 651000, 0,
      '113/08/15', 651000, 0, 620000,
      '', '', '', '',
      '4%', '113/08/20', 620000, 24800,
      '', '', '',
      '', '', '', '',
      '', '', ''
    ];

    // 範例資料（純廣專案）
    const exampleRow2 = [
      2024, '已結案', '純廣', '李美麗', '8月', '舊客戶',
      'AD20240815', '12345678', '12345678', 'YY企業有限公司', 'YY年度廣告',
      1050000, '113/08/20', 'CD87654321', 1050000, 0,
      '113/09/10', 1050000, 0, 1000000,
      '', '', '', '',
      '5%', '113/09/25', 900000, 45000,
      '', '', '',
      '', '', '', '',
      '', '', ''
    ];

    // 範例資料（專案）
    const exampleRow3 = [
      2024, '未結案', '專案', '張三', '9月', '新客戶',
      'PR20240901', '98765432', '98765432', 'ZZ科技股份有限公司', 'ZZ年度專案',
      2000000, '113/09/15', 'EF11223344', 1000000, 1000000,
      '113/10/05', 1000000, 0, 1904762,
      '', '', '', '',
      '', '', '', '',
      '', '', '',
      '113/09/20', 228571, '113/10/30', 914286,
      '113/09/20', 50000, '', ''
    ];

    // 添加標題列
    worksheet.addRow(headers);

    // 設定標題列樣式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // 添加範例資料
    worksheet.addRow(exampleRow1);
    worksheet.addRow(exampleRow2);
    worksheet.addRow(exampleRow3);

    // 設定欄寬
    const columnWidths = [
      10, 8, 8, 10, 10, 8,
      14, 12, 12, 20, 30,
      12, 12, 14, 12, 12,
      12, 12, 10, 12,
      12, 12, 12, 12,
      10, 18, 18, 18,
      18, 18, 18,
      18, 18, 18, 18,
      12, 12, 12, 12
    ];
    
    columnWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });

    // 凍結標題列
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // 添加說明工作表
    const infoSheet = workbook.addWorksheet('填寫說明');
    infoSheet.addRow(['欄位說明']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['欄位名稱', '說明', '範例', '必填']);
    infoSheet.addRow(['簽約年度', '西元年', '2024', '是']);
    infoSheet.addRow(['狀態', '未結案 或 已結案', '未結案', '是']);
    infoSheet.addRow(['類型', '食驗室 或 純廣 或 專案', '食驗室', '是']);
    infoSheet.addRow(['業務', '業務人員姓名', '王小明', '是']);
    infoSheet.addRow(['專案月份', '數字或X月格式', '7月', '否']);
    infoSheet.addRow(['新客戶', '新客戶 或 舊客戶', '新客戶', '是']);
    infoSheet.addRow(['專案編號', '專案唯一識別碼', 'CU20240706', '是']);
    infoSheet.addRow(['客戶編號', '客戶代碼', '90546191', '是']);
    infoSheet.addRow(['統一編號', '8碼統編', '90546191', '否']);
    infoSheet.addRow(['公司名稱', '客戶全名', 'XX股份有限公司', '是']);
    infoSheet.addRow(['專案名稱', '專案說明', 'XX年度食驗室', '是']);
    infoSheet.addRow(['價格(含稅)', '合約金額（含稅）', '651000', '是']);
    infoSheet.addRow(['發票日期', '民國年格式：113/07/10', '113/07/10', '否']);
    infoSheet.addRow(['發票號碼', '發票號碼', 'AB12345678', '否']);
    infoSheet.addRow(['開立金額(含稅)', '發票金額', '651000', '否']);
    infoSheet.addRow(['未開立發票金額', '未開立發票的金額', '0', '否']);
    infoSheet.addRow(['收款日期', '民國年格式：113/08/15', '113/08/15', '否']);
    infoSheet.addRow(['銀行存款匯入金額', '實際收款金額', '651000', '否']);
    infoSheet.addRow(['收款差異', '收款差異金額', '0', '否']);
    infoSheet.addRow(['價格(未稅)', '合約金額（未稅）', '620000', '是']);
    infoSheet.addRow(['']);
    infoSheet.addRow(['注意事項：']);
    infoSheet.addRow(['1. 日期格式請使用民國年格式，例如：113/07/10（西元2024年7月10日）']);
    infoSheet.addRow(['2. 金額欄位請填入數字，不需包含千分位符號']);
    infoSheet.addRow(['3. 狀態欄位只能填入「未結案」或「已結案」']);
    infoSheet.addRow(['4. 類型欄位只能填入「食驗室」、「純廣」或「專案」']);
    infoSheet.addRow(['5. 新客戶欄位只能填入「新客戶」或「舊客戶」']);
    infoSheet.addRow(['6. 如果有多筆發票或收款，請在下一列填入，專案編號等主資訊欄位需重複填入']);

    // 設定說明工作表樣式
    const infoHeaderRow = infoSheet.getRow(3);
    infoHeaderRow.font = { bold: true };
    infoHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    infoSheet.getColumn(1).width = 25;
    infoSheet.getColumn(2).width = 40;
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
