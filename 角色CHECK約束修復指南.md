# 角色 CHECK 約束修復指南

## 問題描述

在使用角色管理功能時，嘗試為使用者分配自訂角色會遇到以下錯誤：

```
更新使用者失敗：CHECK constraint failed: role IN ('admin', 'user', 'salesperson', 'boss')
```

### 原因

這是因為 `users` 表在早期版本中設置了 `CHECK` 約束，限制 `role` 欄位只能是 4 個預設值之一。當角色管理功能引入自訂角色後，這個約束會阻止使用者使用新角色。

### 影響

- ❌ 無法為使用者分配自訂角色
- ❌ 更新已有自訂角色使用者的資料會失敗
- ✅ 4 個預設角色（admin, user, salesperson, boss）仍可正常使用

## 解決方案

### 方法一：使用自動修復腳本（推薦）

#### 步驟 1：上傳腳本到伺服器

```bash
# 在本地電腦
scp fix-user-role-constraint.sh root@pbg-dev-01:/root/
scp migrations/migrate_remove_user_role_check.js root@pbg-dev-01:/opt/project-system/migrations/
```

#### 步驟 2：執行修復腳本

```bash
# 在伺服器上
ssh root@pbg-dev-01
cd /root

# 設定執行權限
chmod +x fix-user-role-constraint.sh

# 執行修復
sudo ./fix-user-role-constraint.sh
```

#### 腳本會自動：

1. ✅ 尋找專案安裝目錄
2. ✅ 檢查是否有 CHECK 約束
3. ✅ 備份資料庫
4. ✅ 停止服務
5. ✅ 執行遷移（移除 CHECK 約束）
6. ✅ 驗證修復結果
7. ✅ 重啟服務

### 方法二：手動執行遷移

#### 步驟 1：上傳遷移腳本

```bash
# 在本地電腦
scp migrations/migrate_remove_user_role_check.js root@pbg-dev-01:/opt/project-system/migrations/
scp package.json root@pbg-dev-01:/opt/project-system/
```

#### 步驟 2：備份資料庫

```bash
# 在伺服器上
cd /opt/project-system
cp data/invoice_bonus.db data/invoice_bonus.db.backup-$(date +%Y%m%d_%H%M%S)
```

#### 步驟 3：停止服務

```bash
sudo systemctl stop project-system.service
```

#### 步驟 4：執行遷移

```bash
cd /opt/project-system
npm run migrate:remove-user-role-check
```

#### 步驟 5：重啟服務

```bash
sudo systemctl start project-system.service
sudo systemctl status project-system.service
```

### 方法三：使用 SQL 直接修復（高級）

> ⚠️ **警告**: 此方法需要熟悉 SQLite，操作前請務必備份資料庫！

#### 步驟 1：備份資料庫

```bash
cd /opt/project-system
cp data/invoice_bonus.db data/invoice_bonus.db.backup-$(date +%Y%m%d_%H%M%S)
```

#### 步驟 2：停止服務

```bash
sudo systemctl stop project-system.service
```

#### 步驟 3：執行 SQL 修復

```bash
sqlite3 /opt/project-system/data/invoice_bonus.db
```

在 SQLite shell 中執行：

```sql
-- 1. 禁用外鍵
PRAGMA foreign_keys = OFF;

-- 2. 開始事務
BEGIN TRANSACTION;

-- 3. 創建新表（沒有 CHECK 約束）
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  salesperson_id INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  last_login TEXT,
  FOREIGN KEY (salesperson_id) REFERENCES salespeople(id)
);

-- 4. 複製資料
INSERT INTO users_new 
SELECT * FROM users;

-- 5. 刪除舊表
DROP TABLE users;

-- 6. 重新命名
ALTER TABLE users_new RENAME TO users;

-- 7. 重建索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 8. 提交事務
COMMIT;

-- 9. 重新啟用外鍵
PRAGMA foreign_keys = ON;

-- 10. 驗證（檢查 schema，不應該包含 CHECK ... role IN）
SELECT sql FROM sqlite_master WHERE type='table' AND name='users';

-- 11. 退出
.quit
```

#### 步驟 4：重啟服務

```bash
sudo systemctl start project-system.service
```

## 驗證修復

### 1. 檢查資料庫結構

```bash
sqlite3 /opt/project-system/data/invoice_bonus.db "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';"
```

**預期結果**：不應該包含 `CHECK(role IN ('admin', 'user', 'salesperson', 'boss'))`

### 2. 測試新增自訂角色使用者

```bash
# 1. 登入系統
# 2. 進入「角色管理」，新增一個測試角色（例如：專案經理）
# 3. 進入「使用者管理」→「新增使用者」
# 4. 分配剛建立的自訂角色
# 5. 點擊「建立」
```

**預期結果**：✅ 使用者成功建立，沒有錯誤訊息

### 3. 測試更新使用者角色

```bash
# 1. 在使用者列表中，編輯任一使用者
# 2. 更改為自訂角色
# 3. 點擊「更新」
```

**預期結果**：✅ 使用者角色成功更新

## 新檔案說明

### 1. `migrations/migrate_remove_user_role_check.js`

- **作用**：移除 `users` 表的 `role` 欄位 CHECK 約束
- **執行方式**：`npm run migrate:remove-user-role-check`
- **安全性**：
  - 自動檢測是否需要遷移
  - 使用事務保證資料安全
  - 失敗時自動回滾
