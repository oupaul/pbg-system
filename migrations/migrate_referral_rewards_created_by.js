/**
 * 轉介紹獎勵：新增「建立者」欄位 created_by_user_id
 * 既有資料從修改記錄補：建立當下的 user_info 是使用者姓名，只有在「姓名剛好對應到唯一一位使用者」時才補，
 * 對不上或有同名的一律留空（顯示為「-」），不亂猜。
 */
const db = require('../src/models/db');

function migrate() {
  console.log('開始轉介紹獎勵「建立者」欄位遷移...');

  try {
    db.prepare('ALTER TABLE referral_rewards ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL').run();
    console.log('✓ referral_rewards 已新增 created_by_user_id');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
    console.log('  referral_rewards.created_by_user_id 已存在，略過');
  }

  const rows = db.prepare(`
    SELECT r.id, (
      SELECT l.user_info FROM system_logs l
      WHERE l.table_name = 'referral_rewards' AND l.action = 'create' AND l.record_id = r.id
      ORDER BY l.id ASC LIMIT 1
    ) AS creator_name
    FROM referral_rewards r
    WHERE r.created_by_user_id IS NULL
  `).all();

  const findUsers = db.prepare('SELECT id FROM users WHERE name = ?');
  const setCreator = db.prepare('UPDATE referral_rewards SET created_by_user_id = ? WHERE id = ? AND created_by_user_id IS NULL');
  let filled = 0;
  for (const r of rows) {
    if (!r.creator_name) continue;
    const users = findUsers.all(r.creator_name);
    if (users.length === 1) { setCreator.run(users[0].id, r.id); filled++; }
  }
  console.log(`✓ 既有 ${rows.length} 筆中補上建立者 ${filled} 筆（其餘留空）`);

  console.log('✓ 轉介紹獎勵「建立者」欄位遷移完成');
}

migrate();
