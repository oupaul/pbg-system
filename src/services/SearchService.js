/**
 * 全系統搜尋
 *
 * 免維護清單：啟動後自動用 PRAGMA 掃描所有資料表的文字欄位（新表/新欄位自動納入），
 * 命中後沿外鍵往上找歸屬（專案優先，其次客戶）。可搜尋範圍由兩層決定：
 *   1. 程式內建「系統底線」（下方常數，管理者無法移除）：系統類資料表與含密碼/憑證樣式的欄位
 *   2. 管理者在「搜尋範圍設定」勾選的 search_field_settings（沒有紀錄 = 預設納入，標示為新出現）
 */
const db = require('../models/db');
const { ROLES, PROJECT_VIEW_SCOPE } = require('../constants');

// 系統底線：整表排除（系統/帳號/憑證/紀錄類，不論管理者如何設定都不會被搜尋）
const FLOOR_EXCLUDED_TABLES = new Set([
  'users', 'roles', 'system_settings', 'system_logs', 'login_history', 'notifications',
  'user_salesperson_access', 'approval_chain_steps', 'schema_migrations', 'deletion_requests',
  'search_field_settings'
]);

// 系統底線：欄位名稱含這些樣式的一律不搜
const FLOOR_EXCLUDED_COLUMN = /password|secret|token|hash|stored_filename|line_user_id/i;

// 這些資料表的內容只給有編輯權限的角色搜尋（比照專案頁「獎金」頁籤的可見範圍）
const EDIT_REQUIRED_TABLES = new Set(['bonus_calculations', 'referral_rewards']);

// 顯示用中文標籤（缺漏時退回原本的資料表/欄位名稱，不影響搜尋本身）
const TABLE_LABELS = {
  projects: '專案', customers: '客戶/廠商', invoices: '發票', payments: '收款', costs: '成本明細',
  bonus_calculations: '獎金', referral_rewards: '轉介紹紀錄', pipelines: '銷售機會',
  activities: '活動紀錄', project_attachments: '附件', revenue_recognition: '業績認列',
  invoice_requests: '發票開立申請', invoice_request_items: '發票開立申請明細',
  project_templates: '專案範本', customer_creation_requests: '新客戶審核申請'
};
const COLUMN_LABELS = {
  notes: '備註', project_name: '專案名稱', project_code: '專案編號', company_name: '公司名稱',
  customer_code: '客戶編號', tax_id: '統一編號', invoice_number: '發票號碼', item_name: '成本名稱',
  item_code: '進項編號', contact_name: '聯絡人', contact_phone: '聯絡電話', contact_email: '聯絡Email',
  address: '地址', industry: '產業別', opportunity_name: '商機名稱', content: '內容',
  void_reason: '作廢原因', forfeiture_reason: '充公原因', contract_term: '合約年限',
  sales_mode: '銷售模式', project_type: '專案類型', status: '狀態', cost_type: '成本類型',
  cost_category: '費用類別', payment_method: '付款辦法', payment_term: '付款條件',
  order_status: '下單狀態', bonus_type: '獎金類型', original_filename: '檔名', bank_name: '銀行',
  bank_account: '銀行帳號', customer_level: '客戶等級', request_type: '申請類型',
  quote_number: '報價單號', recipient_name: '收件人', recipient_address: '收件地址',
  recipient_phone: '收件電話', review_note: '審核備註', created_by: '建立者'
};

let schemaCache = null;

