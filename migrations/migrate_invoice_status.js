const db = require('../src/models/db');

/**
 * 發票作廢與折讓功能：新增 status 等欄位，並更新 v_project_summary
 * - status: 有效、作廢、整筆折讓
 * - voided_at, void_reason: 作廢/折讓日期與原因
 * - replacement_invoice_id, original_invoice_id: 作廢重開關聯
 */
function migrate() {
  try {
    console.log('開始執行發票作廢與折讓功能遷移...');

    // 1. 檢查 invoices 表是否已有 status 欄位
    const tableInfo = db.prepare("PRAGMA table_info(invoices)").all();
    const hasStatus = tableInfo.some(col => col.name === 'status');

    if (!hasStatus) {
      console.log('新增 invoices 表欄位...');
      db.exec(`
        ALTER TABLE invoices ADD COLUMN status TEXT DEFAULT '有效';
        ALTER TABLE invoices ADD COLUMN voided_at TEXT;
        ALTER TABLE invoices ADD COLUMN void_reason TEXT;
        ALTER TABLE invoices ADD COLUMN replacement_invoice_id INTEGER REFERENCES invoices(id);
        ALTER TABLE invoices ADD COLUMN original_invoice_id INTEGER REFERENCES invoices(id);
      `);
      console.log('✓ 已新增 status, voided_at, void_reason, replacement_invoice_id, original_invoice_id');
    } else {
      console.log('✓ invoices 表已包含 status 等欄位，跳過欄位新增');
    }

    // 2. 將既有發票設為「有效」
    const updated = db.prepare(`
      UPDATE invoices SET status = '有效' WHERE status IS NULL OR status = ''
    `).run();
    if (updated.changes > 0) {
      console.log(`✓ 已將 ${updated.changes} 筆既有發票設為「有效」`);
    }

    // 3. 更新 v_project_summary：total_invoiced 只計有效發票
    const viewInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary'").get();
    if (!viewInfo) {
      console.warn('⚠️  找不到 v_project_summary 視圖，跳過視圖更新');
      return;
    }

    const projectsInfo = db.prepare("PRAGMA table_info(projects)").all();
    const hasExpectedInvoiceField = projectsInfo.some(col => col.name === 'expected_invoice_year_month');
    const hasSalesDiscountField = projectsInfo.some(col => col.name === 'sales_discount');

    const validInvoiceSubquery = `(SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id AND (status IS NULL OR status = '有效'))`;

    db.prepare('DROP VIEW IF EXISTS v_project_summary').run();

    if (hasExpectedInvoiceField) {
      db.exec(`
        CREATE VIEW v_project_summary AS
        SELECT 
          p.id,
          p.project_code,
          p.contract_year,
          p.contract_month,
          p.status,
          p.project_type,
          p.salesperson_id,
          sp.name as salesperson_name,
          p.customer_id,
          c.customer_code,
          c.company_name,
          c.tax_id,
          p.project_name,
          p.price_with_tax,
          p.price_without_tax,
          p.is_new_customer,
          p.expected_invoice_year_month,
          ${hasSalesDiscountField ? 'p.sales_discount,' : ''}
          p.notes,
          p.created_at,
          p.updated_at,
          COALESCE(${validInvoiceSubquery}, 0) as total_invoiced,
          COALESCE((
            SELECT SUM(
              CASE 
                WHEN difference_type = '匯費' THEN bank_deposit_amount + COALESCE(payment_difference, 0)
                ELSE bank_deposit_amount
              END
            ) FROM payments WHERE project_id = p.id
          ), 0) as total_received,
          (p.price_with_tax - COALESCE(${validInvoiceSubquery}, 0)) as uninvoiced_amount
        FROM projects p
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        LEFT JOIN customers c ON p.customer_id = c.id
      `);
    } else {
      db.exec(`
        CREATE VIEW v_project_summary AS
        SELECT 
          p.id,
          p.project_code,
          p.contract_year,
          p.contract_month,
          p.status,
          p.project_type,
          p.salesperson_id,
          sp.name as salesperson_name,
          p.customer_id,
          c.customer_code,
          c.company_name,
          c.tax_id,
          p.project_name,
          p.price_with_tax,
          p.price_without_tax,
          p.is_new_customer,
          ${hasSalesDiscountField ? 'p.sales_discount,' : ''}
          p.notes,
          p.created_at,
          p.updated_at,
          COALESCE(${validInvoiceSubquery}, 0) as total_invoiced,
          COALESCE((
            SELECT SUM(
              CASE 
                WHEN difference_type = '匯費' THEN bank_deposit_amount + COALESCE(payment_difference, 0)
                ELSE bank_deposit_amount
              END
            ) FROM payments WHERE project_id = p.id
          ), 0) as total_received,
          (p.price_with_tax - COALESCE(${validInvoiceSubquery}, 0)) as uninvoiced_amount
        FROM projects p
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        LEFT JOIN customers c ON p.customer_id = c.id
      `);
    }

    console.log('✓ v_project_summary 視圖已更新，total_invoiced 僅計算有效發票');
    console.log('✓ 發票作廢與折讓功能遷移完成');
  } catch (err) {
    console.error('❌ 遷移失敗:', err.message);
    throw err;
  }
}

migrate();
