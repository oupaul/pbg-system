const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const argon2 = require('argon2');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

// 確保資料目錄存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function migrate() {
  // 注意：argon2 需要原生模組編譯，如果安裝失敗，可以回退到 bcrypt
  const SQL = await initSqlJs();
  
  let db;
  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    db = new SQL.Database();
  }

  console.log('開始執行用戶表遷移...');

  // 創建用戶表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      last_login TEXT
    )
  `);
  console.log('✓ 建立 users 表');

  // 檢查是否已有用戶，如果沒有則創建預設管理員
  const existingUsers = db.exec('SELECT COUNT(*) as count FROM users');
  const userCount = existingUsers[0]?.values[0]?.[0] || 0;

  if (userCount === 0) {
    // 創建預設管理員帳號：admin / admin123
    const defaultPassword = 'admin123';
    let passwordHash;
    try {
      passwordHash = await argon2.hash(defaultPassword, {
        type: argon2.argon2id,
        memoryCost: 65536, // 64 MB
        timeCost: 3,
        parallelism: 4
      });
    } catch (err) {
      console.error('⚠️  argon2 雜湊失敗，回退到 bcrypt:', err.message);
      const bcrypt = require('bcrypt');
      passwordHash = bcrypt.hashSync(defaultPassword, 10);
    }
    
    db.run(`
      INSERT INTO users (username, password_hash, name, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `, ['admin', passwordHash, '系統管理員', 'admin', 1]);
    
    console.log('✓ 創建預設管理員帳號：');
    console.log('  帳號：admin');
    console.log('  密碼：admin123');
    console.log('  ⚠️  請在首次登入後立即修改密碼！');
  }

  // 儲存資料庫
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);

  db.close();
  console.log('\n✅ 用戶表遷移完成！');
}

migrate().catch(console.error);

