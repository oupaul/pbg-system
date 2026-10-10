// 自訂瀏覽器分頁圖示（favicon）
// 圖示檔存放在 data/branding/（隨資料目錄一起備份、更新程式時不會被覆蓋），
// 檔名由系統固定產生，不使用使用者上傳的檔名。
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getUserInfo } = require('../utils/authHelper');
const AuditLogService = require('../services/AuditLogService');

const BRANDING_DIR = path.join(__dirname, '..', '..', 'data', 'branding');
const DEFAULT_FAVICON = path.join(__dirname, '..', '..', 'public', 'favicon-default.svg');
const MAX_FAVICON_BYTES = 512 * 1024;

// 只接受圖片格式（不含 SVG：SVG 可夾帶腳本）；以檔案開頭的特徵位元組判斷，不信任副檔名與 Content-Type
const FORMATS = [
  { ext: 'png', mime: 'image/png', test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'ico', mime: 'image/x-icon', test: b => b.length > 6 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00 },
  { ext: 'jpg', mime: 'image/jpeg', test: b => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: b => b.length > 6 && b.slice(0, 4).toString('latin1') === 'GIF8' }
];

function readSetting(key) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row ? row.setting_value : null;
  } catch (err) {
    return null;
  }
}

function writeSetting(key, value) {
  const result = db.prepare(`UPDATE system_settings SET setting_value = ?, setting_type = 'string', updated_at = datetime('now', 'localtime') WHERE setting_key = ?`).run(String(value), key);
  if (result.changes === 0) {
    db.prepare(`INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at) VALUES (?, ?, 'string', datetime('now', 'localtime'))`).run(key, String(value));
  }
}

// 目前自訂的圖示：{ file, mime } 或 null（沿用系統預設圖示）
function getCustomFavicon() {
  const name = readSetting('favicon_file');
  if (!name) return null;
  const format = FORMATS.find(f => `favicon.${f.ext}` === name);
  if (!format) return null;
  const file = path.join(BRANDING_DIR, name);
  return fs.existsSync(file) ? { file, mime: format.mime, name } : null;
}

function removeCustomFiles() {
  if (!fs.existsSync(BRANDING_DIR)) return;
  for (const f of FORMATS) {
    const file = path.join(BRANDING_DIR, `favicon.${f.ext}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// ── 公開路由：登入頁也需要圖示，所以不需要登入 ──
const publicRouter = express.Router();
publicRouter.get(['/favicon.ico', '/branding/favicon'], (req, res) => {
  const custom = getCustomFavicon();
  res.set('X-Content-Type-Options', 'nosniff');
  // 網址帶版本參數（?v=），換圖後瀏覽器會重新抓取；無參數時只快取短時間
  res.set('Cache-Control', req.query.v ? 'public, max-age=86400' : 'public, max-age=300');
  if (custom) {
    res.type(custom.mime);
    return res.sendFile(custom.file);
  }
  res.type('image/svg+xml');
  res.sendFile(DEFAULT_FAVICON);
});

// ── 設定路由（僅管理員，掛在 /settings/favicon 下）──
const settingsRouter = express.Router();
const faviconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FAVICON_BYTES, files: 1 } }).single('favicon');

settingsRouter.post('/', requireAuth, requireAdmin, (req, res) => {
  faviconUpload(req, res, (uploadErr) => {
    const back = (key, msg) => res.redirect(`/settings?${key}=` + encodeURIComponent(msg));
    if (uploadErr) {
      return back('error', uploadErr.code === 'LIMIT_FILE_SIZE' ? `圖示檔案過大，上限 ${MAX_FAVICON_BYTES / 1024} KB` : '上傳失敗：' + uploadErr.message);
    }
    if (!req.file) return back('error', '請選擇要上傳的圖示檔案');

    const format = FORMATS.find(f => f.test(req.file.buffer));
    if (!format) return back('error', '不支援的檔案格式，請上傳 PNG、ICO、JPG 或 GIF 圖片');

    try {
      fs.mkdirSync(BRANDING_DIR, { recursive: true });
      removeCustomFiles();
      fs.writeFileSync(path.join(BRANDING_DIR, `favicon.${format.ext}`), req.file.buffer);
      const oldName = readSetting('favicon_file');
      writeSetting('favicon_file', `favicon.${format.ext}`);
      writeSetting('favicon_version', Date.now());
      AuditLogService.logUpdate('system_settings', 'favicon',
        { favicon_file: oldName || '(預設)' }, { favicon_file: `favicon.${format.ext}` }, getUserInfo(req));
      back('success', '瀏覽器分頁圖示已更新（瀏覽器可能需重新整理或重新開啟分頁才會顯示新圖示）');
    } catch (err) {
      console.error('更新分頁圖示失敗:', err);
      back('error', '更新分頁圖示失敗：' + err.message);
    }
  });
});

settingsRouter.post('/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    const oldName = readSetting('favicon_file');
    removeCustomFiles();
    writeSetting('favicon_file', '');
    writeSetting('favicon_version', Date.now());
    AuditLogService.logUpdate('system_settings', 'favicon',
      { favicon_file: oldName || '(預設)' }, { favicon_file: '(預設)' }, getUserInfo(req));
    res.redirect('/settings?success=' + encodeURIComponent('已恢復為系統預設的分頁圖示'));
  } catch (err) {
    console.error('恢復預設分頁圖示失敗:', err);
    res.redirect('/settings?error=' + encodeURIComponent('恢復預設圖示失敗：' + err.message));
  }
});

module.exports = { publicRouter, settingsRouter, getCustomFavicon, FORMATS };
