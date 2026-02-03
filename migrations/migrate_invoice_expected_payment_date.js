const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 取得資料庫路徑
function getDbPath() {
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'invoice_bonus.db'),
    '/opt/invoice-bonus-system/data/invoice_bonus.db',
    '/opt/pbg-system/data/invoice_bonus.db'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), 'data', 'invoice_bonus.db');
}

function migrate() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，跳過 expected_payment_date 遷移');
    return;
  }

  console.log('開始執行發票預計收款日欄位遷移...');
  console.log('資料庫路徑:', dbPath);

  let db;
  try {
    db = new Database(dbPath, { readonly: false });
    console.log('✓ 資料庫已連接');

    // 檢查欄位是否已存在
    const tableInfo = db.prepare('PRAGMA table_info(invoices)').all();
    const hasExpectedPaymentDate = tableInfo.some(col => col.name === 'expected_payment_date');

    if (hasExpectedPaymentDate) {
      console.log('✓ expected_payment_date 欄位已存在，跳過遷移');
      db.close();
      return;
    }

    console.log('檢測到 invoices 表缺少 expected_payment_date 欄位，開始執行遷移...');

    db.exec(`
      ALTER TABLE invoices
      ADD COLUMN expected_payment_date TEXT
    `);

    console.log('✓ expected_payment_date 欄位已添加');

    const newTableInfo = db.prepare('PRAGMA table_info(invoices)').all();
    if (!newTableInfo.some(col => col.name === 'expected_payment_date')) {
      throw new Error('驗證失敗：expected_payment_date 欄位未成功添加');
    }
    console.log('✓ 驗證成功');

    db.close();
    console.log('✅ 發票預計收款日遷移完成');
  } catch (err) {
    if (db) db.close();
    console.error('❌ 遷移失敗:', err.message);
    throw err;
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
