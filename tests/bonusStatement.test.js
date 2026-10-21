const {
  resolvePeriod, partitionBonuses, totalsOf, statementId, statementFileName
} = require('../src/utils/bonusStatement');
const { renderStatementPdf } = require('../src/utils/bonusStatementPdf');
const { getChineseFontPath } = require('../src/services/PdfExportService').helpers;

describe('resolvePeriod', () => {
  test('全年、季、月', () => {
    expect(resolvePeriod(2026, 'year')).toMatchObject({ code: '2026', start: '2026-01-01', end: '2026-12-31' });
    expect(resolvePeriod('2026', 'q3')).toMatchObject({ code: '2026Q3', start: '2026-07-01', end: '2026-09-30' });
    expect(resolvePeriod(2026, 'Q4')).toMatchObject({ code: '2026Q4', start: '2026-10-01', end: '2026-12-31' });
    expect(resolvePeriod(2026, 'm2')).toMatchObject({ code: '202602', start: '2026-02-01', end: '2026-02-28' });
    expect(resolvePeriod(2028, 'm2')).toMatchObject({ end: '2028-02-29' }); // 閏年
    expect(resolvePeriod(2026, 'm12')).toMatchObject({ code: '202612', end: '2026-12-31' });
  });

  test('不合法的年度或期間回傳 null', () => {
    expect(resolvePeriod(1999, 'year')).toBeNull();
    expect(resolvePeriod(2101, 'year')).toBeNull();
    expect(resolvePeriod('abc', 'year')).toBeNull();
    expect(resolvePeriod(2026, 'q5')).toBeNull();
    expect(resolvePeriod(2026, 'm0')).toBeNull();
    expect(resolvePeriod(2026, 'm13')).toBeNull();
    expect(resolvePeriod(2026, "year' OR 1=1")).toBeNull();
  });
});

describe('partitionBonuses 分組規則', () => {
  const period = resolvePeriod(2026, 'q3'); // 2026-07-01 ~ 2026-09-30
  const row = (o) => ({ project_code: 'P', bonus_type: '業績獎金', bonus_amount: 100, ...o });
  const rows = [
    row({ id: 1, status: '已發放', payment_date: '2026-07-01' }),            // 期間第一天 → 已發放
    row({ id: 2, status: '已發放', payment_date: '2026-09-30' }),            // 期間最後一天 → 已發放
    row({ id: 3, status: '已發放', payment_date: '2026-06-30' }),            // 期間前一天 → 不列
    row({ id: 4, status: '已發放', payment_date: '2026-10-01' }),            // 期間後一天 → 不列
    row({ id: 5, status: '已發放', payment_date: null }),                    // 沒有發放日 → 不列
    row({ id: 6, status: '待發放', payment_date: null }),                    // 待發放不受期間限制
    row({ id: 7, status: '待發放', payment_date: '2025-01-01' }),
    row({ id: 8, status: '充公', payment_date: '2026-08-15' }),              // 充公用發放日
    row({ id: 9, status: '充公', payment_date: null, updated_at: '2026-09-02 10:00:00' }), // 無發放日用更新日
    row({ id: 10, status: '充公', payment_date: null, updated_at: '2026-01-02 10:00:00' }) // 不在期間 → 不列
  ];
  const g = partitionBonuses(rows, period);
  const idsOf = (list) => list.map(r => r.id).sort((a, b) => a - b);

  test('各組內容', () => {
    expect(idsOf(g.paid)).toEqual([1, 2]);
    expect(idsOf(g.pending)).toEqual([6, 7]);
    expect(idsOf(g.forfeited)).toEqual([8, 9]);
  });

  test('每一筆最多出現在一個群組，合計正確', () => {
    const all = [...g.paid, ...g.pending, ...g.forfeited].map(r => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(totalsOf(g)).toEqual({ paid: 200, pending: 200, forfeited: 200 });
  });

  test('金額合計不累積浮點誤差', () => {
    const t = totalsOf({ paid: [{ bonus_amount: 0.1 }, { bonus_amount: 0.2 }], pending: [], forfeited: [] });
    expect(t.paid).toBe(0.3);
  });

  test('已發放依發放日排序', () => {
    const sorted = partitionBonuses([
      row({ id: 1, status: '已發放', payment_date: '2026-09-01' }),
      row({ id: 2, status: '已發放', payment_date: '2026-07-05' })
    ], period);
    expect(sorted.paid.map(r => r.id)).toEqual([2, 1]);
  });
});

describe('對帳單編號與檔名', () => {
  test('編號包含業務、期間與產出時間', () => {
    const id = statementId({ salespersonId: 7, periodCode: '2026Q3', now: new Date(2026, 9, 21, 14, 30, 5) });
    expect(id).toBe('BS-7-2026Q3-20261021143005');
  });

  test('檔名移除不安全字元', () => {
    expect(statementFileName('王小明', '2026Q3')).toBe('獎金對帳單_王小明_2026Q3.pdf');
    expect(statementFileName('a/b\\c:d"e\r\nf', '2026')).not.toMatch(/[\\/:"\r\n]/);
    expect(statementFileName('', '2026')).toBe('獎金對帳單_業務_2026.pdf');
  });
});

describe('renderStatementPdf', () => {
  const mk = (n, status) => Array.from({ length: n }, (_, i) => ({
    id: i, status, project_code: `P2026-${i}`, project_name: `機房整合建置案第${i}期（含門禁與監視系統汰換）`,
    customer_name: '甲乙丙科技股份有限公司', bonus_type: '業績獎金', base_amount: 1000000 + i,
    bonus_percentage: 3.5, bonus_amount: 35000 + i, payment_date: '2026-08-10', forfeiture_reason: status === '充公' ? '離職' : null
  }));
  const data = (paidCount) => {
    const groups = { paid: mk(paidCount, '已發放'), pending: mk(2, '待發放'), forfeited: mk(1, '充公') };
    return {
      company: '示範科技股份有限公司', salespersonName: '王小明', periodLabel: '2026 年第 3 季（7～9 月）',
      statementId: 'BS-1-2026Q3-20261021143005', generatedAt: '2026-10-21 14:30', generatedBy: '系統管理員',
      groups, totals: totalsOf(groups)
    };
  };

  test('產出有效的 PDF（含中文字型）', async () => {
    const fontPath = getChineseFontPath();
    expect(fontPath).toBeTruthy();
    const buf = await renderStatementPdf(data(3), { fontPath });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.toString('latin1')).toMatch(/NotoSans/);
  });

  test('資料很多時會分頁，沒有資料的群組也能正常輸出', async () => {
    const fontPath = getChineseFontPath();
    const many = await renderStatementPdf(data(60), { fontPath });
    const pages = (b) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages(many)).toBeGreaterThan(2);
    const empty = await renderStatementPdf({ ...data(0), groups: { paid: [], pending: [], forfeited: [] }, totals: { paid: 0, pending: 0, forfeited: 0 } }, { fontPath });
    expect(empty.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
