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

module.exports = {
  ROLES,
  PROJECT_VIEW_SCOPE,
  PROJECT_STATUS,
  INVOICE_STATUS,
  PAYMENT_DIFF_TYPE,
  BONUS_STATUS,
  SALESPERSON_STATUS,
  DASHBOARD_VIEW_MODE,
  ONLINE_THRESHOLD_MINUTES
};
