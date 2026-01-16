const Database = require('better-sqlite3');
const path = require('path');

// 取得資料庫路徑
function getDbPath() {
  const isInstalled = process.cwd() === '/opt/invoice-bonus-system';
  if (isInstalled) {
    return '/opt/invoice-bonus-system/data/invoice_bonus.db';
  }
  return path.join(process.cwd(), 'data', 'invoice_bonus.db');
}

function migrate() {
  const dbPath = getDbPath();
  console.log('開始執行銷貨折讓欄位遷移...');
  console.log('資料庫路徑:', dbPath);

  let db;
  try {
    db = new Database(dbPath, { readonly: false });
    console.log('✓ 資料庫已連接');

    // 檢查欄位是否已存在
    const tableInfo = db.prepare('PRAGMA table_info(projects)').all();
    const hasSalesDiscount = tableInfo.some(col => col.name === 'sales_discount');

    if (hasSalesDiscount) {
      console.log('✓ sales_discount 欄位已存在，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到 projects 表缺少 sales_discount 欄位，開始執行遷移...');

    // 添加銷貨折讓欄位
    console.log('添加 sales_discount 欄位...');
    db.exec(`
      ALTER TABLE projects 
      ADD COLUMN sales_discount REAL DEFAULT 0
    `);

    console.log('✓ sales_discount 欄位已添加');

    // 驗證欄位是否成功添加
    const newTableInfo = db.prepare('PRAGMA table_info(projects)').all();
    const hasNewSalesDiscount = newTableInfo.some(col => col.name === 'sales_discount');

    if (hasNewSalesDiscount) {
      console.log('✓ 驗證成功：sales_discount 欄位已存在於 projects 表');
    } else {
      throw new Error('驗證失敗：sales_discount 欄位未成功添加');
    }

    // 檢查並更新 v_project_summary 視圖以包含 sales_discount 欄位
    try {
      const viewInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary'").get();
      if (viewInfo && viewInfo.sql) {
        const viewSql = viewInfo.sql;
        // 檢查視圖是否已包含 sales_discount
        if (!viewSql.includes('sales_discount')) {
          console.log('更新 v_project_summary 視圖以包含 sales_discount 欄位...');
          
          // 檢查視圖是否包含 expected_invoice_year_month 以決定更新策略
          const hasExpectedInvoice = viewSql.includes('expected_invoice_year_month');
          
          // 重建視圖（添加 sales_discount 欄位）
          let newViewSql = `
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
              p.sales_discount,
              p.is_new_customer,
          `;
          
          if (hasExpectedInvoice) {
            newViewSql += `
              p.expected_invoice_year_month,
            `;
          }
          
          newViewSql += `
              p.notes,
              p.created_at,
              p.updated_at,
              COALESCE(SUM(i.amount_with_tax), 0) as total_invoiced,
              COALESCE(SUM(pay.bank_deposit_amount), 0) as total_received,
              (p.price_with_tax - COALESCE(SUM(i.amount_with_tax), 0)) as uninvoiced_amount
            FROM projects p
            LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
            LEFT JOIN customers c ON p.customer_id = c.id
            LEFT JOIN invoices i ON p.id = i.project_id
            LEFT JOIN payments pay ON p.id = pay.project_id
            GROUP BY p.id
          `;
          
          db.exec('DROP VIEW IF EXISTS v_project_summary');
          db.exec(newViewSql);
          console.log('✓ v_project_summary 視圖已更新');
        } else {
          console.log('✓ v_project_summary 視圖已包含 sales_discount 欄位');
        }
      } else {
        console.log('⚠️  找不到 v_project_summary 視圖，跳過視圖更新');
      }
    } catch (viewError) {
      console.warn('⚠️  更新 v_project_summary 視圖時發生錯誤:', viewError.message);
      console.warn('視圖更新失敗不會影響資料庫欄位添加，視圖可在下次遷移時重建');
    }

    console.log('✓ 銷貨折讓欄位遷移完成');
    db.close();
  } catch (error) {
    console.error('✗ 遷移失敗:', error.message);
    console.error('錯誤堆疊:', error.stack);
    if (db) {
      db.close();
    }
    process.exit(1);
  }
}

// 執行遷移
if (require.main === module) {
  migrate();
}

module.exports = { migrate };

