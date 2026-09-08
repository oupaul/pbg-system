/**
 * 推廣獎金（轉介紹獎勵）：建立 referral_rewards 表。
 *
 * 不重用既有的 bonus_calculations——那張表的 project_id/salesperson_id
 * 都是 NOT NULL，bonus_type 有寫死的 CHECK 列舉，且所有讀取路徑都經過
 * v_bonus_summary 視圖（對 projects/salespeople 都是 INNER JOIN），客戶
 * 受益人或還沒轉入專案的紀錄會直接從畫面上消失，結構上無法承載「受益人
 * 可能是客戶本人」這件事。
 *
 * recipient_type='customer' 時，受益人就是 referring_customer_id 本人，
 * 不另外存受益客戶欄位；只有 recipient_type='staff' 才需要 recipient_user_id。
 * referred_customer_id、project_id 都可留空——轉介紹關係可能在新客戶/新
 * 專案都還沒正式成立前就先記錄下來。
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function migrate() {
  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    console.log('開始執行推廣獎金（轉介紹獎勵）遷移...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referring_customer_id INTEGER NOT NULL REFERENCES customers(id),
        referred_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        recipient_type TEXT NOT NULL DEFAULT 'customer' CHECK(recipient_type IN ('customer', 'staff')),
        recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reward_amount REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT '待發放' CHECK(status IN ('待發放', '已發放', '充公')),
        forfeiture_reason TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        CHECK (
          (recipient_type = 'staff' AND recipient_user_id IS NOT NULL) OR
          (recipient_type = 'customer' AND recipient_user_id IS NULL)
        )
      )
    `);
    console.log('✓ 建立 referral_rewards 表');

    db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_referring_customer ON referral_rewards(referring_customer_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_customer ON referral_rewards(referred_customer_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_project ON referral_rewards(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_recipient_user ON referral_rewards(recipient_user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status)`);
    console.log('✓ 建立 referral_rewards 索引');

    console.log('✓ 推廣獎金（轉介紹獎勵）遷移完成');
    db.close();
  } catch (err) {
    console.error('遷移失敗:', err);
    if (db) db.close();
    throw err;
  }
}

if (require.main === module) {
  migrate();
}
module.exports = { migrate };
