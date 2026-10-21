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
