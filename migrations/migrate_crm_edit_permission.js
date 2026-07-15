/**
 * CRM 模組：新增獨立的「CRM 編輯權限」角色欄位 can_edit_crm。
 *
 * 不沿用既有的 can_edit（綁定專案/發票等財務資料編輯權限），因為業務開發
 * （客戶資料、潛在商機）理應是每位業務員的基本工作內容，不應該因為該業務員
 * 被限制「唯讀」專案而連帶無法建立/更新客戶與商機。
 *
 * 預設值：admin/user/salesperson 開放（1），boss 維持唯讀角色定位（0）。
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

  console.log('開始執行 CRM 編輯權限欄位遷移...');

  const tableInfo = db.prepare('PRAGMA table_info(roles)').all();
  const hasCol = tableInfo.some(c => c.name === 'can_edit_crm');

  if (!hasCol) {
    db.exec(`ALTER TABLE roles ADD COLUMN can_edit_crm INTEGER DEFAULT 1 CHECK(can_edit_crm IN (0, 1))`);
    console.log('✓ roles 已新增 can_edit_crm 欄位（預設 1）');
  } else {
    console.log('  roles.can_edit_crm 已存在，略過');
  }

  db.prepare(`UPDATE roles SET can_edit_crm = 0 WHERE role_key = 'boss'`).run();
  console.log('✓ boss 角色 can_edit_crm 設為 0（維持唯讀角色定位）');

  console.log('✓ CRM 編輯權限欄位遷移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
