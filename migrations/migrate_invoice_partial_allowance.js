/**
 * 發票部分折讓：新增 allowance_amount 欄位
 * 有效發票認列金額 = amount_with_tax - COALESCE(allowance_amount, 0)
 */
const db = require('../src/models/db');

function migrate() {
  console.log('開始發票部分折讓遷移...');

  // 1. invoices 新增 allowance_amount
  try {
    db.prepare('ALTER TABLE invoices ADD COLUMN allowance_amount REAL DEFAULT 0').run();
    console.log('✓ invoices 已新增 allowance_amount');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
    console.log('  invoices.allowance_amount 已存在，略過');
  }

  // 2. 更新 v_project_summary：total_invoiced 改為 (amount_with_tax - COALESCE(allowance_amount,0))
  const viewRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary'").get();
  if (!viewRow || !viewRow.sql) {
    console.warn('⚠️ 未找到 v_project_summary，請手動確認視圖');
    return;
  }

  let sql = viewRow.sql;
  // 將 total_invoiced / uninvoiced 中的 SUM(amount_with_tax) 改為 SUM(amount_with_tax - COALESCE(allowance_amount, 0))
  const before = sql;
  sql = sql.replace(/SUM\s*\(\s*amount_with_tax\s*\)\s+FROM\s+invoices/g, 'SUM(amount_with_tax - COALESCE(allowance_amount, 0)) FROM invoices');
  const updated = sql !== before;

  if (updated) {
    db.prepare('DROP VIEW IF EXISTS v_project_summary').run();
    db.exec(sql);
    console.log('✓ v_project_summary 已更新為支援部分折讓認列金額');
  } else {
    console.log('  v_project_summary 未匹配預期格式，請手動更新 total_invoiced 為 SUM(amount_with_tax - COALESCE(allowance_amount,0))');
  }

  console.log('✓ 發票部分折讓遷移完成');
}

migrate();
