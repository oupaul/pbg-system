/**
 * PDF 匯出服務
 * 支援專案總表、獎金報表、帳齡分析等報表匯出為 PDF
 * 注意：預設字型不支援中文，若需正確顯示中文請將支援 CJK 的字型檔
 * (如 NotoSansTC-Regular.ttf) 置於專案 fonts/ 目錄
 */
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../models/db');
const dayjs = require('dayjs');
const ReceivablesAgingService = require('./ReceivablesAgingService');
const GrossProfitAnalysisService = require('./GrossProfitAnalysisService');

// 嘗試載入中文字型（可選）
function getChineseFontPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'fonts', 'NotoSansTC-Regular.ttf'),
    path.join(__dirname, '..', '..', 'fonts', 'NotoSansCJKtc-Regular.otf')
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function applyFont(doc) {
  const fontPath = getChineseFontPath();
  if (fontPath) doc.font(fontPath);
}

function formatROCDate(dateStr) {
  if (!dateStr) return '';
  const d = dayjs(dateStr);
  if (!d.isValid()) return '';
  const rocYear = d.year() - 1911;
  return `${rocYear}/${d.format('MM/DD')}`;
}

function formatCurrency(num) {
  if (num === null || num === undefined) return '';
  return Math.round(num).toLocaleString();
}

