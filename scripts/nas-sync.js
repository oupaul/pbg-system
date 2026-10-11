#!/usr/bin/env node
// 把備份檔同步到「備份還原」頁面設定的 NAS（異地備份）。供 backup.sh（含定時備份）在備份完成後呼叫。
// 用法：node scripts/nas-sync.js <備份檔.tar.gz>
// NAS 未啟用時直接略過（結束碼 0）；同步失敗結束碼為 1，但 backup.sh 只會警告，不會讓備份本身失敗。
const NasConfigService = require('../src/services/NasConfigService');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/nas-sync.js <備份檔>');
    process.exit(2);
  }
  const result = await NasConfigService.syncToNas(file, 'cli_' + Date.now());
  if (result && result.skipped) {
    console.log('NAS 備份未啟用，略過異地備份');
    return;
  }
  if (!result || !result.success) {
    console.error('NAS 同步失敗:', result && (result.error || result.message));
    process.exit(1);
  }
  console.log('NAS 同步完成');
})().catch((err) => {
  console.error('NAS 同步失敗:', err.message);
  process.exit(1);
});
