// 上傳檔案驗證：副檔名白名單 + 檔案內容（檔頭）必須與副檔名相符。
// 不信任使用者宣稱的 MIME 類型；可夾帶腳本或可執行的格式（html、svg、js、exe、sh…）不在白名單內。
const fs = require('fs');
const path = require('path');
const { inspectZip } = require('./attachmentPreview');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// 檔頭檢查器：每種內容類型回傳 true/false
const SIGNATURES = {
  pdf: (h) => h.subarray(0, 1024).includes('%PDF-', 0, 'latin1'),
  zip: (h) => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 0x03 || h[2] === 0x05) && (h[3] === 0x04 || h[3] === 0x06),
  ole: (h) => h.length >= 8 && OLE_MAGIC.every((b, i) => h[i] === b),
  png: (h) => h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47,
  jpeg: (h) => h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  gif: (h) => h.length >= 6 && h.subarray(0, 4).toString('latin1') === 'GIF8',
  webp: (h) => h.length >= 12 && h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP',
  bmp: (h) => h.length >= 2 && h[0] === 0x42 && h[1] === 0x4d,
  tiff: (h) => h.length >= 4 && ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2a && h[3] === 0x00) || (h[0] === 0x4d && h[1] === 0x4d && h[2] === 0x00 && h[3] === 0x2a)),
  rar: (h) => h.length >= 6 && h.subarray(0, 4).toString('latin1') === 'Rar!',
  sevenz: (h) => h.length >= 6 && h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf && h[4] === 0x27 && h[5] === 0x1c,
  rtf: (h) => h.subarray(0, 5).toString('latin1') === '{\\rtf',
  // 純文字：沒有 NUL 位元組（UTF-16 帶 BOM 的文字檔也放行）
  text: (h) => {
    if (h.length >= 2 && ((h[0] === 0xff && h[1] === 0xfe) || (h[0] === 0xfe && h[1] === 0xff))) return true;
    return !h.subarray(0, 8192).includes(0);
  }
};

// 附件允許的副檔名 → 內容類型
const ATTACHMENT_EXTENSIONS = {
  '.pdf': 'pdf',
  '.doc': 'ole', '.xls': 'ole', '.ppt': 'ole', '.msg': 'ole',
  '.docx': 'zip', '.xlsx': 'zip', '.pptx': 'zip', '.odt': 'zip', '.ods': 'zip', '.odp': 'zip', '.zip': 'zip',
  '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp', '.bmp': 'bmp',
  '.tif': 'tiff', '.tiff': 'tiff',
  '.rar': 'rar', '.7z': 'sevenz',
  '.rtf': 'rtf',
  '.txt': 'text', '.csv': 'text', '.tsv': 'text', '.log': 'text', '.md': 'text'
};

// Excel 匯入只接受 .xlsx
const XLSX_EXTENSIONS = { '.xlsx': 'zip' };

function readHead(filePath, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 驗證已存到磁碟的上傳檔。
 * @param {string} filePath 檔案實際路徑
 * @param {string} originalName 使用者上傳時的檔名（取副檔名）
 * @param {Object} allowed 副檔名 → 內容類型 的對照表
 * @returns {{ok: boolean, reason?: string}}
 */
function validateUploadedFile(filePath, originalName, allowed) {
  const ext = path.extname(originalName || '').toLowerCase();
  const sigName = allowed[ext];
  if (!sigName) {
    return { ok: false, reason: `不支援的檔案類型${ext ? `（${ext}）` : ''}` };
  }
  let head;
  try {
    head = readHead(filePath, 8192);
  } catch {
    return { ok: false, reason: '無法讀取上傳的檔案' };
  }
  if (head.length === 0) return { ok: false, reason: '檔案是空的' };
  if (!SIGNATURES[sigName](head)) {
    return { ok: false, reason: `檔案內容與副檔名（${ext}）不符，請確認檔案是否正確` };
  }
  return { ok: true };
}

// Excel 匯入檔另外檢查 OOXML 結構（含 zip bomb 防護），避免交給 ExcelJS 解壓惡意檔案
function validateXlsxStructure(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return { ok: false, reason: '無法讀取上傳的檔案' };
  }
  const zip = inspectZip(buffer);
  if (!zip.ok) return { ok: false, reason: `不是正常的 .xlsx 檔案（${zip.reason}）` };
  if (!zip.names.includes('[Content_Types].xml') || !zip.names.includes('xl/workbook.xml')) {
    return { ok: false, reason: '不是正常的 .xlsx 檔案（缺少必要內容）' };
  }
  return { ok: true };
}

function uploadErrorMessage(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return `檔案過大（上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB）`;
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return '上傳欄位不正確';
  return '檔案上傳失敗';
}

function removeQuietly(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* 暫存檔可能已不存在 */ }
}

/**
 * 產生「上傳 + 驗證」的中介層陣列，可直接放進 router.post(path, ...guard, handler)。
 * 驗證失敗（類型不符、內容不符、超過大小）會刪除已存檔案並呼叫 onReject(req, res, message)，不會進入後面的處理函式。
 * @param {Object} opts
 * @param {Object} opts.multer      multer 實例
 * @param {string} [opts.field]     表單欄位名稱，預設 'file'
 * @param {Object} opts.allowed     副檔名白名單（見 ATTACHMENT_EXTENSIONS / XLSX_EXTENSIONS）
 * @param {boolean} [opts.xlsxStructure] 是否另外驗證 .xlsx 結構
 * @param {Function} opts.onReject  (req, res, message) => void
 */
function guardedSingleUpload({ multer: m, field = 'file', allowed, xlsxStructure = false, onReject }) {
  const receive = (req, res, next) => {
    m.single(field)(req, res, (err) => {
      if (err) {
        if (req.file) removeQuietly(req.file.path);
        return onReject(req, res, uploadErrorMessage(err));
      }
      next();
    });
  };
  const verify = (req, res, next) => {
    if (!req.file) return next(); // 沒選檔案由後面的處理函式回報
    let result = validateUploadedFile(req.file.path, req.file.originalname, allowed);
    if (result.ok && xlsxStructure) result = validateXlsxStructure(req.file.path);
    if (!result.ok) {
      removeQuietly(req.file.path);
      return onReject(req, res, result.reason);
    }
    next();
  };
  return [receive, verify];
}

module.exports = {
  MAX_UPLOAD_BYTES,
  ATTACHMENT_EXTENSIONS,
  XLSX_EXTENSIONS,
  validateUploadedFile,
  validateXlsxStructure,
  guardedSingleUpload
};
