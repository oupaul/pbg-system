const { accountLockedMinutes, recordAccountFailure, clearAccountFailures } = require('../src/middleware/rateLimiter');

describe('帳號層級失敗鎖定', () => {
  test('連續失敗 5 次後鎖定，且不分大小寫；清除後解除', () => {
    const user = 'lock-test-user';
    for (let i = 0; i < 4; i++) recordAccountFailure(user);
    expect(accountLockedMinutes(user)).toBe(0);
    recordAccountFailure(user.toUpperCase());
    expect(accountLockedMinutes(user)).toBeGreaterThan(0);
    clearAccountFailures(user);
    expect(accountLockedMinutes(user)).toBe(0);
  });
  test('不存在的帳號同樣會鎖定（避免洩漏帳號是否存在）', () => {
    const user = 'ghost-' + Date.now();
    for (let i = 0; i < 5; i++) recordAccountFailure(user);
    expect(accountLockedMinutes(user)).toBeGreaterThan(0);
    clearAccountFailures(user);
  });
});
