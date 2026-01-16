const db = require('../src/models/db');

/**
 * 更新 v_project_summary 視圖，使 total_received 考慮匯費差異
 * 當差異類型是「匯費」時，實際收款 = 銀行匯入金額 + 差異金額
 */
function migrate() {
  try {
    console.log('開始更新 v_project_summary 視圖以考慮匯費差異...');

    // 檢查視圖是否存在
    const viewInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary'").get();
    
    if (!viewInfo) {
      console.warn('⚠️  找不到 v_project_summary 視圖，跳過視圖更新');
      return;
    }

    // 檢查 projects 表是否有 expected_invoice_year_month 欄位
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    const hasExpectedInvoiceField = tableInfo.some(col => col.name === 'expected_invoice_year_month');

    // 檢查 projects 表是否有 sales_discount 欄位
    const hasSalesDiscountField = tableInfo.some(col => col.name === 'sales_discount');

    // 刪除舊視圖
    db.prepare('DROP VIEW IF EXISTS v_project_summary').run();

    if (hasExpectedInvoiceField) {
      // 重建 v_project_summary 檢視表（包含 expected_invoice_year_month 和 sales_discount）
      // 使用子查詢避免 JOIN 導致的笛卡爾積問題
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
          COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
          COALESCE((
            SELECT SUM(
              CASE 
                WHEN difference_type = '匯費' THEN bank_deposit_amount + COALESCE(payment_difference, 0)
                ELSE bank_deposit_amount
              END
            ) FROM payments WHERE project_id = p.id
          ), 0) as total_received,
          (p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0)) as uninvoiced_amount
        FROM projects p
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        LEFT JOIN customers c ON p.customer_id = c.id
      `);
    } else {
      // 重建 v_project_summary 檢視表（不包含 expected_invoice_year_month）
      // 使用子查詢避免 JOIN 導致的笛卡爾積問題
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
          COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
          COALESCE((
            SELECT SUM(
              CASE 
                WHEN difference_type = '匯費' THEN bank_deposit_amount + COALESCE(payment_difference, 0)
                ELSE bank_deposit_amount
              END
            ) FROM payments WHERE project_id = p.id
          ), 0) as total_received,
          (p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0)) as uninvoiced_amount
        FROM projects p
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        LEFT JOIN customers c ON p.customer_id = c.id
      `);
    }

    console.log('✓ v_project_summary 視圖已更新，total_received 現在會考慮匯費差異');
  } catch (err) {
    console.error('❌ 更新 v_project_summary 視圖時發生錯誤:', err.message);
    throw err;
  }
}

migrate();

