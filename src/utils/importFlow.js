// 匯入前預覽流程（上傳 → 試跑預覽 → 確認才寫入）。每種匯入各自呼叫 mountImportFlow 掛上一組路由：
//   POST   {urlBase}                  上傳（驗證副檔名/內容/結構）→ 暫存 → 試跑（交易最後回滾，不留任何資料）→ 轉到預覽頁
//   GET    {urlBase}/preview/:token   預覽頁：將新增／略過／失敗的筆數、錯誤與警告明細
//   POST   {urlBase}/confirm/:token   確認：用同一份暫存檔正式匯入
//   POST   {urlBase}/cancel/:token    取消：刪除暫存檔
//   GET    {urlBase}/issues/:token    下載錯誤／警告清單（CSV）
const path = require('path');
const { createStaging } = require('./importStaging');
const { buildIssuesCsv } = require('./importSummaries');
const { createSnapshot } = require('./dbSnapshot');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const staging = createStaging({ dir: path.join(__dirname, '..', '..', 'uploads', 'import-staging') });

// 瀏覽器常以 UTF-8 傳送中文檔名，若被解為 Latin-1 會變亂碼（與專案附件相同的處理）
function fixFilenameEncoding(name) {
  if (!name || typeof name !== 'string') return name;
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch { return name; }
}

function mountImportFlow(router, cfg) {
  // urlBase：完整網址路徑（用於轉址與頁面連結，例如 /import-export/import）；routePath：相對於 router 掛載點的路徑（例如 /import）
  const { urlBase, routePath, kind, label, backUrl, guards = [], upload, run, summarize, finish, longTimeout = false } = cfg;
  const back = (query) => backUrl + (query ? `?${query}` : '');
  const errorBack = (res, message) => res.redirect(back('error=' + encodeURIComponent(message)));
  const userIdOf = (req) => (req.user && req.user.id) || null;

  // 1. 上傳 → 試跑
  router.post(routePath, ...guards, ...upload, async (req, res) => {
    if (!req.file) return errorBack(res, '請選擇檔案');
    if (longTimeout) { req.setTimeout(600000); res.setTimeout(600000); }
    const token = staging.stage(req.file.path, {
      userId: userIdOf(req), kind, originalName: fixFilenameEncoding(req.file.originalname) || 'import.xlsx'
    });
    const entry = staging.get(token, userIdOf(req), kind);
    try {
      const raw = await run(entry.filePath, req, { dryRun: true });
      entry.summary = summarize(raw);
    } catch (err) {
      console.error(`[匯入預覽] ${label} 試跑失敗:`, err.message);
      staging.discard(entry);
      return errorBack(res, err.message || '預覽過程中發生未知錯誤');
    }
    res.redirect(`${urlBase}/preview/${token}`);
  });

  // 2. 預覽頁
  router.get(`${routePath}/preview/:token`, ...guards, (req, res) => {
    const entry = staging.get(req.params.token, userIdOf(req), kind);
    if (!entry || !entry.summary) return errorBack(res, '預覽已過期或不存在，請重新上傳檔案');
    const s = entry.summary;
    res.render('import-export/preview', {
      title: `${label}匯入預覽`,
      label,
      fileName: entry.originalName,
      stats: s.stats,
      errors: s.errors,
      errorCount: s.errorCount,
      warnings: s.warnings,
      notes: s.notes || [],
      importable: s.importable && !s.fatal,
      snapshotError: req.query.snapshotError === '1',
      fatal: s.fatal,
      confirmUrl: `${urlBase}/confirm/${entry.token}`,
      cancelUrl: `${urlBase}/cancel/${entry.token}`,
      issuesUrl: `${urlBase}/issues/${entry.token}`,
      backUrl
    });
  });

  // 3. 確認 → 正式匯入（先取走暫存，避免重複點擊匯入兩次）
  router.post(`${routePath}/confirm/:token`, ...guards, async (req, res) => {
    if (!staging.get(req.params.token, userIdOf(req), kind)) return errorBack(res, '預覽已過期或已匯入過，請重新上傳檔案');

    // 正式寫入前先保存一份資料庫快照（失敗就中止，不在沒有安全網的情況下寫入；暫存檔保留，可直接重試）
    let snapshot;
    try {
      snapshot = createSnapshot({ exec: (sql) => require('../models/db').exec(sql), dir: DATA_DIR, prefix: 'pre-import', keep: 5 });
      console.log(`[匯入] ${label}：已建立匯入前快照 ${snapshot.name}`);
    } catch (err) {
      console.error(`[匯入] ${label}：無法建立匯入前快照:`, err.message);
      return res.redirect(`${urlBase}/preview/${req.params.token}?snapshotError=1`);
    }

    const entry = staging.claim(req.params.token, userIdOf(req), kind);
    if (!entry) return errorBack(res, '預覽已過期或已匯入過，請重新上傳檔案');
    if (longTimeout) { req.setTimeout(600000); res.setTimeout(600000); }
    try {
      const raw = await run(entry.filePath, req, { dryRun: false });
      finish(req, raw);
      if (req.session.importResult) req.session.importResult.snapshot = snapshot.name;
      try { require('../services/CacheService').delByPrefix('dashboard:'); } catch (e) { /* 快取清除失敗不影響匯入結果 */ }
      res.redirect(backUrl);
    } catch (err) {
      console.error(`[匯入] ${label} 失敗:`, err.message);
      errorBack(res, err.message || '匯入過程中發生未知錯誤');
    } finally {
      staging.discard(entry);
    }
  });

  // 4. 取消
  router.post(`${routePath}/cancel/:token`, ...guards, (req, res) => {
    const entry = staging.get(req.params.token, userIdOf(req), kind);
    if (entry) staging.discard(entry);
    res.redirect(backUrl);
  });

  // 5. 錯誤／警告清單 CSV
  router.get(`${routePath}/issues/:token`, ...guards, (req, res) => {
    const entry = staging.get(req.params.token, userIdOf(req), kind);
    if (!entry || !entry.summary) return errorBack(res, '預覽已過期或不存在，請重新上傳檔案');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-issues.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(buildIssuesCsv(entry.summary));
  });
}

module.exports = { mountImportFlow, staging };
