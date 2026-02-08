/**
 * 專案類型：新增 alert_margin_threshold（毛利警示閾值 %）
 * 毛利率低於此值時，在毛利分析「依類型彙總」顯示警示
 */
const db = require('../src/models/db');

function migrate() {
  console.log('開始專案類型毛利警示閾值遷移...');

  try {
    db.prepare('ALTER TABLE project_types ADD COLUMN alert_margin_threshold REAL').run();
    console.log('✓ project_types 已新增 alert_margin_threshold');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
    console.log('  project_types.alert_margin_threshold 已存在，略過');
  }

  console.log('✓ 專案類型毛利警示閾值遷移完成');
}

migrate();
