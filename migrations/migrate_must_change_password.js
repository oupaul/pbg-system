/**
 * 強制變更預設密碼：新增 users.must_change_password 旗標。
 *
 * 全新安裝的預設管理員帳號（admin/admin123，見 migrations/migrate.js、migrate_users.js）
 * 目前沒有任何機制強制或提示第一次登入就換掉這組固定密碼——每個客戶部署起家的帳密都一樣，
 * 是獨立部署到客戶主機的實際安全缺口。
 *
 * 這裡只負責「新增欄位」：ALTER TABLE 的 DEFAULT 會套用到既有所有資料列，
 * 既有安裝的使用者一律維持 0，不會被強制要求改密碼。只有 migrate.js／migrate_users.js
 * 在「資料庫全新建立」時新增的 admin 帳號會被設為 1，由 src/middleware/auth.js 的
 * 強制導向邏輯要求該帳號登入後立刻改密碼。
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

  const cols = db.prepare('PRAGMA table_info(users)').all();
  const hasCol = cols.some(c => c.name === 'must_change_password');

  if (hasCol) {
    console.log('✓ users.must_change_password 已存在，跳過遷移');
    db.close();
    return;
  }

  console.log('為 users 新增 must_change_password 欄位...');
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0 CHECK(must_change_password IN (0, 1))');
  console.log('✓ users.must_change_password 欄位新增完成（既有使用者維持 0）');
  db.close();
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
