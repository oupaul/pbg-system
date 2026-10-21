/**
 * 資料保留與自動清理：修改記錄（system_logs）、登入紀錄（login_history）、已讀通知（notifications）。
 *
 * 保留天數由管理員在「系統設定」設定，全部預設 0（不清理）；超過天數的資料每天自動永久刪除一次
 * （程序內排程，沿用逾期收款提醒的做法：先寫入執行日期再執行，避免同一天重複執行）。
 * 刪除分批進行（每批 5000 筆），不會長時間鎖住資料庫。未讀通知永遠不會被清理。
 */
// 延遲載入資料庫：純函式（formatLocal、validateDays）可以在不開資料庫的情況下使用與測試
const db = { prepare: (sql) => require('../models/db').prepare(sql) };

const BATCH_SIZE = 5000;
const MAX_BATCHES = 400; // 單次最多清 200 萬筆，避免異常情況下無限迴圈
const RUN_HOUR = 3;
const RUN_MINUTE = 30;

const TARGETS = [
  { key: 'retention_system_logs_days', table: 'system_logs', dateColumn: 'created_at', label: '修改記錄', minDays: 30, extraWhere: '' },
  { key: 'retention_login_history_days', table: 'login_history', dateColumn: 'logged_in_at', label: '登入紀錄', minDays: 30, extraWhere: '' },
  { key: 'retention_read_notifications_days', table: 'notifications', dateColumn: 'created_at', label: '已讀通知', minDays: 7, extraWhere: ' AND is_read = 1' }
];

function pad2(n) { return String(n).padStart(2, '0'); }

// 伺服器本地時間 YYYY-MM-DD HH:MM:SS（資料表的時間欄位都是 datetime('now','localtime') 的字串）
function formatLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function localDate(date) { return formatLocal(date).slice(0, 10); }

/** 保留天數是否合法：0（不清理），或不小於該項目的最小天數、不超過 3650 天 */
function validateDays(days, minDays) {
  if (!Number.isInteger(days)) return false;
  return days === 0 || (days >= minDays && days <= 3650);
}

function getSetting(key, fallback) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row && row.setting_value !== null ? row.setting_value : fallback;
  } catch { return fallback; }
}

function setSetting(key, value) {
  db.prepare(`UPDATE system_settings SET setting_value = ?, updated_at = datetime('now', 'localtime') WHERE setting_key = ?`).run(String(value), key);
}

function configuredDays(target) {
  const n = parseInt(getSetting(target.key, '0'), 10);
  return validateDays(n, target.minDays) ? n : 0; // 設定值不合法時一律視為不清理（不要因為壞掉的設定誤刪資料）
}

const DataRetentionService = {
  TARGETS,
  formatLocal,
  validateDays,

  /** 各項目的目前筆數、最舊一筆的時間，以及依目前設定「將被清理」的筆數 */
  getStats(now = new Date()) {
    const nowStr = formatLocal(now);
    return TARGETS.map(t => {
      const days = configuredDays(t);
      let total = 0, oldest = null, deletable = 0;
      try {
        const agg = db.prepare(`SELECT COUNT(*) AS c, MIN(${t.dateColumn}) AS oldest FROM ${t.table}`).get();
        total = agg.c; oldest = agg.oldest;
        if (days > 0) {
          deletable = db.prepare(`SELECT COUNT(*) AS c FROM ${t.table} WHERE ${t.dateColumn} < datetime(?, '-' || ? || ' days')${t.extraWhere}`).get(nowStr, days).c;
        }
      } catch { /* 舊資料庫沒有該資料表時顯示 0 */ }
      return { key: t.key, label: t.label, table: t.table, days, minDays: t.minDays, total, oldest, deletable };
    });
  },

  /**
   * 依目前設定清理一次
   * @returns {Object} { deleted: { <table>: n }, total }
   */
  run({ now = new Date(), actor = '系統（自動清理）' } = {}) {
    const nowStr = formatLocal(now);
    const deleted = {};
    let total = 0;
    for (const t of TARGETS) {
      const days = configuredDays(t);
      if (days === 0) continue;
      let count = 0;
      for (let i = 0; i < MAX_BATCHES; i++) {
        const r = db.prepare(`
          DELETE FROM ${t.table} WHERE id IN (
            SELECT id FROM ${t.table} WHERE ${t.dateColumn} < datetime(?, '-' || ? || ' days')${t.extraWhere} LIMIT ${BATCH_SIZE}
          )
        `).run(nowStr, days);
        count += r.changes;
        if (r.changes < BATCH_SIZE) break;
      }
      if (count > 0) { deleted[t.table] = count; total += count; }
    }
    if (total > 0) {
      // 留一筆修改記錄說明清理了什麼（這筆本身是最新的，不會被這次清理刪掉）
      try {
        require('./AuditLogService').log('retention_cleanup', 'system_settings', 0, null, deleted, actor);
      } catch { /* 記錄失敗不影響清理結果 */ }
      console.log('[資料保留] 已清理：', JSON.stringify(deleted));
    }
    return { deleted, total };
  },

  /** 排程檢查：有設定保留天數、到了清理時間且今天還沒跑過就執行一次 */
  tick(now = new Date()) {
    if (TARGETS.every(t => configuredDays(t) === 0)) return null;
    const today = localDate(now);
    if (getSetting('retention_last_run_date', '') === today) return null;
    if (now.getHours() * 60 + now.getMinutes() < RUN_HOUR * 60 + RUN_MINUTE) return null;
    setSetting('retention_last_run_date', today); // 先記錄再執行，避免同一天重複
    try { return this.run({ now }); } catch (err) {
      console.error('[資料保留] 清理失敗:', err.message);
      return null;
    }
  },

  _timer: null,
  start({ intervalMs = 30 * 60 * 1000 } = {}) {
    if (this._timer) return;
    this._timer = setInterval(() => { try { this.tick(); } catch (err) { console.error('[資料保留] 排程失敗:', err.message); } }, intervalMs);
    this._timer.unref();
  },
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
};

module.exports = DataRetentionService;
