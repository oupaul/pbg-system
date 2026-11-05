// 上傳驗證與匯入流程（預覽 → 確認）的行為測試。
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { describeIntegration, as, ids, postFile } = require('./helpers');

const decode = (loc) => { try { return decodeURIComponent(loc); } catch { return loc; } };
const dataDir = () => path.join(process.env.PBG_TEST_TMP, 'data');
const snapshots = () => fs.readdirSync(dataDir()).filter(f => f.startsWith('invoice_bonus.db.pre-import-'));

async function xlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describeIntegration('專案附件上傳驗證', () => {
  const upload = async (filename, content, type) => {
    const admin = await as('admin');
    return postFile(admin, `/projects/${ids.A.project}/attachments`, { filename, content, type });
  };

  test.each([
    ['網頁 .html', 'x.html', '<html><script>alert(1)</script></html>', /不支援/],
    ['SVG', 'x.svg', '<svg onload=alert(1)>', /不支援/],
    ['可執行檔 .exe', 'x.exe', 'MZ\x90\x00', /不支援/],
    ['腳本 .sh', 'x.sh', '#!/bin/sh\nrm -rf /', /不支援/],
    ['含巨集 .xlsm', 'x.xlsm', 'PK\x03\x04', /不支援/],
    ['偽裝成 pdf 的網頁', 'fake.pdf', '<html><script>alert(1)</script></html>', /不符/],
    ['偽裝成圖片的網頁', 'fake.png', '<svg onload=alert(1)>', /不符/],
    ['雙重副檔名 a.pdf.exe', 'a.pdf.exe', '%PDF-1.4\nx', /不支援/]
  ])('拒絕：%s', async (label, filename, content, reason) => {
    const r = await upload(filename, content);
    expect(r.status).toBe(302);
    expect(decode(r.location)).toMatch(reason);
  });

  test('接受內容正確的 PDF，並能以 application/pdf 預覽', async () => {
    const r = await upload('合約.pdf', '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n', 'application/pdf');
    expect(r.status).toBe(302);
    expect(decode(r.location)).toMatch(/附件已上傳/);
  });

  test('被拒絕的檔案不會留在 uploads 目錄', async () => {
    const dir = path.join(process.env.PBG_TEST_TMP, 'uploads', 'attachments');
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    await upload('y.html', '<html></html>');
    await upload('fake2.pdf', '<html></html>');
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    expect(after).toBe(before);
  });
});

