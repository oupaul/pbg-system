const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

// 確保資料目錄存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  let db;
  try {
    db = new Database(dbPath);
    // 注意：在執行 DROP TABLE 之前需要暫時禁用外鍵約束
    // 因為外鍵約束可能導致刪除 projects 表時影響相關資料
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行移除 project_type CHECK 約束遷移...');

  try {
    // 檢查 projects 表的 CREATE TABLE 語句
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='projects'
    `).get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️ 找不到 projects 表，跳過遷移');
      db.close();
      return;
    }

    // 檢查是否還有 CHECK 約束（只檢查 '食驗室', '純廣', '專案' 這個舊約束）
    const createTableSql = tableInfo.sql;
    const hasOldCheckConstraint = createTableSql.includes("CHECK(project_type IN ('食驗室', '純廣', '專案'))");

    if (!hasOldCheckConstraint) {
      console.log('✓ project_type CHECK 約束已不存在或已更新，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到舊的 project_type CHECK 約束，開始移除...');

    // 暫時禁用外鍵約束，避免刪除 projects 表時影響相關資料（invoices, payments 等）
    console.log('暫時禁用外鍵約束（保護相關資料）...');
    db.pragma('foreign_keys = OFF');

    // 使用事務確保資料完整性
    const transaction = db.transaction(() => {
      // 0. 先移除依賴舊表的檢視表，避免在 DROP/RENAME 期間出現缺表錯誤
      console.log('移除舊的檢視表...');
      db.exec(`DROP VIEW IF EXISTS v_project_summary`);
      db.exec(`DROP VIEW IF EXISTS v_bonus_summary`);

      // 2. 創建新表（移除 CHECK 約束，但保留 NOT NULL）
      console.log('創建新表結構（移除 CHECK 約束）...');
      
      // 檢查是否存在 sales_discount 欄位
      const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
      const hasSalesDiscount = tableInfo.some(col => col.name === 'sales_discount');
      
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_code TEXT NOT NULL,
          contract_year INTEGER NOT NULL,
          contract_month INTEGER NOT NULL,
          status TEXT DEFAULT '未結案' CHECK(status IN ('未結案', '已結案', '取消')),
          project_type TEXT NOT NULL,
          salesperson_id INTEGER,
          customer_id INTEGER,
          project_name TEXT NOT NULL,
          price_with_tax REAL DEFAULT 0,
          price_without_tax REAL DEFAULT 0,
          is_new_customer INTEGER DEFAULT 0,
          expected_invoice_year_month TEXT,
          ${hasSalesDiscount ? 'sales_discount REAL DEFAULT 0,' : ''}
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime')),
          FOREIGN KEY (salesperson_id) REFERENCES salespeople(id),
          FOREIGN KEY (customer_id) REFERENCES customers(id),
          UNIQUE(project_code, project_type, customer_id, project_name)
        )
      `);

      // 3. 複製資料
      console.log('複製資料...');
      db.exec(`
        INSERT INTO projects_new 
        SELECT * FROM projects
      `);

      // 4. 刪除舊表（外鍵約束已禁用，不會影響相關資料）
      console.log('刪除舊表...');
      db.exec(`DROP TABLE projects`);

      // 5. 重新命名新表
      console.log('重新命名表...');
      db.exec(`ALTER TABLE projects_new RENAME TO projects`);

    });

    // 執行事務
    transaction();

    // 重新啟用外鍵約束
    console.log('重新啟用外鍵約束...');
    db.pragma('foreign_keys = ON');

    // 5. 重建檢視表（需要檢查是否有 expected_invoice_year_month 欄位）
    console.log('重建檢視表...');
    
    // 檢查是否有 expected_invoice_year_month 欄位
    const columnsInfo = db.prepare(`PRAGMA table_info(projects)`).all();
    const hasExpectedInvoice = columnsInfo.some(col => col.name === 'expected_invoice_year_month');

    if (hasExpectedInvoice) {
      // 重建 v_project_summary 檢視表（包含 expected_invoice_year_month）
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
      `);
    } else {
      // 重建 v_project_summary 檢視表（不包含 expected_invoice_year_month）
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
      `);
    }

    // 重建 v_bonus_summary 檢視表
    db.exec(`
      CREATE VIEW v_bonus_summary AS
      SELECT 
        bc.id,
        bc.project_id,
        p.project_code,
        p.project_name,
        p.project_type,
        bc.salesperson_id,
        s.name as salesperson_name,
        bc.bonus_type,
        bc.base_amount,
        bc.bonus_percentage,
        bc.bonus_amount,
        bc.payment_date,
        bc.status,
        bc.forfeiture_reason
      FROM bonus_calculations bc
      JOIN projects p ON bc.project_id = p.id
      JOIN salespeople s ON bc.salesperson_id = s.id
    `);

    console.log('✓ project_type CHECK 約束移除完成');
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };

