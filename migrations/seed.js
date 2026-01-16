const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

function seed() {
  let db;
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始插入種子資料...');

  const bonusTiers = [
    ['食驗室', '食驗室獎金', 100, 0, '食驗室專案獎金，以未稅金額計算，不扣成本'],
    ['純廣', '純廣獎金', 90, 10, '純廣專案獎金，以未稅金額90%計算（扣成本10%）'],
    ['專案', '專案簽約獎金', 20, 40, '專案簽約獎金，以未稅金額60%的20%計算（扣成本40%）'],
    ['專案', '專案結案獎金', 80, 40, '專案結案獎金，以未稅金額60%的80%計算（扣成本40%）'],
    ['食驗室', '開發獎金', 0, 0, '新客戶開發獎金'],
    ['純廣', '開發獎金', 0, 0, '新客戶開發獎金'],
    ['專案', '開發獎金', 0, 0, '新客戶開發獎金']
  ];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO bonus_tiers (project_type, tier_name, percentage, cost_deduction_rate, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const tier of bonusTiers) {
    insertStmt.run(...tier);
  }
  console.log('✓ 插入獎金級距設定');

  // better-sqlite3 會自動儲存到磁碟
  db.close();
  console.log('\n✅ 種子資料插入完成！');
}

seed();
