/**
 * 升級所有用戶密碼為 Argon2id 格式
 * 
 * 注意：此腳本會嘗試升級所有用戶的密碼格式
 * 但由於無法知道原始密碼，此腳本實際上無法直接升級
 * 
 * 最佳做法：
 * 1. 讓用戶重新登入（系統會自動升級）
 * 2. 或使用此腳本提供的建議，手動重置密碼
 */

const db = require('../src/models/db');
const User = require('../src/models/User');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

console.log('==========================================');
console.log('密碼升級工具');
console.log('==========================================\n');

// 查詢所有用戶
const users = db.prepare(`
  SELECT id, username, name, role, password_hash
  FROM users
  ORDER BY id
`).all();

console.log(`找到 ${users.length} 個用戶\n`);

// 分類用戶
const bcryptUsers = [];
const sha256Users = [];
const argon2Users = [];

users.forEach(user => {
  const hash = user.password_hash;
  
  // SHA256: 64 個十六進位字元
  if (hash.length === 64 && /^[a-f0-9]{64}$/i.test(hash)) {
    sha256Users.push(user);
  }
  // bcrypt: 以 $2a$, $2b$, $2y$ 開頭
  else if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    bcryptUsers.push(user);
  }
  // argon2: 以 $argon2id$ 開頭
  else if (hash.startsWith('$argon2id$') || hash.startsWith('$argon2i$')) {
    argon2Users.push(user);
  }
});

console.log('需要升級的用戶：');
console.log(`  - SHA256 格式: ${sha256Users.length} 個`);
console.log(`  - bcrypt 格式: ${bcryptUsers.length} 個`);
console.log(`已使用 Argon2id: ${argon2Users.length} 個\n`);

if (bcryptUsers.length === 0 && sha256Users.length === 0) {
  console.log('✅ 所有用戶都已使用 Argon2id 格式！');
  rl.close();
  process.exit(0);
}

console.log('==========================================');
console.log('升級選項');
console.log('==========================================');
console.log('由於無法直接獲取用戶原始密碼，有以下選項：\n');
console.log('選項 1：讓用戶重新登入（推薦）');
console.log('  - 當用戶使用舊格式密碼登入時，系統會自動升級為 Argon2id');
console.log('  - 這是最安全且最簡單的方法\n');
console.log('選項 2：手動重置特定用戶密碼');
console.log('  - 管理員可以在使用者管理頁面重置用戶密碼');
console.log('  - 新密碼會自動使用 Argon2id 格式\n');
console.log('選項 3：批量重置為臨時密碼（需要用戶下次登入時修改）');
console.log('  ⚠️  此選項會將用戶密碼重置為臨時密碼\n');

async function main() {
  const answer = await question('請選擇操作 [1: 僅顯示建議 / 2: 批量重置為臨時密碼] (預設: 1): ');
  
  if (answer.trim() === '2') {
    const confirm = await question('\n⚠️  警告：此操作將重置所有舊格式用戶的密碼！\n確認繼續？ (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('操作已取消');
      rl.close();
      process.exit(0);
    }
    
    const tempPassword = await question('請輸入臨時密碼（所有用戶將使用此密碼）: ');
    if (tempPassword.length < 6) {
      console.log('❌ 密碼長度至少需要 6 個字元');
      rl.close();
      process.exit(1);
    }
    
    console.log('\n開始升級密碼...\n');
    
    const allUsersToUpgrade = [...sha256Users, ...bcryptUsers];
    let successCount = 0;
    let failCount = 0;
    
    for (const user of allUsersToUpgrade) {
      try {
        console.log(`正在升級 ${user.username} (${user.name})...`);
        const hash = await User.hashPassword(tempPassword);
        
        db.prepare(`
          UPDATE users 
          SET password_hash = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(hash, user.id);
        
        console.log(`  ✓ ${user.username} 密碼已重置\n`);
        successCount++;
      } catch (err) {
        console.error(`  ❌ ${user.username} 升級失敗: ${err.message}\n`);
        failCount++;
      }
    }
    
    console.log('==========================================');
    console.log('升級完成');
    console.log('==========================================');
    console.log(`成功: ${successCount} 個`);
    console.log(`失敗: ${failCount} 個`);
    console.log(`\n⚠️  所有用戶的密碼已重置為: ${tempPassword}`);
    console.log('請通知所有用戶：');
    console.log('  1. 使用臨時密碼登入');
    console.log('  2. 登入後立即修改密碼（系統設定 > 修改密碼）\n');
  } else {
    console.log('\n==========================================');
    console.log('建議操作步驟');
    console.log('==========================================');
    console.log('\n方法 1：自動升級（推薦）');
    console.log('  1. 通知所有用戶重新登入系統');
    console.log('  2. 系統會自動將他們的密碼升級為 Argon2id 格式');
    console.log('  3. 升級過程對用戶透明，無需任何操作\n');
    
    console.log('方法 2：手動重置密碼');
    if (bcryptUsers.length > 0 || sha256Users.length > 0) {
      console.log('\n需要升級的用戶列表：');
      [...sha256Users, ...bcryptUsers].forEach((user, index) => {
        console.log(`  ${index + 1}. ${user.username} (${user.name}) - ${user.role}`);
      });
      console.log('\n  請在「使用者管理」頁面為這些用戶重置密碼');
      console.log('  新密碼會自動使用 Argon2id 格式\n');
    }
    
    console.log('==========================================');
    console.log('升級驗證');
    console.log('==========================================');
    console.log('升級後，請執行以下命令驗證：');
    console.log('  npm run check:password-hash\n');
  }
  
  rl.close();
}

main().catch(err => {
  console.error('發生錯誤:', err);
  rl.close();
  process.exit(1);
});