- **執行時機**：
  - 部署時自動執行（已加入 `deploy.sh`）
  - 可手動執行（當遇到 CHECK 約束錯誤時）

### 2. `fix-user-role-constraint.sh`

- **作用**：一鍵修復 CHECK 約束問題
- **功能**：
  - 自動尋找專案目錄
  - 自動備份資料庫
  - 自動停止/啟動服務
  - 執行遷移並驗證結果
- **使用場景**：快速修復現有環境

### 3. `package.json`

- **新增**：`migrate:remove-user-role-check` 命令
- **位置**：第 15 行

### 4. `deploy.sh`

- **修改**：在兩處遷移流程中加入新遷移
- **執行順序**：
  1. `migrate:user-roles`（創建 4 個預設角色）
  2. `migrate:roles`（創建 roles 表和角色管理功能）
  3. **`migrate:remove-user-role-check`**（移除 CHECK 約束，新增）
  4. `migrate:system-settings`

## 常見問題

### Q1: 執行遷移後，現有使用者會受影響嗎？

**A**: 不會。遷移只是移除約束，不會修改任何使用者資料。所有現有使用者的角色保持不變。

### Q2: 移除 CHECK 約束會有安全問題嗎？

**A**: 不會。角色驗證現在由應用程式層和 `roles` 表控制：
- 角色選單只顯示啟用的角色
- 可以在角色管理中控制哪些角色可用
- 更靈活且易於維護

### Q3: 如果遷移失敗怎麼辦？

**A**: 遷移使用事務，失敗會自動回滾，資料庫不會損壞。可以：
1. 查看錯誤訊息
2. 從備份還原（`data/invoice_bonus.db.backup-*`）
3. 聯繫技術支援

### Q4: 可以回退到舊版本嗎？

**A**: 可以，但不建議：
1. 停止服務
2. 還原舊的資料庫備份
3. 使用舊版本代碼
4. 注意：任何自訂角色的使用者將無法登入

### Q5: 已經部署了最新代碼，但忘記執行遷移怎麼辦？

**A**: 使用快速修復：
```bash
cd /opt/project-system
npm run migrate:remove-user-role-check
sudo systemctl restart project-system.service
```

### Q6: 測試環境和正式環境都需要執行嗎？

**A**: 是的。每個環境都需要執行一次遷移。建議流程：
1. 先在測試環境執行並驗證
2. 確認無誤後再在正式環境執行

### Q7: 執行腳本時提示 "cannot execute: required file not found"

**A**: 這是行尾字元問題（CRLF vs LF），解決方法：

```bash
# 方法 1: 使用 dos2unix
dos2unix fix-user-role-constraint.sh
chmod +x fix-user-role-constraint.sh

# 方法 2: 使用 sed
sed -i 's/\r$//' fix-user-role-constraint.sh
chmod +x fix-user-role-constraint.sh

# 方法 3: 直接在 Linux 上創建（推薦）
cat > fix-user-role-constraint.sh << 'EOF'
#!/bin/bash
# ... (腳本內容) ...
EOF
chmod +x fix-user-role-constraint.sh
```

## 技術細節

### SQLite CHECK 約束限制

在 SQLite 中，CHECK 約束是表結構的一部分，無法單獨移除。必須：
1. 創建新表（沒有約束）
2. 複製資料
3. 刪除舊表
4. 重新命名新表

### 為什麼早期版本有 CHECK 約束

在角色管理功能開發前，系統只有 4 個固定角色，使用 CHECK 約束可以：
- 在資料庫層面確保資料一致性
- 防止輸入錯誤的角色值

但引入動態角色管理後，這個約束變成了限制。

### 遷移的安全性保證

1. **事務**：所有操作在事務中執行，失敗自動回滾
2. **外鍵保護**：臨時禁用外鍵，完成後重新啟用
3. **資料完整性**：複製所有資料，不遺漏任何欄位
4. **索引重建**：確保查詢性能不受影響

## 部署建議

### 對於新部署

使用最新的 `deploy.sh`，會自動執行所有遷移，包括移除 CHECK 約束。

### 對於現有環境

1. **測試環境**：
   ```bash
   # 上傳新代碼
   cd /root/pbg-ins
   sudo ./deploy.sh
   # deploy.sh 會自動執行所有遷移
   ```

2. **正式環境**：
   ```bash
   # 方法一：完整部署（推薦）
   cd /root/pbg-ins
   sudo ./deploy.sh
   
   # 方法二：僅執行遷移（風險較高）
   cd /opt/project-system
   npm run migrate:remove-user-role-check
   sudo systemctl restart project-system.service
   ```

## 相關文件

- [使用者管理角色選單修復說明.md](使用者管理角色選單修復說明.md)
- [角色管理功能部署說明.md](角色管理功能部署說明.md)
- [舊備份還原指南.md](舊備份還原指南.md)

## 更新日誌

- **2026-01-12**: 初始版本
- **適用版本**: v1.8.2 及以後

---

**重要提示**：
- ✅ 執行遷移前務必備份資料庫
- ✅ 建議在非營業時間執行
- ✅ 先在測試環境驗證
- ✅ 保留資料庫備份至少 7 天
