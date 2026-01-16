const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', '..', 'data', 'invoice_bonus.db');
const dataDir = path.dirname(dbPath);

// 確保資料目錄存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化資料庫
const db = new Database(dbPath, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// 啟用外鍵約束
db.pragma('foreign_keys = ON');

// 啟用 WAL 模式（提升並發性能）
db.pragma('journal_mode = WAL');

console.log('✓ 資料庫已連接 (better-sqlite3):', dbPath);

// 封裝 API（完全兼容原有代碼）
class DatabaseWrapper {
  prepare(sql) {
    try {
      const stmt = db.prepare(sql);
      
      return {
        run: (...params) => {
          try {
            const result = stmt.run(...params);
            return {
              changes: result.changes,
              lastInsertRowid: result.lastInsertRowid
            };
          } catch (err) {
            console.error('SQL執行錯誤:', err.message);
            console.error('SQL:', sql);
            console.error('參數:', params);
            throw err;
          }
        },
        get: (...params) => {
          try {
            return stmt.get(...params);
          } catch (err) {
            console.error('SQL查詢錯誤:', err.message);
            console.error('SQL:', sql);
            console.error('參數:', params);
            return undefined;
          }
        },
        all: (...params) => {
          try {
            return stmt.all(...params);
          } catch (err) {
            console.error('SQL查詢錯誤:', err.message);
            console.error('SQL:', sql);
            console.error('參數:', params);
            return [];
          }
        }
      };
    } catch (err) {
      console.error('SQL準備錯誤:', err.message);
      console.error('SQL:', sql);
      throw err;
    }
  }
  
  exec(sql) {
    try {
      db.exec(sql);
    } catch (err) {
      console.error('SQL執行錯誤:', err.message);
      console.error('SQL:', sql);
      throw err;
    }
  }
  
  pragma(pragma) {
    try {
      return db.pragma(pragma);
    } catch (err) {
      console.error('PRAGMA錯誤:', err.message);
      // 忽略 pragma 錯誤
    }
  }
  
  transaction(fn) {
    return (...args) => {
      return db.transaction(fn)(...args);
    };
  }
  
  close() {
    try {
      db.close();
      console.log('✓ 資料庫連接已關閉');
    } catch (err) {
      console.error('關閉資料庫錯誤:', err.message);
    }
  }
  
  // 重新載入資料庫（備份還原用）
  async reload() {
    try {
      // better-sqlite3 會自動重新載入，無需特別處理
      console.log('[db.js] 資料庫已重新載入 (better-sqlite3 自動同步)');
      return true;
    } catch (err) {
      console.error('資料庫重新載入錯誤:', err);
      return false;
    }
  }
  
  // 為了兼容性保留的空方法
  pauseAutoSave() {
    console.log('[db.js] better-sqlite3 不需要暫停自動保存');
  }
  
  resumeAutoSave() {
    console.log('[db.js] better-sqlite3 不需要恢復自動保存');
  }
}

// 優雅關閉
process.on('exit', () => {
  db.close();
});

process.on('SIGINT', () => {
  db.close();
  process.exit();
});

process.on('SIGTERM', () => {
  db.close();
  process.exit();
});

module.exports = new DatabaseWrapper();
module.exports.initPromise = Promise.resolve(); // 為了兼容性