describeIntegration('Excel 匯入：預覽、確認、快照與權限', () => {
  test('匯入檔必須是真的 .xlsx（副檔名、內容、結構）', async () => {
    const admin = await as('admin');
    const bad = [
      ['a.xls', await xlsxBuffer([['a']])],
      ['a.csv', Buffer.from('a,b\n1,2')],
      ['fake.xlsx', Buffer.from('<html>not excel</html>')]
    ];
    for (const [name, content] of bad) {
      const r = await postFile(admin, '/customers/import', { filename: name, content });
      expect([name, r.status, /preview/.test(r.location)]).toEqual([name, 302, false]);
      expect(decode(r.location)).toMatch(/error=/);
    }
  });

  test('客戶匯入：預覽不寫入資料；他人看不到預覽；確認後才寫入並先做快照；不能重複確認', async () => {
    const admin = await as('admin');
    const before = snapshots().length;
    const file = await xlsxBuffer([
      ['客戶編號', '統一編號', '公司名稱', '客戶/廠商類型'],
      ['IMPT001', '', '預覽測試公司', '客戶']
    ]);

    const up = await postFile(admin, '/customers/import', { filename: 'c.xlsx', content: file });
    expect(up.status).toBe(302);
    expect(up.location).toMatch(/\/customers\/import\/preview\/[0-9a-f]{32}$/);
    const previewUrl = up.location.replace(/^https?:\/\/[^/]+/, '');
    const token = previewUrl.split('/').pop();

    // 預覽頁正常，且還沒有寫入任何資料、也沒有產生快照
    const preview = await admin.get(previewUrl);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('客戶/廠商匯入預覽');
    expect((await admin.get('/customers/?search=IMPT001')).text).not.toContain('預覽測試公司');
    expect(snapshots().length).toBe(before);

    // 其他人（即使有匯入權限）不能看、不能確認、不能取消別人的預覽
    for (const other of ['u_user', 'u_import', 'u_salesA']) {
      const c = await as(other);
      const view = await c.get(previewUrl);
      const confirm = await c.post(`/customers/import/confirm/${token}`, { form: {} });
      expect([other, view.status === 200]).toEqual([other, false]);
      expect([other, confirm.status === 302 && /\/customers\?success|\/customers$/.test(confirm.location)]).toEqual([other, false]);
    }
    expect((await admin.get('/customers/?search=IMPT001')).text).not.toContain('預覽測試公司');

    // 確認：先快照、再寫入
    const confirm = await admin.post(`/customers/import/confirm/${token}`, { form: {} });
    expect(confirm.status).toBe(302);
    expect(snapshots().length).toBe(before + 1);
    const snapshotFile = path.join(dataDir(), snapshots().sort().pop());
    expect(fs.statSync(snapshotFile).mode & 0o777).toBe(0o600);
    expect((await admin.get('/customers/?search=IMPT001')).text).toContain('預覽測試公司');

    // 同一個預覽不能再次確認（不會匯入兩次）
    const again = await admin.post(`/customers/import/confirm/${token}`, { form: {} });
    expect(decode(again.location)).toMatch(/已過期|已匯入過/);
  });

  test('取消預覽後無法再確認，也不會寫入', async () => {
    const admin = await as('admin');
    const file = await xlsxBuffer([['客戶編號', '統一編號', '公司名稱', '客戶/廠商類型'], ['IMPT002', '', '取消測試公司', '客戶']]);
    const up = await postFile(admin, '/customers/import', { filename: 'c2.xlsx', content: file });
    const token = up.location.split('/').pop();
    await admin.post(`/customers/import/cancel/${token}`, { form: {} });
    const confirm = await admin.post(`/customers/import/confirm/${token}`, { form: {} });
    expect(decode(confirm.location)).toMatch(/已過期|已匯入過/);
    expect((await admin.get('/customers/?search=IMPT002')).text).not.toContain('取消測試公司');
  });

  test('成本明細匯入：有匯入權限者預覽的內容，其他同樣有權限的人也看不到', async () => {
    const owner = await as('u_user');
    const other = await as('u_import');
    const file = await xlsxBuffer([['專案編號', '類型', '客戶編號', '專案名稱', '進項編號', '成本名稱', '成本日期', '成本類型', '費用類別', '廠商', '付款辦法', '付款條件', '下單狀態', '預估金額', '實際金額', '備註'],
      ['P-A', 'A類', 'C-A', '專案A', '', '測試成本', '2026-10-01', '', '', '', '', '', '', 100, 100, '']]);
    const up = await postFile(owner, '/import-export/import-costs', { filename: 'costs.xlsx', content: file });
    expect(up.location).toMatch(/\/import-export\/import-costs\/preview\/[0-9a-f]{32}$/);
    const url = up.location.replace(/^https?:\/\/[^/]+/, '');
    expect((await owner.get(url)).status).toBe(200);
    expect((await other.get(url)).status).not.toBe(200);
    // 錯誤清單下載同樣只有本人
    expect((await owner.get(url.replace('/preview/', '/issues/'))).status).toBe(200);
    expect((await other.get(url.replace('/preview/', '/issues/'))).status).not.toBe(200);
  });

  test('沒有批次匯入權限的人不能上傳（只有編輯權限不夠）', async () => {
    const file = await xlsxBuffer([['a']]);
    for (const user of ['u_edit', 'u_settings', 'u_boss', 'u_salesA']) {
      const c = await as(user);
      const r = await postFile(c, '/import-export/import', { filename: 'p.xlsx', content: file });
      expect([user, r.status]).toEqual([user, 403]);
    }
  });
});

// ---- 成本明細匯入：新格式（沒有進項編號）與舊格式 ----
// 放在這個檔案是因為匯入確認會在共用資料目錄產生快照，上面數快照的測試不能和別的檔案平行。
const Database = require('better-sqlite3');
const withDb = (fn, { readonly = true } = {}) => {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
};
const xlsx = async (rows, sheetName = '成本明細') => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const NEW_HEADER = ['專案編號', '類型', '客戶編號', '專案名稱', '成本名稱', '成本日期', '成本類型', '費用類別', '廠商', '付款辦法', '付款條件', '下單狀態', '預估金額', '實際金額', '備註'];
const TAX_HEADER = [...NEW_HEADER, '稅別'];
// 舊版匯出檔：第 16 欄是唯讀的「廠商名稱」、第 17 欄「專案狀態」，不是稅別
const OLD_EXPORT_HEADER = [...NEW_HEADER, '廠商名稱', '專案狀態'];
const OLD_HEADER = ['專案編號', '類型', '客戶編號', '專案名稱', '進項編號', '成本名稱', '成本日期', '成本類型', '費用類別', '廠商', '付款辦法', '付款條件', '下單狀態', '預估金額', '實際金額', '備註'];

