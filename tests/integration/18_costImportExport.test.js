// 成本明細的匯出與毛利分析：已刪除的成本不計入、進項編號欄位已從匯出與範本移除。
// （成本匯入的測試在 05_uploads_imports.test.js：匯入確認會在共用的資料目錄產生快照，和那個檔案裡數快照的測試必須在同一個檔案內依序執行。）
const path = require('path');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const { describeIntegration, as, ids, BASE } = require('./helpers');

function withDb(fn, { readonly = true } = {}) {
  const db = new Database(path.join(process.env.PBG_TEST_TMP, 'data', 'invoice_bonus.db'), { readonly });
  db.pragma('busy_timeout = 5000');
  try { return fn(db); } finally { db.close(); }
}
// 下載 xlsx（測試用的 client.get 回傳文字，二進位檔要自己抓）
const download = async (client, url) => {
  const res = await fetch(BASE + url, { headers: { Cookie: client.cookie, 'X-Forwarded-For': client.ip } });
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb;
};
const sheetRows = (ws) => { const out = []; ws.eachRow(r => out.push(r.values.slice(1))); return out; };

const NEW_HEADER = ['專案編號', '類型', '客戶編號', '專案名稱', '成本名稱', '成本日期', '成本類型', '費用類別', '廠商', '付款辦法', '付款條件', '下單狀態', '預估金額', '實際金額', '備註', '稅別'];

describeIntegration('成本匯出與毛利分析：不含已刪除的成本', () => {
  let admin; let P; const code = 'CEXP-1';
  const costId = (n) => withDb(db => db.prepare('SELECT id FROM costs WHERE item_name = ?').get(n).id);
  beforeAll(async () => {
    admin = await as('admin');
    P = withDb(db => Number(db.prepare(`
      INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
      VALUES (?, 2031, 10, 'A類', '成本匯出專案', ?, ?, 1050000, 1000000)
    `).run(code, ids.spA, ids.A.customer).lastInsertRowid), { readonly: false });
    // 含稅金額：315,000 / 1.05 = 300,000、525,000 / 1.05 = 500,000（毛利以未稅成本計）
    for (const [n, act] of [['CE-KEEP', '315000'], ['CE-GONE', '525000']]) {
      await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2031-10-03', item_name: n, estimated_amount: act, actual_amount: act } });
    }
    // 有小數的未稅金額：1,000 / 1.05 = 952.38（匯出不能被四捨五入成整數）
    await admin.post('/costs/', { form: { project_id: String(P), cost_date: '2031-10-04', item_name: 'CE-DEC', estimated_amount: '1000', actual_amount: '1000' } });
    await admin.post(`/costs/${costId('CE-GONE')}/delete`, { form: {} });
  });

  test('成本明細匯出沒有已刪除的成本、沒有進項編號欄，且可直接重新匯入（欄位與範本一致）', async () => {
    const wb = await download(admin, '/import-export/export/costs/2031');
    const rows = sheetRows(wb.worksheets[0]);
    expect(rows[0].slice(0, 16)).toEqual(NEW_HEADER);
    expect(rows[0].slice(16)).toEqual(['廠商名稱', '專案狀態', '預估金額(未稅)', '實際金額(未稅)']);
    expect(rows[0]).not.toContain('進項編號');
    const names = rows.slice(1).map(r => r[4]);
    expect(names).toContain('CE-KEEP');
    expect(names).not.toContain('CE-GONE');
    // 稅別與未稅金額欄
    const keep = rows.find(r => r[4] === 'CE-KEEP');
    expect(keep[12]).toBe(315000); // 預估金額（輸入的含稅金額）
    expect(keep[15]).toBe('含稅');
    expect(keep[18]).toBe(300000); // 預估金額(未稅)
    expect(keep[19]).toBe(300000); // 實際金額(未稅)
    const dec = rows.find(r => r[4] === 'CE-DEC');
    expect([dec[18], dec[19]]).toEqual([952.38, 952.38]); // 未稅金額保留小數，不被四捨五入成整數
  });

  test('匯入範本與填寫說明沒有進項編號，欄位順序和匯出一致', async () => {
    const wb = await download(admin, '/import-export/template/costs');
    expect(sheetRows(wb.getWorksheet('成本明細'))[0]).toEqual(NEW_HEADER);
    expect(JSON.stringify(sheetRows(wb.getWorksheet('填寫說明')))).not.toContain('進項編號');
  });

  test('專案年度匯出內的成本明細工作表也不含已刪除的成本', async () => {
    const wb = await download(admin, '/import-export/export/projects/2031');
    const ws = wb.getWorksheet('成本明細');
    const names = sheetRows(ws).slice(1).map(r => r[4]);
    expect(names).toContain('CE-KEEP');
    expect(names).not.toContain('CE-GONE');
  });

  test('毛利分析只算沒刪的成本、且以未稅金額計（300,000 + 952.38，不是含稅 316,000、也不含已刪除的 500,000）', async () => {
    const html = (await admin.get('/gross-profit/?year=2031')).text;
    const m = new RegExp(`data-project_code="${code}"[^>]*data-total_cost="([\\d.]+)"`).exec(html);
    expect(m && Number(m[1])).toBe(300952.38);
    // 復原後兩筆都計入
    await admin.post(`/costs/${costId('CE-GONE')}/restore`, { form: {} });
    const html2 = (await admin.get('/gross-profit/?year=2031')).text;
    const m2 = new RegExp(`data-project_code="${code}"[^>]*data-total_cost="([\\d.]+)"`).exec(html2);
    expect(m2 && Number(m2[1])).toBe(800952.38);
  });
});
