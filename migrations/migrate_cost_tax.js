/**
 * 成本含稅／未稅：costs 新增 tax_included（1＝含稅、0＝免稅／未稅不換算）、tax_rate（寫入當時的營業稅率）、
 * estimated_amount_ex_tax / actual_amount_ex_tax（換算後的未稅金額，毛利與成本彙總用這兩欄）。
 * 既有成本全部視為「含稅」（同仁填的都是含稅金額），用目前系統設定的營業稅率補算未稅金額；
 * 原本的 estimated_amount / actual_amount 不改。因此升級後既有專案的毛利會因成本改用未稅而變高。
 * 只補算 *_ex_tax 還是 NULL 的列，可重複執行。
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

const round2 = (n) => Math.round(Number((Number(n) * 100).toPrecision(12))) / 100;

function migrate() {
  if (!fs.existsSync(dbPath)) {
    console.log('資料庫不存在，無需遷移');
    return;
  }
  const db = new Database(dbPath);
  try {
    const cols = db.prepare('PRAGMA table_info(costs)').all().map(c => c.name);
    if (cols.length === 0) {
      console.log('⚠️ 找不到 costs 表，跳過遷移');
      return;
    }
    const add = (name, ddl) => {
      if (!cols.includes(name)) {
        db.prepare(`ALTER TABLE costs ADD COLUMN ${name} ${ddl}`).run();
        console.log(`✓ costs 已新增 ${name}`);
      } else {
        console.log(`  costs.${name} 已存在，略過`);
      }
    };
    add('tax_included', 'INTEGER NOT NULL DEFAULT 1');
    add('tax_rate', 'REAL');
    add('estimated_amount_ex_tax', 'REAL');
    add('actual_amount_ex_tax', 'REAL');

    let rate = 5;
    try {
      const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'tax_rate'").get();
      const v = row ? Number(row.setting_value) : NaN;
      if (Number.isFinite(v) && v >= 0 && v <= 100) rate = v;
    } catch (e) { /* 沒有設定表就用 5 */ }

    const rows = db.prepare('SELECT id, estimated_amount, actual_amount, tax_included FROM costs WHERE estimated_amount_ex_tax IS NULL OR actual_amount_ex_tax IS NULL').all();
    const upd = db.prepare('UPDATE costs SET tax_rate = ?, estimated_amount_ex_tax = ?, actual_amount_ex_tax = ? WHERE id = ?');
    const ex = (amount, included) => round2(included ? (Number(amount) || 0) / (1 + rate / 100) : (Number(amount) || 0));
    db.transaction(() => {
      for (const r of rows) upd.run(rate, ex(r.estimated_amount, r.tax_included !== 0), ex(r.actual_amount, r.tax_included !== 0), r.id);
    })();
    console.log(`✓ 已補算 ${rows.length} 筆成本的未稅金額（營業稅率 ${rate}%，既有成本視為含稅）`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
