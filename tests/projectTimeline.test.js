const { describeEvent, buildEvents, KINDS, TABLE_BY_KIND, formatValue } = require('../src/utils/projectTimeline');

const row = (over) => ({ action: 'update', table_name: 'invoices', record_id: 1, old_value: null, new_value: null, user_info: '王小明', created_at: '2026-10-21 10:00:00', ...over });
const json = (o) => JSON.stringify(o);

describe('describeEvent：新增與刪除', () => {
  test('新增發票：標題含號碼，詳細列出關鍵欄位（金額加幣別）', () => {
    const e = describeEvent(row({ action: 'create', new_value: json({ project_id: 1, invoice_number: 'AB12345678', invoice_date: '2026-10-01', amount_with_tax: 105000, userInfo: '王小明', _skipOverInvoiceCheck: true }) }));
    expect(e).toMatchObject({ kind: 'invoice', tone: 'add', title: '新增發票 AB12345678', actor: '王小明' });
    expect(e.details).toEqual([
      { label: '發票日期', from: null, to: '2026-10-01' },
      { label: '金額(含稅)', from: null, to: '$105,000' }
    ]); // 不顯示 userInfo、內部欄位與空值
  });

  test('新增專案、收款、獎金、附件', () => {
    expect(describeEvent(row({ action: 'create', table_name: 'projects', record_id: 5, new_value: json({ project_code: 'P1', project_name: '機房', price_with_tax: 100, status: '未結案' }) })).title).toBe('建立專案「機房」');
    expect(describeEvent(row({ action: 'create', table_name: 'payments', new_value: json({ payment_date: '2026-10-02', bank_deposit_amount: 5000 }) })).title).toBe('新增收款 2026-10-02 $5,000');
    expect(describeEvent(row({ action: 'create', table_name: 'bonus_calculations', new_value: json({ bonus_type: '業績獎金', bonus_amount: 300, status: '待發放' }) })).title).toBe('新增獎金 業績獎金');
    expect(describeEvent(row({ action: 'create', table_name: 'project_attachments', new_value: json({ original_filename: '合約.pdf' }) })).title).toBe('新增附件 合約.pdf');
  });

  test('永久刪除（記錄內容在舊值裡）', () => {
    const e = describeEvent(row({ action: 'delete', table_name: 'costs', old_value: json({ item_name: '機櫃' }) }));
    expect(e).toMatchObject({ kind: 'cost', tone: 'remove', title: '刪除成本 機櫃' });
  });

  test('沒有任何可辨識資料時用 #編號當名稱；不認識的資料表與動作回傳 null', () => {
    expect(describeEvent(row({ action: 'create', table_name: 'costs', record_id: 9, new_value: json({}) })).title).toBe('新增成本 成本');
    expect(describeEvent(row({ table_name: 'users', action: 'create' }))).toBeNull();
    expect(describeEvent(row({ action: 'login' }))).toBeNull();
  });
});

