/**
 * 角色旗標 can_manage_roles / can_manage_settings / can_backup_restore 開始被實際強制。
 *
 * 在此之前，這三個旗標只是介面上的勾選框，所有管理頁面都只看 can_manage_users。
 * 為了讓既有的管理員類角色（can_manage_users = 1，含自訂角色）在升級後行為不變，
 * 這裡把這三個旗標一併補成 1。可重複執行。
 *
 * 另外列出「沒有 can_manage_users、但這三個旗標被勾選過」的角色：
 * 這些角色以前勾了沒有效果，升級後會真的取得對應權限，請管理員確認是否符合預期。
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
  const cols = db.prepare('PRAGMA table_info(roles)').all().map(c => c.name);
  const needed = ['can_manage_users', 'can_manage_roles', 'can_manage_settings', 'can_backup_restore'];
  if (!needed.every(c => cols.includes(c))) {
    console.log('roles 資料表缺少權限旗標欄位，略過');
    db.close();
    return;
  }

  const unexpected = db.prepare(`
    SELECT role_key, role_name, can_manage_roles, can_manage_settings, can_backup_restore
    FROM roles
    WHERE can_manage_users = 0
      AND (can_manage_roles = 1 OR can_manage_settings = 1 OR can_backup_restore = 1)
  `).all();
  for (const r of unexpected) {
    console.log(`⚠ 角色「${r.role_name}」(${r.role_key}) 沒有「使用者管理」但已勾選：` +
      [r.can_manage_roles ? '角色管理' : '', r.can_manage_settings ? '系統設定' : '', r.can_backup_restore ? '備份還原' : '']
        .filter(Boolean).join('、') + '，升級後這些權限會實際生效，請確認');
  }

  const result = db.prepare(`
    UPDATE roles
    SET can_manage_roles = 1, can_manage_settings = 1, can_backup_restore = 1
    WHERE can_manage_users = 1
      AND (can_manage_roles = 0 OR can_manage_settings = 0 OR can_backup_restore = 0)
  `).run();
  console.log(`✓ 已為 ${result.changes} 個管理員類角色補齊 角色管理／系統設定／備份還原 旗標`);
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
