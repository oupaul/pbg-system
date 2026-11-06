// 選項類管理頁（成本類型、付款辦法…）共用的「調整順序」端點。
// 前端（public/js/reorder-table.js）把整份列表排好後，把「全部」id 依新順序送來；
// 後端驗證後在單一交易內重新編號為 1、2、3…（不會有重複數字，也不必手動輸入）。
//
// 必須送完整清單：只送一部分重新編號會和沒送的列撞號；清單和資料庫對不上
// （有人在這之間新增／刪除了項目）就回 409，請使用者重新整理，不會寫出錯誤的順序。
const db = require('../models/db');
const { requireAuth, requireManageSettings } = require('../middleware/auth');

const MAX_ITEMS = 1000;

/**
 * 驗證並整理 ids；不合法回傳 { error }。
 * @param {*} raw req.body.ids
 */
function parseOrderedIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: '沒有要排序的項目' };
  if (raw.length > MAX_ITEMS) return { error: '項目過多' };
  const ids = [];
  for (const v of raw) {
    if (!(typeof v === 'number' || (typeof v === 'string' && /^\d{1,15}$/.test(v)))) return { error: '排序資料不正確' };
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return { error: '排序資料不正確' };
    ids.push(n);
  }
  if (new Set(ids).size !== ids.length) return { error: '排序資料不正確' };
  return { ids };
}

/**
 * 在 router 上掛 POST /reorder。table 只能是程式內寫死的資料表名稱（會直接放進 SQL）。
 * 權限與其他設定類管理頁相同（requireManageSettings）。
 */
function mountReorder(router, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('不合法的資料表名稱');

  router.post('/reorder', requireAuth, requireManageSettings, (req, res) => {
    const parsed = parseOrderedIds(req.body && req.body.ids);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    const { ids } = parsed;

    try {
      const current = db.prepare(`SELECT id FROM ${table}`).all().map(r => r.id);
      const wanted = new Set(ids);
      if (current.length !== ids.length || !current.every(id => wanted.has(id))) {
        return res.status(409).json({ ok: false, error: '列表內容已變動，請重新整理頁面後再調整順序' });
      }

      const update = db.prepare(`UPDATE ${table} SET display_order = ? WHERE id = ?`);
      db.transaction(() => {
        ids.forEach((id, index) => update.run(index + 1, id));
      })();
      res.json({ ok: true });
    } catch (err) {
      console.error(`調整 ${table} 順序失敗:`, err);
      res.status(500).json({ ok: false, error: '儲存順序失敗' });
    }
  });
}

module.exports = { mountReorder, parseOrderedIds };
