const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const {
  ATTACHMENT_EXTENSIONS,
  XLSX_EXTENSIONS,
  validateUploadedFile,
  validateXlsxStructure,
  guardedSingleUpload
} = require('../src/utils/uploadValidation');

let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(32)]);

describe('validateUploadedFile（附件白名單）', () => {
  test('內容與副檔名相符的常見格式通過', () => {
    expect(validateUploadedFile(write('a.pdf', '%PDF-1.7\n...'), 'a.pdf', ATTACHMENT_EXTENSIONS).ok).toBe(true);
    expect(validateUploadedFile(write('a.png', PNG), 'a.png', ATTACHMENT_EXTENSIONS).ok).toBe(true);
    expect(validateUploadedFile(write('a.jpg', JPG), 'photo.JPG', ATTACHMENT_EXTENSIONS).ok).toBe(true);
    expect(validateUploadedFile(write('a.xls', OLE), 'a.xls', ATTACHMENT_EXTENSIONS).ok).toBe(true);
    expect(validateUploadedFile(write('a.csv', '品項,金額\n門弓器,100\n'), '報價.csv', ATTACHMENT_EXTENSIONS).ok).toBe(true);
  });

  test('空白檔案、無副檔名拒絕', () => {
    expect(validateUploadedFile(write('empty.pdf', ''), 'empty.pdf', ATTACHMENT_EXTENSIONS).ok).toBe(false);
    expect(validateUploadedFile(write('noext', '%PDF-1.7'), 'noext', ATTACHMENT_EXTENSIONS).ok).toBe(false);
  });

  test('可執行／腳本／網頁／SVG 副檔名一律拒絕', () => {
    for (const name of ['x.exe', 'x.sh', 'x.js', 'x.html', 'x.htm', 'x.svg', 'x.php', 'x.bat', 'x.jar', 'x.dll', 'x.xlsm', 'x.docm']) {
      const r = validateUploadedFile(write(name, 'hello'), name, ATTACHMENT_EXTENSIONS);
      expect(r.ok).toBe(false);
    }
  });

  test('偽裝副檔名：內容和副檔名不符會拒絕', () => {
    expect(validateUploadedFile(write('fake.pdf', '<html><script>alert(1)</script></html>'), 'fake.pdf', ATTACHMENT_EXTENSIONS).ok).toBe(false);
    expect(validateUploadedFile(write('fake.png', '<svg onload=alert(1)>'), 'fake.png', ATTACHMENT_EXTENSIONS).ok).toBe(false);
    expect(validateUploadedFile(write('fake.docx', 'MZ\x90\x00 not a zip'), 'fake.docx', ATTACHMENT_EXTENSIONS).ok).toBe(false);
    expect(validateUploadedFile(write('fake.txt', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])), 'fake.txt', ATTACHMENT_EXTENSIONS).ok).toBe(false);
  });

  test('雙重副檔名只看最後一個', () => {
    expect(validateUploadedFile(write('a.pdf.exe', '%PDF-1.7'), 'a.pdf.exe', ATTACHMENT_EXTENSIONS).ok).toBe(false);
    expect(validateUploadedFile(write('a.exe.pdf', '%PDF-1.7'), 'a.exe.pdf', ATTACHMENT_EXTENSIONS).ok).toBe(true);
  });
});

describe('Excel 匯入檔驗證', () => {
  async function makeXlsx() {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('s').addRow(['a', 1]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  test('正常 .xlsx 通過', async () => {
    const p = write('ok.xlsx', await makeXlsx());
    expect(validateUploadedFile(p, 'ok.xlsx', XLSX_EXTENSIONS).ok).toBe(true);
    expect(validateXlsxStructure(p).ok).toBe(true);
  });

  test('只接受 .xlsx（.xls、.csv、.zip 都拒絕）', async () => {
    const buf = await makeXlsx();
    for (const name of ['a.xls', 'a.csv', 'a.zip', 'a.xlsm']) {
      expect(validateUploadedFile(write(name, buf), name, XLSX_EXTENSIONS).ok).toBe(false);
    }
  });

  test('一般 zip 改名成 .xlsx 會被結構檢查擋下', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const p = write('notexcel.xlsx', await zip.generateAsync({ type: 'nodebuffer' }));
    expect(validateUploadedFile(p, 'notexcel.xlsx', XLSX_EXTENSIONS).ok).toBe(true); // 檔頭是 zip
    expect(validateXlsxStructure(p).ok).toBe(false);
  });

  test('zip bomb（解壓後遠超上限）被擋下', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('big.bin', Buffer.alloc(160 * 1024 * 1024));
    const p = write('bomb.xlsx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect(validateXlsxStructure(p).ok).toBe(false);
  }, 30000); // 產生 160MB 測試檔，機器忙碌時超過預設 5 秒
});

describe('guardedSingleUpload', () => {
  function runGuard(guard, req) {
    return new Promise((resolve) => {
      const res = {};
      const [receive, verify] = guard;
      receive(req, res, (err) => {
        if (err) return resolve({ passed: false });
        verify(req, res, () => resolve({ passed: true }));
      });
      // onReject 會自行呼叫 resolve（見下方 guard 設定）
    });
  }

  test('驗證失敗會刪除檔案並呼叫 onReject，不會進入後面的處理函式', async () => {
    const filePath = write('upload-bad.pdf', '<html>x</html>');
    let rejected = null;
    const guard = guardedSingleUpload({
      multer: { single: () => (req, res, cb) => cb() },
      allowed: ATTACHMENT_EXTENSIONS,
      onReject: (req, res, message) => { rejected = message; res.done(); }
    });
    const req = { file: { path: filePath, originalname: 'upload-bad.pdf' } };
    const outcome = await new Promise((resolve) => {
      const res = { done: () => resolve({ passed: false }) };
      guard[0](req, res, () => guard[1](req, res, () => resolve({ passed: true })));
    });
    expect(outcome.passed).toBe(false);
    expect(rejected).toMatch(/不符/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('multer 超過大小限制時回報友善訊息', async () => {
    let rejected = null;
    const guard = guardedSingleUpload({
      multer: { single: () => (req, res, cb) => cb(Object.assign(new Error('x'), { code: 'LIMIT_FILE_SIZE' })) },
      allowed: ATTACHMENT_EXTENSIONS,
      onReject: (req, res, message) => { rejected = message; res.done(); }
    });
    await new Promise((resolve) => {
      const res = { done: resolve };
      guard[0]({}, res, () => resolve());
    });
    expect(rejected).toMatch(/檔案過大/);
  });

  test('沒有選檔案時放行給後面的處理函式回報', async () => {
    const guard = guardedSingleUpload({
      multer: { single: () => (req, res, cb) => cb() },
      allowed: ATTACHMENT_EXTENSIONS,
      onReject: () => { throw new Error('不應被呼叫'); }
    });
    const outcome = await runGuard(guard, {});
    expect(outcome.passed).toBe(true);
  });
});