describe('describeEvent：修改', () => {
  test('只列出有變動的欄位；數字與字串的相同值不算變動', () => {
    const e = describeEvent(row({
      old_value: json({ invoice_number: 'AB1', amount_with_tax: 1000, invoice_date: '2026-10-01', status: '有效' }),
      new_value: json({ invoice_number: 'AB1', amount_with_tax: '1000', invoice_date: '2026-10-05', status: '有效' })
    }));
    expect(e.title).toBe('修改發票 AB1');
    expect(e.details).toEqual([{ label: '發票日期', from: '2026-10-01', to: '2026-10-05' }]);
  });

  test('沒有實際變動的更新（系統每次儲存都會記錄一筆）不顯示', () => {
    expect(describeEvent(row({ old_value: json({ invoice_number: 'AB1', amount_with_tax: 1 }), new_value: json({ invoice_number: 'AB1', amount_with_tax: 1 }) }))).toBeNull();
    expect(describeEvent(row({ table_name: 'projects', old_value: json({ project_name: 'x', updated_at: 'a' }), new_value: json({ project_name: 'x', updated_at: 'b' }) }))).toBeNull();
  });

  test('空值與有值的變動顯示為「（空白）」', () => {
    const e = describeEvent(row({ table_name: 'payments', old_value: json({ payment_date: '2026-10-01', notes: null }), new_value: json({ payment_date: '2026-10-01', notes: '補匯費' }) }));
    expect(e.details).toEqual([{ label: '備註', from: '（空白）', to: '補匯費' }]);
  });

  test('發票作廢、整筆折讓、部分折讓有專屬標題', () => {
    const base = { invoice_number: 'AB1', status: '有效', allowance_amount: 0 };
    const voided = describeEvent(row({ old_value: json(base), new_value: json({ status: '作廢', voided_at: '2026-10-09', void_reason: '開錯' }) }));
    expect(voided.title).toBe('作廢發票 AB1');
    expect(voided.details).toEqual([{ label: '作廢原因', from: '（空白）', to: '開錯' }]); // 不重複列出作廢時間與狀態
    expect(describeEvent(row({ old_value: json(base), new_value: json({ status: '整筆折讓' }) })).title).toBe('發票整筆折讓 AB1');
    const partial = describeEvent(row({ old_value: json(base), new_value: json({ allowance_amount: 500 }) }));
    expect(partial.title).toBe('發票部分折讓 AB1');
    expect(partial.details).toEqual([{ label: '折讓金額', from: '$0', to: '$500' }]);
  });

  test('獎金與專案的狀態變更標題', () => {
    expect(describeEvent(row({ table_name: 'bonus_calculations', old_value: json({ bonus_type: '業績獎金', status: '待發放' }), new_value: json({ status: '已發放' }) })).title).toBe('獎金 業績獎金 狀態變更為「已發放」');
    expect(describeEvent(row({ table_name: 'projects', old_value: json({ status: '未結案' }), new_value: json({ status: '已結案' }) })).title).toBe('專案狀態變更為「已結案」');
  });

  test('軟刪除與還原', () => {
    expect(describeEvent(row({ old_value: json({ invoice_number: 'AB1' }), new_value: json({ deleted_at: '2026-10-09 10:00:00' }) })).title).toBe('刪除發票 AB1');
    const restored = describeEvent(row({ old_value: json({ invoice_number: 'AB1', deleted_at: '2026-10-09' }), new_value: json({ deleted_at: null }) }));
    expect(restored).toMatchObject({ tone: 'restore', title: '還原發票 AB1' });
  });

  test('外鍵欄位以名稱顯示（業務、客戶、發票），查不到時顯示 #id', () => {
    const lookups = { salespeople: { 2: '李大華' }, customers: { 7: '甲公司' }, invoices: { 3: 'AB3' } };
    const e = describeEvent(row({ table_name: 'projects', old_value: json({ project_name: 'X', salesperson_id: 1, customer_id: 7 }), new_value: json({ salesperson_id: 2, customer_id: 7 }) }), { lookups });
    expect(e.details).toEqual([{ label: '業務', from: '#1', to: '李大華' }]);
    expect(formatValue('invoice_id', 3, { lookups })).toBe('AB3');
    expect(formatValue('vendor_id', 7, { lookups })).toBe('甲公司');
  });

  test('壞掉的 JSON 不會造成錯誤', () => {
    const e = describeEvent(row({ action: 'create', new_value: '{not json' }));
    expect(e).toMatchObject({ kind: 'invoice', title: '新增發票 （無號碼）' });
  });
});

describe('buildEvents 與常數', () => {
  test('過濾掉沒有內容的事件並保留順序與游標', () => {
    const events = buildEvents([
      row({ action: 'create', new_value: json({ invoice_number: 'A' }), cursor: 'c3' }),
      row({ old_value: json({ invoice_number: 'A' }), new_value: json({ invoice_number: 'A' }), cursor: 'c2' }),
      row({ action: 'delete', old_value: json({ invoice_number: 'A' }), cursor: 'c1' })
    ]);
    expect(events.map(e => e.cursor)).toEqual(['c3', 'c1']);
  });
  test('種類與資料表一一對應', () => {
    expect(KINDS.map(k => TABLE_BY_KIND[k]).every(Boolean)).toBe(true);
    expect(TABLE_BY_KIND.bonus).toBe('bonus_calculations');
  });
});
