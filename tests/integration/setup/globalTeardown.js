const fs = require('fs');

module.exports = async () => {
  const state = globalThis.__PBG_INTEGRATION__;
  if (!state) return;
  try { state.child.kill('SIGTERM'); } catch { /* 已結束 */ }
  await new Promise(r => setTimeout(r, 300));
  try { state.child.kill('SIGKILL'); } catch { /* 已結束 */ }
  // 只刪自己建立的暫存目錄（路徑必須在系統暫存區且帶有固定前綴）
  if (state.tmp && /pbg-integration-[A-Za-z0-9]+$/.test(state.tmp) && state.tmp.startsWith(require('os').tmpdir())) {
    fs.rmSync(state.tmp, { recursive: true, force: true });
  }
};
