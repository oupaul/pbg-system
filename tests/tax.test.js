const { toExTax, parseTaxIncluded, DEFAULT_TAX_RATE } = require('../src/utils/tax');

describe('含稅換算未稅', () => {
  test('含稅金額依稅率換算，四捨五入到 2 位', () => {
    expect(toExTax(105, true, 5)).toBe(100);
    expect(toExTax(1000, true, 5)).toBe(952.38);
    expect(toExTax(900, true, 5)).toBe(857.14);
    expect(toExTax(100, true, 10)).toBe(90.91);
    expect(toExTax(0.1, true, 5)).toBe(0.1);
    expect(toExTax(1.05, true, 5)).toBe(1);
  });

  test('免稅／未稅：金額原樣不換算', () => {
    expect(toExTax(1000, false, 5)).toBe(1000);
    expect(toExTax(2500.5, false, 5)).toBe(2500.5);
  });

  test('稅率 0 不換算；負數（沖銷）照算；非數字當 0', () => {
    expect(toExTax(1000, true, 0)).toBe(1000);
    expect(toExTax(-105, true, 5)).toBe(-100);
    expect(toExTax('abc', true, 5)).toBe(0);
    expect(toExTax(null, true, 5)).toBe(0);
  });

  test('沒給稅率時用預設 5%', () => {
    expect(DEFAULT_TAX_RATE).toBe(5);
    expect(toExTax(105, true)).toBe(100);
  });
});

describe('稅別值解析', () => {
  test('空白、含稅、1 都是含稅（預設）', () => {
    for (const v of [undefined, null, '', ' ', '1', 1, '含稅', 'true', true]) expect(parseTaxIncluded(v)).toBe(1);
  });
  test('免稅、未稅、0 都是免稅', () => {
    for (const v of ['0', 0, '免稅', '未稅', '零稅率', '免稅/未稅', '免稅／未稅', 'false', false]) expect(parseTaxIncluded(v)).toBe(0);
  });
  test('認不得的值回傳 null（呼叫端要報錯，不能默默當成含稅）', () => {
    for (const v of ['亂填', '2', '含 稅', '5%']) expect(parseTaxIncluded(v)).toBeNull();
  });
});
