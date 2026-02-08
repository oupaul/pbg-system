/**
 * 發票與收款軟刪除：新增 deleted_at 欄位，刪除時改為標記不實際刪除，並可還原
 */
const db = require('../src/models/db');

function migrate() {
  console.log('開始發票/收款軟刪除遷移...');

  // 1. invoices 新增 deleted_at
  try {
    db.prepare('ALTER TABLE invoices ADD COLUMN deleted_at TEXT').run();
    console.log('✓ invoices 已新增 deleted_at');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
    console.log('  invoices.deleted_at 已存在，略過');
  }

  // 2. payments 新增 deleted_at
  try {
    db.prepare('ALTER TABLE payments ADD COLUMN deleted_at TEXT').run();
    console.log('✓ payments 已新增 deleted_at');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
    console.log('  payments.deleted_at 已存在，略過');
  }

  // 3. 更新 v_project_summary：總額僅計未刪除的發票與收款
  const viewRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary'").get();
  if (viewRow && viewRow.sql) {
    let sql = viewRow.sql;
    const before = sql;
    // 發票子查詢（有效發票條件）
    sql = sql.replace(
      /FROM invoices WHERE project_id = p\.id AND \(status IS NULL OR status = '有效'\)/g,
      "FROM invoices WHERE project_id = p.id AND (status IS NULL OR status = '有效') AND (deleted_at IS NULL)"
    );
    // 收款子查詢
    sql = sql.replace(
      /FROM payments WHERE project_id = p\.id(?!\s*AND\s*\(deleted_at)/g,
      'FROM payments WHERE project_id = p.id AND (deleted_at IS NULL)'
    );
    if (sql !== before) {
      db.prepare('DROP VIEW IF EXISTS v_project_summary').run();
      db.exec(sql);
      console.log('✓ v_project_summary 已更新為排除已刪除發票/收款');
    }
  } else {
    console.warn('⚠️ 未找到 v_project_summary，請手動確認視圖條件');
  }

  console.log('✓ 發票/收款軟刪除遷移完成');
}

migrate();
