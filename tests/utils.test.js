const escapeHtml = require('../src/utils/escapeHtml');
const { jsAttr } = require('../src/utils/escapeHtml');
const jsonForScript = require('../src/utils/jsonForScript');
const safeRedirect = require('../src/utils/safeRedirect');

describe('escapeHtml', () => {
  test('跳脫五個 HTML 特殊字元', () => {
    expect(escapeHtml('<a href="x">\'&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  });
  test('null/undefined 變空字串，數字轉字串', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });
  test('XSS payload 不會留下可執行的標籤', () => {
    const out = escapeHtml('"><img src=x onerror=alert(1)>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('"');
  });
});

describe('jsAttr（放進 onclick 的單引號 JS 字串）', () => {
  test('先 JS 跳脫再 HTML 跳脫：單引號與反斜線不會跳出字串', () => {
    expect(jsAttr("a'b\\c")).toBe("a\\&#39;b\\\\c");
  });
  test('換行被跳脫、HTML 特殊字元被實體化', () => {
    expect(jsAttr('x\n<y>')).toBe('x\\n&lt;y&gt;');
  });
});

describe('jsonForScript（嵌入 <script> 的 JSON）', () => {
  test('</script> 與單引號、& 被跳脫', () => {
    const out = jsonForScript({ a: "</script><script>alert(1)</script>'&" });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain("'");
    expect(out).not.toContain('&');
    expect(JSON.parse(out).a).toBe("</script><script>alert(1)</script>'&");
  });
  test('U+2028/2029 被跳脫', () => {
    expect(jsonForScript('a b')).toBe('"a\\u2028b"');
  });
  test('undefined 變 null', () => {
    expect(jsonForScript(undefined)).toBe('null');
  });
});

describe('safeRedirect（防開放式重導）', () => {
  test.each([
    ['/projects/1', '/projects/1'],
    ['/ok?x=1', '/ok?x=1'],
  ])('允許站內路徑 %s', (input, expected) => {
    expect(safeRedirect(input, '/')).toBe(expected);
  });
  test.each([
    '//evil.com', '/\\evil.com', 'http://evil.com', 'javascript:alert(1)', '/a\nb', '', undefined, null, 123,
  ])('拒絕 %p', (input) => {
    expect(safeRedirect(input, '/home')).toBe('/home');
  });
});
