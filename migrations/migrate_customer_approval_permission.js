/**
 * 新客戶/廠商審核權限：新增獨立的角色欄位 can_approve_customer。
 *
 * 原本 src/routes/customerApprovals.js 的 requireCustomerApprovalPermission 與
 * src/services/NotificationService.js 的 notifyCustomerApprovers 都直接寫死
 * `role === 'admin' || role === 'user'`，跟刪除審核（走 roles.can_delete 旗標）
 * 的權限來源不一致——換一家公司如果新增自訂角色，該角色永遠無法被賦予審核權限。
 *
 * 預設值：admin/user 開放（1，維持既有安裝的行為不變），其餘角色維持 0，
 * 新公司可到「角色管理」自行調整哪些角色能審核新客戶/廠商申請。
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

  console.log('開始執行新客戶/廠商審核權限欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(roles)').all();
  const hasCol = tableInfo.some(c => c.name === 'can_approve_customer');

  if (!hasCol) {
    db.exec(`ALTER TABLE roles ADD COLUMN can_approve_customer INTEGER DEFAULT 0 CHECK(can_approve_customer IN (0, 1))`);
    console.log('✓ roles 已新增 can_approve_customer 欄位（預設 0）');
  } else {
    console.log('  roles.can_approve_customer 已存在，略過');
  }

  db.prepare(`UPDATE roles SET can_approve_customer = 1 WHERE role_key IN ('admin', 'user')`).run();
  console.log('✓ admin/user 角色 can_approve_customer 設為 1（維持既有行為不變）');

  console.log('✓ 新客戶/廠商審核權限欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
