const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  SALESPERSON: 'salesperson',
  BOSS: 'boss'
};

const PROJECT_VIEW_SCOPE = {
  ALL: 'all',
  ASSIGNED: 'assigned',
  OWN: 'own',
  NONE: 'none'
};

const PROJECT_STATUS = {
  OPEN: '未結案',
  CLOSED: '已結案',
  CANCELLED: '取消'
};

const INVOICE_STATUS = {
  VALID: '有效',
  VOID: '作廢',
  PARTIAL_ALLOWANCE: '部分折讓',
  FULL_ALLOWANCE: '整筆折讓'
};

const PAYMENT_DIFF_TYPE = {
  FEE: '匯費',
  PENALTY: '違約金',
  OTHER: '其他'
};

const BONUS_STATUS = {
  PENDING: '待發放',
  PAID: '已發放',
  CONFISCATED: '充公'
};

const SALESPERSON_STATUS = {
  ACTIVE: 'active',
  RESIGNED: 'resigned',
  SUSPENDED: 'suspended'
};

const DASHBOARD_VIEW_MODE = {
  ALL_AND_SEPARATE: 'all_and_separate',
  EXCLUDE_SEPARATE: 'exclude_separate',
  NONE: 'none'
};

// 判定「線上」的門檻：最近 N 分鐘內有請求活動即視為線上
const ONLINE_THRESHOLD_MINUTES = 10;

// 銷售機會成交機率固定對應的階段名稱，純顯示用（不影響任何業務邏輯判斷），
// 原本在 5 個檔案裡各自重複定義一份一樣的對照表，容易改一處忘了改其他處而不一致，
// 這裡集中成唯一的來源。陣列本身即為顯示順序（由低到高）。
const WIN_PROBABILITY_STAGES = [
  { pct: 10, label: '初步接洽' },
  { pct: 30, label: '需求分析' },
  { pct: 50, label: '提案報價' },
  { pct: 100, label: '商務談判' }
];

// 上面陣列的 {百分比: 名稱} 查表版本，給只需要「依百分比查名稱」的地方用，
// 避免每個呼叫端都要自己 reduce 一次
const WIN_PROBABILITY_STAGE_LABELS = WIN_PROBABILITY_STAGES.reduce((map, s) => {
  map[s.pct] = s.label;
  return map;
}, {});

module.exports = {
  ROLES,
  PROJECT_VIEW_SCOPE,
  PROJECT_STATUS,
  INVOICE_STATUS,
  PAYMENT_DIFF_TYPE,
  BONUS_STATUS,
  SALESPERSON_STATUS,
  DASHBOARD_VIEW_MODE,
  ONLINE_THRESHOLD_MINUTES,
  WIN_PROBABILITY_STAGES,
  WIN_PROBABILITY_STAGE_LABELS
};
