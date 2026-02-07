/**
 * 應收帳款帳齡分析服務
 * 依發票的預計收款日計算未收款金額的帳齡分布
 */
const db = require('../models/db');
const Payment = require('../models/Payment');

const ReceivablesAgingService = {
  /**
   * 取得應收帳款帳齡分析
   * @param {number|null} year - 專案簽約年度篩選，null 為全部
   * @returns {Object} { buckets, total, details }
   */
  getAgingReport(year = null) {
    const today = new Date().toISOString().slice(0, 10);

    // 取得有效發票（僅 status = 有效）
    let invoices;
    if (year) {
      invoices = db.prepare(`
        SELECT i.*, p.project_code, p.project_name, p.salesperson_id, sp.name as salesperson_name
        FROM invoices i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        WHERE (i.status IS NULL OR i.status = '有效') AND p.contract_year = ?
        ORDER BY i.expected_payment_date, i.invoice_date
      `).all(year);
    } else {
      invoices = db.prepare(`
        SELECT i.*, p.project_code, p.project_name, p.salesperson_id, sp.name as salesperson_name
        FROM invoices i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        WHERE (i.status IS NULL OR i.status = '有效')
        ORDER BY i.expected_payment_date, i.invoice_date
      `).all();
    }

    const buckets = {
      notYetDue: { label: '未到期', amount: 0, count: 0, items: [] },
      days1_30: { label: '1-30 天', amount: 0, count: 0, items: [] },
      days31_60: { label: '31-60 天', amount: 0, count: 0, items: [] },
      days61_90: { label: '61-90 天', amount: 0, count: 0, items: [] },
      over90: { label: '90 天以上', amount: 0, count: 0, items: [] },
      noDate: { label: '未設預計日', amount: 0, count: 0, items: [] }
    };

    let totalUnpaid = 0;

    for (const inv of invoices) {
      const amount = inv.amount_with_tax || 0;

      // 計算該發票已收款金額
      const payments = db.prepare(`
        SELECT * FROM payments WHERE invoice_id = ?
      `).all(inv.id);

      const paid = payments.reduce((sum, p) => sum + Payment.calculateActualReceived(p), 0);
      const unpaid = Math.max(0, amount - paid);

      if (unpaid <= 0) continue;

      totalUnpaid += unpaid;

      const agingDate = inv.expected_payment_date || inv.invoice_date;
      const item = {
        project_id: inv.project_id,
        project_code: inv.project_code,
        project_name: inv.project_name,
        salesperson_name: inv.salesperson_name || '-',
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        amount: unpaid,
        expected_payment_date: inv.expected_payment_date,
        aging_date: agingDate
      };

      if (!agingDate) {
        buckets.noDate.amount += unpaid;
        buckets.noDate.count += 1;
        buckets.noDate.items.push(item);
      } else {
        const dueDate = new Date(agingDate);
        const todayDate = new Date(today);
        const diffMs = todayDate - dueDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          buckets.notYetDue.amount += unpaid;
          buckets.notYetDue.count += 1;
          buckets.notYetDue.items.push(item);
        } else if (diffDays <= 30) {
          buckets.days1_30.amount += unpaid;
          buckets.days1_30.count += 1;
          buckets.days1_30.items.push(item);
        } else if (diffDays <= 60) {
          buckets.days31_60.amount += unpaid;
          buckets.days31_60.count += 1;
          buckets.days31_60.items.push(item);
        } else if (diffDays <= 90) {
          buckets.days61_90.amount += unpaid;
          buckets.days61_90.count += 1;
          buckets.days61_90.items.push(item);
        } else {
          buckets.over90.amount += unpaid;
          buckets.over90.count += 1;
          buckets.over90.items.push(item);
        }
      }
    }

    return {
      buckets,
      total: totalUnpaid,
      totalCount: Object.values(buckets).reduce((s, b) => s + b.count, 0)
    };
  }
};

module.exports = ReceivablesAgingService;
