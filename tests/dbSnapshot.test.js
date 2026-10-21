const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSnapshot } = require('../src/utils/dbSnapshot');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// 模擬 VACUUM INTO：從 SQL 解析出目的地檔案並建立
function fakeExec(sql) {
  const m = /^VACUUM INTO '(.*)'$/s.exec(sql);
  if (!m) throw new Error('unexpected sql: ' + sql);
  fs.writeFileSync(m[1].replace(/''/g, "'"), 'snapshot');
}

describe('createSnapshot', () => {
  test('建立 invoice_bonus.db.pre-import-<時間> 並設定 600 權限', () => {
    const r = createSnapshot({ exec: fakeExec, dir, now: new Date('2026-10-21T05:30:00.123Z') });
    expect(r.name).toMatch(/^invoice_bonus\.db\.pre-import-20261021053000123-\d+$/);
    expect(fs.existsSync(r.path)).toBe(true);
    expect(fs.statSync(r.path).mode & 0o777).toBe(0o600);
  });

  test('只保留最近 keep 份，且不動其他前綴的檔案', () => {
    fs.writeFileSync(path.join(dir, 'invoice_bonus.db.pre-migrate-20260101000000000-1'), 'x');
    fs.writeFileSync(path.join(dir, 'invoice_bonus.db'), 'x');
    for (let i = 1; i <= 7; i++) {
      createSnapshot({ exec: fakeExec, dir, keep: 5, now: new Date(Date.UTC(2026, 9, 21, 5, i)) });
    }
    const left = fs.readdirSync(dir).filter(f => f.includes('.pre-import-')).sort();
    expect(left).toHaveLength(5);
    expect(left[0]).toContain('20261021050' + '3'); // 最舊的兩份（1、2 分）已刪除
    expect(fs.existsSync(path.join(dir, 'invoice_bonus.db.pre-migrate-20260101000000000-1'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'invoice_bonus.db'))).toBe(true);
  });

  test('路徑含單引號時 SQL 會正確跳脫', () => {
    const odd = path.join(dir, "it's");
    fs.mkdirSync(odd);
    const r = createSnapshot({ exec: fakeExec, dir: odd });
    expect(fs.existsSync(r.path)).toBe(true);
  });

  test('快照失敗會拋出例外（呼叫端據此中止匯入）', () => {
    expect(() => createSnapshot({ exec: () => { throw new Error('disk full'); }, dir })).toThrow('disk full');
  });
});
