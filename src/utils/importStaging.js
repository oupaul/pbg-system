// 匯入前預覽的暫存區：上傳並通過驗證的 Excel 先放在這裡，預覽（試跑後回滾）確認無誤後才用同一份檔案正式匯入。
// - 檔案放在 uploads/import-staging/<token>.xlsx，token 為 128 位元隨機值
// - 每份暫存只有建立者本人、同一種匯入類型能取用；30 分鐘後失效
// - 中繼資料放記憶體（重啟後暫存失效，使用者重新上傳即可）；殘留檔案由 sweep 依修改時間清掉
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const STALE_FILE_MS = 60 * 60 * 1000;

function createStaging({ dir, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
  const entries = new Map();

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  function removeFile(filePath) {
    try { fs.unlinkSync(filePath); } catch { /* 檔案可能已被清掉 */ }
  }

  function sweep() {
    const t = now();
    for (const [token, entry] of entries) {
      if (t - entry.createdAt > ttlMs) {
        removeFile(entry.filePath);
        entries.delete(token);
      }
    }
    // 重啟後遺留、或不在記憶體中的檔案：超過 1 小時一律刪除
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!/^[0-9a-f]{32}\.xlsx$/.test(name)) continue;
        const full = path.join(dir, name);
        const token = name.slice(0, -5);
        if (entries.has(token)) continue;
        try {
          if (t - fs.statSync(full).mtimeMs > STALE_FILE_MS) removeFile(full);
        } catch { /* 忽略 */ }
      }
    } catch { /* 目錄不存在時略過 */ }
  }

  return {
    /** 把已上傳的檔案移進暫存區，回傳 token */
    stage(srcPath, { userId, kind, originalName }) {
      ensureDir();
      sweep();
      const token = crypto.randomBytes(16).toString('hex');
      const filePath = path.join(dir, `${token}.xlsx`);
      try {
        fs.renameSync(srcPath, filePath);
      } catch {
        // 跨檔案系統時 rename 會失敗，改用複製
        fs.copyFileSync(srcPath, filePath);
        removeFile(srcPath);
      }
      fs.chmodSync(filePath, 0o600);
      entries.set(token, { token, userId, kind, originalName, filePath, createdAt: now(), summary: null });
      return token;
    },

    /** 取得暫存（限本人、同類型、未過期）；不符一律回傳 null */
    get(token, userId, kind) {
      if (!/^[0-9a-f]{32}$/.test(String(token || ''))) return null;
      const entry = entries.get(token);
      if (!entry) return null;
      if (now() - entry.createdAt > ttlMs) {
        removeFile(entry.filePath);
        entries.delete(token);
        return null;
      }
      if (entry.userId !== userId || entry.kind !== kind) return null;
      return entry;
    },

    /** 取走並移除記錄（檔案留給呼叫端處理完再 discard），避免重複點擊造成同一份檔案匯入兩次 */
    claim(token, userId, kind) {
      const entry = this.get(token, userId, kind);
      if (!entry) return null;
      entries.delete(token);
      return entry;
    },

    /** 刪除暫存檔（entry 可能已被 claim） */
    discard(entryOrToken) {
      const entry = typeof entryOrToken === 'string' ? entries.get(entryOrToken) : entryOrToken;
      if (!entry) return;
      entries.delete(entry.token);
      removeFile(entry.filePath);
    },

    sweep,
    _size: () => entries.size
  };
}

module.exports = { createStaging, TTL_MS };
