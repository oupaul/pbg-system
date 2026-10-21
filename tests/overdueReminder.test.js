const { shouldRunNow, buildDigest, daysBetween, localDateStr, parseTimeToMinutes } = require('../src/services/OverdueReminderService');

// 2026-10-19 是週一、2026-10-21 是週三、2026-10-24 是週六
const at = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm, 0);
const base = { enabled: true, frequency: 'weekly', time: '09:00', lastRunDate: '' };

describe('shouldRunNow', () => {
  test('停用時不執行', () => {
    expect(shouldRunNow({ ...base, enabled: false, now: at(2026, 10, 19) })).toBe(false);
  });
  test('weekly：週一到時間執行；時間未到不執行', () => {
    expect(shouldRunNow({ ...base, now: at(2026, 10, 19, 9, 0) })).toBe(true);
    expect(shouldRunNow({ ...base, now: at(2026, 10, 19, 8, 59) })).toBe(false);
  });
  test('weekly：非週一且沒有補發條件時不執行', () => {
    expect(shouldRunNow({ ...base, now: at(2026, 10, 21), lastRunDate: '2026-10-19' })).toBe(false);
    expect(shouldRunNow({ ...base, now: at(2026, 10, 21), lastRunDate: '' })).toBe(false);
  });
  test('weekly：錯過週一，距上次執行滿 7 天會補發', () => {
    expect(shouldRunNow({ ...base, now: at(2026, 10, 21), lastRunDate: '2026-10-12' })).toBe(true);
    expect(shouldRunNow({ ...base, now: at(2026, 10, 21), lastRunDate: '2026-10-15' })).toBe(false);
  });
  test('今天已經執行過就不再執行', () => {
    expect(shouldRunNow({ ...base, now: at(2026, 10, 19, 15), lastRunDate: '2026-10-19' })).toBe(false);
  });
  test('daily：只有週一到週五', () => {
    expect(shouldRunNow({ ...base, frequency: 'daily', now: at(2026, 10, 21) })).toBe(true);
    expect(shouldRunNow({ ...base, frequency: 'daily', now: at(2026, 10, 24) })).toBe(false);
    expect(shouldRunNow({ ...base, frequency: 'daily', now: at(2026, 10, 25) })).toBe(false);
  });
  test('時間格式錯誤時退回預設 09:00', () => {
    expect(shouldRunNow({ ...base, time: 'abc', now: at(2026, 10, 19, 9, 0) })).toBe(true);
    expect(shouldRunNow({ ...base, time: 'abc', now: at(2026, 10, 19, 8, 0) })).toBe(false);
  });
});

describe('日期工具', () => {
  test('daysBetween 與 localDateStr', () => {
    expect(daysBetween('2026-09-25', '2026-10-21')).toBe(26);
    expect(daysBetween('2026-10-28', '2026-10-21')).toBe(-7);
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(localDateStr(at(2026, 1, 5))).toBe('2026-01-05');
  });
  test('parseTimeToMinutes', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('9:05')).toBe(545);
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes('')).toBeNull();
  });
});

describe('buildDigest', () => {
  const item = (over) => ({ salesperson_name: '王小明', project_code: 'P1', project_name: '案', invoice_number: 'AB1', unpaid: 100000, expected_payment_date: '2026-10-10', ...over });
  const opts = { today: '2026-10-21', symbol: '$', upcomingDays: 7 };

  test('沒有任何項目回傳 null', () => {
    expect(buildDigest({ overdue: [], upcoming: [] }, opts)).toBeNull();
  });

  test('業務本人：標題與逾期／即將到期兩段', () => {
    const d = buildDigest({
      overdue: [item({ unpaid: 100000, expected_payment_date: '2026-10-10' }), item({ invoice_number: 'AB2', unpaid: 50000, expected_payment_date: '2026-09-21' })],
      upcoming: [item({ invoice_number: 'AB3', unpaid: 30000, expected_payment_date: '2026-10-24' })]
    }, opts);
    expect(d.title).toBe('收款提醒：逾期 2 張（$150,000）、即將到期 1 張（$30,000）');
    expect(d.message).toContain('逾期未收（2 張，合計 $150,000）');
    expect(d.message).toContain('逾期 30 天（預計 2026-09-21）');
    expect(d.message).toContain('逾期 11 天（預計 2026-10-10）');
    expect(d.message).toContain('7 天內即將到期（1 張，合計 $30,000）');
    expect(d.message).toContain('預計 2026-10-24（3 天後）');
    // 逾期最久的排在前面
    expect(d.message.indexOf('AB2')).toBeLessThan(d.message.indexOf('AB1'));
    expect(d.message).not.toContain('各業務概況');
  });

  test('今天到期顯示「今天」', () => {
    const d = buildDigest({ overdue: [], upcoming: [item({ expected_payment_date: '2026-10-21' })] }, opts);
    expect(d.message).toContain('（今天）');
  });

  test('彙總：加上各業務概況、每行顯示業務名稱、標題加「彙總」與測試前綴', () => {
    const d = buildDigest({
      overdue: [item({ salesperson_name: '王小明', unpaid: 100000 }), item({ salesperson_name: '李大華', invoice_number: 'AB9', unpaid: 300000 })],
      upcoming: []
    }, { ...opts, showSalesperson: true, byPerson: true, testPrefix: '【測試】' });
    expect(d.title).toBe('【測試】收款提醒彙總：逾期 2 張（$400,000）');
    expect(d.message).toContain('各業務概況');
    expect(d.message).toContain('・李大華：逾期 1 張 $300,000');
    // 金額較大的業務排在前面
    expect(d.message.indexOf('・李大華：')).toBeLessThan(d.message.indexOf('・王小明：'));
    expect(d.message).toContain('・王小明｜P1');
  });

  test('超過 15 筆時截斷並提示', () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ invoice_number: `N${i}` }));
    const d = buildDigest({ overdue: many, upcoming: [] }, opts);
    expect(d.message).toContain('…另有 5 筆，請登入系統查看');
    expect((d.message.match(/^・/gm) || []).length).toBe(15);
  });
});
