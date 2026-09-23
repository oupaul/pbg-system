/**
 * 發票開立申請審核權限：新增獨立的角色欄位 can_approve_invoice_request。
 *
 * 比照 migrate_customer_approval_permission.js 的做法，不做部門概念，用角色旗標
 * 代表「有審核發票開立申請的權限」，不分部門。
 *
 * 預設值：admin/user 開放（1，維持既有安裝的行為不變），其餘角色維持 0，
 * 新公司可到「角色管理」自行調整哪些角色能審核發票開立申請。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  console.log('開始執行發票開立申請審核權限欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(roles)').all();
  const hasCol = tableInfo.some(c => c.name === 'can_approve_invoice_request');

  if (!hasCol) {
    db.exec(`ALTER TABLE roles ADD COLUMN can_approve_invoice_request INTEGER DEFAULT 0 CHECK(can_approve_invoice_request IN (0, 1))`);
    console.log('✓ roles 已新增 can_approve_invoice_request 欄位（預設 0）');
  } else {
    console.log('  roles.can_approve_invoice_request 已存在，略過');
  }

  db.prepare(`UPDATE roles SET can_approve_invoice_request = 1 WHERE role_key IN ('admin', 'user')`).run();
  console.log('✓ admin/user 角色 can_approve_invoice_request 設為 1（維持既有行為不變）');

  console.log('✓ 發票開立申請審核權限欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