const PdfExportService = {
  /**
   * 匯出專案總表 PDF
   */
  async exportProjectSummary(year) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      applyFont(doc);
      const projects = db.prepare(`
        SELECT p.*, s.name as salesperson_name, c.customer_code, c.company_name
        FROM projects p
        LEFT JOIN salespeople s ON p.salesperson_id = s.id
        LEFT JOIN customers c ON p.customer_id = c.id
        WHERE p.contract_year = ?
        ORDER BY p.contract_month, p.project_code
      `).all(year);

      doc.fontSize(14).text(`專案總表 - ${year} 年度`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(8);

      const headers = ['專案編號', '專案名稱', '客戶', '業務', '類型', '價格', '已開發票', '已收款', '未收款'];
      const colWidths = [65, 170, 150, 50, 45, 55, 55, 55, 55];
      const cellPadding = 4;
      const rowHeight = 30;
      let y = doc.y;

      // 標題列
      let x = 40;
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], rowHeight).fillAndStroke('#e9ecef', '#333');
        doc.fillColor('#000').text(h, x + cellPadding, y + 5, { width: colWidths[i] - cellPadding * 2, align: 'left' });
        x += colWidths[i];
      });
      y += rowHeight;

      for (const p of projects) {
        const invoices = db.prepare('SELECT * FROM invoices WHERE project_id = ?').all(p.id);
        const validInvoices = invoices.filter(i => !i.status || i.status === '有效');
        const totalInvoiced = validInvoices.reduce((s, i) => s + (i.amount_with_tax || 0), 0);
        const payments = db.prepare('SELECT * FROM payments WHERE project_id = ?').all(p.id);
        const totalReceived = payments.reduce((s, pm) => s + (pm.bank_deposit_amount || 0), 0);
        const unpaid = Math.max(0, totalInvoiced - totalReceived - (p.sales_discount || 0));

        if (y > 500) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
          y = 40;
        }

        x = 40;
        const rowData = [
          (p.project_code || '').substring(0, 12),
          (p.project_name || '').substring(0, 25),
          (p.company_name || '').substring(0, 22),
          (p.salesperson_name || '').substring(0, 10),
          (p.project_type || '').substring(0, 8),
          formatCurrency(p.price_with_tax),
          formatCurrency(totalInvoiced),
          formatCurrency(totalReceived),
          formatCurrency(unpaid)
        ];
        rowData.forEach((val, i) => {
          doc.rect(x, y, colWidths[i], rowHeight).stroke();
          doc.text(String(val || ''), x + cellPadding, y + 4, { width: colWidths[i] - cellPadding * 2 });
          x += colWidths[i];
        });
        y += rowHeight;
      }

      doc.text(`共 ${projects.length} 筆專案`, 40, y + 10);
      doc.end();
    });
  },

  /**
   * 匯出獎金報表 PDF
   */
  async exportBonusReport(year) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      applyFont(doc);
      const bonuses = db.prepare(`
        SELECT b.*, p.project_code, p.project_name, p.project_type, s.name as salesperson_name
        FROM bonus_calculations b
        JOIN projects p ON b.project_id = p.id
        JOIN salespeople s ON b.salesperson_id = s.id
        WHERE p.contract_year = ?
        ORDER BY s.name, b.bonus_type, p.project_code
      `).all(year);

      doc.fontSize(14).text(`獎金報表 - ${year} 年度`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(8);

      const headers = ['業務', '專案編號', '專案名稱', '類型', '獎金類型', '金額', '發放日', '狀態'];
      const colWidths = [45, 65, 170, 45, 60, 50, 55, 40];
      const cellPadding = 4;
      const rowHeight = 30;
      let y = doc.y;

      let x = 40;
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], rowHeight).fillAndStroke('#e9ecef', '#333');
        doc.fillColor('#000').text(h, x + cellPadding, y + 5, { width: colWidths[i] - cellPadding * 2 });
        x += colWidths[i];
      });
      y += rowHeight;

      for (const b of bonuses) {
        if (y > 720) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 40;
        }
        x = 40;
        const rowData = [
          (b.salesperson_name || '').substring(0, 12),
          (b.project_code || '').substring(0, 18),
          (b.project_name || '').substring(0, 40),
          (b.project_type || '').substring(0, 10),
          (b.bonus_type || '').substring(0, 12),
          formatCurrency(b.bonus_amount),
          formatROCDate(b.payment_date),
          (b.status || '').substring(0, 8)
        ];
        rowData.forEach((val, i) => {
          doc.rect(x, y, colWidths[i], rowHeight).stroke();
          doc.text(String(val || ''), x + cellPadding, y + 4, { width: colWidths[i] - cellPadding * 2 });
          x += colWidths[i];
        });
        y += rowHeight;
      }

      doc.text(`共 ${bonuses.length} 筆獎金記錄`, 40, y + 10);
      doc.end();
    });
  },

  /**
   * 匯出帳齡分析 PDF
   */
  async exportReceivablesAging(year) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      applyFont(doc);
      const aging = ReceivablesAgingService.getAgingReport(year || null);

      const title = year ? `應收帳款帳齡分析 - ${year} 年度` : '應收帳款帳齡分析 - 全部';
      doc.fontSize(14).text(title, { align: 'center' });
      doc.moveDown(0.5);

      // 帳齡區塊彙總
      const bucketLabels = [
        { key: 'notYetDue', label: '未到期' },
        { key: 'days1_30', label: '1-30 天' },
        { key: 'days31_60', label: '31-60 天' },
        { key: 'days61_90', label: '61-90 天' },
        { key: 'over90', label: '90 天以上' },
        { key: 'noDate', label: '未設預計日' }
      ];

      doc.fontSize(10).text(`總未收款：$${formatCurrency(aging.total)} (${aging.totalCount} 筆)`, { align: 'left' });
      doc.moveDown(0.3);

      bucketLabels.forEach(({ key, label }) => {
        const b = aging.buckets[key];
        if (b && b.amount > 0) {
          doc.text(`${label}: $${formatCurrency(b.amount)} (${b.count} 筆)`, { indent: 20 });
        }
      });
      doc.moveDown(1);

      // 明細表格
      doc.fontSize(8);
      const headers = ['帳齡', '專案編號', '專案名稱', '發票號碼', '業務', '未收金額', '預計收款日'];
      const colWidths = [55, 65, 170, 70, 55, 55, 55];
      const cellPadding = 4;
      const rowHeight = 30;
      let y = doc.y;

      let x = 40;
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], rowHeight).fillAndStroke('#e9ecef', '#333');
        doc.fillColor('#000').text(h, x + cellPadding, y + 5, { width: colWidths[i] - cellPadding * 2 });
        x += colWidths[i];
      });
      y += rowHeight;

      const allItems = bucketLabels.flatMap(({ key }) => {
        const b = aging.buckets[key];
        return (b?.items || []).map(item => ({ ...item, bucketLabel: aging.buckets[key].label }));
      });

      for (const item of allItems) {
        if (y > 700) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 40;
        }
        x = 40;
        const rowData = [
          item.bucketLabel || '',
          (item.project_code || '').substring(0, 18),
          (item.project_name || '').substring(0, 35),
          (item.invoice_number || '-').substring(0, 18),
          (item.salesperson_name || '-').substring(0, 12),
          formatCurrency(item.amount),
          item.expected_payment_date ? formatROCDate(item.expected_payment_date) : '-'
        ];
        rowData.forEach((val, i) => {
          doc.rect(x, y, colWidths[i], rowHeight).stroke();
          doc.text(String(val || ''), x + cellPadding, y + 4, { width: colWidths[i] - cellPadding * 2 });
          x += colWidths[i];
        });
        y += rowHeight;
      }

      if (allItems.length === 0) {
        doc.text('尚無未收款發票', 40, y + 5);
      }

      doc.end();
    });
  },

  /**
   * 匯出毛利分析 PDF（專案明細為主）
   */
  async exportGrossProfit(year, user = null, statusFilter = null) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      applyFont(doc);
      const byProject = GrossProfitAnalysisService.getAnalysisByProject(year, user, statusFilter);
      const totals = {
        revenue: byProject.reduce((s, r) => s + (r.revenue || 0), 0),
        cost: byProject.reduce((s, r) => s + (r.total_cost || 0), 0),
        grossProfit: byProject.reduce((s, r) => s + (r.gross_profit || 0), 0)
      };
      const grossMarginPct = totals.revenue > 0
        ? Math.round((totals.grossProfit / totals.revenue) * 1000) / 10
        : 0;

      const statusSuffix = statusFilter === '未結案' ? '（未結案）' : statusFilter === '已結案' ? '（已結案）' : '';
      const title = (year ? `專案毛利分析 - ${year} 年度` : '專案毛利分析 - 全部') + statusSuffix;
      doc.fontSize(14).text(title, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`總收入：$${formatCurrency(totals.revenue)}　總成本：$${formatCurrency(totals.cost)}　總毛利：$${formatCurrency(totals.grossProfit)}　平均毛利率：${grossMarginPct}%`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(8);

      const cellPadding = 4;
      const groupRowHeight = 28;
      const projectRowHeight = 40;  // 專案明細列高加高，以容納專案名稱換行
      let y = doc.y;

      // 依群組彙總表（放在專案明細上面）
      const byGroup = GrossProfitAnalysisService.getAnalysisByReportGroup(year, user, statusFilter);
      if (byGroup && byGroup.length > 0) {
        doc.fontSize(10).text('依群組彙總', 40, y);
        y += 22;
        const groupHeaders = ['報表群組', '專案數', '總收入', '總成本', '總毛利', '毛利率%'];
        const groupColWidths = [130, 50, 95, 95, 95, 62];
        let gx = 40;
        groupHeaders.forEach((h, i) => {
          doc.rect(gx, y, groupColWidths[i], groupRowHeight).fillAndStroke('#e9ecef', '#333');
          doc.fillColor('#000').text(h, gx + cellPadding, y + 5, { width: groupColWidths[i] - cellPadding * 2 });
          gx += groupColWidths[i];
        });
        y += groupRowHeight;
        for (const r of byGroup) {
          if (y > 500) {
            doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
            y = 40;
          }
          gx = 40;
          const rowData = [
            (r.report_group_name || '未分群').substring(0, 22),
            r.project_count || 0,
            formatCurrency(r.total_revenue),
            formatCurrency(r.total_cost),
            formatCurrency(r.gross_profit),
            (r.gross_margin_pct != null ? r.gross_margin_pct + '%' : '')
          ];
          rowData.forEach((val, i) => {
            doc.rect(gx, y, groupColWidths[i], groupRowHeight).stroke();
            doc.text(String(val || ''), gx + cellPadding, y + 4, { width: groupColWidths[i] - cellPadding * 2 });
            gx += groupColWidths[i];
          });
          y += groupRowHeight;
        }
        doc.moveDown(1);
        y = doc.y;
      }

      // 專案明細表（A4 橫向約 762pt 可用，欄寬以數值完整顯示為優先）
      const headers = ['專案編號', '專案名稱', '年度', '類型', '狀態', '報表群組', '業務', '收入', '成本', '毛利', '毛利率%'];
      const colWidths = [68, 150, 32, 52, 46, 58, 50, 78, 78, 78, 62];
      let x = 40;
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], projectRowHeight).fillAndStroke('#e9ecef', '#333');
        doc.fillColor('#000').text(h, x + cellPadding, y + 5, { width: colWidths[i] - cellPadding * 2 });
        x += colWidths[i];
      });
      y += projectRowHeight;

      for (const r of byProject) {
        if (y > 500) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
          y = 40;
        }
        x = 40;
        const rowData = [
          (r.project_code || '').substring(0, 12),
          (r.project_name || '').substring(0, 22),
          r.contract_year || '',
          (r.project_type || '').substring(0, 8),
          (r.status || '').substring(0, 6),
          (r.report_group_name && r.report_group_name.trim() ? r.report_group_name : '未分群').substring(0, 12),
          (r.salesperson_name || '-').substring(0, 10),
          formatCurrency(r.revenue),
          formatCurrency(r.total_cost),
          formatCurrency(r.gross_profit),
          r.gross_margin_pct != null ? r.gross_margin_pct + '%' : ''
        ];
        rowData.forEach((val, i) => {
          doc.rect(x, y, colWidths[i], projectRowHeight).stroke();
          doc.text(String(val || ''), x + cellPadding, y + 4, { width: colWidths[i] - cellPadding * 2 });
          x += colWidths[i];
        });
        y += projectRowHeight;
      }

      doc.text(`共 ${byProject.length} 筆專案`, 40, y + 10);
      doc.end();
    });
  }
};

module.exports = PdfExportService;
