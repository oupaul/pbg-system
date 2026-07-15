/**
 * 儀表板檢視模式與業務獨立加總
 *
 * 1. salespeople: show_separate_dashboard - 是否在儀表板顯示獨立加總區塊
 * 2. roles: dashboard_view_mode - 儀表板檢視模式
 *    - all_and_separate: 全部專案 + 獨立業務區塊（boss, user）
 *    - exclude_separate: 僅非獨立專案（pm_manager）
 *    - none: 不顯示儀表板（salesperson）
 */
const db = require('../src/models/db');

function migrate() {
  try {
    console.log('開始執行儀表板檢視模式遷移...');

    // 1. salespeople 新增 show_separate_dashboard
    try {
      db.prepare('ALTER TABLE salespeople ADD COLUMN show_separate_dashboard INTEGER DEFAULT 0').run();
      console.log('✓ salespeople 已新增 show_separate_dashboard');
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
      console.log('  salespeople.show_separate_dashboard 已存在，略過');
    }

    // 2. roles 新增 dashboard_view_mode
    try {
      db.prepare('ALTER TABLE roles ADD COLUMN dashboard_view_mode TEXT DEFAULT \'all_and_separate\'').run();
      console.log('✓ roles 已新增 dashboard_view_mode');
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
      console.log('  roles.dashboard_view_mode 已存在，略過');
    }

    // 3. 設定預設值：salesperson = none，其餘 = all_and_separate
    const updated = db.prepare(`
      UPDATE roles SET dashboard_view_mode = CASE
        WHEN role_key = 'salesperson' THEN 'none'
        ELSE 'all_and_separate'
      END
      WHERE dashboard_view_mode IS NULL OR dashboard_view_mode = ''
    `).run();
    if (updated.changes > 0) {
      console.log(`✓ 已更新 ${updated.changes} 個角色的 dashboard_view_mode`);
    }

    console.log('✓ 儀表板檢視模式遷移完成');
  } catch (err) {
    console.error('❌ 遷移失敗:', err.message);
    throw err;
  }
}

migrate();
