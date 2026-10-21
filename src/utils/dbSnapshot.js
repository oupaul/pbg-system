// 資料庫快照（VACUUM INTO：一致、含 WAL 內容、不需停服務）。
// 用於「批次匯入前」自動保存一份，匯入出大問題時可以整個資料庫退回匯入前的狀態。
// 注意：VACUUM INTO 不能在交易中執行，呼叫時不可有進行中的交易。
const fs = require('fs');
const path = require('path');

const DB_FILE_NAME = 'invoice_bonus.db';

/**
 * @param {Object} opts
 * @param {Function} opts.exec  執行 SQL 的函式（預設用應用程式的資料庫連線）
 * @param {string}   opts.dir   快照存放目錄（與資料庫同一個 data 目錄）
 * @param {string}   [opts.prefix='pre-import']  檔名前綴：invoice_bonus.db.<prefix>-<時間>
 * @param {number}   [opts.keep=5]               只保留最近幾份
 * @param {Date}     [opts.now]
 * @returns {{path: string, name: string}}
 */
function createSnapshot({ exec, dir, prefix = 'pre-import', keep = 5, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17) + '-' + process.pid;
  const name = `${DB_FILE_NAME}.${prefix}-${stamp}`;
  const snapshotPath = path.join(dir, name);
  exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
  try { fs.chmodSync(snapshotPath, 0o600); } catch { /* 忽略 */ }

  // 只保留最近 keep 份（檔名含時間戳，字串排序即時間排序）
  try {
    const marker = `${DB_FILE_NAME}.${prefix}-`;
    fs.readdirSync(dir)
      .filter(f => f.startsWith(marker))
      .sort().reverse().slice(keep)
      .forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* 忽略 */ } });
  } catch { /* 清理失敗不影響本次快照 */ }

  return { path: snapshotPath, name };
}

module.exports = { createSnapshot, DB_FILE_NAME };