function quote(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function schemaVersion() {
  const row = db.prepare('PRAGMA schema_version').get();
  return row ? row.schema_version : 0;
}

// 掃描整個資料庫結構；以 PRAGMA schema_version 判斷是否需要重掃（migration 之後自動更新）
function getSchema() {
  const version = schemaVersion();
  if (schemaCache && schemaCache.version === version) return schemaCache.tables;

  const tableNames = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%\\_new' ESCAPE '\\'
    ORDER BY name
  `).all().map(r => r.name);

  const tables = {};
  tableNames.forEach(name => {
    const cols = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const fks = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
    tables[name] = {
      name,
      columns: cols,
      pk: (cols.find(c => c.pk) || {}).name || 'id',
      textColumns: cols.filter(c => !c.pk && /CHAR|TEXT|CLOB/i.test(c.type || '')).map(c => c.name),
      hasDeletedAt: cols.some(c => c.name === 'deleted_at'),
      fks: fks.map(f => ({ from: f.from, table: f.table, to: f.to })),
      notNull: new Set(cols.filter(c => c.notnull).map(c => c.name))
    };
  });

  Object.values(tables).forEach(t => { t.owner = resolveOwner(t, tables); });
  schemaCache = { version, tables };
  return tables;
}

// 從資料表出發沿外鍵 BFS（最多 3 跳）找歸屬：優先專案、其次客戶；
// 只走「必填外鍵」的路徑（可為空的外鍵會讓部分資料找不到歸屬）；都沒有才退而使用可為空的路徑
function resolveOwner(table, tables) {
  if (table.name === 'projects') return { type: 'project', joins: [], alias: 't', idCol: 'id' };
  if (table.name === 'customers') return { type: 'customer', joins: [], alias: 't', idCol: 'id' };

  const found = { strict: [], loose: [] };
  const queue = [{ table, joins: [], strict: true, visited: new Set([table.name]) }];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.joins.length >= 3) continue;
    cur.table.fks.forEach(fk => {
      const target = tables[fk.table];
      if (!target || cur.visited.has(target.name)) return;
      const nullable = !cur.table.notNull.has(fk.from);
      const strict = cur.strict && !nullable;
      const joins = cur.joins.concat([{
        fromAlias: cur.joins.length === 0 ? 't' : 'j' + cur.joins.length,
        fromCol: fk.from,
        toTable: target.name,
        toAlias: 'j' + (cur.joins.length + 1),
        toCol: fk.to || target.pk
      }]);
      if (target.name === 'projects' || target.name === 'customers') {
        (strict ? found.strict : found.loose).push({
          type: target.name === 'projects' ? 'project' : 'customer', joins, alias: 'j' + joins.length, idCol: fk.to || target.pk
        });
      } else {
        queue.push({ table: target, joins, strict, visited: new Set([...cur.visited, target.name]) });
      }
    });
  }
  const rank = (a, b) => (a.type === b.type ? a.joins.length - b.joins.length : (a.type === 'project' ? -1 : 1));
  const pool = found.strict.length ? found.strict : found.loose;
  return pool.sort(rank)[0] || null;
}

function loadSettings() {
  const map = {};
  try {
    db.prepare('SELECT table_name, column_name, is_searchable, is_confirmed FROM search_field_settings').all()
      .forEach(r => {
        (map[r.table_name] = map[r.table_name] || {})[r.column_name] = r;
      });
  } catch (_) { /* 尚未執行 migration 時視為沒有任何設定 */ }
  return map;
}

// 決定某資料表目前實際可搜尋的欄位（套用系統底線與管理者設定）
function searchableColumns(table, settings) {
  if (FLOOR_EXCLUDED_TABLES.has(table.name)) return [];
  const tableSetting = (settings[table.name] || {})['*'];
  if (tableSetting && !tableSetting.is_searchable) return [];
  return table.textColumns.filter(col => {
    if (FLOOR_EXCLUDED_COLUMN.test(col)) return false;
    const s = (settings[table.name] || {})[col];
    return s ? !!s.is_searchable : true;
  });
}

function projectScopeCondition(user, alias) {
  if (!user) return { sql: '', params: [] };
  const scope = user.project_view_scope ||
    (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);
  if (scope === PROJECT_VIEW_SCOPE.ALL) return { sql: '', params: [] };
  if (scope === PROJECT_VIEW_SCOPE.NONE) return { sql: ' AND 1=0', params: [] };
  if (scope === PROJECT_VIEW_SCOPE.OWN) {
    if (!user.salesperson_id) return { sql: ' AND 1=0', params: [] };
    return { sql: ` AND ${alias}.salesperson_id = ?`, params: [user.salesperson_id] };
  }
  if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
    let ids = [];
    try {
      ids = db.prepare('SELECT salesperson_id FROM user_salesperson_access WHERE user_id = ?').all(user.id).map(r => r.salesperson_id);
    } catch (_) { /* ignore */ }
    if (!ids.length) return { sql: ' AND 1=0', params: [] };
    return { sql: ` AND ${alias}.salesperson_id IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  return { sql: ' AND 1=0', params: [] };
}

function escapeLike(q) {
  return q.replace(/[\\%_]/g, m => '\\' + m);
}

function makeSnippet(value, q) {
  const text = String(value);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 60);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + q.length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// 核心：回傳命中清單（每筆含歸屬類型/id 與命中來源）
function collect(q, user, perTableLimit) {
  const tables = getSchema();
  const settings = loadSettings();
  const pattern = '%' + escapeLike(q) + '%';
  const isAdmin = !!(user && user.isAdmin);
  const canEdit = !!(user && user.canEdit);
  const hits = [];

  Object.values(tables).forEach(table => {
    const cols = searchableColumns(table, settings);
    if (!cols.length) return;
    if (EDIT_REQUIRED_TABLES.has(table.name) && !canEdit) return;

    const owner = table.owner;
    // 沒有歸屬的資料表只有管理者搜得到，且不顯示內容（防止漏擋敏感表時洩漏內容）
    if (!owner && !isAdmin) return;

    const joinSql = owner ? owner.joins.map(j =>
      ` LEFT JOIN ${quote(j.toTable)} ${j.toAlias} ON ${j.toAlias}.${quote(j.toCol)} = ${j.fromAlias}.${quote(j.fromCol)}`
    ).join('') : '';
    const ownerSelect = owner ? `${owner.alias}.${quote(owner.idCol)}` : 'NULL';
    const where = '(' + cols.map(c => `t.${quote(c)} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
    const params = cols.map(() => pattern);

    let scopeSql = '';
    if (owner && owner.type === 'project') {
      const scope = projectScopeCondition(user, owner.alias);
      scopeSql = scope.sql;
      params.push(...scope.params);
    }
    const deletedSql = table.hasDeletedAt ? ' AND t.deleted_at IS NULL' : '';
    const ownerDeletedSql = owner && owner.type === 'customer' && owner.alias !== 't'
      ? ` AND (${owner.alias}.deleted_at IS NULL)` : '';

    const sql = `SELECT t.rowid AS _rid, ${ownerSelect} AS _owner_id, ` +
      cols.map((c, i) => `t.${quote(c)} AS c${i}`).join(', ') +
      ` FROM ${quote(table.name)} t${joinSql} WHERE ${where}${deletedSql}${ownerDeletedSql}${scopeSql} LIMIT ${perTableLimit}`;

    let rows;
    try {
      rows = db.prepare(sql).all(...params);
    } catch (err) {
      console.error(`[搜尋] 查詢 ${table.name} 失敗:`, err.message);
      return;
    }
    rows.forEach(row => {
      const matched = [];
      cols.forEach((c, i) => {
        const v = row['c' + i];
        if (v !== null && v !== undefined && String(v).toLowerCase().includes(q.toLowerCase())) {
          matched.push({ column: c, snippet: makeSnippet(v, q) });
        }
      });
      if (!matched.length) return;
      if (owner && (row._owner_id === null || row._owner_id === undefined)) {
        if (!isAdmin) return;
        hits.push({ ownerType: 'orphan', ownerId: null, table: table.name, rowId: row._rid, matched: matched.map(m => ({ column: m.column, snippet: null })) });
        return;
      }
      hits.push({
        ownerType: owner ? owner.type : 'orphan',
        ownerId: owner ? row._owner_id : null,
        table: table.name,
        rowId: row._rid,
        // 沒有歸屬的資料只顯示命中的欄位名稱，不顯示內容
        matched: owner ? matched : matched.map(m => ({ column: m.column, snippet: null }))
      });
    });
  });
  return hits;
}

function labelTable(t) { return TABLE_LABELS[t] || t; }
function labelColumn(c) { return COLUMN_LABELS[c] || c; }

const SearchService = {
  MIN_LENGTH: 2,
  labelTable,
  labelColumn,

  // 全域搜尋：回傳依歸屬分組的結果
  search(q, user, groupLimit = 20) {
    const hits = collect(q, user, 200);
    const groups = { project: new Map(), customer: new Map(), orphan: new Map() };
    hits.forEach(h => {
      const key = h.ownerType === 'orphan' ? h.table : h.ownerId;
      const map = groups[h.ownerType];
      if (!map.has(key)) map.set(key, { ownerId: h.ownerId, table: h.table, hits: [] });
      map.get(key).hits.push({ table: h.table, tableLabel: labelTable(h.table), rowId: h.rowId,
        matched: h.matched.map(m => ({ column: m.column, columnLabel: labelColumn(m.column), snippet: m.snippet })) });
    });

    const result = { projects: [], customers: [], other: [], totals: { projects: groups.project.size, customers: groups.customer.size, other: groups.orphan.size } };

    const projectIds = [...groups.project.keys()];
    if (projectIds.length) {
      const infos = db.prepare(`
        SELECT p.id, p.project_code, p.project_name, p.project_type, p.status, p.price_with_tax, c.company_name, sp.name AS salesperson_name
        FROM projects p
        LEFT JOIN customers c ON p.customer_id = c.id
        LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
        WHERE p.id IN (${projectIds.map(() => '?').join(',')})
      `).all(...projectIds);
      infos.forEach(info => { info.hits = groups.project.get(info.id).hits; });
      result.projects = infos.sort((a, b) => b.hits.length - a.hits.length).slice(0, groupLimit);
    }

    const customerIds = [...groups.customer.keys()];
    if (customerIds.length) {
      const infos = db.prepare(`
        SELECT id, customer_code, company_name, tax_id FROM customers
        WHERE id IN (${customerIds.map(() => '?').join(',')}) AND deleted_at IS NULL
      `).all(...customerIds);
      infos.forEach(info => { info.hits = groups.customer.get(info.id).hits; });
      result.customers = infos.sort((a, b) => b.hits.length - a.hits.length).slice(0, groupLimit);
    }

    result.other = [...groups.orphan.values()].slice(0, groupLimit).map(g => ({
      table: g.table, tableLabel: labelTable(g.table), hits: g.hits
    }));
    return result;
  },

  // 專案列表的關鍵字搜尋：回傳「任何資料命中且歸屬到專案」的專案 id
  findProjectIdsByKeyword(keyword, user) {
    const q = (keyword || '').trim();
    if (q.length < 1) return [];
    const ids = new Set();
    collect(q, user, 500).forEach(h => { if (h.ownerType === 'project') ids.add(h.ownerId); });
    return [...ids];
  },

  // 搜尋範圍設定頁用：列出所有資料表與欄位目前的狀態
  describe() {
    const tables = getSchema();
    const settings = loadSettings();
    return Object.values(tables).filter(t => t.textColumns.length).map(t => {
      const tableSetting = (settings[t.name] || {})['*'];
      const floorTable = FLOOR_EXCLUDED_TABLES.has(t.name);
      return {
        name: t.name,
        label: labelTable(t.name),
        floorExcluded: floorTable,
        searchable: !floorTable && !(tableSetting && !tableSetting.is_searchable),
        ownerType: t.owner ? t.owner.type : null,
        columns: t.textColumns.map(c => {
          const s = (settings[t.name] || {})[c];
          const floor = floorTable || FLOOR_EXCLUDED_COLUMN.test(c);
          return {
            name: c,
            label: labelColumn(c),
            floorExcluded: floor,
            searchable: !floor && (s ? !!s.is_searchable : true),
            isNew: !floor && !s
          };
        })
      };
    }).sort((a, b) => Number(a.floorExcluded) - Number(b.floorExcluded) || a.name.localeCompare(b.name));
  },

  // 儲存設定：每個顯示在頁面上的欄位都記為已確認
  saveSettings(entries) {
    const upsert = db.prepare(`
      INSERT INTO search_field_settings (table_name, column_name, is_searchable, is_confirmed, updated_at)
      VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
      ON CONFLICT(table_name, column_name)
      DO UPDATE SET is_searchable = excluded.is_searchable, is_confirmed = 1, updated_at = excluded.updated_at
    `);
    db.transaction(() => {
      entries.forEach(e => upsert.run(e.table, e.column, e.searchable ? 1 : 0));
    })();
    schemaCache = null;
  },

  isFloorExcludedTable: t => FLOOR_EXCLUDED_TABLES.has(t),
  isFloorExcludedColumn: c => FLOOR_EXCLUDED_COLUMN.test(c),
  _resetCache() { schemaCache = null; }
};

module.exports = SearchService;
