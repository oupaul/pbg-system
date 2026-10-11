#!/usr/bin/env node
// 以 SQLite 官方線上備份 API 產生「一致」的資料庫備份（不需要 sqlite3 命令列工具）。
// 用法：node scripts/sqlite-backup.js <來源.db> <備份目的地.db>
// 備份過程中即使服務仍在寫入，也會得到單一時間點的完整複本（含尚未 checkpoint 的 WAL 內容）；
// 完成後對備份檔執行 PRAGMA integrity_check，不是 ok 就以非 0 結束。
const path = require('path');
const Database = require('better-sqlite3');

async function main() {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('用法: node scripts/sqlite-backup.js <來源.db> <備份目的地.db>');
    process.exit(2);
  }
  const source = new Database(path.resolve(src), { readonly: true, fileMustExist: true });
  try {
    await source.backup(path.resolve(dest));
  } finally {
    source.close();
  }
  const copy = new Database(path.resolve(dest), { readonly: true, fileMustExist: true });
  const result = copy.pragma('integrity_check', { simple: true });
  copy.close();
  if (result !== 'ok') {
    console.error('備份檔完整性檢查失敗:', result);
    process.exit(1);
  }
  console.log('備份完成且完整性檢查通過:', dest);
}

main().catch((err) => {
  console.error('備份失敗:', err.message);
  process.exit(1);
});
