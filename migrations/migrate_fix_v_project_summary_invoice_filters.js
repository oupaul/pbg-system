/**
 * 修正 v_project_summary 視圖：專案管理未收款篩選金額計算
 *
 * 問題：已開立發票金額重複加總、未開發票出現已折讓金額
 * 原因：視圖可能缺少 (1) 有效發票篩選 (2) 軟刪除排除 (3) 部分折讓扣除 (4) 整筆折讓排除於未開發票
 *
 * 修正後與 Invoice.getTotalByProject 邏輯一致：
 * - total_invoiced: 僅計有效且未刪除發票，認列金額 = amount_with_tax - allowance_amount
 * - total_received: 僅計未刪除收款，考慮匯費差異
 * - uninvoiced_amount: price_with_tax - total_invoiced - 整筆折讓金額（已折讓的不應顯示為未開發票）
 */
const db = require('../src/models/db');

function migrate() {
  try {
    console.log('開始修正 v_project_summary 視圖（發票作廢/折讓/軟刪除）...');

    const projectsInfo = db.prepare('PRAGMA table_info(projects)').all();
    const hasExpectedInvoice = projectsInfo.some(c => c.name === 'expected_invoice_year_month');
    const hasSalesDiscount = projectsInfo.some(c => c.name === 'sales_discount');
    const hasReportGroup = projectsInfo.some(c => c.name === 'report_group_id');

    // 有效發票認列金額（排除作廢、整筆折讓、軟刪除；部分折讓以 amount - allowance 計）
    const totalInvoicedSubquery = `(
      SELECT COALESCE(SUM(amount_with_tax - COALESCE(allowance_amount, 0)), 0)
      FROM invoices
      WHERE project_id = p.id
        AND (status IS NULL OR status = '有效')
        AND (deleted_at IS NULL)
    )`;

    // 整筆折讓金額（用於未開發票計算：已折讓的不應顯示為未開發票）
    const wholeAllowanceSubquery = `(
      SELECT COALESCE(SUM(amount_with_tax), 0)
      FROM invoices
      WHERE project_id = p.id
        AND status = '整筆折讓'
        AND (deleted_at IS NULL)
    )`;

    // 收款總額（僅計未刪除；考慮匯費差異）
    const totalReceivedSubquery = `(
      SELECT COALESCE(SUM(
        CASE
          WHEN difference_type = '匯費' THEN bank_deposit_amount + COALESCE(payment_difference, 0)
          ELSE bank_deposit_amount
        END
      ), 0)
      FROM payments
      WHERE project_id = p.id AND (deleted_at IS NULL)
    )`;

    const baseCols = `
      p.id, p.project_code, p.contract_year, p.contract_month, p.status,
      p.project_type, p.salesperson_id, sp.name as salesperson_name,
      p.customer_id, c.customer_code, c.company_name, c.tax_id,
      p.project_name, p.price_with_tax, p.price_without_tax, p.is_new_customer,
      ${hasExpectedInvoice ? 'p.expected_invoice_year_month,' : ''}
      ${hasSalesDiscount ? 'p.sales_discount,' : ''}
      ${hasReportGroup ? 'p.report_group_id,' : ''}
      p.notes, p.created_at, p.updated_at,
      COALESCE(${totalInvoicedSubquery}, 0) as total_invoiced,
      COALESCE(${totalReceivedSubquery}, 0) as total_received,
      (p.price_with_tax - COALESCE(${totalInvoicedSubquery}, 0) - COALESCE(${wholeAllowanceSubquery}, 0)) as uninvoiced_amount
    `;

    db.prepare('DROP VIEW IF EXISTS v_project_summary').run();
    db.exec(`
      CREATE VIEW v_project_summary AS
      SELECT ${baseCols}
      FROM projects p
      LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
      LEFT JOIN customers c ON p.customer_id = c.id
    `);

    console.log('✓ v_project_summary 視圖已修正');
    console.log('  - total_invoiced: 僅計有效發票，扣除部分折讓');
    console.log('  - total_received: 僅計未刪除收款，考慮匯費');
    console.log('  - uninvoiced_amount: 排除整筆折讓金額');
  } catch (err) {
    console.error('❌ 遷移失敗:', err.message);
    throw err;
  }
}

migrate();
