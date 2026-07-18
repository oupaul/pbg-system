#!/usr/bin/env node
// Migration runner — 依序執行 migrations/，以 schema_migrations 追蹤已執行項目
// 新增 migration 時只需在 MIGRATIONS 陣列末尾加一行，runner 自動只跑新的。

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'invoice_bonus.db');

// 依執行順序排列 — 只能在最後新增，不可改變已有項目的位置
const MIGRATIONS = [
  'migrate_project_code_unique',
  'migrate_project_customer_unique',
  'migrate_project_name_unique',
  'migrate_user_roles',
  'migrate_roles',
  'migrate_remove_user_role_check',
  'migrate_system_settings',
  'migrate_project_types',
  'migrate_remove_project_type_check',
  'migrate_sales_discount',
  'migrate_costs',
  'migrate_update_total_received_with_fee',
  'migrate_invoice_expected_payment_date',
  'migrate_invoice_status',
  'migrate_soft_delete_invoices_payments',
  'migrate_invoice_partial_allowance',
  'migrate_fix_v_project_summary_invoice_filters',
  'migrate_project_templates',
  'migrate_project_types_alert_threshold',
  'migrate_project_types_show_in_dashboard',
  'migrate_project_types_show_separate_dashboard',
  'migrate_project_attachments',
  'migrate_project_attachments_soft_delete',
  'migrate_attachment_cleanup_setting',
  'migrate_report_groups',
  'migrate_dashboard_view_mode',
  'migrate_permission_scope',
  'migrate_v_invoice_summary',
  'migrate_rename_user_role',
  'migrate_crm_pipeline_activity',
  'migrate_customer_contact_owner',
  'migrate_activity_reminder_days',
  'migrate_customer_level_industry_status',
  'migrate_crm_edit_permission',
  'migrate_deletion_requests',
  'migrate_customer_vendor_party_type',
  'migrate_customer_bank_info',
  'migrate_customer_address',
  'migrate_customer_owner_to_user',
  'migrate_pipeline_owner_user',
  'migrate_customer_creation_requests',
  'migrate_notifications',
  'migrate_notification_channels',
  'migrate_customer_request_pipeline_bundle',
  'migrate_business_event_notify_recipients',
];

function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('資料庫不存在，跳過 migration runner');
    return;
  }

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name   TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  const done = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
  );
  db.close();

  const pending = MIGRATIONS.filter(m => !done.has(m));

  if (pending.length === 0) {
    console.log('✓ 所有 migration 均已執行，無需更新');
    return;
  }

  if (done.size === 0) {
    console.log(`執行 ${pending.length} 個 migration...`);
  } else {
    console.log(`發現 ${pending.length} 個新 migration：`);
    pending.forEach(m => console.log(`  + ${m}`));
    console.log('');
  }

  let success = 0;
  let failed = 0;
  const failedList = [];

  for (const name of pending) {
    const scriptPath = path.join(__dirname, `${name}.js`);
    if (!fs.existsSync(scriptPath)) {
      console.warn(`[警告] 找不到 migration 腳本: ${name}.js，跳過`);
      continue;
    }

    try {
      execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: PROJECT_ROOT });

      const db2 = new Database(DB_PATH);
      db2.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)').run(name);
      db2.close();

      success++;
    } catch {
      console.error(`[警告] ${name} 執行失敗，將於下次重試`);
      failed++;
      failedList.push(name);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`✓ migration 完成：執行 ${success} 個`);
  } else {
    console.log(`migration 完成：${success} 個成功，${failed} 個失敗（${failedList.join(', ')}）`);
    process.exit(1);
  }
}

run();
