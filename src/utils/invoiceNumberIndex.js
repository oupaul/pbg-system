// 發票號碼唯一索引：同一個號碼同時只能有一張「有效」發票（忽略大小寫；已作廢、已刪除的不佔用）。
// 部分唯一索引由 migration 與 scripts/check-invoice-duplicates.js 共用；已存在重複資料時索引無法建立，
// 必須先人工處理（哪一張是對的只有人能判斷，所以不自動修改資料）。
// 這裡的函式接收原生 better-sqlite3 的資料庫物件。
const INDEX_NAME = 'idx_invoices_number_active';

const ACTIVE_CONDITION = `invoice_number IS NOT NULL AND invoice_number <> ''
  AND deleted_at IS NULL AND COALESCE(status, '有效') <> '作廢'`;

function hasInvoicesTable(db) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'").get();
}

function indexExists(db) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(INDEX_NAME);
}

/** 目前仍佔用號碼、但同號碼出現多次的發票（依號碼分組，不分大小寫） */
function findDuplicates(db) {
  const groups = db.prepare(`
    SELECT invoice_number COLLATE NOCASE AS number, COUNT(*) AS count
    FROM invoices
    WHERE ${ACTIVE_CONDITION}
    GROUP BY invoice_number COLLATE NOCASE
    HAVING COUNT(*) > 1
    ORDER BY number
  `).all();
  const rows = db.prepare(`
    SELECT i.id, i.invoice_number, i.invoice_date, i.amount_with_tax, i.status, p.project_code, p.project_name
    FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.invoice_number = ? COLLATE NOCASE
      AND i.deleted_at IS NULL AND COALESCE(i.status, '有效') <> '作廢'
    ORDER BY i.id
  `);
  return groups.map(g => ({ number: g.number, count: g.count, invoices: rows.all(g.number) }));
}

/** 建立索引；有重複資料時不建立並回傳重複清單 */
function createIndexIfClean(db) {
  if (!hasInvoicesTable(db)) return { status: 'no-table' };
  if (indexExists(db)) return { status: 'exists' };
  const duplicates = findDuplicates(db);
  if (duplicates.length > 0) return { status: 'duplicates', duplicates };
  db.exec(`CREATE UNIQUE INDEX ${INDEX_NAME} ON invoices(invoice_number COLLATE NOCASE) WHERE ${ACTIVE_CONDITION}`);
  return { status: 'created' };
}

function formatDuplicates(duplicates) {
  const lines = [];
  for (const d of duplicates) {
    lines.push(`  發票號碼 ${d.number}（${d.count} 張）：`);
    for (const inv of d.invoices) {
      lines.push(`    - 發票 #${inv.id}｜專案 ${inv.project_code || '?'} ${inv.project_name || ''}｜日期 ${inv.invoice_date || '-'}｜金額 ${inv.amount_with_tax}｜狀態 ${inv.status || '有效'}`);
    }
  }
  return lines.join('\n');
}

module.exports = { INDEX_NAME, ACTIVE_CONDITION, hasInvoicesTable, indexExists, findDuplicates, createIndexIfClean, formatDuplicates };
