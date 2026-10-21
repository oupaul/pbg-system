// 批次操作的共用邏輯（專案頁的發票／收款批次刪除與還原）。
// 規則：整批要同一個專案、專案要在使用者範圍內、全部成功才生效（任何一筆失敗整批復原）、
// 每批有數量上限。刪除是軟刪除，可再批次還原。
const db = require('../models/db');
const { userCanAccessProject } = require('./projectScope');
const cache = require('../services/CacheService');

const MAX_BATCH = 200;

/** 把表單送來的 ids（單一字串或陣列）整理成不重複的正整數陣列；不合法回傳 { error } */
function parseIdList(raw, max = MAX_BATCH) {
  const list = [].concat(raw === undefined || raw === null ? [] : raw).map(v => String(v).trim()).filter(v => v !== '');
  if (list.length === 0) return { error: '請先勾選要處理的資料' };
  if (!list.every(v => /^\d{1,15}$/.test(v))) return { error: '勾選的資料不正確' };
  const ids = [...new Set(list.map(Number))];
  if (ids.length > max) return { error: `一次最多處理 ${max} 筆` };
  return { ids };
}

/**
 * @param {Object} opts
 * @param {Object} opts.req, opts.res
 * @param {Function} opts.find     (id) => 資料列（要有 project_id、deleted_at）
 * @param {Function} opts.apply    (record) => boolean，實際執行並回傳是否有變動；失敗請丟 Error（整批復原）
 * @param {string}  opts.unit      單位與名稱，例如 '張發票'、'筆收款'
 * @param {string}  opts.verb      動作，例如 '刪除'、'還原'
 * @param {string}  opts.tab       完成後回到的分頁（pane id，不含 #）
 * @param {boolean} [opts.showDeleted]  完成後專案頁是否顯示已刪除
 */
function runBatch({ req, res, find, apply, unit, verb, tab, showDeleted = false }) {
  const fail = (status, message, projectId = null) => {
    if (projectId) return res.redirect(`/projects/${projectId}?error=${encodeURIComponent(message)}#${tab}`);
    return res.status(status).render('error', { title: status === 403 ? '權限不足' : '請求錯誤', message, error: {} });
  };

  const parsed = parseIdList(req.body && req.body.ids);
  if (parsed.error) {
    const back = /^\d+$/.test(String(req.body && req.body.project_id || '')) ? parseInt(req.body.project_id, 10) : null;
    return fail(400, parsed.error, back);
  }

  const records = parsed.ids.map(find);
  if (records.some(r => !r)) return fail(400, '部分資料不存在，請重新整理頁面後再試');
  const projectIds = [...new Set(records.map(r => r.project_id))];
  if (projectIds.length !== 1) return fail(400, '一次只能處理同一個專案的資料');
  const projectId = projectIds[0];
  // 先全部檢查範圍再動手，任何一筆不在範圍內就整批拒絕
  if (!userCanAccessProject(req.user, projectId)) return fail(403, '您沒有權限操作這個專案的資料');

  let changed = 0;
  try {
    db.transaction(() => {
      for (const record of records) if (apply(record)) changed++;
    })();
  } catch (err) {
    return fail(400, `批次${verb}失敗，全部未變更：${err.message}`, projectId);
  }

  if (changed > 0) cache.delByPrefix('dashboard:');
  const skipped = records.length - changed;
  const message = `已${verb} ${changed} ${unit}` + (skipped > 0 ? `（${skipped} ${unit}不需處理，已略過）` : '');
  const flag = showDeleted ? 'show_deleted=1&' : '';
  return res.redirect(`/projects/${projectId}?${flag}success=${encodeURIComponent(message)}#${tab}`);
}

module.exports = { MAX_BATCH, parseIdList, runBatch };
