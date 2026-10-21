// 角色 × 端點的權限矩陣：每個端點列出「哪些使用者允許進入處理函式」，其餘一律必須被擋下（403／導回登入）。
// 允許的使用者送出的是刻意無效的內容（空表單），所以只會進到處理函式後被驗證擋掉，不會留下資料。
//
// 種子使用者（見 setup/seed.js）：
//   admin 系統管理員；u_user 專案管理員；u_boss 老闆（唯讀）；u_salesA/u_salesB 業務員（範圍：自己）
//   u_edit 只有編輯；u_settings/u_roles/u_backup/u_import 各只多一個管理旗標；
//   u_ownedit 範圍「自己」的編輯者；u_assigned 範圍「指派」；u_none 範圍「無」
const { describeIntegration, as, getRoutes, ids, isAllowed } = require('./helpers');

const ALL = ['admin', 'u_user', 'u_boss', 'u_salesA', 'u_edit', 'u_settings', 'u_roles', 'u_backup', 'u_import', 'u_ownedit', 'u_assigned', 'u_none'];
const EDITORS = ['admin', 'u_user', 'u_edit', 'u_settings', 'u_roles', 'u_backup', 'u_import', 'u_ownedit', 'u_assigned', 'u_none'];
// 業務績效頁只開放專案檢視範圍為「全部」的角色（見 routes/salesPerformance.js）
const ALL_SCOPE = ['admin', 'u_user', 'u_boss', 'u_edit', 'u_settings', 'u_roles', 'u_backup', 'u_import'];
const projA = () => ({ project_id: String(ids.A.project) });

// [method, path, form, 允許的使用者]
const adminOnly = ['admin'];
const rolesAdmin = ['admin', 'u_roles'];
const settingsAdmin = ['admin', 'u_settings'];
const backupAdmin = ['admin', 'u_backup'];
// 有編輯權限且專案檢視範圍為「全部」
const EDITORS_ALL_SCOPE = ['admin', 'u_user', 'u_edit', 'u_settings', 'u_roles', 'u_backup', 'u_import'];
const importers = ['admin', 'u_user', 'u_import'];
// 財務資料寫入：需要編輯權限，且專案要在自己的範圍內（u_none 範圍為「無」、u_ownedit/u_assigned 只含業務 A 的專案）
const financeWriters = ['admin', 'u_user', 'u_edit', 'u_settings', 'u_roles', 'u_backup', 'u_import', 'u_ownedit', 'u_assigned'];

const settingsPages = ['/settings/', '/project-types/', '/bonus-types/', '/bonus-tiers/', '/activity-types/', '/sales-modes/',
  '/search-settings/', '/customer-levels/', '/customer-statuses/', '/pipeline-statuses/', '/approval-chains/', '/cost-types/',
  '/cost-categories/', '/payment-methods/', '/payment-terms/', '/order-statuses/', '/report-groups/', '/pipeline-amount-options/'];
const settingsWrites = ['/settings/update', '/settings/bulk-update', '/settings/test-email', '/settings/overdue-reminder/test',
  '/settings/favicon/delete', '/settings/retention/run', '/project-types/create', '/project-types/update/999999', '/project-types/delete/999999',
  '/bonus-types/create', '/bonus-tiers/create', '/activity-types/create', '/sales-modes/create', '/customer-levels/create',
  '/customer-statuses/create', '/pipeline-statuses/create', '/approval-chains/create', '/cost-types/create', '/cost-categories/create',
  '/payment-methods/create', '/payment-terms/create', '/order-statuses/create', '/report-groups/create', '/pipeline-amount-options/create'];

