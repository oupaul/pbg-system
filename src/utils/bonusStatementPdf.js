// 獎金對帳單 PDF 版面（pdfkit，A4 橫式）。純排版：資料由呼叫端準備好（見 services/BonusStatementService.js），
// 這裡不碰資料庫，方便測試。字型需由呼叫端傳入（專案內建繁體字型，見 fonts/README.md）。
const PDFDocument = require('pdfkit');

const MARGIN = 36;
const COLUMNS = [
  { key: 'project_code', title: '專案編號', width: 88 },
  { key: 'project_name', title: '專案名稱', width: 170 },
  { key: 'customer_name', title: '客戶', width: 118 },
  { key: 'bonus_type', title: '獎金類型', width: 72 },
  { key: 'base_amount', title: '計算基礎', width: 70, align: 'right', money: true },
  { key: 'bonus_percentage', title: '比例', width: 38, align: 'right' },
  { key: 'bonus_amount', title: '獎金金額', width: 76, align: 'right', money: true },
  { key: 'payment_date', title: '發放日', width: 64, date: true },
  { key: 'note', title: '備註', width: 74 }
];
const TABLE_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0); // 770，剛好是 A4 橫式扣掉左右邊界
const PAD = 4;
const GRAY = '#64748B';
const LINE = '#CBD5E1';
const HEAD_BG = '#F1F5F9';

function moneyText(symbol, n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return symbol + v.toLocaleString('en-US');
}

/**
 * @param {Object} data
 * @param {string} data.company          公司名稱（可為空）
 * @param {string} data.salespersonName
 * @param {string} data.periodLabel
 * @param {string} data.statementId
 * @param {string} data.generatedAt      產出時間（已格式化）
 * @param {string} data.generatedBy
 * @param {Object} data.groups           { paid, pending, forfeited }（各為獎金列的陣列）
 * @param {Object} data.totals           { paid, pending, forfeited }
 * @param {Object} opts
 * @param {string} [opts.fontPath]       中文字型路徑
 * @param {string} [opts.symbol='$']
 * @param {Function} [opts.formatDate]   日期格式化（預設原樣顯示 YYYY-MM-DD 前 10 碼）
 * @returns {Promise<Buffer>}
 */
