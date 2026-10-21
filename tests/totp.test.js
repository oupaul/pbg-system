const crypto = require('crypto');
const { base32Encode, base32Decode, generateSecret, hotp, totp, timeStep, verifyTotp, otpauthUri } = require('../src/utils/totp');
const secretBox = require('../src/utils/secretBox');

// RFC 4226 附錄 D 的 HOTP 測試向量（密鑰 "12345678901234567890"）
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const HOTP_VECTORS = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

describe('Base32', () => {
  test('RFC 4648 測試向量', () => {
    const vectors = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
  });
  test('解碼容許小寫、空白與連字號，拒絕非法字元', () => {
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow(); // 1 不在字母表內
  });
  test('隨機往返', () => {
    for (let i = 0; i < 20; i++) {
      const buf = crypto.randomBytes(20);
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });
});

describe('HOTP / TOTP（RFC 測試向量）', () => {
  test.each(HOTP_VECTORS.map((code, counter) => [counter, code]))('HOTP counter=%i → %s', (counter, code) => {
    expect(hotp(RFC_SECRET, counter)).toBe(code);
  });

  // RFC 6238 附錄 B（SHA-1，8 位數）：T=59 → 94287082、T=1111111109 → 07081804、T=20000000000 → 65353130
  test.each([[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']])(
    'TOTP 8 位數 t=%i → %s', (t, code) => {
      expect(totp(RFC_SECRET, t * 1000, { digits: 8 })).toBe(code);
    });

  test('6 位數就是 8 位數的末 6 碼', () => {
    expect(totp(RFC_SECRET, 59 * 1000)).toBe('287082');
  });
});

describe('verifyTotp', () => {
  const secret = generateSecret();
  const now = 1_800_000_000_000;
  const step = timeStep(now);

  test('目前、前一個、後一個時間步都接受；再遠的拒絕', () => {
    expect(verifyTotp(secret, hotp(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, hotp(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, hotp(secret, step + 1), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(secret, hotp(secret, step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step + 2), { nowMs: now })).toBeNull();
  });

  test('同一個時間步不能重複使用（lastStep 之前或相等的都拒絕）', () => {
    const code = hotp(secret, step);
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step - 1 })).toBe(step);
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step - 1), { nowMs: now, lastStep: step })).toBeNull();
  });

  test('格式不對的輸入一律拒絕；空白會被忽略', () => {
    const code = hotp(secret, step);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now })).toBe(step);
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5']) {
      expect(verifyTotp(secret, bad, { nowMs: now })).toBeNull();
    }
  });

  test('錯誤的驗證碼', () => {
    const wrong = String((parseInt(hotp(secret, step), 10) + 1) % 1000000).padStart(6, '0');
    expect(verifyTotp(secret, wrong, { nowMs: now })).toBeNull();
  });
});

test('otpauth 網址包含密鑰、發行者與參數，帳號與發行者會被編碼', () => {
  const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'a b@x.com', issuer: '業績 獎金' });
  expect(uri.startsWith('otpauth://totp/')).toBe(true);
  expect(uri).toContain(encodeURIComponent('業績 獎金') + ':' + encodeURIComponent('a b@x.com'));
  expect(uri).toContain('secret=ABCDEFGH');
  expect(uri).toContain('digits=6');
  expect(uri).toContain('period=30');
});

describe('secretBox', () => {
  const original = process.env.SESSION_SECRET;
  beforeAll(() => { process.env.SESSION_SECRET = 'unit-test-session-secret'; });
  afterAll(() => { process.env.SESSION_SECRET = original; });

  test('加解密往返，每次密文都不同', () => {
    const a = secretBox.encrypt('JBSWY3DPEHPK3PXP');
    const b = secretBox.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(secretBox.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  test('金鑰不同（SESSION_SECRET 改變）、資料被竄改、格式不對都會失敗', () => {
    const payload = secretBox.encrypt('SECRET');
    process.env.SESSION_SECRET = 'a-different-secret';
    expect(() => secretBox.decrypt(payload)).toThrow();
    process.env.SESSION_SECRET = 'unit-test-session-secret';
    const parts = payload.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => secretBox.decrypt(parts.join('.'))).toThrow();
    expect(() => secretBox.decrypt('garbage')).toThrow();
    expect(() => secretBox.decrypt('v2.a.b.c')).toThrow();
  });

  test('不同用途（info）的金鑰互相獨立', () => {
    const payload = secretBox.encrypt('x', 'totp-secret');
    expect(() => secretBox.decrypt(payload, 'recovery-code')).toThrow();
  });

  test('keyedHash 結果固定、與金鑰有關', () => {
    const h1 = secretBox.keyedHash('ABCDE-FGHIJ');
    expect(h1).toBe(secretBox.keyedHash('ABCDE-FGHIJ'));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    process.env.SESSION_SECRET = 'another';
    expect(secretBox.keyedHash('ABCDE-FGHIJ')).not.toBe(h1);
  });

  test('沒有 SESSION_SECRET 時拒絕運作（不會用預設金鑰）', () => {
    delete process.env.SESSION_SECRET;
    expect(() => secretBox.encrypt('x')).toThrow(/SESSION_SECRET/);
  });
});
