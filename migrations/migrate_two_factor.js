/**
 * 雙因素驗證（TOTP）：
 *  - users：totp_secret（AES-256-GCM 加密後的密鑰）、totp_enabled、totp_last_step（上次成功驗證的時間步，防重放）、
 *    totp_enabled_at、recovery_codes（復原碼的帶金鑰雜湊，JSON 陣列）
 *  - roles：require_2fa（該角色的使用者必須啟用雙因素驗證）
 *
 * 升級後所有角色預設 require_2fa = 0、所有使用者都沒有啟用雙因素驗證：升級本身不會影響任何人登入，
 * 由管理員在「角色管理」對需要的角色勾選「強制雙因素驗證」（建議至少對系統管理員與財務相關角色）。
 * 可重複執行。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function addColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (cols.includes(column)) {
    console.log(`✓ ${table}.${column} 已存在，略過`);
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`✓ ${table}.${column} 已新增`);
}

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  try {
    addColumn(db, 'users', 'totp_secret', 'TEXT');
    addColumn(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'users', 'totp_enabled_at', 'TEXT');
    addColumn(db, 'users', 'recovery_codes', 'TEXT');
    addColumn(db, 'roles', 'require_2fa', 'INTEGER NOT NULL DEFAULT 0');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
