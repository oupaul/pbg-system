#!/bin/bash

# 修復腳本：為現有資料庫添加 expected_invoice_year_month 欄位
# 使用 sqlite3 命令行工具

DB_PATH="/opt/invoice-bonus-system/data/invoice_bonus.db"

echo "開始修復資料庫：添加 expected_invoice_year_month 欄位..."

# 檢查資料庫是否存在
if [ ! -f "$DB_PATH" ]; then
    echo "❌ 資料庫檔案不存在: $DB_PATH"
    exit 1
fi

# 檢查欄位是否已存在
COLUMN_EXISTS=$(sqlite3 "$DB_PATH" "PRAGMA table_info(projects);" | grep "expected_invoice_year_month")

if [ ! -z "$COLUMN_EXISTS" ]; then
    echo "✓ 欄位 expected_invoice_year_month 已存在"
    exit 0
fi

# 執行 SQL 命令
sqlite3 "$DB_PATH" <<EOF
BEGIN TRANSACTION;

-- 添加新欄位
ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT;

-- 更新視圖
DROP VIEW IF EXISTS v_project_summary;

CREATE VIEW v_project_summary AS
SELECT 
  p.id,
  p.project_code,
  p.contract_year,
  p.contract_month,
  p.status,
  p.project_type,
  p.project_name,
  p.price_with_tax,
  p.price_without_tax,
  p.is_new_customer,
  p.salesperson_id,
  p.customer_id,
  p.expected_invoice_year_month,
  p.notes,
  p.created_at,
  p.updated_at,
  s.name as salesperson_name,
  s.status as salesperson_status,
  c.customer_code,
  c.tax_id,
  c.company_name,
  COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
  p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as uninvoiced_amount,
  COALESCE((SELECT SUM(bank_deposit_amount) FROM payments WHERE project_id = p.id), 0) as total_received
FROM projects p
LEFT JOIN salespeople s ON p.salesperson_id = s.id
LEFT JOIN customers c ON p.customer_id = c.id;

COMMIT;
EOF

# 檢查執行結果
if [ $? -eq 0 ]; then
    echo "✓ 添加欄位 expected_invoice_year_month"
    echo "✓ 更新 v_project_summary 視圖"
    echo "✅ 修復完成！"
    
    # 驗證
    VERIFY=$(sqlite3 "$DB_PATH" "PRAGMA table_info(projects);" | grep "expected_invoice_year_month")
    if [ ! -z "$VERIFY" ]; then
        echo "✓ 驗證成功：欄位已正確添加"
        echo ""
        echo "現在請重啟服務："
        echo "systemctl restart invoice-bonus-system.service"
    else
        echo "❌ 驗證失敗：欄位未添加"
        exit 1
    fi
else
    echo "❌ 修復失敗"
    exit 1
fi

