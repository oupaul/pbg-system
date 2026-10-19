const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectPreviewKind, readTextPreview, parseDelimited } = require('../src/utils/attachmentPreview');

let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('detectPreviewKind', () => {
  test('依檔頭判斷圖片，不看副檔名', () => {
    expect(detectPreviewKind(write('a.bin', PNG), 'a.bin')).toEqual({ kind: 'image', contentType: 'image/png' });
    expect(detectPreviewKind(write('b.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'b.jpg').contentType).toBe('image/jpeg');
    expect(detectPreviewKind(write('c.gif', Buffer.from('GIF89a......')), 'c.gif').contentType).toBe('image/gif');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(detectPreviewKind(write('d.webp', webp), 'd.webp').contentType).toBe('image/webp');
  });
  test('副檔名是 png 但內容不是圖片 → 不預覽', () => {
    expect(detectPreviewKind(write('fake.png', '<html><script>alert(1)</script></html>'), 'fake.png')).toBeNull();
  });
  test('PDF 需檔頭為 %PDF-', () => {
    expect(detectPreviewKind(write('a.pdf', '%PDF-1.4 ...'), 'a.pdf').kind).toBe('pdf');
    expect(detectPreviewKind(write('b.pdf', '<html>not a pdf</html>'), 'b.pdf')).toBeNull();
  });
  test('SVG、HTML 一律不預覽', () => {
    expect(detectPreviewKind(write('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg')).toBeNull();
    expect(detectPreviewKind(write('x.html', '<html></html>'), 'x.html')).toBeNull();
  });
  test('文字與 CSV 看副檔名且內容不含 NUL', () => {
    expect(detectPreviewKind(write('a.txt', 'hello'), 'a.txt').kind).toBe('text');
    expect(detectPreviewKind(write('a.csv', 'a,b\n1,2'), 'a.csv').kind).toBe('csv');
    expect(detectPreviewKind(write('bin.txt', Buffer.from([0x41, 0x00, 0x42])), 'bin.txt')).toBeNull();
    expect(detectPreviewKind(write('noext', 'hello'), 'noext')).toBeNull();
  });
  test('檔案不存在回傳 null', () => {
    expect(detectPreviewKind(path.join(dir, 'missing'), 'missing.png')).toBeNull();
  });
});

describe('readTextPreview', () => {
  test('UTF-8（含 BOM）文字', () => {
    const p = write('u.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文內容')]));
    const r = readTextPreview(p, 'u.txt', 'text');
    expect(r.text).toBe('中文內容');
    expect(r.encoding).toBe('UTF-8');
  });
  test('Big5 編碼的 CSV', () => {
    const big5 = Buffer.from([0xa5, 0x5f, 0xa8, 0xcc, 0x2c, 0x31]); // "北走,1" 的 Big5 位元組
    const p = write('b.csv', big5);
    const r = readTextPreview(p, 'b.csv', 'csv');
    expect(r.encoding).toBe('Big5');
    expect(r.rows[0].length).toBe(2);
  });
  test('CSV 支援引號、引號內逗號與換行', () => {
    const p = write('q.csv', 'name,note\n"A, B","line1\nline2"\n"say ""hi""",x\n');
    const r = readTextPreview(p, 'q.csv', 'csv');
    expect(r.rows).toEqual([['name', 'note'], ['A, B', 'line1\nline2'], ['say "hi"', 'x']]);
  });
  test('分號與 Tab 分隔自動判斷', () => {
    expect(readTextPreview(write('s.csv', 'a;b;c\n1;2;3'), 's.csv', 'csv').rows[1]).toEqual(['1', '2', '3']);
    expect(readTextPreview(write('t.tsv', 'a\tb\n1\t2'), 't.tsv', 'csv').rows[1]).toEqual(['1', '2']);
  });
  test('大檔案只讀前 256KB 並標示截斷', () => {
    const p = write('big.txt', 'x'.repeat(300 * 1024));
    const r = readTextPreview(p, 'big.txt', 'text');
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(256 * 1024);
  });
  test('CSV 最多 500 列、40 欄', () => {
    const lines = ['h'];
    for (let i = 0; i < 800; i++) lines.push(Array.from({ length: 60 }, (_, j) => j).join(','));
    const r = readTextPreview(write('many.csv', lines.join('\n')), 'many.csv', 'csv');
    expect(r.rows.length).toBeLessThanOrEqual(501);
    expect(r.truncated).toBe(true);
    expect(r.columnsTruncated).toBe(true);
    expect(Math.max(...r.rows.map(row => row.length))).toBeLessThanOrEqual(40);
  });
  test('無法辨識編碼時回傳錯誤', () => {
    const r = readTextPreview(write('weird.txt', Buffer.from([0xff, 0xfe, 0xfd, 0x80, 0x81])), 'weird.txt', 'text');
    expect(r.error).toBeTruthy();
  });
});

describe('parseDelimited', () => {
  test('空字串', () => {
    expect(parseDelimited('', ',').rows).toEqual([]);
  });
});
