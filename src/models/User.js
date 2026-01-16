const db = require('./db');
const argon2 = require('argon2');

const User = {
  // 依使用者名稱取得
  findByUsername(username) {
    return db.prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`).get(username);
  },

  // 依ID取得（包含 salesperson_id）
  findById(id) {
    try {
      return db.prepare(`
        SELECT u.*, s.name as salesperson_name
        FROM users u
        LEFT JOIN salespeople s ON u.salesperson_id = s.id
        WHERE u.id = ? AND u.is_active = 1
      `).get(id);
    } catch (err) {
      // 向後兼容：如果失敗（舊版資料庫），使用舊版查詢
      console.warn('[User.findById] 使用舊版查詢:', err.message);
      return db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(id);
    }
  },

  // 驗證密碼
  async verifyPassword(password, passwordHash) {
    // 如果密碼雜湊是舊的 SHA256 格式（64 字元），先嘗試用 SHA256 驗證
    if (passwordHash && passwordHash.length === 64 && /^[a-f0-9]{64}$/i.test(passwordHash)) {
      // 舊的 SHA256 格式，使用舊方法驗證
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      return hash === passwordHash;
    }
    
    // 如果是 bcrypt 格式（以 $2a$, $2b$, $2y$ 開頭）
    if (passwordHash && (passwordHash.startsWith('$2a$') || passwordHash.startsWith('$2b$') || passwordHash.startsWith('$2y$'))) {
      try {
        const bcrypt = require('bcrypt');
        return bcrypt.compareSync(password, passwordHash);
      } catch (err) {
        console.error('[User.verifyPassword] bcrypt 驗證錯誤:', err);
        return false;
      }
    }
    
    // 使用 argon2id 驗證
    try {
      return await argon2.verify(passwordHash, password);
    } catch (err) {
      console.error('[User.verifyPassword] argon2 驗證錯誤:', err);
      return false;
    }
  },

  // 雜湊密碼
  async hashPassword(password) {
    // 使用 argon2id 雜湊（推薦的參數設定）
    // type: argon2id（混合模式，提供最好的安全性）
    // memoryCost: 65536 (64 MB) - 記憶體成本
    // timeCost: 3 - 迭代次數
    // parallelism: 4 - 平行度
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4
    });
  },

  // 更新最後登入時間
  updateLastLogin(id) {
    db.prepare(`
      UPDATE users 
      SET last_login = datetime('now', 'localtime')
      WHERE id = ?
    `).run(id);
  },

  // 更新密碼（使用 update 方法，確保一致性）
  async updatePassword(id, newPassword) {
    try {
      const passwordHash = await this.hashPassword(newPassword);
      const result = db.prepare(`
        UPDATE users 
        SET password_hash = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(passwordHash, id);
      
      // 驗證密碼是否正確更新
      const updatedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
      if (!updatedUser) {
        console.error('[User.updatePassword] 更新後用戶不存在');
        return false;
      }
      
      const passwordValid = await this.verifyPassword(newPassword, updatedUser.password_hash);
      if (!passwordValid) {
        console.error('[User.updatePassword] 密碼更新後驗證失敗');
        return false;
      }
      
      console.log(`[User.updatePassword] 密碼更新成功，用戶 ID: ${id}, changes: ${result.changes}`);
      return result.changes > 0;
    } catch (err) {
      console.error('[User.updatePassword] 更新錯誤:', err);
      throw err;
    }
  },

  // 取得所有用戶
  findAll() {
    try {
      // 嘗試使用新版本查詢（包含 salesperson_id）
      return db.prepare(`
        SELECT 
          u.id, u.username, u.name, u.role, u.salesperson_id, u.is_active, 
          u.created_at, u.last_login,
          s.name as salesperson_name
        FROM users u
        LEFT JOIN salespeople s ON u.salesperson_id = s.id
        ORDER BY u.created_at DESC
      `).all();
    } catch (err) {
      // 如果失敗（可能是舊版資料庫），使用舊版查詢
      console.warn('[User.findAll] 使用舊版查詢（可能缺少 salesperson_id 欄位）:', err.message);
      return db.prepare(`
        SELECT id, username, name, role, is_active, created_at, last_login
        FROM users
        ORDER BY created_at DESC
      `).all();
    }
  },

  // 創建用戶
  async create(data) {
    const passwordHash = await this.hashPassword(data.password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, name, role, salesperson_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.username,
      passwordHash,
      data.name,
      data.role || 'user',
      data.salesperson_id || null,
      data.is_active !== undefined ? data.is_active : 1
    );
    return result.lastInsertRowid;
  },

  // 更新用戶
  async update(id, data) {
    try {
      const fields = [];
      const values = [];

      if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
      }
      if (data.role !== undefined) {
        fields.push('role = ?');
        values.push(data.role);
      }
      if (data.salesperson_id !== undefined) {
        fields.push('salesperson_id = ?');
        values.push(data.salesperson_id || null);
      }
      if (data.is_active !== undefined) {
        fields.push('is_active = ?');
        values.push(data.is_active);
      }
      if (data.password !== undefined) {
        fields.push('password_hash = ?');
        // hashPassword 是 async，需要同步調用
        // 注意：這裡需要調用者確保使用 await 或 Promise
        throw new Error('User.update with password requires async/await. Use updatePassword method instead.');
      }

      if (fields.length === 0) {
        console.log('[User.update] 沒有要更新的欄位');
        return false;
      }

      fields.push(`updated_at = datetime('now', 'localtime')`);
      values.push(id);

      const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
      console.log(`[User.update] 執行 SQL: ${sql}, 參數: [${values.map((v, i) => i === values.length - 1 ? 'id=' + v : (i === values.length - 2 && fields[i].includes('password') ? '[密碼雜湊]' : v)).join(', ')}]`);
      
      const result = db.prepare(sql).run(...values);
      
      // 驗證更新是否成功（查詢資料庫確認）
      const updatedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
      if (!updatedUser) {
        console.error('[User.update] 更新後用戶不存在');
        return false;
      }
      
      
      console.log(`[User.update] 更新成功，用戶 ID: ${id}, changes: ${result.changes}`);
      return true; // 總是返回 true，因為我們已經驗證了更新成功
    } catch (err) {
      console.error('[User.update] 更新錯誤:', err);
      throw err;
    }
  },

  // 刪除用戶（軟刪除）
  delete(id) {
    const result = db.prepare(`
      UPDATE users 
      SET is_active = 0, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }
};

module.exports = User;

