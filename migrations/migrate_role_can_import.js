/**
 * 新增角色權限旗標 can_import（批次匯入）。
 *
 * 專案總表／成本明細的 Excel 匯入原本只要有「可編輯」權限就能用，範圍太寬；
 * 改成獨立旗標，並需同時具備編輯權限。升級時只授予：
 *   - 內建的 admin（系統管理員）、user（專案管理員）
 *   - 以及「使用者管理」旗標為 1 的管理員類角色（他們原本就能匯入客戶/活動紀錄，屬於管理員等級）
 * 其他角色（含自訂的「可編輯」角色）一律不授予，需要時由管理員到角色管理頁勾選。
 *
 * 只在「剛新增欄位」的那一次設定初始值，之後重跑不會把管理員手動關閉的旗標又打開。可重複執行。
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
  if (cols.length === 0) {
    console.log('roles 資料表不存在，略過');
    db.close();
    return;
  }
  if (cols.includes('can_import')) {
    console.log('✓ roles.can_import 已存在，略過');
    db.close();
    return;
  }

  db.exec('ALTER TABLE roles ADD COLUMN can_import INTEGER DEFAULT 0');
  const granted = db.prepare(`
    UPDATE roles SET can_import = 1
    WHERE role_key IN ('admin', 'user') OR can_manage_users = 1
  `).run();
  console.log(`✓ roles.can_import 已新增，並授予 ${granted.changes} 個角色（系統管理員、專案管理員與管理員類角色）`);

  const lost = db.prepare(`
    SELECT role_key, role_name FROM roles WHERE can_edit = 1 AND can_import = 0
  `).all();
  for (const r of lost) {
    console.log(`⚠ 角色「${r.role_name}」(${r.role_key}) 有編輯權限，但升級後沒有批次匯入權限；需要的話請到「角色管理」勾選「批次匯入」`);
  }
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
