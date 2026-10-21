/**
 * 逾期收款自動提醒。
 *
 * 依「預計收款日」找出尚未收齊的發票（逾期＋可選的即將到期），彙整成「一則」訊息發給：
 *   - 負責該專案業務所綁定的使用者（只看到自己的發票）
 *   - 管理員在系統設定指定的彙總收件人（財務/主管，看到全公司並依業務分組）
 * 訊息一律走 NotificationService.notify：一定有站內通知，使用者有填 Email/LINE 且對應管道已啟用時也會外送。
 *
 * 排程在程序內執行（每 5 分鐘檢查一次，不需要額外的 systemd timer）：
 * 到了設定時間且今天還沒執行過就執行一次；先記錄執行日期再發送，避免重複發送。預設停用。
 */
// 延遲載入資料庫與其他服務：純函式（shouldRunNow／buildDigest）可以在不開資料庫的情況下使用與測試
const db = { prepare: (sql) => require('../models/db').prepare(sql) };

const MAX_LINES_PER_SECTION = 15;
const DEFAULT_TIME = '09:00';

function getSetting(key, defaultValue) {
  try {
    const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row && row.setting_value !== null ? row.setting_value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function setSetting(key, value) {
  db.prepare(`UPDATE system_settings SET setting_value = ?, updated_at = datetime('now', 'localtime') WHERE setting_key = ?`)
    .run(String(value), key);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// 伺服器本地日期 YYYY-MM-DD
function localDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 兩個 YYYY-MM-DD 日期相差幾天（b - a）
function daysBetween(a, b) {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db_ = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db_ - da) / 86400000);
}

function parseTimeToMinutes(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function money(symbol, n) {
  return symbol + Math.round(Number(n) || 0).toLocaleString('en-US');
}

/**
 * 現在是否該自動執行一次
 * weekly：每週一；若錯過週一（例如當天主機關機），距離上次執行滿 7 天也會補發
 * daily：週一到週五每天
 */
function shouldRunNow({ now, enabled, frequency, time, lastRunDate }) {
  if (!enabled) return false;
  const today = localDateStr(now);
  if (lastRunDate === today) return false;

  const configured = parseTimeToMinutes(time);
  const targetMinutes = configured === null ? parseTimeToMinutes(DEFAULT_TIME) : configured;
  if (now.getHours() * 60 + now.getMinutes() < targetMinutes) return false;

  const weekday = now.getDay(); // 0 週日 … 6 週六
  if (frequency === 'daily') return weekday >= 1 && weekday <= 5;

  // weekly（預設）
  if (weekday === 1) return true;
  if (lastRunDate && /^\d{4}-\d{2}-\d{2}$/.test(lastRunDate)) return daysBetween(lastRunDate, today) >= 7;
  return false;
}

function sectionLines(items, kind, today, symbol, { showSalesperson }) {
  const lines = items.slice(0, MAX_LINES_PER_SECTION).map(it => {
    const who = showSalesperson ? `${it.salesperson_name || '-'}｜` : '';
    const base = `・${who}${it.project_code || ''} ${it.project_name || ''}｜${it.invoice_number || '-'}｜${money(symbol, it.unpaid)}`;
    const days = daysBetween(it.expected_payment_date, today);
    return kind === 'overdue'
      ? `${base}｜逾期 ${days} 天（預計 ${it.expected_payment_date}）`
      : `${base}｜預計 ${it.expected_payment_date}（${days === 0 ? '今天' : `${-days} 天後`}）`;
  });
  if (items.length > MAX_LINES_PER_SECTION) lines.push(`…另有 ${items.length - MAX_LINES_PER_SECTION} 筆，請登入系統查看`);
  return lines;
}

function sum(items) { return items.reduce((s, it) => s + (it.unpaid || 0), 0); }

/**
 * 組出一則提醒訊息
 * @param {Object} data { overdue: [], upcoming: [] }（逾期已依逾期天數、即將到期已依預計日排序前的原始項目即可）
 * @param {Object} opts { today, symbol, upcomingDays, showSalesperson, byPerson, testPrefix }
 * @returns {{title: string, message: string}|null}  沒有任何項目回傳 null
 */
function buildDigest(data, opts) {
  const { today, symbol = '$', upcomingDays = 7, showSalesperson = false, byPerson = false, testPrefix = '' } = opts;
  const overdue = [...data.overdue].sort((a, b) => a.expected_payment_date.localeCompare(b.expected_payment_date));
  const upcoming = [...data.upcoming].sort((a, b) => a.expected_payment_date.localeCompare(b.expected_payment_date));
  if (overdue.length === 0 && upcoming.length === 0) return null;

  const titleParts = [];
  if (overdue.length) titleParts.push(`逾期 ${overdue.length} 張（${money(symbol, sum(overdue))}）`);
  if (upcoming.length) titleParts.push(`即將到期 ${upcoming.length} 張（${money(symbol, sum(upcoming))}）`);
  const title = `${testPrefix}收款提醒${byPerson ? '彙總' : ''}：${titleParts.join('、')}`;

  const blocks = [];
  if (byPerson) {
    const groups = new Map();
    for (const [kind, list] of [['overdue', overdue], ['upcoming', upcoming]]) {
      for (const it of list) {
        const key = it.salesperson_name || '（未指定業務）';
        if (!groups.has(key)) groups.set(key, { overdue: [], upcoming: [] });
        groups.get(key)[kind].push(it);
      }
    }
    const rows = [...groups.entries()]
      .sort((a, b) => sum(b[1].overdue) - sum(a[1].overdue))
      .map(([name, g]) => {
        const parts = [];
        if (g.overdue.length) parts.push(`逾期 ${g.overdue.length} 張 ${money(symbol, sum(g.overdue))}`);
        if (g.upcoming.length) parts.push(`即將到期 ${g.upcoming.length} 張 ${money(symbol, sum(g.upcoming))}`);
        return `・${name}：${parts.join('、')}`;
      });
    blocks.push(['各業務概況', ...rows].join('\n'));
  }
  if (overdue.length) {
    blocks.push([`逾期未收（${overdue.length} 張，合計 ${money(symbol, sum(overdue))}）`, ...sectionLines(overdue, 'overdue', today, symbol, { showSalesperson })].join('\n'));
  }
  if (upcoming.length) {
    blocks.push([`${upcomingDays} 天內即將到期（${upcoming.length} 張，合計 ${money(symbol, sum(upcoming))}）`, ...sectionLines(upcoming, 'upcoming', today, symbol, { showSalesperson })].join('\n'));
  }
  return { title, message: blocks.join('\n\n') };
}

function parseIds(text) {
  return String(text || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
}

const OverdueReminderService = {
  shouldRunNow,
  buildDigest,
  daysBetween,
  localDateStr,
  parseTimeToMinutes,

  /**
   * 立即產生並發送一次提醒
   * @param {Object} opts
   * @param {Date}   [opts.now]
   * @param {number} [opts.onlyUserId] 只發給這位使用者（完整彙總內容，標題加「【測試】」），供設定頁測試用
   * @returns {{overdueCount, upcomingCount, salespersonRecipients, watcherRecipients, empty}}
   */
  run({ now = new Date(), onlyUserId = null } = {}) {
    const today = localDateStr(now);
    const upcomingDays = parseInt(getSetting('payment_reminder_days', '7'), 10) || 7;
    const includeUpcoming = getSetting('overdue_reminder_include_upcoming', 'true') === 'true';
    const symbol = getSetting('currency_symbol', '$') || '$';

    const ReceivablesAgingService = require('./ReceivablesAgingService');
    const NotificationService = require('./NotificationService');
    const reminder = ReceivablesAgingService.getPaymentReminder(upcomingDays, null, null);
    const overdue = reminder.overdue;
    const upcoming = includeUpcoming ? reminder.upcoming : [];
    const summary = { overdueCount: overdue.length, upcomingCount: upcoming.length, salespersonRecipients: 0, watcherRecipients: 0, empty: false };
    if (overdue.length === 0 && upcoming.length === 0) {
      summary.empty = true;
      return summary;
    }

    const baseOpts = { today, symbol, upcomingDays };
    const send = (userId, digest) => NotificationService.notify(userId, {
      type: 'payment_overdue_digest',
      title: digest.title,
      message: digest.message,
      link: '/',
      related_type: 'payment_digest',
      related_id: null
    });

    // 測試：只發給指定使用者，內容是完整彙總
    if (onlyUserId) {
      const digest = buildDigest({ overdue, upcoming }, { ...baseOpts, showSalesperson: true, byPerson: true, testPrefix: '【測試】' });
      send(onlyUserId, digest);
      summary.watcherRecipients = 1;
      return summary;
    }

    const activeUsers = db.prepare('SELECT id, salesperson_id FROM users WHERE is_active = 1').all();
    const activeIds = new Set(activeUsers.map(u => u.id));
    const watcherIds = new Set(parseIds(getSetting('overdue_reminder_notify_user_ids', '')).filter(id => activeIds.has(id)));

    // 彙總收件人：全公司
    if (watcherIds.size > 0) {
      const digest = buildDigest({ overdue, upcoming }, { ...baseOpts, showSalesperson: true, byPerson: true });
      watcherIds.forEach(id => send(id, digest));
      summary.watcherRecipients = watcherIds.size;
    }

    // 業務本人：只看自己的發票（已是彙總收件人的人不重複發）
    const bySalesperson = new Map();
    for (const kind of ['overdue', 'upcoming']) {
      for (const it of (kind === 'overdue' ? overdue : upcoming)) {
        if (!it.salesperson_id) continue;
        if (!bySalesperson.has(it.salesperson_id)) bySalesperson.set(it.salesperson_id, { overdue: [], upcoming: [] });
        bySalesperson.get(it.salesperson_id)[kind].push(it);
      }
    }
    for (const user of activeUsers) {
      if (!user.salesperson_id || watcherIds.has(user.id)) continue;
      const data = bySalesperson.get(user.salesperson_id);
      if (!data) continue;
      const digest = buildDigest(data, baseOpts);
      if (!digest) continue;
      send(user.id, digest);
      summary.salespersonRecipients++;
    }
    return summary;
  },

  /** 排程檢查：到時間且今天還沒跑過就執行一次。回傳執行摘要或 null（沒執行） */
  tick(now = new Date()) {
    const decision = shouldRunNow({
      now,
      enabled: getSetting('overdue_reminder_enabled', 'false') === 'true',
      frequency: getSetting('overdue_reminder_frequency', 'weekly'),
      time: getSetting('overdue_reminder_time', DEFAULT_TIME),
      lastRunDate: getSetting('overdue_reminder_last_run_date', '')
    });
    if (!decision) return null;

    // 先記錄今天已執行，再發送：就算發送途中出錯或重啟，也不會在同一天重複發送
    setSetting('overdue_reminder_last_run_date', localDateStr(now));
    try {
      const summary = this.run({ now });
      console.log(`[逾期收款提醒] 已執行：逾期 ${summary.overdueCount} 張、即將到期 ${summary.upcomingCount} 張，彙總收件人 ${summary.watcherRecipients}、業務 ${summary.salespersonRecipients}`);
      return summary;
    } catch (err) {
      console.error('[逾期收款提醒] 執行失敗:', err.message);
      return null;
    }
  },

  _timer: null,
  _startTimer: null,

  /** 啟動排程（程序內每 5 分鐘檢查一次；已啟動則略過） */
  start({ intervalMs = 5 * 60 * 1000 } = {}) {
    if (this._timer) return;
    const safeTick = () => { try { this.tick(); } catch (err) { console.error('[逾期收款提醒] 排程檢查失敗:', err.message); } };
    this._timer = setInterval(safeTick, intervalMs);
    this._timer.unref();
    // 啟動後稍等再檢查一次，讓剛過了設定時間才重啟的情況也能補上
    this._startTimer = setTimeout(safeTick, 30 * 1000);
    this._startTimer.unref();
  },

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._startTimer) clearTimeout(this._startTimer);
    this._timer = null;
    this._startTimer = null;
  }
};

module.exports = OverdueReminderService;
