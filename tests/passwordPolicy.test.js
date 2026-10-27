const PasswordPolicy = require('../src/utils/passwordPolicy');

const v = (pw, opts = {}) => PasswordPolicy.validate(pw, { complexity: false, ...opts });

describe('密碼規則：長度（固定最短 6 個字元）', () => {
  test('最短長度是 6', () => { expect(PasswordPolicy.MIN_LENGTH).toBe(6); });
  test('6 個字元可以，5 個字元不行', () => {
    expect(v('abcdef').ok).toBe(true);
    expect(v('abcde').ok).toBe(false);
    expect(v('abcde').message).toContain('至少需要 6 個字元');
  });
  test('空值、非字串、純空白不行', () => {
    for (const bad of ['', null, undefined, 12345678, {}, []]) expect(v(bad).ok).toBe(false);
    expect(v('      ').ok).toBe(true); // 6 個空白算 6 個字元（不額外規定；複雜度開啟時才會被擋）
  });
  test('上限 128：超過不行，剛好 128 可以', () => {
    expect(v('a'.repeat(128)).ok).toBe(true);
    expect(v('a'.repeat(129)).ok).toBe(false);
    expect(v('a'.repeat(129)).message).toContain('不可超過 128');
  });
  test('中文與表情符號各算字元，不會被誤判', () => {
    expect(v('密碼密碼密碼').ok).toBe(true);
    expect(v('密碼密碼密').ok).toBe(false);
  });
  test('複雜度關閉時，簡單密碼（只有數字）也可以', () => {
    expect(v('123456').ok).toBe(true);
    expect(v('password').ok).toBe(true);
  });
});

describe('密碼規則：複雜度（管理員開啟時）', () => {
  const c = (pw, username = 'paul') => PasswordPolicy.validate(pw, { complexity: true, username });

  test('需包含大寫、小寫、數字、符號中的至少 3 種', () => {
    expect(c('abcdef').ok).toBe(false);     // 1 種
    expect(c('Abcdef').ok).toBe(false);     // 2 種
    expect(c('abc123').ok).toBe(false);     // 2 種
    expect(c('Abc123').ok).toBe(true);      // 3 種：大寫小寫數字
    expect(c('abc12!').ok).toBe(true);      // 3 種：小寫數字符號
    expect(c('ABC!12').ok).toBe(true);      // 3 種：大寫符號數字
    expect(c('Ab1!Cd').ok).toBe(true);      // 4 種
    expect(c('Abcdef').message).toContain('至少 3 種');
  });

  test('中文與空白算「符號」（非英數字元）', () => {
    expect(c('Abcd密碼').ok).toBe(true);    // 大寫、小寫、符號（6 個字元）
    expect(c('abc 12').ok).toBe(true);      // 小寫、符號（空白）、數字
  });

  test('不可包含使用者名稱（不分大小寫；名稱太短不檢查）', () => {
    expect(c('Xpaul-123A').ok).toBe(false);
    expect(c('XPAUL-123a').ok).toBe(false);
    expect(c('Xpaul-123A').message).toContain('使用者名稱');
    expect(c('Xpa-123Ab', 'pa').ok).toBe(true);  // 兩個字元的名稱不拿來比對
    expect(c('Abc-1234x', '').ok).toBe(true);
    expect(c('Abc-1234x', undefined).ok).toBe(true);
  });

  test('長度規則仍然先檢查：太短的訊息是長度，不是複雜度', () => {
    expect(c('Ab1').message).toContain('至少需要 6 個字元');
  });
});

describe('密碼規則：說明文字與設定', () => {
  test('describe 依是否開啟複雜度給不同說明', () => {
    expect(PasswordPolicy.describe(false)).toBe('至少 6 個字元');
    const on = PasswordPolicy.describe(true);
    expect(on).toContain('至少 6 個字元');
    expect(on).toContain('至少 3 種');
    expect(on).toContain('使用者名稱');
  });
  test('讀不到資料庫或設定時視為關閉（不會因此擋住所有人）', () => {
    // 單元測試環境沒有資料庫表：isComplexityEnabled 必須安全地回傳 false
    expect(PasswordPolicy.isComplexityEnabled()).toBe(false);
  });
});
