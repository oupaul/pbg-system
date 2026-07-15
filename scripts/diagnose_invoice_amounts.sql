-- ============================================================
-- 發票金額診斷查詢
-- 用於比對儀表板、專案管理、v_project_summary 的金額差異
-- 執行方式: sqlite3 data/invoice_bonus.db < scripts/diagnose_invoice_amounts.sql
-- ============================================================

.mode column
.headers on
.width 12 20 12 12 12 12

SELECT '=== 1. 發票總額比對（三種計算方式）===' as section;
SELECT '';

-- 方式 A: 儀表板邏輯（僅 status 有效，不含 deleted_at、allowance_amount）
SELECT 
  '儀表板邏輯' as 計算方式,
  COALESCE(SUM(amount_with_tax), 0) as 總額,
  COUNT(*) as 發票筆數
FROM invoices 
WHERE (status IS NULL OR status = '有效');

-- 方式 B: 專案管理/v_project_summary 邏輯（含 deleted_at、allowance_amount）
SELECT 
  'v_project_summary' as 計算方式,
  COALESCE(SUM(amount_with_tax - COALESCE(allowance_amount, 0)), 0) as 總額,
  COUNT(*) as 發票筆數
FROM invoices 
WHERE (status IS NULL OR status = '有效') AND (deleted_at IS NULL);

-- 方式 C: 全部發票（含作廢、整筆折讓、軟刪除）
SELECT 
  '全部發票(含作廢等)' as 計算方式,
  COALESCE(SUM(amount_with_tax), 0) as 總額,
  COUNT(*) as 發票筆數
FROM invoices;

SELECT '';
SELECT '=== 2. 可能造成差異的發票（有效但已軟刪除、或有部分折讓）===' as section;
SELECT '';

SELECT 
  i.id as 發票ID,
  p.project_code as 專案編號,
  i.invoice_number as 發票號碼,
  i.invoice_date as 發票日期,
  i.amount_with_tax as 金額,
  COALESCE(i.allowance_amount, 0) as 部分折讓,
  i.status as 狀態,
  CASE WHEN i.deleted_at IS NOT NULL THEN '已刪除' ELSE '' END as 軟刪除
FROM invoices i
JOIN projects p ON i.project_id = p.id
WHERE (i.status IS NULL OR i.status = '有效')
  AND (i.deleted_at IS NOT NULL OR COALESCE(i.allowance_amount, 0) > 0)
ORDER BY p.project_code, i.invoice_date;

SELECT '';
SELECT '=== 3. 疑似重複發票（同專案、同金額、不同發票號碼）===' as section;
SELECT '';

SELECT 
  a.project_id as 專案ID,
  p.project_code as 專案編號,
  a.amount_with_tax as 金額,
  COUNT(*) as 筆數,
  GROUP_CONCAT(a.invoice_number, ' | ') as 發票號碼列表,
  GROUP_CONCAT(a.id, ', ') as 發票ID列表
FROM invoices a
JOIN projects p ON a.project_id = p.id
WHERE (a.status IS NULL OR a.status = '有效') AND (a.deleted_at IS NULL)
GROUP BY a.project_id, a.amount_with_tax
HAVING COUNT(*) > 1
ORDER BY 筆數 DESC;

SELECT '';
SELECT '=== 4. 各專案金額比對（v_project_summary vs 直接加總）===' as section;
SELECT '';

SELECT 
  v.id as 專案ID,
  v.project_code as 專案編號,
  v.total_invoiced as 視圖已開發票,
  COALESCE(direct.total, 0) as 直接加總,
  (v.total_invoiced - COALESCE(direct.total, 0)) as 差異
FROM v_project_summary v
LEFT JOIN (
  SELECT project_id, 
    SUM(amount_with_tax - COALESCE(allowance_amount, 0)) as total
  FROM invoices 
  WHERE (status IS NULL OR status = '有效') AND (deleted_at IS NULL)
  GROUP BY project_id
) direct ON v.id = direct.project_id
WHERE ABS(v.total_invoiced - COALESCE(direct.total, 0)) > 0.01
ORDER BY ABS(v.total_invoiced - COALESCE(direct.total, 0)) DESC;

SELECT '';
SELECT '=== 5. 收款總額比對（含/不含軟刪除）===' as section;
SELECT '';

SELECT 
  '含已刪除收款' as 計算方式,
  COALESCE(SUM(bank_deposit_amount), 0) as 銀行匯入總額
FROM payments;

SELECT 
  '僅未刪除收款' as 計算方式,
  COALESCE(SUM(bank_deposit_amount), 0) as 銀行匯入總額
FROM payments 
WHERE deleted_at IS NULL;

SELECT '';
SELECT '=== 6. 作廢重開關聯檢查（original_invoice_id / replacement_invoice_id）===' as section;
SELECT '';

SELECT 
  i.id as 發票ID,
  p.project_code as 專案編號,
  i.invoice_number as 發票號碼,
  i.status as 狀態,
  i.original_invoice_id as 原發票ID,
  i.replacement_invoice_id as 重開發票ID
FROM invoices i
JOIN projects p ON i.project_id = p.id
WHERE i.original_invoice_id IS NOT NULL OR i.replacement_invoice_id IS NOT NULL
ORDER BY p.project_code, i.id;

SELECT '';
SELECT '=== 診斷完成 ===' as section;
