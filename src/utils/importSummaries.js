// 匯入結果的整理：
//  - summarize*：把匯入服務的原始結果整理成「預覽頁」用的摘要（統計、錯誤、警告、是否可匯入）
//  - shape*：把正式匯入的原始結果整理成存進 session、供匯入頁/客戶頁顯示的結果（沿用原有格式與上限）
// 皆為純函式，方便測試。

function clip(v, max = 300) {
  const msg = (typeof v === 'object' && v !== null) ? (v.message || String(v)) : String(v);
  return msg.length > max ? msg.substring(0, max) + '...' : msg;
}

function messages(list, max, clipLen) {
  return (list || []).slice(0, max).map(v => clip(v, clipLen));
}

const PREVIEW_MAX_MESSAGES = 5000;

function firstMessage(raw) {
  if (raw && raw.error) return String(raw.error);
  const first = raw && raw.errors && raw.errors[0];
  return first ? clip(first) : '匯入失敗';
}

// ---------- 預覽摘要 ----------

function summarizeProjects(raw) {
  const r = (raw && raw.results) || {};
  // results.salespeople／customers 是「處理過幾列」；實際新增的筆數由匯入服務以交易前後筆數差另外提供
  const newlyCreated = (raw && raw.created) || { salespeople: r.salespeople || 0, customers: r.customers || 0 };
  // 「只會自動建立業務人員」不算有可匯入的內容（所有專案列都失敗時，真正匯入也只會留下孤立的業務人員）
  const created = (r.projects || 0) + (r.invoices || 0) + (r.payments || 0) + (r.bonuses || 0) + (r.costs || 0) + (newlyCreated.customers || 0);
  return {
    stats: [
      { label: '新增專案', value: r.projects || 0, main: true },
      { label: '新增發票', value: r.invoices || 0, main: true },
      { label: '新增收款', value: r.payments || 0, main: true },
      { label: '新增獎金', value: r.bonuses || 0, main: true },
      { label: '新增成本明細', value: r.costs || 0, main: true },
      { label: '新增業務人員（Excel 中不存在的會自動建立）', value: newlyCreated.salespeople || 0 },
      { label: '新增客戶/廠商（Excel 中不存在的會自動建立）', value: newlyCreated.customers || 0 },
      { label: '略過已存在的重複資料', value: r.duplicates || 0 }
    ],
    errors: messages(raw && raw.errors, PREVIEW_MAX_MESSAGES, 300),
    errorCount: (raw && raw.errorCount) || ((raw && raw.errors) || []).length,
    warnings: [],
    importable: created > 0,
    fatal: raw && raw.success === false && created === 0 ? firstMessage(raw) : null
  };
}

function summarizeCosts(raw) {
  const created = (raw && raw.createdCount) || 0;
  return {
    stats: [
      { label: '新增成本明細', value: created, main: true },
      { label: '略過已存在的重複資料', value: (raw && raw.duplicateCount) || 0 },
      { label: '失敗（整列略過）', value: (raw && raw.failedCount) || 0, danger: true }
    ],
    errors: messages(raw && raw.errors, PREVIEW_MAX_MESSAGES, 300),
    errorCount: (raw && raw.errorCount) || ((raw && raw.errors) || []).length,
    warnings: [],
    importable: created > 0,
    fatal: raw && raw.success === false && created === 0 ? firstMessage(raw) : null
  };
}

function summarizeCustomers(raw) {
  const created = (raw && raw.createdCount) || 0;
  return {
    stats: [
      { label: '新增客戶/廠商', value: created, main: true },
      { label: '失敗（整列略過）', value: (raw && raw.skippedCount) || 0, danger: true }
    ],
    errors: messages(raw && raw.errors, PREVIEW_MAX_MESSAGES, 300),
    errorCount: (raw && raw.errorCount) || ((raw && raw.errors) || []).length,
    warnings: [],
    importable: created > 0,
    fatal: raw && raw.success === false && created === 0 ? firstMessage(raw) : null
  };
}

function summarizeActivities(raw) {
  const created = (raw && raw.createdCount) || 0;
  const linked = (raw && raw.linkedCount) || 0;
  const createdTypes = (raw && raw.createdTypes) || [];
  return {
    stats: [
      { label: '新增活動紀錄', value: created, main: true },
      { label: '補上銷售機會關聯', value: linked, main: true },
      { label: '略過已存在的重複資料', value: (raw && raw.duplicateCount) || 0 },
      { label: '失敗（整列略過）', value: (raw && raw.failedCount) || 0, danger: true }
    ],
    errors: messages(raw && raw.errors, PREVIEW_MAX_MESSAGES, 300),
    errorCount: (raw && raw.errorCount) || ((raw && raw.errors) || []).length,
    warnings: messages(raw && raw.warnings, PREVIEW_MAX_MESSAGES, 300),
    notes: createdTypes.length ? [`將自動新增活動類型：${createdTypes.slice(0, 30).join('、')}`] : [],
    importable: created > 0 || linked > 0,
    fatal: raw && raw.success === false && created === 0 && linked === 0 ? firstMessage(raw) : null
  };
}

// ---------- 正式匯入結果（存進 session 供頁面顯示；格式與上限沿用原本的匯入處理） ----------

function shapeProjects(raw) {
  return {
    success: raw.success !== false,
    results: raw.results || {},
    errorCount: raw.errorCount || 0,
    errors: messages(raw.errors, 50, 200),
    log: messages(raw.log, 100, 200),
    warning: raw.warning || null
  };
}

function shapeCosts(raw) {
  return {
    kind: 'costs',
    success: raw.success !== false,
    results: { costs: raw.createdCount || 0, duplicates: raw.duplicateCount || 0, failed: raw.failedCount || 0 },
    errorCount: raw.errorCount || 0,
    errors: messages(raw.errors, 50, 200),
    warning: (raw.failedCount || 0) > 0 ? `有 ${raw.failedCount} 列匯入失敗，其餘已完成` : null
  };
}

function shapeCustomers(raw) {
  return {
    success: raw.success !== false,
    createdCount: raw.createdCount || 0,
    skippedCount: raw.skippedCount || 0,
    errorCount: raw.errorCount || 0,
    errors: messages(raw.errors, 50, 200)
  };
}

function shapeActivities(raw) {
  return {
    kind: 'activities',
    success: raw.success !== false,
    createdCount: raw.createdCount || 0,
    duplicateCount: raw.duplicateCount || 0,
    linkedCount: raw.linkedCount || 0,
    skippedCount: raw.failedCount || 0,
    errorCount: raw.errorCount || 0,
    errors: messages(raw.errors, 50, 200),
    warnings: messages(raw.warnings, 30, 200),
    createdTypes: (raw.createdTypes || []).slice(0, 30)
  };
}

// ---------- 錯誤清單 CSV ----------

// 防 CSV/Excel 公式注入：以 = + - @ 開頭的儲存格前面加單引號
function csvCell(value) {
  let text = String(value === null || value === undefined ? '' : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function buildIssuesCsv(summary) {
  const rows = [['類型', '訊息']];
  (summary.errors || []).forEach(m => rows.push(['錯誤', m]));
  (summary.warnings || []).forEach(m => rows.push(['警告', m]));
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  clip,
  summarizeProjects, summarizeCosts, summarizeCustomers, summarizeActivities,
  shapeProjects, shapeCosts, shapeCustomers, shapeActivities,
  csvCell, buildIssuesCsv
};
