/**
 * 檢查密碼雜湊格式腳本
 * 用於驗證系統是否已使用 argon2id 加密方式
 */

const db = require('../src/models/db');

console.log('==========================================');
console.log('密碼雜湊格式檢查工具');
console.log('==========================================\n');

// 查詢所有用戶
const users = db.prepare(`
  SELECT id, username, name, role, 
         password_hash,
         LENGTH(password_hash) as hash_length,
         SUBSTR(password_hash, 1, 20) as hash_prefix
  FROM users
  ORDER BY id
`).all();

if (users.length === 0) {
  console.log('⚠️  資料庫中沒有用戶');
  process.exit(0);
}

console.log(`找到 ${users.length} 個用戶\n`);

let sha256Count = 0;
let bcryptCount = 0;
let argon2Count = 0;
let unknownCount = 0;

users.forEach((user, index) => {
  console.log(`[${index + 1}] ${user.username} (${user.name})`);
  console.log(`    角色: ${user.role}`);
  console.log(`    密碼雜湊長度: ${user.hash_length}`);
  console.log(`    密碼雜湊前綴: ${user.hash_prefix}...`);
  
  // 判斷密碼格式
  let format = '';
  let status = '';
  
  // SHA256: 64 個十六進位字元
  if (user.hash_length === 64 && /^[a-f0-9]{64}$/i.test(user.password_hash)) {
    format = 'SHA256 (舊格式，需要升級)';
    status = '⚠️  舊格式';
    sha256Count++;
  }
  // bcrypt: 以 $2a$, $2b$, $2y$ 開頭，長度約 60
  else if (user.password_hash.startsWith('$2a$') || 
           user.password_hash.startsWith('$2b$') || 
           user.password_hash.startsWith('$2y$')) {
    format = 'bcrypt (舊格式，需要升級)';
    status = '⚠️  舊格式';
    bcryptCount++;
  }
  // argon2: 以 $argon2id$ 或 $argon2i$ 開頭
  else if (user.password_hash.startsWith('$argon2id$') || 
           user.password_hash.startsWith('$argon2i$') || 
           user.password_hash.startsWith('$argon2d$')) {
    format = 'Argon2 (新格式 ✓)';
    status = '✓  新格式';
    argon2Count++;
  }
  else {
    format = '未知格式';
    status = '❌ 未知';
    unknownCount++;
  }
  
  console.log(`    格式: ${format}`);
  console.log(`    狀態: ${status}`);
  console.log('');
});

// 統計摘要
console.log('==========================================');
console.log('統計摘要');
console.log('==========================================');
console.log(`總用戶數: ${users.length}`);
console.log(`SHA256 格式: ${sha256Count} 個 ${sha256Count > 0 ? '⚠️  需要升級' : ''}`);
console.log(`bcrypt 格式: ${bcryptCount} 個 ${bcryptCount > 0 ? '⚠️  需要升級' : ''}`);
console.log(`Argon2 格式: ${argon2Count} 個 ✓`);
console.log(`未知格式: ${unknownCount} 個 ${unknownCount > 0 ? '❌ 請檢查' : ''}`);
console.log('');

// 檢查結果
if (sha256Count === 0 && bcryptCount === 0 && unknownCount === 0 && argon2Count > 0) {
  console.log('✅ 所有用戶都已使用 Argon2id 加密方式！');
} else if (argon2Count > 0) {
  console.log('✅ 系統已支援 Argon2id，但仍有舊格式密碼需要升級。');
  console.log('💡 建議：讓這些用戶重新登入，系統會自動升級密碼格式。');
} else {
  console.log('⚠️  系統尚未使用 Argon2id 加密方式。');
  console.log('💡 建議：確認已安裝 argon2 套件，並重新部署系統。');
}

console.log('==========================================\n');

// 測試密碼雜湊功能
console.log('測試密碼雜湊功能...');
const User = require('../src/models/User');

(async () => {
  try {
    const testPassword = 'test_password_123';
    console.log('測試密碼: ' + testPassword);
    
    const hash = await User.hashPassword(testPassword);
    console.log('生成的雜湊: ' + hash.substring(0, 50) + '...');
    
    if (hash.startsWith('$argon2id$')) {
      console.log('✓ 密碼雜湊功能正常，使用 Argon2id');
      
      // 驗證密碼
      const isValid = await User.verifyPassword(testPassword, hash);
      if (isValid) {
        console.log('✓ 密碼驗證功能正常');
      } else {
        console.log('❌ 密碼驗證功能異常');
      }
    } else {
      console.log('❌ 密碼雜湊功能異常，未使用 Argon2id');
    }
  } catch (err) {
    console.error('❌ 測試失敗:', err.message);
    console.error('   請確認已安裝 argon2 套件: npm install argon2');
  }
  
  process.exit(0);
})();