describeIntegration('成本匯入：新格式（無進項編號）與舊格式', () => {
  let admin; let P; let code;
  const mkProject = (c) => withDb(db => Number(db.prepare(`
    INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
    VALUES (?, 2026, 10, 'A類', ?, ?, ?, 100000, 95238)
  `).run(c, `成本匯入 ${c}`, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
  const importFile = async (buf) => {
    const up = await postFile(admin, '/import-export/import-costs', { filename: 'costs.xlsx', content: buf });
    expect(up.location).toMatch(/\/preview\/[0-9a-f]{32}$/);
    const token = up.location.split('/').pop();
    const confirm = await admin.post(`/import-export/import-costs/confirm/${token}`, { form: {} });
    return decode(confirm.location);
  };
  const rowsOf = (name) => withDb(db => db.prepare('SELECT * FROM costs WHERE item_name = ? ORDER BY id').all(name));

  beforeAll(async () => {
    admin = await as('admin');
    code = 'CIMP-1';
    P = mkProject(code);
  });

  test('新格式（沒有進項編號欄）：欄位對得上，金額與日期正確', async () => {
    await importFile(await xlsx([NEW_HEADER, [code, '', '', '', 'CI-NEW', '2026-10-05', '', '', '', '', '', '', 1050, 1000, '備註新']]));
    const r = rowsOf('CI-NEW');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ project_id: P, cost_date: '2026-10-05', estimated_amount: 1050, actual_amount: 1000, notes: '備註新' });
  });

  test('舊格式（第 5 欄是進項編號）仍可匯入：進項編號被忽略，其餘欄位不錯位', async () => {
    await importFile(await xlsx([OLD_HEADER, [code, '', '', '', 'OLD-CODE-1', 'CI-OLD', '2026-10-06', '', '', '', '', '', '', 2100, 2000, '備註舊']]));
    const r = rowsOf('CI-OLD');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ project_id: P, cost_date: '2026-10-06', estimated_amount: 2100, actual_amount: 2000, notes: '備註舊' });
    expect(r[0].item_code).toBeNull(); // 不再寫入
  });

  test('稅別欄：含稅／免稅／空白，並算好未稅金額；沒有這欄的檔案一律含稅', async () => {
    await importFile(await xlsx([TAX_HEADER,
      [code, '', '', '', 'CI-TAX-1', '2026-10-07', '', '', '', '', '', '', 1050, 1050, '', '含稅'],
      [code, '', '', '', 'CI-TAX-2', '2026-10-07', '', '', '', '', '', '', 1050, 1050, '', '免稅'],
      [code, '', '', '', 'CI-TAX-3', '2026-10-07', '', '', '', '', '', '', 1050, 1050, '', '']]));
    expect(rowsOf('CI-TAX-1')[0]).toMatchObject({ tax_included: 1, estimated_amount_ex_tax: 1000, actual_amount_ex_tax: 1000 });
    expect(rowsOf('CI-TAX-2')[0]).toMatchObject({ tax_included: 0, estimated_amount_ex_tax: 1050, actual_amount_ex_tax: 1050 });
    expect(rowsOf('CI-TAX-3')[0]).toMatchObject({ tax_included: 1, estimated_amount_ex_tax: 1000 });
    // 沒有稅別欄（先前新格式的測試資料 CI-NEW 也是）→ 含稅
    expect(rowsOf('CI-NEW')[0]).toMatchObject({ tax_included: 1, estimated_amount: 1050, estimated_amount_ex_tax: 1000 });
  });

  test('稅別填錯：該列失敗並說明，不會默默當成含稅；其他列照常匯入', async () => {
    const up = await postFile(admin, '/import-export/import-costs', { filename: 'costs.xlsx', content: await xlsx([TAX_HEADER,
      [code, '', '', '', 'CI-TAX-BAD', '2026-10-08', '', '', '', '', '', '', 100, 100, '', '亂填'],
      [code, '', '', '', 'CI-TAX-OK', '2026-10-08', '', '', '', '', '', '', 100, 100, '', '免稅']]) });
    const token = up.location.split('/').pop();
    const preview = (await admin.get(`/import-export/import-costs/preview/${token}`)).text;
    expect(preview).toContain('稅別');
    expect(preview).toContain('亂填');
    await admin.post(`/import-export/import-costs/confirm/${token}`, { form: {} });
    expect(rowsOf('CI-TAX-BAD')).toHaveLength(0);
    expect(rowsOf('CI-TAX-OK')).toHaveLength(1);
  });

  test('舊版匯出檔（第 16 欄是廠商名稱）重新匯入：不會把廠商名稱當成稅別', async () => {
    await importFile(await xlsx([OLD_EXPORT_HEADER,
      [code, '', '', '', 'CI-OLDEXP', '2026-10-09', '', '', '', '', '', '', 525, 525, '', '某某企業有限公司', '進行中']]));
    expect(rowsOf('CI-OLDEXP')[0]).toMatchObject({ tax_included: 1, estimated_amount_ex_tax: 500 });
  });

  test('重複匯入同一筆會略過；已刪除的不算重複（刪掉後可以再匯入）', async () => {
    const file = await xlsx([NEW_HEADER, [code, '', '', '', 'CI-NEW', '2026-10-05', '', '', '', '', '', '', 1050, 1000, '']]);
    await importFile(file);
    expect(rowsOf('CI-NEW')).toHaveLength(1);
    await admin.post(`/costs/${rowsOf('CI-NEW')[0].id}/delete`, { form: {} });
    await importFile(file);
    const r = rowsOf('CI-NEW');
    expect(r).toHaveLength(2);
    expect(r.filter(x => !x.deleted_at)).toHaveLength(1);
  });
});