const ENDPOINTS = [
  // ---- 使用者管理（can_manage_users）----
  ...['/users/', '/users/new', '/audit-logs/', '/audit-logs/statistics', '/audit-logs/export', '/login-history/', '/health/',
    '/notifications/broadcast', '/customers/export', '/customers/export-activities', '/customers/import/template', '/customers/import-activities/template']
    .map(p => ['GET', p, null, adminOnly]),
  ...['/users/', '/users/999999', '/users/999999/toggle-active', '/users/999999/reset-2fa', '/notifications/broadcast', '/customers/import', '/customers/import-activities']
    .map(p => ['POST', p, {}, adminOnly]),

  // ---- 角色管理（can_manage_roles）----
  ['GET', '/roles/', null, rolesAdmin], ['GET', '/roles/new', null, rolesAdmin],
  ['POST', '/roles/', {}, rolesAdmin], ['PUT', '/roles/999999', {}, rolesAdmin], ['DELETE', '/roles/999999', null, rolesAdmin],

  // ---- 系統設定與各類選項（can_manage_settings）----
  ...settingsPages.map(p => ['GET', p, null, settingsAdmin]),
  ...settingsWrites.map(p => ['POST', p, {}, settingsAdmin]),

  // ---- 備份還原（can_backup_restore）。刻意不含會真的執行備份的 POST /backup、POST /nas/config ----
  ...['/backup-restore/', '/backup-restore/nas/config', '/backup-restore/progress/nope', '/backup-restore/download/nope.tar.gz']
    .map(p => ['GET', p, null, backupAdmin]),
  ...['/backup-restore/restore', '/backup-restore/delete', '/backup-restore/delete-batch', '/backup-restore/nas/test']
    .map(p => ['POST', p, {}, backupAdmin]),

  // ---- 匯入匯出：頁面與匯出需要編輯權限；專案總表／成本明細匯入另需 can_import ----
  ...['/import-export/', '/import-export/template', '/import-export/template/costs'].map(p => ['GET', p, null, EDITORS]),
  // 全公司範圍的匯出：另外要求專案檢視範圍為「全部」（範圍為自己／指派／無的編輯者不可，否則會帶出他人資料）
  ...['/import-export/export/projects/2026', '/import-export/export/bonuses/2026', '/import-export/export/invoices/all',
    '/import-export/export/costs/all', '/import-export/export/aging', '/import-export/export/pdf/projects/2026',
    '/import-export/export/pdf/bonuses/2026', '/import-export/export/pdf/aging']
    .map(p => ['GET', p, null, EDITORS_ALL_SCOPE]),
  ['GET', '/sales-performance/export', null, ALL_SCOPE],
  ['POST', '/import-export/import', {}, importers], ['POST', '/import-export/import-costs', {}, importers],

  // ---- 財務資料寫入（編輯權限＋專案範圍）----
  ['POST', '/payments/', projA, financeWriters], ['POST', '/costs/', projA, financeWriters],
  ['POST', '/invoices/', projA, financeWriters], ['POST', '/bonuses/', projA, financeWriters],
  ['POST', '/bonuses/batch-update', {}, EDITORS], ['POST', '/bonuses/batch-delete', {}, ['admin', 'u_user']],
  ['POST', '/projects/', {}, EDITORS], ['GET', '/projects/new', null, EDITORS],
  ['POST', '/salespeople/', {}, EDITORS], ['POST', '/project-templates/', {}, EDITORS],

  // ---- 所有登入者都能看的一般頁面（確認沒有被過度限制）----
  ['GET', '/sales-performance/', null, ALL_SCOPE],
  ['GET', '/account/security', null, ALL],
  ...['/', '/projects/', '/bonuses/', '/recent-payments/', '/gross-profit/', '/search/', '/customers/', '/pipelines/', '/notifications/']
    .map(p => ['GET', p, null, ALL])
];

describeIntegration('權限矩陣', () => {
  let clients;
  beforeAll(async () => {
    clients = {};
    for (const u of ALL) clients[u] = await as(u);
  });

  test('所有種子使用者都能登入', () => {
    const failed = ALL.filter(u => clients[u].loginStatus !== 302 || !/^\/$|^\/\?/.test(clients[u].loginLocation));
    expect(failed).toEqual([]);
  });

  test.each(ENDPOINTS.map(e => [`${e[0]} ${e[1]}`, e]))('%s', async (label, [method, path, form, allow]) => {
    const mismatches = [];
    for (const user of ALL) {
      const body = typeof form === 'function' ? form() : form;
      const res = await clients[user].request(method, path, body ? { form: body } : {});
      const allowed = isAllowed(res);
      const expected = allow.includes(user);
      if (allowed !== expected) mismatches.push(`${user}：預期${expected ? '允許' : '拒絕'}，實際 ${res.status}${res.location ? ' → ' + res.location.slice(0, 50) : ''}`);
    }
    expect(mismatches).toEqual([]);
  });
});

// ---- 「寫入面」凍結：唯讀與受限角色實際能執行的所有變更類路由，必須剛好等於下面的清單 ----
// 新增任何一條變更資料的路由後，如果這兩個角色能打到它，這個測試會失敗，逼著開發者確認是否真的該開放。
describeIntegration('寫入面（變更類路由）', () => {
  const SKIP = new Set(['/login', '/login/2fa', '/logout', '/change-password', '/webhooks/line/']); // 這幾個會破壞或改變目前的 session

  async function allowedMutations(username) {
    const c = await as(username);
    const out = [];
    for (const r of await getRoutes()) {
      if (r.method === 'GET' || SKIP.has(r.path)) continue;
      const res = await c.request(r.method, r.url, { form: {} });
      if (isAllowed(res)) out.push(r.key);
    }
    return out.sort();
  }

  test('老闆（唯讀）只能標記自己的通知為已讀', async () => {
    expect(await allowedMutations('u_boss')).toEqual([
      'POST /account/security/2fa/disable',
      'POST /account/security/2fa/enable',
      'POST /account/security/2fa/recovery-codes',
      'POST /notifications/:id/read',
      'POST /notifications/mark-all-read'
    ]);
  });

  test('業務員只能操作 CRM（客戶、銷售機會、活動紀錄、轉介紹獎勵）與自己的通知', async () => {
    expect(await allowedMutations('u_salesA')).toEqual([
      'POST /account/security/2fa/disable',
      'POST /account/security/2fa/enable',
      'POST /account/security/2fa/recovery-codes',
      'POST /customers/',
      'POST /customers/:id',
      'POST /customers/:id/activities',
      'POST /customers/:id/activities/:activityId/delete',
      'POST /customers/:id/delete',
      'POST /customers/quick-add',
      'POST /notifications/:id/read',
      'POST /notifications/mark-all-read',
      'POST /pipelines/',
      'POST /pipelines/:id',
      'POST /pipelines/:id/activities',
      'POST /pipelines/:id/activities/:activityId/delete',
      'POST /pipelines/:id/delete',
      'POST /pipelines/:id/status',
      'POST /referral-rewards/',
      'POST /referral-rewards/:id',
      'POST /referral-rewards/:id/delete'
    ].sort());
  });
});