function renderStatementPdf(data, { fontPath = null, symbol = '$', formatDate = (d) => (d ? String(d).slice(0, 10) : '') } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true,
      info: { Title: `獎金對帳單 ${data.salespersonName} ${data.periodLabel}`, Author: data.company || '', Subject: `對帳單編號 ${data.statementId}` }
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (fontPath) doc.font(fontPath);

    const pageBottom = () => doc.page.height - 48;
    const ensureSpace = (needed) => {
      if (doc.y + needed > pageBottom()) { doc.addPage(); return true; }
      return false;
    };

    // ---- 標題與基本資料 ----
    if (data.company) doc.fontSize(10).fillColor(GRAY).text(data.company, MARGIN, MARGIN, { width: TABLE_WIDTH, align: 'center' });
    doc.fontSize(20).fillColor('#1E293B').text('獎金對帳單', MARGIN, doc.y + (data.company ? 2 : 0), { width: TABLE_WIDTH, align: 'center' });
    doc.moveDown(0.6);

    const infoTop = doc.y;
    const infoRows = [
      ['業務人員', data.salespersonName, '對帳單編號', data.statementId],
      ['期間', data.periodLabel, '產出時間', data.generatedAt],
      ['幣別', symbol, '產出人', data.generatedBy || '-']
    ];
    const colX = [MARGIN, MARGIN + 70, MARGIN + 400, MARGIN + 470];
    doc.fontSize(9.5);
    infoRows.forEach((r, i) => {
      const y = infoTop + i * 16;
      doc.fillColor(GRAY).text(r[0], colX[0], y, { width: 66 });
      doc.fillColor('#1E293B').text(String(r[1]), colX[1], y, { width: 320 });
      doc.fillColor(GRAY).text(r[2], colX[2], y, { width: 66 });
      doc.fillColor('#1E293B').text(String(r[3]), colX[3], y, { width: 300 });
    });
    doc.y = infoTop + infoRows.length * 16 + 8;

    // ---- 合計摘要 ----
    const sumTop = doc.y;
    const boxW = TABLE_WIDTH / 3;
    const summary = [
      ['本期已發放', data.totals.paid, data.groups.paid.length],
      ['待發放（截至產出日）', data.totals.pending, data.groups.pending.length],
      ['本期充公', data.totals.forfeited, data.groups.forfeited.length]
    ];
    summary.forEach(([label, amount, count], i) => {
      const x = MARGIN + i * boxW;
      doc.rect(x, sumTop, boxW - 6, 44).lineWidth(0.8).stroke(LINE);
      doc.fontSize(9).fillColor(GRAY).text(`${label}（${count} 筆）`, x + 8, sumTop + 6, { width: boxW - 22 });
      doc.fontSize(15).fillColor('#1E293B').text(moneyText(symbol, amount), x + 8, sumTop + 21, { width: boxW - 22 });
    });
    doc.y = sumTop + 44 + 14;

    // ---- 表格 ----
    const cellText = (col, row) => {
      if (col.key === 'note') return row.status === '充公' ? (row.forfeiture_reason || '充公') : '';
      if (col.money) return moneyText(symbol, row[col.key]);
      if (col.key === 'bonus_percentage') return row.bonus_percentage ? `${row.bonus_percentage}%` : '-';
      if (col.date) return formatDate(row.payment_date) || '-';
      return row[col.key] === null || row[col.key] === undefined ? '' : String(row[col.key]);
    };

    const drawHeaderRow = () => {
      const y = doc.y;
      const h = 20;
      doc.rect(MARGIN, y, TABLE_WIDTH, h).fill(HEAD_BG);
      let x = MARGIN;
      doc.fontSize(8.5).fillColor('#334155');
      COLUMNS.forEach(col => {
        doc.text(col.title, x + PAD, y + 6, { width: col.width - PAD * 2, align: col.align || 'left', lineBreak: false });
        x += col.width;
      });
      doc.y = y + h;
    };

    const drawSection = (title, hint, rows, totalAmount) => {
      ensureSpace(70);
      doc.fontSize(11).fillColor('#1E293B').text(title, MARGIN, doc.y);
      doc.fontSize(8).fillColor(GRAY).text(hint, MARGIN, doc.y + 1);
      doc.moveDown(0.5);
      if (rows.length === 0) {
        doc.fontSize(9).fillColor(GRAY).text('（無資料）', MARGIN + PAD, doc.y);
        doc.moveDown(1);
        return;
      }
      drawHeaderRow();
      doc.fontSize(8.5);
      for (const row of rows) {
        const cells = COLUMNS.map(col => cellText(col, row));
        const heights = cells.map((t, i) => doc.heightOfString(t, { width: COLUMNS[i].width - PAD * 2 }));
        const rowH = Math.max(18, Math.max(...heights) + PAD * 2);
        if (doc.y + rowH > pageBottom()) {
          doc.addPage();
          doc.fontSize(9).fillColor(GRAY).text(`${title}（續）`, MARGIN, doc.y);
          doc.moveDown(0.3);
          drawHeaderRow();
          doc.fontSize(8.5);
        }
        const y = doc.y;
        let x = MARGIN;
        doc.fillColor('#1E293B');
        cells.forEach((t, i) => {
          doc.text(t, x + PAD, y + PAD, { width: COLUMNS[i].width - PAD * 2, align: COLUMNS[i].align || 'left' });
          x += COLUMNS[i].width;
        });
        doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + TABLE_WIDTH, y + rowH).lineWidth(0.5).stroke(LINE);
        doc.y = y + rowH;
      }
      // 小計
      ensureSpace(24);
      const sy = doc.y;
      doc.rect(MARGIN, sy, TABLE_WIDTH, 20).fill(HEAD_BG);
      doc.fontSize(9).fillColor('#1E293B')
        .text(`小計（${rows.length} 筆）`, MARGIN + PAD, sy + 6, { width: 300, lineBreak: false });
      const amountCol = COLUMNS.findIndex(c => c.key === 'bonus_amount');
      const amountX = MARGIN + COLUMNS.slice(0, amountCol).reduce((s, c) => s + c.width, 0);
      doc.text(moneyText(symbol, totalAmount), amountX + PAD, sy + 6, { width: COLUMNS[amountCol].width - PAD * 2, align: 'right', lineBreak: false });
      doc.y = sy + 20 + 12;
    };

    drawSection('一、本期已發放', '狀態為「已發放」且發放日在上列期間內的獎金', data.groups.paid, data.totals.paid);
    drawSection('二、待發放（截至產出日）', '狀態為「待發放」的全部獎金，不受期間限制，供發放前確認', data.groups.pending, data.totals.pending);
    drawSection('三、本期充公', '狀態為「充公」且發放日（無發放日時為最後更新日）在上列期間內的獎金', data.groups.forfeited, data.totals.forfeited);

    // ---- 說明與簽核 ----
    ensureSpace(110);
    doc.fontSize(8).fillColor(GRAY)
      .text('說明：本對帳單依系統資料於產出當下計算，各筆獎金的狀態與金額以產出時間為準；如與您的紀錄有出入，請向財務確認。', MARGIN, doc.y, { width: TABLE_WIDTH });
    doc.moveDown(1.2);
    const sigY = doc.y + 12;
    const sigs = [['業務確認簽名', 0], ['日期', 1], ['財務確認簽名', 2], ['日期', 3]];
    sigs.forEach(([label, i]) => {
      const x = MARGIN + i * (TABLE_WIDTH / 4);
      doc.moveTo(x, sigY + 22).lineTo(x + TABLE_WIDTH / 4 - 24, sigY + 22).lineWidth(0.7).stroke('#94A3B8');
      doc.fontSize(8.5).fillColor(GRAY).text(label, x, sigY + 26, { width: TABLE_WIDTH / 4 - 24 });
    });

    // ---- 頁尾（需要總頁數，所以最後才寫）----
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // 頁尾寫在下邊界以內，否則 pdfkit 會因為超出邊界自動多加一頁
      doc.fontSize(8).fillColor(GRAY).text(
        `${data.statementId}　｜　第 ${i + 1} / ${range.count} 頁`,
        MARGIN, doc.page.height - 30, { width: TABLE_WIDTH, align: 'center', lineBreak: false }
      );
    }
    doc.end();
  });
}

module.exports = { renderStatementPdf, COLUMNS, TABLE_WIDTH };
