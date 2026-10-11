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
// 遇到其他程序（備份腳本、migration、還原）暫時鎖住資料庫時最多等 5 秒再放棄，而不是立刻回報 SQLITE_BUSY
db.pragma('busy_timeout = 5000');
// WAL 模式下 NORMAL 已足夠安全（斷電最多遺失最後幾筆交易，不會損毀資料庫），寫入比預設的 FULL 快很多
db.pragma('synchronous = NORMAL');

// 「維運層級」錯誤（資料庫忙碌、鎖定、磁碟/IO 錯誤、損毀、唯讀）不能被當成「查無資料」吞掉：
// 否則備份或 migration 與服務同時存取時，查詢失敗會被畫面顯示成空清單或 0 元，甚至跳過驗證。
// 其他錯誤（缺資料表/欄位等 schema 差異）維持原本「記錄後回傳空結果」的容錯行為，
// 因為既有程式碼對舊版資料庫有大量依賴這個行為。
function isOperationalError(err) {
  const code = String((err && err.code) || '');
  return /^SQLITE_(BUSY|LOCKED|IOERR|CORRUPT|FULL|READONLY|CANTOPEN|NOTADB|PROTOCOL)/.test(code);
}

// 錯誤日誌不記錄 SQL 參數（可能含密碼雜湊、個資），只記錄參數個數
function logSqlError(label, err, sql, params) {
  console.error(label, err.message);
  console.error('SQL:', sql);
  console.error('參數個數:', Array.isArray(params) ? params.length : 0);
}

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
            logSqlError('SQL執行錯誤:', err, sql, params);
            throw err;
          }
        },
        get: (...params) => {
          try {
            return stmt.get(...params);
          } catch (err) {
            logSqlError('SQL查詢錯誤:', err, sql, params);
            if (isOperationalError(err)) throw err;
            return undefined;
          }
        },
        all: (...params) => {
          try {
            return stmt.all(...params);
          } catch (err) {
            logSqlError('SQL查詢錯誤:', err, sql, params);
            if (isOperationalError(err)) throw err;
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

// 程序正常結束時關閉連線。SIGINT/SIGTERM 的優雅關閉（先停止接收請求、等進行中的請求結束，
// 再關閉資料庫）改由 src/app.js 處理；單獨執行的腳本收到訊號時由 Node 預設行為結束（WAL 資料庫可安全復原）。
process.on('exit', () => {
  try { db.close(); } catch (err) { /* 已經關閉 */ }
});

module.exports = new DatabaseWrapper();
module.exports.initPromise = Promise.resolve(); // 為了兼容性
