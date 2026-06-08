/**
 * Migration: permission scope redesign
 *
 * Changes:
 *  1. Add `project_view_scope` column to roles table
 *     Values: 'all' | 'assigned' | 'own' | 'none'
 *  2. Create `user_salesperson_access` junction table
 *     (allows specific users to see projects of specific salespeople)
 *  3. Set default scope values for all existing system roles
 *  4. Add missing performance indexes
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  console.log('開始執行權限範圍設計遷移...');

  if (!fs.existsSync(dbPath)) {
    console.log('❌ 資料庫文件不存在，請先執行基礎遷移');
    return;
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // ── 1. Add project_view_scope to roles ──────────────────────────────────
  const rolesInfo = db.prepare('PRAGMA table_info(roles)').all();
  const hasScope = rolesInfo.some(c => c.name === 'project_view_scope');

  if (!hasScope) {
    db.exec(`
      ALTER TABLE roles
      ADD COLUMN project_view_scope TEXT DEFAULT 'all'
        CHECK(project_view_scope IN ('all', 'assigned', 'own', 'none'))
    `);
    console.log('✓ roles 表新增 project_view_scope 欄位');
  } else {
    console.log('✓ project_view_scope 欄位已存在，跳過');
  }

  // ── 2. Set scope for system roles ───────────────────────────────────────
  const setScope = db.prepare(`
    UPDATE roles SET project_view_scope = ? WHERE role_key = ?
  `);

  const setManyScopes = db.transaction(() => {
    setScope.run('all',  'admin');
    setScope.run('all',  'user');
    setScope.run('all',  'boss');
    setScope.run('own',  'salesperson');
  });
  setManyScopes();
  console.log('✓ 系統角色 project_view_scope 已設定');

  // ── 3. Create user_salesperson_access table ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_salesperson_access (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      salesperson_id INTEGER NOT NULL REFERENCES salespeople(id) ON DELETE CASCADE,
      created_at     TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, salesperson_id)
    )
  `);
  console.log('✓ 建立 user_salesperson_access 表');

  // ── 4. Indexes ───────────────────────────────────────────────────────────
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_usa_user_id
       ON user_salesperson_access(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usa_salesperson_id
       ON user_salesperson_access(salesperson_id)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_salesperson_id
       ON projects(salesperson_id)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_status_year
       ON projects(status, contract_year)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_project_id
       ON invoices(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_project_id
       ON payments(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
       ON audit_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name
       ON audit_logs(table_name)`,
    `CREATE INDEX IF NOT EXISTS idx_bonus_calcs_salesperson
       ON bonus_calculations(salesperson_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bonus_calcs_project
       ON bonus_calculations(project_id)`
  ];

  for (const sql of indexes) {
    try {
      db.exec(sql);
    } catch (err) {
      // Index may already exist under a different name — not fatal
      console.warn('  index 建立略過:', err.message);
    }
  }
  console.log('✓ 補充缺失的 DB indexes');

  db.close();
  console.log('✅ 權限範圍遷移完成');
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
