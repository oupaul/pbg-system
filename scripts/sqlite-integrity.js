#!/usr/bin/env node
// 檢查 SQLite 資料庫的完整性（唯讀）：印出 PRAGMA integrity_check 的第一行（正常為 ok），打不開或損壞時印出錯誤訊息。
// 供 restore.sh 在沒有 sqlite3 命令列工具時使用。用法：node scripts/sqlite-integrity.js <資料庫路徑>
const Database = require('better-sqlite3');

const file = process.argv[2];
if (!file) {
  console.log('Error: 缺少資料庫路徑');
  process.exit(2);
}
let db;
try {
  db = new Database(file, { readonly: true, fileMustExist: true });
  const rows = db.pragma('integrity_check');
  const first = rows && rows[0] ? Object.values(rows[0])[0] : 'Error: 無結果';
  console.log(String(first));
} catch (err) {
  console.log(`Error: ${err.message}`);
} finally {
  if (db) try { db.close(); } catch { /* 忽略 */ }
}
