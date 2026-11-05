/**
 * 角色旗標 can_view_bonus（可檢視獎金）：新增欄位，預設 1。
 * 獎金金額原本沒有獨立的權限控管（專案頁的獎金分頁只看「編輯」權限，獎金管理頁任何登入者都能開），
 * 現在由這個旗標統一控制所有顯示獎金的地方。預設 1＝所有既有角色維持原本看得到的範圍，升級不改變任何人的權限；
 * 管理員之後可在「角色管理」對個別角色取消勾選。內建 admin 角色永遠看得到。可重複執行。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  try {
    const cols = db.prepare('PRAGMA table_info(roles)').all().map(c => c.name);
    if (cols.length === 0) {
      console.log('⚠️ 找不到 roles 表，跳過遷移');
      return;
    }
    if (!cols.includes('can_view_bonus')) {
      db.prepare('ALTER TABLE roles ADD COLUMN can_view_bonus INTEGER NOT NULL DEFAULT 1').run();
      console.log('✓ roles 已新增 can_view_bonus（既有角色全部預設 1，權限不變）');
    } else {
      console.log('  roles.can_view_bonus 已存在，略過');
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
