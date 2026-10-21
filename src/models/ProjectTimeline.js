// 專案時間軸的資料查詢：把「這個專案相關的修改記錄」依時間排列，並補上沒有修改記錄的資料（例如記錄功能上線前
// 就存在、或直接匯入資料庫的發票/收款），讓每個專案都有完整的歷史。顯示文字的組合在 utils/projectTimeline.js。
const db = require('./db');
const { TABLES, KINDS, TABLE_BY_KIND, buildEvents } = require('../utils/projectTimeline');

const PAGE_SIZE = 30;
const MAX_LOG_ROWS = 5000; // 單一專案最多讀取最近 5000 筆修改記錄（一般專案遠低於此）

// 子表（有 project_id 欄位）；修改記錄的 record_id 會對到這些表的 id，已被永久刪除的記錄則從記錄內容裡的 project_id 找回
const CHILD_TABLES = ['invoices', 'payments', 'costs', 'bonus_calculations', 'project_attachments'];

// 可看到哪些種類：獎金只有可編輯的角色看得到（與專案頁的「獎金明細」分頁相同）
function allowedKinds(user) {
  return KINDS.filter(k => k !== 'bonus' || (user && user.canEdit));
}

function jsonProjectId(column) {
  return `(CASE WHEN json_valid(${column}) THEN json_extract(${column}, '$.project_id') END)`;
}

function fetchLogRows(projectId, tables) {
  const conditions = [];
  const params = [];
  if (tables.includes('projects')) {
    conditions.push("(l.table_name = 'projects' AND l.record_id = ?)");
    params.push(projectId);
  }
  for (const table of CHILD_TABLES.filter(t => tables.includes(t))) {
    conditions.push(`(l.table_name = '${table}' AND (
      l.record_id IN (SELECT id FROM ${table} WHERE project_id = ?)
      OR ${jsonProjectId('l.new_value')} = ?
      OR ${jsonProjectId('l.old_value')} = ?
    ))`);
    params.push(projectId, projectId, projectId);
  }
  if (conditions.length === 0) return [];
  return db.prepare(`
    SELECT l.id, l.action, l.table_name, l.record_id, l.old_value, l.new_value, l.user_info, l.created_at
    FROM system_logs l
    WHERE ${conditions.join(' OR ')}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${MAX_LOG_ROWS}
  `).all(...params);
}

// 沒有「新增」修改記錄的資料，以資料本身的建立時間補一個「新增」事件
function syntheticCreateRows(projectId, tables, logRows) {
  const hasCreate = new Set(logRows.filter(r => r.action === 'create').map(r => `${r.table_name}#${r.record_id}`));
  const rows = [];
  const pick = (table) => tables.includes(table);
  if (pick('projects')) {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (p && p.created_at && !hasCreate.has(`projects#${p.id}`)) {
      rows.push({ id: null, action: 'create', table_name: 'projects', record_id: p.id, old_value: null, new_value: JSON.stringify(p), user_info: null, created_at: p.created_at, synthetic: 1 });
    }
  }
  for (const table of CHILD_TABLES.filter(pick)) {
    let list = [];
    try { list = db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId); } catch { list = []; }
    for (const r of list) {
      if (!r.created_at || hasCreate.has(`${table}#${r.id}`)) continue;
      rows.push({ id: null, action: 'create', table_name: table, record_id: r.id, old_value: null, new_value: JSON.stringify(r), user_info: null, created_at: r.created_at, synthetic: 1 });
    }
  }
  return rows;
}

// 事件中出現的外鍵 id（業務、客戶、發票）轉成名稱，供顯示用
function buildLookups(rows) {
  const ids = { salespeople: new Set(), customers: new Set(), invoices: new Set() };
  for (const r of rows) {
    for (const text of [r.old_value, r.new_value]) {
      if (!text) continue;
      let v; try { v = JSON.parse(text); } catch { continue; }
      if (!v || typeof v !== 'object') continue;
      if (v.salesperson_id) ids.salespeople.add(Number(v.salesperson_id));
      if (v.customer_id) ids.customers.add(Number(v.customer_id));
      if (v.vendor_id) ids.customers.add(Number(v.vendor_id)); // 廠商也存在客戶/廠商表
      for (const k of ['invoice_id', 'replacement_invoice_id', 'original_invoice_id']) if (v[k]) ids.invoices.add(Number(v[k]));
    }
  }
  const load = (table, column, set) => {
    const list = [...set].filter(Number.isInteger);
    const out = {};
    if (list.length === 0) return out;
    try {
      db.prepare(`SELECT id, ${column} AS name FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`).all(...list).forEach(r => { out[r.id] = r.name; });
    } catch { /* 表或欄位不存在時略過 */ }
    return out;
  };
  return {
    salespeople: load('salespeople', 'name', ids.salespeople),
    customers: load('customers', 'company_name', ids.customers),
    invoices: load('invoices', "COALESCE(NULLIF(invoice_number, ''), '#' || id)", ids.invoices)
  };
}

const ProjectTimeline = {
  PAGE_SIZE,
  allowedKinds,

  /**
   * @param {number} projectId
   * @param {Object} opts
   * @param {Object} opts.user        目前使用者（決定能看到哪些種類）
   * @param {string} [opts.kind]      只看某一種（project/invoice/payment/cost/bonus/attachment）；不傳為全部可見種類
   * @param {string} [opts.cursor]    分頁游標（上一頁最後一筆的 cursor）
   * @param {string} [opts.symbol]    幣別符號
   * @returns {{events: Array, nextCursor: string|null, kinds: string[], counts: Object}}
   */
  list(projectId, { user, kind = null, cursor = null, symbol = '$' } = {}) {
    const visibleKinds = allowedKinds(user);
    const activeKinds = kind && visibleKinds.includes(kind) ? [kind] : visibleKinds;
    const tables = activeKinds.map(k => TABLE_BY_KIND[k]);

    const logRows = fetchLogRows(projectId, tables);
    const all = [...logRows, ...syntheticCreateRows(projectId, tables, logRows)];
    // 排序鍵：時間 → 來源（修改記錄用 id，補的事件用資料表＋id），新→舊；同一時間以較新的記錄在前
    all.forEach((r, i) => {
      r.cursor = `${r.created_at}|${r.id !== null ? 'l' + String(r.id).padStart(10, '0') : 's' + r.table_name + String(r.record_id).padStart(10, '0')}`;
    });
    all.sort((a, b) => (a.cursor < b.cursor ? 1 : a.cursor > b.cursor ? -1 : 0));

    const lookups = buildLookups(all);
    const events = buildEvents(all, { symbol, lookups });

    let start = 0;
    if (cursor) {
      start = events.findIndex(e => e.cursor < cursor);
      if (start === -1) start = events.length;
    }
    const page = events.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < events.length;
    return { events: page, nextCursor: hasMore ? page[page.length - 1].cursor : null, kinds: visibleKinds, total: events.length };
  }
};

module.exports = ProjectTimeline;
