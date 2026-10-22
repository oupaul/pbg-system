// 專案時間軸：把修改記錄（system_logs）轉成使用者看得懂的事件描述。純函式，不碰資料庫（查詢在 models/ProjectTimeline.js）。
//
// 事件 = { kind, icon, tone, title, details: [{ label, from, to }], actor, ts }
//   kind：project／invoice／payment／cost／bonus／attachment（用於篩選）
//   tone：add（新增）、change（修改）、remove（刪除/作廢）、restore（還原）
//   details：修改事件列出「有變動的欄位」前後值；新增事件列出幾個關鍵欄位（from 為 null）

// 各資料表的設定：kind、物件名稱、欄位中文名稱、如何辨識「是哪一筆」、新增時顯示哪些關鍵欄位
const { UTC_STORED_FIELDS, displayTimeField } = require('./localTime');
const TABLES = {
  projects: {
    kind: 'project', object: '專案資料',
    labels: {
      project_code: '專案編號', project_name: '專案名稱', project_type: '專案類型', status: '狀態',
      contract_year: '簽約年度', contract_month: '簽約月份', price_with_tax: '價格(含稅)', price_without_tax: '價格(未稅)',
      salesperson_id: '業務', customer_id: '客戶', notes: '備註', expected_invoice_year_month: '預計開票年月',
      contract_term: '合約年限', sales_discount: '銷貨折讓', is_new_customer: '新/舊客戶', report_group_id: '報表群組',
      sales_mode: '銷售模式'
    },
    ident: (r) => r.project_name || r.project_code,
    createFields: ['project_code', 'project_name', 'price_with_tax', 'status']
  },
  invoices: {
    kind: 'invoice', object: '發票',
    labels: {
      invoice_number: '發票號碼', invoice_date: '發票日期', amount_with_tax: '金額(含稅)', expected_payment_date: '預計收款日',
      status: '狀態', voided_at: '作廢時間', void_reason: '作廢原因', allowance_amount: '折讓金額',
      replacement_invoice_id: '重開後的發票', original_invoice_id: '原發票'
    },
    ident: (r) => r.invoice_number || '（無號碼）',
    createFields: ['invoice_date', 'amount_with_tax', 'expected_payment_date']
  },
  payments: {
    kind: 'payment', object: '收款',
    labels: {
      payment_date: '收款日期', bank_deposit_amount: '匯入金額', payment_difference: '差額', difference_type: '差額類型',
      notes: '備註', invoice_id: '對應發票'
    },
    ident: (r) => [r.payment_date, r.bank_deposit_amount !== undefined && r.bank_deposit_amount !== null ? money(r.bank_deposit_amount) : null].filter(Boolean).join(' '),
    createFields: ['payment_date', 'bank_deposit_amount', 'invoice_id']
  },
  costs: {
    kind: 'cost', object: '成本',
    labels: {
      item_name: '成本名稱', item_code: '進項編號', cost_date: '成本日期', cost_type: '成本類型', cost_category: '費用類別',
      vendor_id: '廠商', estimated_amount: '預估金額', actual_amount: '實際金額', payment_method: '付款辦法',
      payment_term: '付款條件', order_status: '下單狀態', notes: '備註'
    },
    ident: (r) => r.item_name || r.cost_type || '成本',
    createFields: ['cost_date', 'cost_type', 'vendor_id', 'estimated_amount', 'actual_amount']
  },
  bonus_calculations: {
    kind: 'bonus', object: '獎金',
    labels: {
      bonus_type: '獎金類型', base_amount: '計算基礎', bonus_percentage: '比例%', bonus_amount: '獎金金額',
      payment_date: '發放日期', status: '狀態', forfeiture_reason: '充公原因', salesperson_id: '業務'
    },
    ident: (r) => r.bonus_type || '獎金',
    createFields: ['bonus_type', 'bonus_amount', 'status']
  },
  project_attachments: {
    kind: 'attachment', object: '附件',
    labels: { original_filename: '檔名', file_size: '大小' },
    ident: (r) => r.original_filename,
    createFields: ['original_filename']
  }
};

const MONEY_FIELDS = new Set(['price_with_tax', 'price_without_tax', 'amount_with_tax', 'bank_deposit_amount', 'payment_difference',
  'estimated_amount', 'actual_amount', 'base_amount', 'bonus_amount', 'allowance_amount', 'sales_discount']);
const IGNORED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'project_id', 'userInfo', 'user_info']);

function money(n, symbol = '$') {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return symbol + (Math.round(v * 100) / 100).toLocaleString('en-US');
}

