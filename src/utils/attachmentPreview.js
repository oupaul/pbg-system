// 附件線上預覽：只預覽「檔案內容經驗證」的圖片、PDF、純文字/CSV，其餘一律不預覽（維持強制下載）。
// 判斷一律看檔案實際內容（檔頭），不信任使用者上傳時宣稱的 MIME 類型或副檔名；
// SVG、HTML 等可夾帶腳本的格式不在預覽範圍。
const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.md', '.csv', '.tsv']);
const CSV_EXTENSIONS = new Set(['.csv', '.tsv']);
const MAX_TEXT_BYTES = 256 * 1024;   // 文字預覽最多讀取 256KB
const MAX_CSV_ROWS = 500;
const MAX_CSV_COLUMNS = 40;

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

// 圖片：由檔頭判斷實際格式（回傳可安全使用的 Content-Type）
function sniffImageType(head) {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function isPdf(head) {
  return head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-';
}

// 內容看起來是文字：前 8KB 不含 NUL 位元組
function looksLikeText(head) {
  const sample = head.subarray(0, 8192);
  return !sample.includes(0);
}

// 回傳 { kind: 'image'|'pdf'|'text'|'csv', contentType } 或 null（不可預覽）
function detectPreviewKind(filePath, originalFilename) {
  let head;
  try {
    head = readHead(filePath, 8192);
  } catch (e) {
    return null;
  }
  const imageType = sniffImageType(head);
  if (imageType) return { kind: 'image', contentType: imageType };
  if (isPdf(head)) return { kind: 'pdf', contentType: 'application/pdf' };

  const ext = path.extname(originalFilename || '').toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) && looksLikeText(head)) {
    return { kind: CSV_EXTENSIONS.has(ext) ? 'csv' : 'text', contentType: 'text/plain' };
  }
  return null;
}

// 解碼文字：優先 UTF-8（含 BOM），失敗再試 Big5（台灣常見的 Excel 匯出 CSV），都失敗就放棄
function decodeText(buffer) {
  let buf = buffer;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch (e) { /* 不是合法 UTF-8 */ }
  try {
    return { text: new TextDecoder('big5', { fatal: true }).decode(buf), encoding: 'Big5' };
  } catch (e) { /* 不是 Big5 */ }
  return null;
}

// 簡易 CSV 解析（支援引號、引號內的逗號與換行、"" 跳脫）
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      if (rows.length >= MAX_CSV_ROWS + 1) return { rows, truncatedRows: true };
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { rows, truncatedRows: false };
}

function pickDelimiter(text, ext) {
  if (ext === '.tsv') return '\t';
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', '\t', ';'].map(d => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// 讀取文字/CSV 預覽內容（最多 256KB；CSV 最多 500 列、40 欄）
function readTextPreview(filePath, originalFilename, kind) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  let buffer;
  try {
    const length = Math.min(stat.size, MAX_TEXT_BYTES);
    buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const truncatedBytes = stat.size > MAX_TEXT_BYTES;
  // 截斷點可能切在多位元組字元中間：UTF-8 嚴格解碼會失敗，往前退最多 3 個位元組再試
  let decoded = decodeText(buffer);
  for (let cut = 1; !decoded && truncatedBytes && cut <= 3; cut++) {
    decoded = decodeText(buffer.subarray(0, buffer.length - cut));
  }
  if (!decoded) return { error: '無法辨識檔案編碼（僅支援 UTF-8 與 Big5），請下載後開啟' };

  const result = { kind, encoding: decoded.encoding, truncated: truncatedBytes, size: stat.size };
  if (kind === 'csv') {
    const ext = path.extname(originalFilename || '').toLowerCase();
    const parsed = parseDelimited(decoded.text, pickDelimiter(decoded.text, ext));
    let rows = parsed.rows;
    if (truncatedBytes && rows.length > 1) rows = rows.slice(0, -1); // 最後一列可能被截斷
    if (parsed.truncatedRows) { rows = rows.slice(0, MAX_CSV_ROWS + 1); result.truncated = true; }
    result.columnsTruncated = rows.some(r => r.length > MAX_CSV_COLUMNS);
    result.rows = rows.map(r => r.slice(0, MAX_CSV_COLUMNS));
  } else {
    result.text = decoded.text;
  }
  return result;
}


// ── Word（.docx）／Excel（.xlsx）預覽：檔案只在使用者的瀏覽器解析，伺服器只做「是不是正常的 OOXML」檢查 ──
// 重點是防範解壓縮炸彈：.docx/.xlsx 其實是 ZIP，惡意檔案可以幾 KB 展開成數 GB 讓瀏覽器當掉，
// 所以先讀 ZIP 中央目錄，累計「解壓後大小」與檔案數，超過上限就不提供預覽。
const MAX_OFFICE_BYTES = { docx: 10 * 1024 * 1024, xlsx: 5 * 1024 * 1024 };
const MAX_ZIP_ENTRIES = 3000;
const MAX_ZIP_UNCOMPRESSED_TOTAL = 150 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_ENTRY = 100 * 1024 * 1024;

// 讀取 ZIP 中央目錄；回傳 { ok, names, totalUncompressed, reason }
function inspectZip(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return { ok: false, reason: '不是 ZIP 格式' };
  // 找 End of Central Directory（從檔尾往回找，註解最長 65535 位元組）
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, reason: '找不到 ZIP 中央目錄' };
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) return { ok: false, reason: '不支援 ZIP64' };
  if (totalEntries > MAX_ZIP_ENTRIES) return { ok: false, reason: '壓縮檔內項目過多' };

  const names = [];
  let total = 0;
  let pos = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) return { ok: false, reason: 'ZIP 中央目錄損毀' };
    const uncompressed = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > buffer.length) return { ok: false, reason: 'ZIP 中央目錄損毀' };
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (name.startsWith('/') || name.split('/').includes('..')) return { ok: false, reason: '壓縮檔含不安全的路徑' };
    if (uncompressed > MAX_ZIP_UNCOMPRESSED_ENTRY) return { ok: false, reason: '壓縮檔內有過大的項目' };
    total += uncompressed;
    if (total > MAX_ZIP_UNCOMPRESSED_TOTAL) return { ok: false, reason: '解壓縮後總大小過大' };
    names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, names, totalUncompressed: total };
}

// 回傳 { kind: 'docx'|'xlsx', maxBytes } 或 null：副檔名 + 檔案確實是正常 OOXML + 通過解壓縮炸彈檢查
function detectOfficeKind(filePath, originalFilename) {
  const ext = path.extname(originalFilename || '').toLowerCase();
  const kind = ext === '.docx' ? 'docx' : (ext === '.xlsx' ? 'xlsx' : null);
  if (!kind) return null;
  let buffer;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_OFFICE_BYTES[kind]) return { kind, tooLarge: true, maxBytes: MAX_OFFICE_BYTES[kind] };
    buffer = fs.readFileSync(filePath);
  } catch (e) {
    return null;
  }
  const zip = inspectZip(buffer);
  if (!zip.ok) return null;
  const required = kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  if (!zip.names.includes('[Content_Types].xml') || !zip.names.includes(required)) return null;
  return { kind, maxBytes: MAX_OFFICE_BYTES[kind] };
}

module.exports = { detectPreviewKind, readTextPreview, parseDelimited, sniffImageType, MAX_TEXT_BYTES, detectOfficeKind, inspectZip };
