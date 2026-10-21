const { round2, toMoney, sumMoney } = require('../src/utils/money');

describe('round2', () => {
  test('消除浮點誤差', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1000.1 - 600.05 - 400.05)).toBe(0);
    expect(round2(35432.00000000001)).toBe(35432);
  });
  test('四捨五入到小數第 2 位（含 1.005 這類邊界）', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1);
    expect(round2(12.344)).toBe(12.34);
    expect(round2(12.345)).toBe(12.35);
  });
  test('非數字回傳 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(undefined)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});

describe('toMoney', () => {
  test('解析使用者輸入', () => {
    expect(toMoney('1,234.567')).toBe(1234.57);
    expect(toMoney('  500 ')).toBe(500);
    expect(toMoney(99.999)).toBe(100);
  });
  test('空白、null、非數字回傳 fallback', () => {
    expect(toMoney('')).toBe(0);
    expect(toMoney(null)).toBe(0);
    expect(toMoney(undefined)).toBe(0);
    expect(toMoney('abc')).toBe(0);
    expect(toMoney('abc', NaN)).toBeNaN();
    expect(toMoney('', null)).toBeNull();
  });
});

describe('sumMoney', () => {
  test('加總不累積誤差', () => {
    const list = Array.from({ length: 10 }, () => 0.1);
    expect(list.reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(sumMoney(list)).toBe(1);
  });
  test('可傳取值函式，忽略空值', () => {
    expect(sumMoney([{ a: 0.1 }, { a: 0.2 }, { a: null }, {}], x => x.a)).toBe(0.3);
    expect(sumMoney([])).toBe(0);
  });
});