function parseJson(text) {
  if (text === null || text === undefined || text === '') return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

function sameValue(a, b) {
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'object' && typeof b !== 'object' && a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

// 欄位值轉成顯示文字（金額加幣別符號、外鍵轉名稱、空值顯示為空白）
function formatValue(field, value, ctx) {
  if (value === null || value === undefined || value === '') return '（空白）';
  if (UTC_STORED_FIELDS.has(field)) return String(displayTimeField(field, value)); // 以 UTC 儲存的時間，顯示時轉本地
  if (MONEY_FIELDS.has(field)) return money(value, ctx.symbol);
  const lk = ctx.lookups || {};
  if (field === 'salesperson_id') return (lk.salespeople && lk.salespeople[value]) || `#${value}`;
  if (field === 'customer_id' || field === 'vendor_id') return (lk.customers && lk.customers[value]) || `#${value}`;
  if (field === 'invoice_id' || field === 'replacement_invoice_id' || field === 'original_invoice_id') return (lk.invoices && lk.invoices[value]) || `#${value}`;
  if (field === 'is_new_customer') return value ? '新客戶' : '舊客戶';
  if (field === 'file_size') return `${Math.round(Number(value) / 1024)} KB`;
  return String(value);
}

/** 從一筆修改記錄解析出一個事件；沒有任何可顯示的內容（例如沒有實際變動的更新）時回傳 null */
function describeEvent(row, ctx = {}) {
  const cfg = TABLES[row.table_name];
  if (!cfg) return null;
  const symbol = ctx.symbol || '$';
  const context = { symbol, lookups: ctx.lookups };
  const oldV = parseJson(row.old_value) || {};
  const newV = parseJson(row.new_value) || {};
  const identSource = { ...oldV, ...newV };
  const ident = cfg.ident(identSource) || (ctx.currentName ? ctx.currentName : `#${row.record_id}`);
  const actor = row.user_info || null;
  const base = { kind: cfg.kind, actor, ts: row.created_at, table: row.table_name, recordId: row.record_id, synthetic: !!row.synthetic };

  const keyDetails = (source) => cfg.createFields
    .filter(f => source[f] !== undefined && source[f] !== null && source[f] !== '')
    .map(f => ({ label: cfg.labels[f] || f, from: null, to: formatValue(f, source[f], context) }));

  if (row.action === 'create') {
    if (cfg.kind === 'project') return { ...base, icon: 'bi-folder-plus', tone: 'add', title: `建立專案「${ident}」`, details: keyDetails(identSource) };
    return { ...base, icon: 'bi-plus-circle', tone: 'add', title: `新增${cfg.object} ${ident}`, details: keyDetails(identSource) };
  }

  if (row.action === 'delete' || row.action === 'hard_delete') {
    return { ...base, icon: 'bi-trash', tone: 'remove', title: cfg.kind === 'project' ? `刪除專案「${ident}」` : `刪除${cfg.object} ${ident}`, details: [] };
  }

  if (row.action !== 'update') return null;

  // 軟刪除與還原（deleted_at 被設定／清除）
  if (Object.prototype.hasOwnProperty.call(newV, 'deleted_at')) {
    if (newV.deleted_at) return { ...base, icon: 'bi-trash', tone: 'remove', title: `刪除${cfg.object} ${ident}`, details: [] };
    return { ...base, icon: 'bi-arrow-counterclockwise', tone: 'restore', title: `還原${cfg.object} ${ident}`, details: [] };
  }

  // 一般修改：只列出真的有變動的欄位
  const details = [];
  for (const key of Object.keys(newV)) {
    if (IGNORED_FIELDS.has(key) || key.startsWith('_') || !cfg.labels[key]) continue;
    if (sameValue(oldV[key], newV[key])) continue;
    details.push({ label: cfg.labels[key], from: formatValue(key, oldV[key], context), to: formatValue(key, newV[key], context) });
  }
  if (details.length === 0) return null; // 沒有實際變動（系統會在每次儲存都記錄一筆），不顯示

  // 發票的特殊狀態
  if (cfg.kind === 'invoice' && newV.status !== undefined && !sameValue(oldV.status, newV.status)) {
    // 作廢時間（系統存的是 UTC 時間字串）與標題上的事件時間重複且容易看錯時區，不列出
    if (newV.status === '作廢') return { ...base, icon: 'bi-x-circle', tone: 'remove', title: `作廢發票 ${ident}`, details: details.filter(d => d.label !== '狀態' && d.label !== '作廢時間') };
    if (newV.status === '整筆折讓') return { ...base, icon: 'bi-dash-circle', tone: 'remove', title: `發票整筆折讓 ${ident}`, details: details.filter(d => d.label !== '狀態') };
  }
  if (cfg.kind === 'invoice' && newV.allowance_amount !== undefined && !sameValue(oldV.allowance_amount, newV.allowance_amount)) {
    return { ...base, icon: 'bi-percent', tone: 'change', title: `發票部分折讓 ${ident}`, details };
  }
  if (cfg.kind === 'bonus' && newV.status !== undefined && !sameValue(oldV.status, newV.status)) {
    return { ...base, icon: 'bi-award', tone: 'change', title: `獎金 ${ident} 狀態變更為「${newV.status}」`, details: details.filter(d => d.label !== '狀態') };
  }
  if (cfg.kind === 'project' && newV.status !== undefined && !sameValue(oldV.status, newV.status)) {
    return { ...base, icon: 'bi-flag', tone: 'change', title: `專案狀態變更為「${newV.status}」`, details: details.filter(d => d.label !== '狀態') };
  }

  const icon = cfg.kind === 'project' ? 'bi-pencil' : 'bi-pencil-square';
  return { ...base, icon, tone: 'change', title: cfg.kind === 'project' ? '修改專案資料' : `修改${cfg.object} ${ident}`, details };
}

/** 事件清單（新→舊）轉成顯示用事件，並丟掉沒有內容的 */
function buildEvents(rows, ctx = {}) {
  const events = [];
  for (const row of rows) {
    const e = describeEvent(row, ctx);
    if (e) events.push({ ...e, cursor: row.cursor });
  }
  return events;
}

const KINDS = ['project', 'invoice', 'payment', 'cost', 'bonus', 'attachment'];
const KIND_LABELS = { project: '專案資料', invoice: '發票', payment: '收款', cost: '成本', bonus: '獎金', attachment: '附件' };
const TABLE_BY_KIND = Object.fromEntries(Object.entries(TABLES).map(([table, cfg]) => [cfg.kind, table]));

module.exports = { TABLES, KINDS, KIND_LABELS, TABLE_BY_KIND, describeEvent, buildEvents, formatValue, money, parseJson };
