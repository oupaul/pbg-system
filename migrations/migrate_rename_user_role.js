/**
 * 將 roles 表中 role_key = 'user' 的顯示名稱從「一般使用者」改為「專案管理員」
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrateRenameUserRole() {
  console.log('開始執行：重新命名 user 角色顯示名稱...');

  if (!fs.existsSync(dbPath)) {
    console.log('❌ 資料庫文件不存在，請先執行基礎遷移');
    return;
  }

  let db;
  try {
    db = new Database(dbPath);

    // 確認 roles 表存在
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='roles'"
    ).get();

    if (!tableExists) {
      console.log('⚠️  roles 表不存在，跳過（可先執行 npm run migrate:roles）');
      db.close();
      return;
    }

    // 讀取目前名稱
    const current = db.prepare(
      "SELECT role_name, description FROM roles WHERE role_key = 'user'"
    ).get();

    if (!current) {
      console.log('⚠️  找不到 role_key = user 的角色，跳過');
      db.close();
      return;
    }

    if (current.role_name === '專案管理員') {
      console.log('✓ role_name 已是「專案管理員」，無需更新');
      db.close();
      return;
    }

    // 執行更新
    const result = db.prepare(`
      UPDATE roles
      SET role_name   = '專案管理員',
          description = '可以編輯專案、客戶、業務、發票、收款等所有專案相關資料',
          updated_at  = datetime('now', 'localtime')
      WHERE role_key = 'user'
    `).run();

    if (result.changes > 0) {
      console.log(`✅ 已將「${current.role_name}」更名為「專案管理員」`);
    } else {
      console.log('⚠️  更新未影響任何資料列');
    }

    db.close();
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    if (db) {
      try { db.close(); } catch (_) {}
    }
    throw err;
  }
}

if (require.main === module) {
  migrateRenameUserRole();
}

module.exports = migrateRenameUserRole;
