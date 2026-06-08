/**
 * 建立 v_invoice_summary 視圖
 *
 * 此視圖擴充 invoices 資料，每筆發票額外提供：
 *   recognized_amount  = amount_with_tax - allowance_amount（認列金額）
 *   total_received     = 所有未刪除收款的實際到帳合計（匯費計入）
 *   unpaid_amount      = 有效發票的未收金額（作廢/整筆折讓 = 0）
 *
 * 設計重點：
 *  - 使用 LEFT JOIN payments（含 deleted_at IS NULL 過濾）做聚合，避免重複計算
 *  - 保留 invoices 的 deleted_at，供上層查詢決定是否排除已刪除發票
 *  - unpaid_amount 對作廢 / 整筆折讓發票固定為 0（不應再追收）
 *  - max(0, ...) 防止已超收時出現負數
 */
const db = require('../src/models/db');

function migrate() {
  console.log('建立 v_invoice_summary 視圖（每筆發票收款摘要）...');

  try {
    db.prepare('DROP VIEW IF EXISTS v_invoice_summary').run();

    db.exec(`
      CREATE VIEW v_invoice_summary AS
      SELECT
        i.id,
        i.project_id,
        i.invoice_date,
        i.invoice_number,
        i.amount_with_tax,
        COALESCE(i.allowance_amount, 0)                                    AS allowance_amount,
        (i.amount_with_tax - COALESCE(i.allowance_amount, 0))             AS recognized_amount,
        i.expected_payment_date,
        i.status,
        i.voided_at,
        i.void_reason,
        i.original_invoice_id,
        i.replacement_invoice_id,
        i.deleted_at,
        i.created_at,
        i.updated_at,
        COALESCE(SUM(
          CASE
            WHEN p.difference_type = '匯費'
              THEN p.bank_deposit_amount + COALESCE(p.payment_difference, 0)
            ELSE p.bank_deposit_amount
          END
        ), 0) AS total_received,
        CASE
          WHEN (i.status IS NULL OR i.status = '有效')
          THEN max(0,
            (i.amount_with_tax - COALESCE(i.allowance_amount, 0))
            - COALESCE(SUM(
                CASE
                  WHEN p.difference_type = '匯費'
                    THEN p.bank_deposit_amount + COALESCE(p.payment_difference, 0)
                  ELSE p.bank_deposit_amount
                END
              ), 0)
          )
          ELSE 0
        END AS unpaid_amount
      FROM invoices i
      LEFT JOIN payments p
        ON p.invoice_id = i.id
        AND p.deleted_at IS NULL
      GROUP BY i.id
    `);

    console.log('✓ v_invoice_summary 視圖建立完成');
    console.log('  欄位：recognized_amount, total_received, unpaid_amount');
  } catch (err) {
    console.error('❌ 建立 v_invoice_summary 失敗:', err.message);
    throw err;
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  migrate();
}

module.exports = migrate;
