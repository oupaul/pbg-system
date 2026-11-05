// 升級路徑：舊結構的資料庫（成本沒有軟刪除、沒有稅別，角色沒有檢視獎金旗標）跑新的 migration 後，
// 既有資料正確、不改任何原有金額、重複執行不出錯。
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { describeIntegration } = require('./helpers');

describeIntegration('成本軟刪除／稅別與檢視獎金旗標的 migration（升級路徑）', () => {
  let dir; let dbFile;
  const run = (name) => {
    process.env.DB_PATH = dbFile;
    const modPath = path.join(__dirname, '..', '..', 'migrations', name);
    delete require.cache[require.resolve(modPath)]; // dbPath 在載入時讀取環境變數
    require(modPath).migrate();
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbg-mig-'));
    dbFile = path.join(dir, 'old.db');
    const db = new Database(dbFile);
    db.exec(`
      CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, setting_type TEXT, description TEXT);
      CREATE TABLE costs (id INTEGER PRIMARY KEY, project_id INTEGER, estimated_amount REAL NOT NULL DEFAULT 0, actual_amount REAL NOT NULL DEFAULT 0, item_name TEXT);
      CREATE TABLE roles (id INTEGER PRIMARY KEY, role_key TEXT, can_edit INTEGER DEFAULT 0);
      INSERT INTO costs (project_id, estimated_amount, actual_amount, item_name) VALUES (1, 1050, 945, 'a'), (1, 0, 300, 'b'), (2, 2100.5, 0, 'c');
      INSERT INTO roles (role_key, can_edit) VALUES ('admin', 1), ('boss', 0), ('custom', 1);
    `);
    db.close();
  });
  afterAll(() => { delete process.env.DB_PATH; fs.rmSync(dir, { recursive: true, force: true }); });

  const read = (sql) => { const db = new Database(dbFile, { readonly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };

  test('軟刪除：新增 deleted_at，既有成本全部視為有效，原金額不動', () => {
    run('migrate_costs_soft_delete.js');
    const rows = read('SELECT item_name, estimated_amount, actual_amount, deleted_at FROM costs ORDER BY id');
    expect(rows).toEqual([
      { item_name: 'a', estimated_amount: 1050, actual_amount: 945, deleted_at: null },
      { item_name: 'b', estimated_amount: 0, actual_amount: 300, deleted_at: null },
      { item_name: 'c', estimated_amount: 2100.5, actual_amount: 0, deleted_at: null }
    ]);
    expect(read("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_costs_project_active'")).toHaveLength(1);
  });

  test('含稅／未稅：既有成本視為含稅，用目前稅率補算未稅金額，原金額不動', () => {
    run('migrate_cost_tax.js'); // 沒有 tax_rate 設定 → 預設 5%
    const rows = read('SELECT item_name, estimated_amount, actual_amount, tax_included, tax_rate, estimated_amount_ex_tax, actual_amount_ex_tax FROM costs ORDER BY id');
    expect(rows).toEqual([
      { item_name: 'a', estimated_amount: 1050, actual_amount: 945, tax_included: 1, tax_rate: 5, estimated_amount_ex_tax: 1000, actual_amount_ex_tax: 900 },
      { item_name: 'b', estimated_amount: 0, actual_amount: 300, tax_included: 1, tax_rate: 5, estimated_amount_ex_tax: 0, actual_amount_ex_tax: 285.71 },
      { item_name: 'c', estimated_amount: 2100.5, actual_amount: 0, tax_included: 1, tax_rate: 5, estimated_amount_ex_tax: 2000.48, actual_amount_ex_tax: 0 }
    ]);
  });

  test('重複執行：不重複補算、不改已算好的列（即使稅率設定之後變了）', () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO system_settings (setting_key, setting_value, setting_type) VALUES ('tax_rate', '10', 'number')").run();
    db.close();
    run('migrate_cost_tax.js');
    run('migrate_costs_soft_delete.js');
    expect(read('SELECT estimated_amount_ex_tax e, tax_rate r FROM costs ORDER BY id').map(x => [x.e, x.r])).toEqual([[1000, 5], [0, 5], [2000.48, 5]]);
  });

  test('之後才補進來的列（沒有未稅金額）會用當時的稅率補算', () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO costs (project_id, estimated_amount, actual_amount, item_name) VALUES (3, 110, 110, 'd')").run();
    db.close();
    run('migrate_cost_tax.js');
    expect(read("SELECT estimated_amount_ex_tax e, actual_amount_ex_tax a, tax_rate r FROM costs WHERE item_name = 'd'")).toEqual([{ e: 100, a: 100, r: 10 }]);
  });

  test('檢視獎金旗標：既有角色全部預設 1（權限不變），重複執行不出錯', () => {
    run('migrate_role_view_bonus.js');
    run('migrate_role_view_bonus.js');
    expect(read('SELECT role_key, can_view_bonus FROM roles ORDER BY id')).toEqual([
      { role_key: 'admin', can_view_bonus: 1 }, { role_key: 'boss', can_view_bonus: 1 }, { role_key: 'custom', can_view_bonus: 1 }
    ]);
  });
});
