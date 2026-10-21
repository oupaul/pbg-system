const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStaging } = require('../src/utils/importStaging');
const S = require('../src/utils/importSummaries');

let dir, srcDir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-'));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-src-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(srcDir, { recursive: true, force: true });
});
function upload(name = 'a.xlsx') {
  const p = path.join(srcDir, name + Math.random());
  fs.writeFileSync(p, 'data');
  return p;
}

describe('importStaging', () => {
  test('stage 後只有本人且同類型可取得', () => {
    const st = createStaging({ dir });
    const token = st.stage(upload(), { userId: 1, kind: 'projects', originalName: 'a.xlsx' });
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(st.get(token, 1, 'projects')).toMatchObject({ originalName: 'a.xlsx' });
    expect(st.get(token, 2, 'projects')).toBeNull();      // 別人
    expect(st.get(token, 1, 'customers')).toBeNull();     // 不同匯入類型
    expect(st.get('../../etc/passwd', 1, 'projects')).toBeNull();
    expect(st.get(undefined, 1, 'projects')).toBeNull();
  });

  test('檔案被移進暫存區並限制為 600 權限', () => {
    const st = createStaging({ dir });
    const src = upload();
    const token = st.stage(src, { userId: 1, kind: 'projects', originalName: 'a.xlsx' });
    expect(fs.existsSync(src)).toBe(false);
    const file = path.join(dir, `${token}.xlsx`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test('claim 只能取一次（避免重複點擊匯入兩次）', () => {
    const st = createStaging({ dir });
    const token = st.stage(upload(), { userId: 1, kind: 'projects', originalName: 'a.xlsx' });
    const first = st.claim(token, 1, 'projects');
    expect(first).not.toBeNull();
    expect(st.claim(token, 1, 'projects')).toBeNull();
    // 檔案要等呼叫端 discard 才刪
    expect(fs.existsSync(first.filePath)).toBe(true);
    st.discard(first);
    expect(fs.existsSync(first.filePath)).toBe(false);
  });

  test('逾時後失效並刪除檔案', () => {
    let t = 1000;
    const st = createStaging({ dir, now: () => t, ttlMs: 60000 });
    const token = st.stage(upload(), { userId: 1, kind: 'projects', originalName: 'a.xlsx' });
    const file = path.join(dir, `${token}.xlsx`);
    t += 59000;
    expect(st.get(token, 1, 'projects')).not.toBeNull();
    t += 2000;
    expect(st.get(token, 1, 'projects')).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  test('sweep 會清掉過期項目與殘留的舊檔，不動不認得的檔名', () => {
    let t = Date.now();
    const st = createStaging({ dir, now: () => t, ttlMs: 60000 });
    const token = st.stage(upload(), { userId: 1, kind: 'projects', originalName: 'a.xlsx' });
    const stale = path.join(dir, 'a'.repeat(32) + '.xlsx');
    fs.writeFileSync(stale, 'x');
    fs.utimesSync(stale, new Date(t - 2 * 3600 * 1000), new Date(t - 2 * 3600 * 1000));
    const other = path.join(dir, 'keep.txt');
    fs.writeFileSync(other, 'x');
    t += 120000;
    st.sweep();
    expect(st.get(token, 1, 'projects')).toBeNull();
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  });
});

describe('importSummaries', () => {
  test('專案匯入摘要：業務/客戶用「實際新增」筆數，而不是處理列數', () => {
    const s = S.summarizeProjects({
      success: true,
      results: { projects: 3, salespeople: 3, customers: 3 },
      created: { salespeople: 1, customers: 0 },
      errors: []
    });
    expect(s.stats.find(x => x.label.startsWith('新增業務人員')).value).toBe(1);
    expect(s.stats.find(x => x.label.startsWith('新增客戶')).value).toBe(0);
  });

  test('專案匯入摘要：統計、可匯入、錯誤整理', () => {
    const s = S.summarizeProjects({
      success: true,
      results: { projects: 3, invoices: 5, payments: 2, bonuses: 1, costs: 4, salespeople: 1, customers: 2, duplicates: 6 },
      errors: [{ time: 'x', message: '第 3 列：缺少專案編號' }, '字串錯誤'],
      errorCount: 2
    });
    expect(s.importable).toBe(true);
    expect(s.fatal).toBeNull();
    expect(s.stats.find(x => x.label === '新增專案').value).toBe(3);
    expect(s.stats.find(x => x.label === '略過已存在的重複資料').value).toBe(6);
    expect(s.errors).toEqual(['第 3 列：缺少專案編號', '字串錯誤']);
  });

  test('全部都是重複資料時不可匯入、不算致命錯誤', () => {
    const s = S.summarizeProjects({ success: true, results: { duplicates: 10 }, errors: [] });
    expect(s.importable).toBe(false);
    expect(s.fatal).toBeNull();
  });

  test('只會自動建立業務人員時不算可匯入', () => {
    const s = S.summarizeProjects({ success: false, results: { salespeople: 2 }, errors: ['第 2 行：缺少專案編號'] });
    expect(s.importable).toBe(false);
    expect(s.fatal).toBe('第 2 行：缺少專案編號');
  });

  test('匯入失敗且沒有任何可新增資料時為致命錯誤', () => {
    expect(S.summarizeProjects({ success: false, error: '工作表太大', errors: [] }).fatal).toBe('工作表太大');
    expect(S.summarizeCosts({ success: false, createdCount: 0, errors: [{ message: '找不到工作表' }] }).fatal).toBe('找不到工作表');
    expect(S.summarizeCustomers({ success: false, createdCount: 0, errors: [] }).fatal).toBe('匯入失敗');
  });

  test('成本、客戶、活動摘要', () => {
    expect(S.summarizeCosts({ success: true, createdCount: 4, duplicateCount: 1, failedCount: 2, errors: ['e'] }))
      .toMatchObject({ importable: true, errorCount: 1 });
    expect(S.summarizeCustomers({ success: true, createdCount: 0, skippedCount: 3, errors: ['a', 'b', 'c'] }))
      .toMatchObject({ importable: false, errorCount: 3 });
    const a = S.summarizeActivities({ success: true, createdCount: 0, linkedCount: 2, duplicateCount: 1, failedCount: 0, createdTypes: ['拜訪'], warnings: ['w'], errors: [] });
    expect(a.importable).toBe(true);
    expect(a.notes[0]).toContain('拜訪');
    expect(a.warnings).toEqual(['w']);
  });

  test('正式匯入結果沿用原本格式與上限', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ message: 'x'.repeat(300) + i }));
    const shaped = S.shapeProjects({ success: true, results: { projects: 1 }, errors: many, errorCount: 80, log: [], warning: null });
    expect(shaped.errors).toHaveLength(50);
    expect(shaped.errors[0].length).toBe(203); // 200 字 + ...
    expect(S.shapeCosts({ success: true, createdCount: 2, duplicateCount: 1, failedCount: 3, errors: [] }))
      .toMatchObject({ kind: 'costs', results: { costs: 2, duplicates: 1, failed: 3 }, warning: '有 3 列匯入失敗，其餘已完成' });
    expect(S.shapeCustomers({ createdCount: 2, skippedCount: 1, errors: [] })).toMatchObject({ createdCount: 2, skippedCount: 1 });
    expect(S.shapeActivities({ createdCount: 1, failedCount: 2, createdTypes: ['a'] })).toMatchObject({ kind: 'activities', skippedCount: 2, createdTypes: ['a'] });
  });

  test('錯誤清單 CSV：加 BOM、跳脫引號、防公式注入', () => {
    const csv = S.buildIssuesCsv({ errors: ['第 2 列："引號"', '=cmd|calc', '+1', '-1', '@x'], warnings: ['提醒'] });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"錯誤","第 2 列：""引號"""');
    expect(csv).toContain(`"錯誤","'=cmd|calc"`);
    expect(csv).toContain(`"錯誤","'+1"`);
    expect(csv).toContain(`"錯誤","'-1"`);
    expect(csv).toContain(`"錯誤","'@x"`);
    expect(csv).toContain('"警告","提醒"');
  });
});
