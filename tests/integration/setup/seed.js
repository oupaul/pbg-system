// 整合測試的種子資料（在「複製出來的測試目錄」內執行，cwd 為該目錄；絕不會碰到真實的 data/）。
// 建立：各種角色與使用者、兩位業務（A、B）各自的客戶／專案／發票／收款／成本／獎金／銷售機會／附件記錄。
const path = require('path');
const root = process.cwd();
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));
const argon2 = require(path.join(root, 'node_modules', 'argon2'));

const PASSWORD = 'Passw0rd-test-1';

async function main() {
  const db = new Database(path.join(root, 'data', 'invoice_bonus.db'));
  const hash = await argon2.hash(PASSWORD);

  // 專案類型／獎金類型（匯入與新增專案需要）
  db.prepare("INSERT OR IGNORE INTO project_types (type_name, is_active) VALUES ('A類', 1)").run();
  try { db.prepare("INSERT OR IGNORE INTO bonus_types (type_name, is_active) VALUES ('業績獎金', 1)").run(); } catch { /* 忽略 */ }

  // ---- 角色（內建 admin / user / salesperson / boss 由 migration 建立）----
  const insertRole = db.prepare(`
    INSERT INTO roles (role_key, role_name, can_edit, can_delete, can_edit_crm, can_manage_users, can_manage_roles,
      can_manage_settings, can_backup_restore, can_import, can_view_all_projects, can_view_own_projects,
      project_view_scope, is_system_role, is_active)
    VALUES (@key, @key, @edit, 0, 1, 0, @roles, @settings, @backup, @import, @all, @own, @scope, 0, 1)
  `);
  const role = (key, o = {}) => insertRole.run({ key, edit: 1, roles: 0, settings: 0, backup: 0, import: 0, all: 1, own: 0, scope: 'all', ...o });
  role('edit_only');
  role('settings_only', { settings: 1 });
  role('roles_only', { roles: 1 });
  role('backup_only', { backup: 1 });
  role('import_only', { import: 1 });
  role('own_editor', { all: 0, own: 1, scope: 'own' });
  role('assigned_role', { all: 0, own: 1, scope: 'assigned' });
  role('none_role', { all: 0, own: 0, scope: 'none' });

  // ---- 業務與客戶 ----
  const sp = db.prepare("INSERT INTO salespeople (name, status) VALUES (?, 'active')");
  const spA = Number(sp.run('業務A').lastInsertRowid);
  const spB = Number(sp.run('業務B').lastInsertRowid);

  // ---- 使用者 ----
  const insUser = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, salesperson_id, is_active, must_change_password)
    VALUES (?, ?, ?, ?, ?, 1, 0)
  `);
  const users = {};
  const addUser = (username, roleKey, salespersonId = null) => {
    users[username] = Number(insUser.run(username, hash, username, roleKey, salespersonId).lastInsertRowid);
  };
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = 'admin'").run(hash);
  users.admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  addUser('u_user', 'user');
  addUser('u_boss', 'boss');
  addUser('u_salesA', 'salesperson', spA);
  addUser('u_salesB', 'salesperson', spB);
  addUser('u_ownedit', 'own_editor', spA);
  addUser('u_edit', 'edit_only');
  addUser('u_settings', 'settings_only');
  addUser('u_roles', 'roles_only');
  addUser('u_backup', 'backup_only');
  addUser('u_import', 'import_only');
  addUser('u_assigned', 'assigned_role');
  addUser('u_none', 'none_role');
  addUser('u_victim', 'edit_only'); // 給「停用後 session 立即失效」測試用
  addUser('u_lock', 'edit_only');   // 給「帳號連續失敗鎖定」測試用
  addUser('u_mustchange', 'edit_only');
  db.prepare("UPDATE users SET must_change_password = 1 WHERE username = 'u_mustchange'").run();
  // u_assigned 只被指派看業務 A
  db.prepare('INSERT INTO user_salesperson_access (user_id, salesperson_id) VALUES (?, ?)').run(users.u_assigned, spA);

  // ---- 客戶、專案與各種記錄（業務 A 與 B 各一套）----
  const ids = { users, spA, spB };
  const customer = db.prepare("INSERT INTO customers (customer_code, company_name) VALUES (?, ?)");
  const project = db.prepare(`
    INSERT INTO projects (project_code, contract_year, contract_month, project_type, project_name, salesperson_id, customer_id, price_with_tax, price_without_tax)
    VALUES (?, 2026, 10, 'A類', ?, ?, ?, 105000, 100000)
  `);
  const invoice = db.prepare("INSERT INTO invoices (project_id, invoice_number, invoice_date, amount_with_tax, expected_payment_date, status) VALUES (?, ?, '2026-10-01', 105000, '2026-10-31', '有效')");
  const payment = db.prepare("INSERT INTO payments (project_id, invoice_id, payment_date, bank_deposit_amount) VALUES (?, ?, '2026-10-15', 50000)");
  const bonus = db.prepare("INSERT INTO bonus_calculations (project_id, salesperson_id, bonus_type, base_amount, bonus_percentage, bonus_amount, status) VALUES (?, ?, '業績獎金', 100000, 5, 5000, '待發放')");
  const attach = db.prepare("INSERT INTO project_attachments (project_id, original_filename, stored_filename, mime_type, file_size) VALUES (?, ?, ?, 'application/pdf', 10)");
  const cost = db.prepare("INSERT INTO costs (project_id, amount) VALUES (?, 1000)");

  for (const [tag, spId] of [['A', spA], ['B', spB]]) {
    const cid = Number(customer.run(`C-${tag}`, `客戶${tag}`).lastInsertRowid);
    const pid = Number(project.run(`P-${tag}`, `專案${tag}`, spId, cid).lastInsertRowid);
    const iid = Number(invoice.run(pid, `INV-${tag}`).lastInsertRowid);
    const payid = Number(payment.run(pid, iid).lastInsertRowid);
    const bid = Number(bonus.run(pid, spId).lastInsertRowid);
    const aid = Number(attach.run(pid, `附件${tag}.pdf`, `missing_${tag}.pdf`).lastInsertRowid);
    const costId = Number(cost.run(pid).lastInsertRowid);
    ids[tag] = { customer: cid, project: pid, invoice: iid, payment: payid, bonus: bid, attachment: aid, cost: costId };
  }

  // ---- 客戶關係負責人（轉介紹獎勵的可見範圍會用到）：客戶 A 歸 u_salesA，客戶 B 歸 u_salesB ----
  db.prepare('UPDATE customers SET owner_salesperson_id = ? WHERE id = ?').run(users.u_salesA, ids.A.customer);
  db.prepare('UPDATE customers SET owner_salesperson_id = ? WHERE id = ?').run(users.u_salesB, ids.B.customer);

  // ---- 轉介紹獎勵（金額各不相同，測試用金額辨識是哪一筆）----
  const reward = db.prepare(`
    INSERT INTO referral_rewards (referring_customer_id, project_id, recipient_type, recipient_user_id, reward_amount, status, notes)
    VALUES (?, ?, ?, ?, ?, '待發放', ?)
  `);
  ids.rewards = {
    aProject: Number(reward.run(ids.A.customer, ids.A.project, 'customer', null, 1111, 'A 專案').lastInsertRowid),
    bProject: Number(reward.run(ids.B.customer, ids.B.project, 'customer', null, 2222, 'B 專案').lastInsertRowid),
    bCustomerLevel: Number(reward.run(ids.B.customer, null, 'customer', null, 3333, 'B 客戶層級（無專案）').lastInsertRowid),
    aCustomerLevel: Number(reward.run(ids.A.customer, null, 'customer', null, 4444, 'A 客戶層級（無專案）').lastInsertRowid),
    // 關聯業務 B 的專案，但領取人是 u_salesA：領取人本人應該看得到
    staffForSalesA: Number(reward.run(ids.B.customer, ids.B.project, 'staff', users.u_salesA, 5555, '領取人是 u_salesA').lastInsertRowid)
  };

  require('fs').writeFileSync(path.join(root, 'seed-ids.json'), JSON.stringify(ids));
  db.close();
  console.log('seed ok');
}

main().catch(err => { console.error(err); process.exit(1); });
