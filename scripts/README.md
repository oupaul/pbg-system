# 工具腳本

## health-check.sh

確認服務是否正常回應：對 `GET /login`（唯一不需要登入即可存取的固定回應頁面）發送請求，預期回傳 HTTP 200。`update.sh` 會在部署完成後自動呼叫，也可以隨時手動執行來驗證服務狀態。

### 使用方法

```bash
scripts/health-check.sh <PORT> [MAX_RETRIES] [RETRY_DELAY_SECONDS]

# 範例
scripts/health-check.sh 3000
scripts/health-check.sh 3000 20 5
```

失敗（逾時仍未回傳 200）時會以非 0 狀態碼結束，不會嘗試修復或重啟服務。

## check_password_hash.js

檢查系統中所有用戶的密碼雜湊格式，確認是否已使用 Argon2id 加密方式。

### 使用方法

```bash
npm run check:password-hash
```

或直接執行：

```bash
node scripts/check_password_hash.js
```

### 功能

1. 列出所有用戶及其密碼雜湊格式
2. 識別密碼格式：
   - SHA256 (舊格式，需要升級)
   - bcrypt (舊格式，需要升級)
   - Argon2 (新格式 ✓)
   - 未知格式
3. 顯示統計摘要
4. 測試密碼雜湊功能

### 輸出說明

- `✓` 表示使用 Argon2id 格式（新格式）
- `⚠️` 表示使用舊格式（SHA256 或 bcrypt），會在下次登入時自動升級
- `❌` 表示未知格式，需要檢查

### 自動升級

當用戶使用舊格式密碼登入時，系統會自動將其升級為 Argon2id 格式。
因此，如果看到舊格式的密碼，可以讓用戶重新登入一次即可完成升級。

## upgrade_passwords.js

協助升級所有用戶密碼為 Argon2id 格式的工具腳本。

### 使用方法

```bash
npm run upgrade:passwords
```

或直接執行：

```bash
node scripts/upgrade_passwords.js
```

### 功能

1. 顯示所有需要升級的用戶
2. 提供三種升級選項：
   - **選項 1（推薦）**：讓用戶重新登入，系統自動升級
   - **選項 2**：在系統中手動重置用戶密碼
   - **選項 3**：批量重置所有用戶為臨時密碼（需謹慎使用）

### 注意事項

⚠️  批量重置密碼會將所有用戶的密碼設置為同一個臨時密碼，使用後請：
1. 通知所有用戶使用臨時密碼登入
2. 要求用戶登入後立即修改密碼

## cleanup-deleted-attachments.js

定期清理「已軟刪除」的專案附件：永久刪除磁碟檔案並移除資料庫記錄。保留天數由系統設定 `attachment_cleanup_retention_days` 控制（預設 30 天，0 = 不自動清理）。

### 使用方法

```bash
npm run cleanup:attachments
```

或直接執行：

```bash
node scripts/cleanup-deleted-attachments.js
```

### 建議排程（cron）

每日凌晨 2 點執行（請將專案目錄改為實際路徑）：

```bash
0 2 * * * cd /opt/invoice-bonus-system && npm run cleanup:attachments
```

### 設定

於「系統設定」→「專案附件清理設定」可調整「軟刪除後保留天數」。若尚未執行遷移 `migrate:attachment-cleanup-setting`，腳本會自動插入預設值 30。


