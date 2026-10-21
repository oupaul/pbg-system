#!/usr/bin/env node
// 檢查重複的有效發票號碼，並在沒有重複時建立唯一索引。
// 用法：
//   node scripts/check-invoice-duplicates.js                 只列出重複（不修改任何資料）
//   node scripts/check-invoice-duplicates.js --create-index  沒有重複時建立唯一索引
// 預設使用 data/invoice_bonus.db；可用 DB_PATH 環境變數指定其他檔案。
const path = require('path');
const Database = require('better-sqlite3');
const { findDuplicates, createIndexIfClean, formatDuplicates, indexExists } = require('../src/utils/invoiceNumberIndex');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');
const createIndex = process.argv.includes('--create-index');

const db = new Database(dbPath, { fileMustExist: true });
try {
  if (createIndex) {
    const result = createIndexIfClean(db);
    if (result.status === 'created') { console.log('✓ 已建立發票號碼唯一索引'); process.exit(0); }
    if (result.status === 'exists') { console.log('✓ 唯一索引已存在'); process.exit(0); }
    if (result.status === 'duplicates') {
      console.error(`仍有 ${result.duplicates.length} 組重複，無法建立索引：\n${formatDuplicates(result.duplicates)}`);
      process.exit(1);
    }
    console.error('invoices 資料表不存在');
    process.exit(1);
  }
  const duplicates = findDuplicates(db);
  console.log(`唯一索引：${indexExists(db) ? '已建立' : '尚未建立'}`);
  if (duplicates.length === 0) {
    console.log('沒有重複的有效發票號碼。');
  } else {
    console.log(`重複的有效發票號碼共 ${duplicates.length} 組：\n${formatDuplicates(duplicates)}`);
    process.exit(1);
  }
} finally {
  db.close();
}
