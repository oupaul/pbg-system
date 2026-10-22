// 時區：Jest 沙盒內改 process.env.TZ 不會生效，所以每個案例用子程序、各自指定 TZ 執行，再比對輸出。
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 在指定時區的子程序執行 script（script 最後 console.log(JSON.stringify(結果))），回傳解析後的結果
function inTz(tz, script) {
  const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}
const probe = `
  const L = require('./src/utils/localTime');
  const T = require('./src/utils/projectTimeline');
  const d = new Date('2026-10-21T18:30:00Z');
  console.log(JSON.stringify({
    isoDate: d.toISOString().slice(0, 10),
    localDate: L.localDate(d),
    localDateTime: L.localDateTime(d),
    utc: L.utcToLocal('2026-10-21 18:30:00'),
    utcT: L.utcToLocal('2026-10-21T18:30:00'),
    newYear: L.utcToLocal('2026-12-31 20:00:01'),
    dateOnly: L.utcToLocal('2026-10-21'),
    empty: L.utcToLocal(''),
    nul: L.utcToLocal(null),
    text: L.utcToLocal('作廢'),
    num: L.utcToLocal(12345),
    voided: L.displayTimeField('voided_at', '2026-10-21 18:30:00'),
    deleted: L.displayTimeField('deleted_at', '2026-10-21 18:30:00'),
    created: L.displayTimeField('created_at', '2026-10-21 18:30:00'),
    tlVoided: T.formatValue('voided_at', '2026-10-21 18:30:00', { symbol: '$' }),
    tlDateOnly: T.formatValue('voided_at', '2026-10-21', { symbol: '$' }),
    tlEmpty: T.formatValue('voided_at', null, { symbol: '$' }),
    early: L.localDate(new Date('2026-10-21T02:00:00Z')),
    earlyUtc: L.utcToLocal('2026-10-21 02:00:00')
  }));
`;

describe('伺服器時區為台灣（UTC+8）', () => {
  const r = inTz('Asia/Taipei', probe);

  test('localDate 用本地日期：UTC 前一天 18:30 在台灣已經是隔天（舊寫法 toISOString 會錯）', () => {
    expect(r.isoDate).toBe('2026-10-21');
    expect(r.localDate).toBe('2026-10-22');
    expect(r.localDateTime).toBe('2026-10-22 02:30:00');
  });
  test('utcToLocal：UTC 時間字串轉成本地時間（含跨日、跨年）', () => {
    expect(r.utc).toBe('2026-10-22 02:30:00');
    expect(r.utcT).toBe('2026-10-22 02:30:00');
    expect(r.newYear).toBe('2027-01-01 04:00:01');
  });
  test('純日期（使用者選的作廢日期）與非時間字串原樣回傳', () => {
    expect(r.dateOnly).toBe('2026-10-21');
    expect(r.empty).toBe('');
    expect(r.nul).toBeNull();
    expect(r.text).toBe('作廢');
    expect(r.num).toBe(12345);
  });
  test('displayTimeField 只轉 voided_at、deleted_at，其他時間欄位（本來就是本地時間）不動', () => {
    expect(r.voided).toBe('2026-10-22 02:30:00');
    expect(r.deleted).toBe('2026-10-22 02:30:00');
    expect(r.created).toBe('2026-10-21 18:30:00');
  });
  test('專案時間軸顯示作廢時間時轉本地時間', () => {
    expect(r.tlVoided).toBe('2026-10-22 02:30:00');
    expect(r.tlDateOnly).toBe('2026-10-21');
    expect(r.tlEmpty).toBe('（空白）');
  });
});

describe('伺服器時區為 UTC', () => {
  test('本地就是 UTC，不做任何位移', () => {
    const r = inTz('UTC', probe);
    expect(r.localDate).toBe('2026-10-21');
    expect(r.utc).toBe('2026-10-21 18:30:00');
    expect(r.tlVoided).toBe('2026-10-21 18:30:00');
  });
});

describe('伺服器時區在 UTC 以西（紐約，10 月為 UTC-4）', () => {
  test('UTC 凌晨在本地仍是前一天', () => {
    const r = inTz('America/New_York', probe);
    expect(r.early).toBe('2026-10-20');
    expect(r.earlyUtc).toBe('2026-10-20 22:00:00');
  });
});
