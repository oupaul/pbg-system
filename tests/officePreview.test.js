const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { detectOfficeKind, inspectZip } = require('../src/utils/attachmentPreview');

let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function makeDocx(extra = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<w:document/>');
  Object.entries(extra).forEach(([name, content]) => zip.file(name, content));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function write(name, buffer) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buffer);
  return p;
}

describe('detectOfficeKind', () => {
  test('正常的 .docx', async () => {
    expect(detectOfficeKind(write('a.docx', await makeDocx()), 'a.docx')).toMatchObject({ kind: 'docx' });
  });
  test('正常的 .xlsx（用 ExcelJS 實際產生）', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['a', 1]);
    const buf = await wb.xlsx.writeBuffer();
    expect(detectOfficeKind(write('a.xlsx', Buffer.from(buf)), 'a.xlsx')).toMatchObject({ kind: 'xlsx' });
  });
  test('副檔名與內容不符一律不預覽', async () => {
    const docx = await makeDocx();
    expect(detectOfficeKind(write('x.xlsx', docx), 'x.xlsx')).toBeNull();      // docx 內容冒充 xlsx
    expect(detectOfficeKind(write('y.docx', Buffer.from('not a zip at all')), 'y.docx')).toBeNull();
    expect(detectOfficeKind(write('z.pdf', docx), 'z.pdf')).toBeNull();          // 其他副檔名
  });
  test('舊格式 .doc/.xls 不支援', () => {
    expect(detectOfficeKind(write('old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), 'old.doc')).toBeNull();
    expect(detectOfficeKind(write('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), 'old.xls')).toBeNull();
  });
  test('缺少必要的 OOXML 項目', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    expect(detectOfficeKind(write('empty.docx', await zip.generateAsync({ type: 'nodebuffer' })), 'empty.docx')).toBeNull();
  });
  test('解壓縮炸彈：解壓後總大小過大 → 不預覽', async () => {
    // 200MB 的零位元組壓縮後只有約 200KB，但解壓後遠超上限
    const bomb = await makeDocx({ 'word/media/big.bin': Buffer.alloc(160 * 1024 * 1024, 0) });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(detectOfficeKind(write('bomb.docx', bomb), 'bomb.docx')).toBeNull();
  }, 60000);
  test('檔案超過預覽大小上限會標示 tooLarge', () => {
    const p = path.join(dir, 'big.xlsx');
    fs.writeFileSync(p, Buffer.alloc(6 * 1024 * 1024, 1));
    expect(detectOfficeKind(p, 'big.xlsx')).toMatchObject({ kind: 'xlsx', tooLarge: true });
  });
  test('檔案不存在', () => {
    expect(detectOfficeKind(path.join(dir, 'missing.docx'), 'missing.docx')).toBeNull();
  });
});

describe('inspectZip', () => {
  test('含 ../ 的路徑被拒絕', async () => {
    const zip = new JSZip();
    zip.file('../evil.txt', 'x');
    zip.file('[Content_Types].xml', '<Types/>');
    const r = inspectZip(await zip.generateAsync({ type: 'nodebuffer' }));
    // JSZip 可能會正規化路徑；不論是否保留 ../，結果要嘛被拒絕，要嘛名稱不含 ..
    expect(r.ok === false || r.names.every(n => !n.includes('..'))).toBe(true);
  });
  test('損毀或過短的資料', () => {
    expect(inspectZip(Buffer.from('PK')).ok).toBe(false);
    expect(inspectZip(Buffer.alloc(100)).ok).toBe(false);
  });
});
