const { shortAmount, niceMax, formatDelta, renderTrendSvg } = require('../src/utils/dashboardChart');
const DashboardSummaryService = require('../src/services/DashboardSummaryService');

describe('shortAmount', () => {
  test('依大小縮寫', () => {
    expect(shortAmount(0)).toBe('0');
    expect(shortAmount(9999)).toBe('9,999');
    expect(shortAmount(12000)).toBe('1萬');
    expect(shortAmount(3450000)).toBe('345萬');
    expect(shortAmount(120000000)).toBe('1.2億');
    expect(shortAmount(200000000)).toBe('2億');
  });
});

describe('niceMax', () => {
  test('取好看的上限', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(730)).toBe(1000);
    expect(niceMax(1800000)).toBe(2000000);
    expect(niceMax(2300000)).toBe(2500000);
    expect(niceMax(4100000)).toBe(5000000);
    expect(niceMax(5100000)).toBe(10000000);
  });
});

describe('formatDelta', () => {
  test('增加／減少／持平／無法比較', () => {
    expect(formatDelta(150, 100)).toEqual({ text: '較上月 +50%', dir: 'up' });
    expect(formatDelta(50, 100)).toEqual({ text: '較上月 -50%', dir: 'down' });
    expect(formatDelta(100, 100)).toEqual({ text: '與上月持平', dir: 'flat' });
    expect(formatDelta(0, 0)).toEqual({ text: '與上月持平', dir: 'flat' });
    expect(formatDelta(500, 0)).toEqual({ text: '上月無資料', dir: 'none' });
    expect(formatDelta(0, 100)).toEqual({ text: '較上月 -100%', dir: 'down' });
  });
});

describe('renderTrendSvg', () => {
  const trend = DashboardSummaryService.lastMonths(new Date(2026, 9, 19), 12).map((ym, i) => ({ ym, invoiced: i * 1000, received: i * 500 }));
  test('輸出 12 組長條與標題文字，全為受控內容', () => {
    const svg = renderTrendSvg(trend, '2026-10');
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<rect /g) || []).length).toBe(24);
    expect(svg).toContain('2026-10 開票 11,000');
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  test('全部為 0 也不會產生 NaN', () => {
    const zero = trend.map(t => ({ ...t, invoiced: 0, received: 0 }));
    expect(renderTrendSvg(zero, '2026-10')).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('月份計算', () => {
  test('lastMonths 跨年', () => {
    const list = DashboardSummaryService.lastMonths(new Date(2026, 1, 15), 4);
    expect(list).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  test('shiftMonth', () => {
    expect(DashboardSummaryService.shiftMonth(2026, 1, 1)).toEqual({ year: 2025, month: 12 });
    expect(DashboardSummaryService.shiftMonth(2026, 3, 14)).toEqual({ year: 2025, month: 1 });
  });
});
