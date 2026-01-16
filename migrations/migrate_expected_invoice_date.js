const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

/**
 * 資料庫遷移：為 projects 表添加「業務預計開立發票年月」欄位
 * 
 * 新增欄位：
 * - expected_invoice_year_month: 業務預計開立發票的年月（格式：YYYY-MM）
 */
async function migrate() {
  const SQL = await initSqlJs();
  
  if (!fs.existsSync(dbPath)) {
    console.error('❌ 資料庫檔案不存在，請先執行 migrate.js');
    process.exit(1);
  }

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  console.log('開始執行資料庫遷移：添加業務預計開立發票年月欄位...');

  try {
    // 檢查欄位是否已存在
    const tableInfo = db.exec("PRAGMA table_info(projects)");
    const columns = tableInfo[0]?.values.map(col => col[1]) || [];
    
    if (columns.includes('expected_invoice_year_month')) {
      console.log('⚠️  欄位 expected_invoice_year_month 已存在，跳過遷移');
      db.close();
      return;
    }

    // 添加新欄位
    db.run(`
      ALTER TABLE projects 
      ADD COLUMN expected_invoice_year_month TEXT
    `);
    console.log('✓ 添加欄位 expected_invoice_year_month');

    // 更新 v_project_summary 視圖以包含新欄位
    db.run(`DROP VIEW IF EXISTS v_project_summary`);
    db.run(`
      CREATE VIEW v_project_summary AS
      SELECT 
        p.id,
        p.project_code,
        p.contract_year,
        p.contract_month,
        p.status,
        p.project_type,
        p.project_name,
        p.price_with_tax,
        p.price_without_tax,
        p.is_new_customer,
        p.salesperson_id,
        p.customer_id,
        p.expected_invoice_year_month,
        p.notes,
        p.created_at,
        p.updated_at,
        s.name as salesperson_name,
        s.status as salesperson_status,
        c.customer_code,
        c.tax_id,
        c.company_name,
        COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
        p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as uninvoiced_amount,
        COALESCE((SELECT SUM(bank_deposit_amount) FROM payments WHERE project_id = p.id), 0) as total_received
      FROM projects p
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN customers c ON p.customer_id = c.id
    `);
    console.log('✓ 更新 v_project_summary 視圖');

    // 儲存資料庫
    const data = db.export();
    const outputBuffer = Buffer.from(data);
    fs.writeFileSync(dbPath, outputBuffer);

    db.close();
    
    console.log('✅ 遷移完成！');
    console.log('   新增欄位：expected_invoice_year_month (業務預計開立發票年月)');
    console.log('   格式：YYYY-MM (例如: 2024-12)');
  } catch (err) {
    console.error('❌ 遷移失敗:', err.message);
    db.close();
    throw err;
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  migrate().catch(console.error);
}

module.exports = migrate;

