const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'invoice_bonus.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function migrate() {
  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error('資料庫連接失敗:', err.message);
    process.exit(1);
  }

  console.log('開始執行公司基本資料設定遷移...');

  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
    if (!table) {
      console.log('⚠️ 找不到 system_settings 表，跳過遷移');
      db.close();
      return;
    }

    // 稅率預設值沿用目前程式碼裡寫死的台灣營業稅 5%，讓既有安裝升級後計算結果不變；
    // 新公司安裝後可到「系統設定」頁面依所在地稅制調整
    const settings = [
      { key: 'company_name', value: '', type: 'string', description: '公司名稱，顯示於報表與通知信件標題' },
      { key: 'company_tax_id', value: '', type: 'string', description: '公司統一編號' },
      { key: 'tax_rate', value: '5', type: 'number', description: '營業稅率（%），用於未稅/含稅金額換算' }
    ];

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO system_settings (setting_key, setting_value, setting_type, description)
      VALUES (?, ?, ?, ?)
    `);

    for (const setting of settings) {
      insertStmt.run(setting.key, setting.value, setting.type, setting.description);
      console.log(`✓ 插入設定：${setting.key}`);
    }

    console.log('✓ 公司基本資料設定遷移完成');
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
