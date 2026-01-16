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
    // 使用 better-sqlite3
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行資料庫遷移...');

  // 1. 業務人員表（必須先建立，因為 users 表有外鍵參照）
  db.exec(`
    CREATE TABLE IF NOT EXISTS salespeople (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'resigned', 'suspended')),
      resigned_date TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 salespeople 表');

  // 2. 用戶表（用於登入認證）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'salesperson', 'boss')),
      salesperson_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      last_login TEXT,
      FOREIGN KEY (salesperson_id) REFERENCES salespeople(id)
    )
  `);
  console.log('✓ 建立 users 表');

  // 檢查是否已有用戶，如果沒有則創建預設管理員
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const userCount = existingUsers.count || 0;

  if (userCount === 0) {
    // 創建預設管理員帳號：admin / admin123
    const bcrypt = require('bcrypt');
    const defaultPassword = 'admin123';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);
    
    db.prepare(`
      INSERT INTO users (username, password_hash, name, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', passwordHash, '系統管理員', 'admin', 1);
    
    console.log('✓ 創建預設管理員帳號：');
    console.log('  帳號：admin');
    console.log('  密碼：admin123');
    console.log('  ⚠️  請在首次登入後立即修改密碼！');
  }

  // 3. 客戶表
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL UNIQUE,
      tax_id TEXT,
      company_name TEXT NOT NULL,
      is_new_customer INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 customers 表');

  // 4. 專案主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_code TEXT NOT NULL,
      contract_year INTEGER NOT NULL,
      contract_month INTEGER NOT NULL,
      status TEXT DEFAULT '未結案' CHECK(status IN ('未結案', '已結案', '取消')),
      project_type TEXT NOT NULL CHECK(project_type IN ('食驗室', '純廣', '專案')),
      salesperson_id INTEGER,
      customer_id INTEGER,
      project_name TEXT NOT NULL,
      price_with_tax REAL DEFAULT 0,
      price_without_tax REAL DEFAULT 0,
      is_new_customer INTEGER DEFAULT 0,
      expected_invoice_year_month TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (salesperson_id) REFERENCES salespeople(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      UNIQUE(project_code, project_type)
    )
  `);
  console.log('✓ 建立 projects 表');

  // 5. 發票明細表
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      invoice_date TEXT,
      invoice_number TEXT,
      amount_with_tax REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  console.log('✓ 建立 invoices 表');

  // 6. 收款明細表
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      invoice_id INTEGER,
      payment_date TEXT,
      bank_deposit_amount REAL DEFAULT 0,
      payment_difference REAL DEFAULT 0,
      difference_type TEXT CHECK(difference_type IN ('匯費', '違約金', '其他', NULL)),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    )
  `);
  console.log('✓ 建立 payments 表');

  // 7. 業績認列表
  db.exec(`
    CREATE TABLE IF NOT EXISTS revenue_recognition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      recognition_month TEXT,
      amount_with_tax REAL DEFAULT 0,
      amount_without_tax REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  console.log('✓ 建立 revenue_recognition 表');

  // 8. 獎金級距設定表
  db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_type TEXT NOT NULL CHECK(project_type IN ('食驗室', '純廣', '專案')),
      tier_name TEXT NOT NULL,
      percentage REAL NOT NULL,
      cost_deduction_rate REAL DEFAULT 0,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 bonus_tiers 表');

  // 9. 獎金計算表
  db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      salesperson_id INTEGER NOT NULL,
      bonus_type TEXT NOT NULL CHECK(bonus_type IN ('食驗室獎金', '純廣獎金', '專案簽約獎金', '專案結案獎金', '開發獎金')),
      base_amount REAL DEFAULT 0,
      bonus_percentage REAL DEFAULT 0,
      bonus_amount REAL DEFAULT 0,
      payment_date TEXT,
      status TEXT DEFAULT '待發放' CHECK(status IN ('待發放', '已發放', '充公')),
      forfeiture_reason TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (salesperson_id) REFERENCES salespeople(id)
    )
  `);
  console.log('✓ 建立 bonus_calculations 表');

  // 10. 部門佔比表
  db.exec(`
    CREATE TABLE IF NOT EXISTS department_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      department TEXT NOT NULL CHECK(department IN ('行銷部', '品牌部', '其他')),
      allocation_amount REAL DEFAULT 0,
      allocation_percentage REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  console.log('✓ 建立 department_allocations 表');

  // 11. 系統日誌表
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      table_name TEXT,
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      user_info TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✓ 建立 system_logs 表');

  // 建立索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_contract_year ON projects(contract_year)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_code_type ON projects(project_code, project_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_project ON bonus_calculations(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bonus_salesperson ON bonus_calculations(salesperson_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_revenue_project ON revenue_recognition(project_id)`);
  console.log('✓ 建立索引');

  // 檢查並添加 expected_invoice_year_month 欄位（用於已存在的資料庫）
  try {
    const tableInfo = db.pragma('table_info(projects)');
    const columns = tableInfo.map(col => col.name) || [];
    
    if (!columns.includes('expected_invoice_year_month')) {
      console.log('檢測到舊資料庫，添加 expected_invoice_year_month 欄位...');
      db.exec('ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT');
      console.log('✓ 添加 expected_invoice_year_month 欄位');
    }
  } catch (err) {
    // 如果檢查失敗，忽略（可能欄位已存在）
    console.log('expected_invoice_year_month 欄位檢查/添加完成');
  }

  // 建立檢視表 - 專案總覽
  db.exec(`DROP VIEW IF EXISTS v_project_summary`);
  db.exec(`
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
  console.log('✓ 建立 v_project_summary 檢視表');

  // 建立檢視表 - 獎金總覽
  db.exec(`DROP VIEW IF EXISTS v_bonus_summary`);
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
  console.log('✓ 建立 v_bonus_summary 檢視表');

  // better-sqlite3 會自動儲存到磁碟
  db.close();
  
  console.log('\n✅ 資料庫遷移完成！');
}

migrate();
