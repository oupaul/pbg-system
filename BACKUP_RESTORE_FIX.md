# 備份還原問題修復說明

## 📋 問題描述

用戶反映：
1. 備份功能沒有正確備份到資料
2. 還原後「業務預計開立發票年月」欄位的資料沒有還原回來
3. 還原後新增的使用者帳號沒有還原回來

## 🔍 問題分析

### 根本原因

**better-sqlite3 資料庫連接機制：**
- better-sqlite3 在 `src/models/db.js` 模組載入時建立資料庫連接
- 連接建立後，會持續保持與資料庫檔案的連接
- 當資料庫檔案被 `restore.sh` 替換後，Node.js 進程中的 `db` 物件仍然指向**舊的檔案描述符或記憶體映射**
- **必須重啟 Node.js 進程**才能重新連接到新的資料庫檔案

### 原有邏輯的問題

**restore.sh 原有邏輯：**
```bash
# 非交互模式（從網頁執行）
- 不停止服務
- 直接替換資料庫檔案
- 依賴 db.reload() 重新載入 ❌ 這個方法只是打印日誌，沒有真正重新連接

# 交互模式（手動執行）
- 停止服務 ✅
- 替換資料庫檔案 ✅
- 重新啟動服務 ✅ 但可能沒有正確執行
```

## 🔧 修復方案

### 1. 修改 restore.sh - 確保重啟服務

**修改前：**
- 交互模式和非交互模式處理邏輯不一致
- 非交互模式不停止服務（導致資料無法更新）
- 使用 `systemctl is-active` 判斷是否重啟（邏輯錯誤）

**修改後：**
```bash
# 統一處理邏輯：
1. 還原前：無論什麼模式，都停止服務（如果運行中）
2. 替換資料庫檔案
3. 檢查並修復資料庫結構
4. 還原後：如果服務之前在運行，一定重新啟動服務
5. 驗證資料完整性
```

**關鍵代碼：**
```bash
# 還原前停止服務
SERVICE_WAS_RUNNING=0
if systemctl is-active --quiet "${SERVICE_NAME}"; then
    SERVICE_WAS_RUNNING=1
    systemctl stop "${SERVICE_NAME}"
    sleep 3
fi

# ... 替換資料庫檔案 ...

# 還原後重啟服務
if [ "$SERVICE_WAS_RUNNING" -eq 1 ]; then
    systemctl start "${SERVICE_NAME}"
    sleep 3
    # 驗證資料
fi
```

### 2. 增強 backup.sh - 完整驗證

**新增驗證項目：**
```bash
✅ 專案數量
✅ 客戶數量
✅ 發票數量
✅ 收款數量
✅ 使用者數量（包含非管理員）
✅ 獎金數量
✅ 預計開票欄位資料
✅ 資料庫結構（expected_invoice_year_month, salesperson_id）
```

**輸出範例：**
```
📊 備份資料統計：
  - 專案: 50 筆
  - 客戶: 30 筆
  - 發票: 100 筆
  - 收款: 80 筆
  - 使用者: 5 筆
  - 獎金: 120 筆
  - 已設定預計開票: 15 筆
  - 非管理員使用者: 4 筆
✓ 資料庫結構驗證通過（包含 expected_invoice_year_month 欄位）
✓ 使用者表結構驗證通過（包含 salesperson_id 欄位）
```

### 3. 改進 restore.sh - 詳細驗證

**還原後驗證：**
```bash
📊 還原後資料統計：
  - 專案: 50 筆
  - 客戶: 30 筆
  - 發票: 100 筆
  - 使用者: 5 筆
  - 已設定預計開票: 15 筆
  - 非管理員使用者: 4 筆
```

## 📝 修改的檔案

1. **backup.sh**
   - 新增完整的資料驗證
   - 顯示預計開票和使用者資料
   - 驗證資料庫結構完整性

2. **restore.sh**
   - 統一服務處理邏輯（交互和非交互模式）
   - 確保還原後一定重啟服務
   - 新增詳細的資料驗證

3. **README.md**
   - 新增 v1.7.4 更新日誌
   - 說明問題原因和解決方案
   - 提供正確的還原流程和驗證方法

## ✅ 驗證方法

### 測試備份

```bash
cd /opt/invoice-bonus-system
sudo ./backup.sh

# 檢查備份日誌，確認：
# - 所有資料類型都有數量統計
# - 資料庫結構驗證通過
# - 預計開票和使用者資料都有範例
```

### 測試還原

```bash
# 1. 建立測試資料
# - 新增幾個專案並設定預計開票年月
# - 建立幾個非管理員使用者帳號

# 2. 執行備份
sudo ./backup.sh

# 3. 修改一些資料（用於驗證還原）

# 4. 執行還原
sudo ./restore.sh

# 5. 驗證還原結果
# 方法 1：查看還原日誌中的資料統計
# 方法 2：登入系統檢查專案和使用者資料
# 方法 3：直接查詢資料庫
sqlite3 data/invoice_bonus.db "SELECT * FROM users;"
sqlite3 data/invoice_bonus.db "SELECT project_code, expected_invoice_year_month FROM projects WHERE expected_invoice_year_month IS NOT NULL;"
```

### 常見問題排查

**問題 1：還原後資料仍然是舊的**
```bash
# 檢查服務是否重啟成功
sudo systemctl status invoice-bonus-system.service

# 如果服務未重啟，手動重啟
sudo systemctl restart invoice-bonus-system.service

# 等待 5 秒後重新檢查
```

**問題 2：還原後服務無法啟動**
```bash
# 查看服務日誌
sudo journalctl -u invoice-bonus-system.service -n 100 --no-pager

# 常見錯誤：
# - 資料庫檔案權限問題
# - 資料庫檔案損壞
# - 舊備份格式不兼容

# 解決方法：
# 1. 檢查資料庫檔案權限
ls -la /opt/invoice-bonus-system/data/

# 2. 嘗試使用更新的備份
sudo ./restore.sh
# 選擇最近的備份（編號最小的）

# 3. 如果仍然失敗，重新執行資料庫遷移
cd /opt/invoice-bonus-system
npm run migrate
```

**問題 3：預計開票欄位顯示錯誤**
```bash
# 檢查資料庫結構
sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db "PRAGMA table_info(projects);" | grep expected

# 如果欄位存在但資料沒有，檢查視圖
sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db "SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary';" | grep expected

# 手動更新視圖（restore.sh 應該會自動處理）
sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db < /path/to/update_view.sql
```

## 🎯 最佳實踐

### 備份策略

1. **定期自動備份**
   ```bash
   # 使用 systemd timer 或 cron
   sudo ./setup-backup-timer.sh
   # 選擇每日備份
   ```

2. **重要操作前手動備份**
   ```bash
   # 在還原、更新、大量資料修改前
   sudo ./backup.sh
   ```

3. **驗證備份內容**
   ```bash
   # 定期檢查備份日誌
   # 確認資料量符合預期
   ```

### 還原流程

1. **選擇正確的備份**
   - 優先選擇最近的備份
   - 檢查備份時間和資料量
   - 避免使用過舊的備份（可能缺少新欄位）

2. **執行還原**
   ```bash
   sudo ./restore.sh
   # 選擇備份編號
   # 確認還原操作
   # 等待完成（不要中斷）
   ```

3. **驗證結果**
   ```bash
   # 檢查服務狀態
   sudo systemctl status invoice-bonus-system.service
   
   # 登入系統驗證
   # - 使用者管理頁面
   # - 專案管理頁面（預計開票欄位）
   # - 發票和收款記錄
   ```

## 📚 相關文件

- **README.md** - 系統完整文檔
- **backup.sh** - 備份腳本
- **restore.sh** - 還原腳本
- **src/models/db.js** - better-sqlite3 資料庫模組

## 🆘 需要協助？

如果還原後仍然有問題：

1. 保留所有日誌輸出
2. 執行以下診斷命令：
   ```bash
   # 服務狀態
   sudo systemctl status invoice-bonus-system.service
   
   # 服務日誌（最近 100 行）
   sudo journalctl -u invoice-bonus-system.service -n 100 --no-pager
   
   # 資料庫檔案資訊
   ls -lh /opt/invoice-bonus-system/data/invoice_bonus.db
   
   # 資料庫內容檢查
   sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db ".tables"
   sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db "SELECT COUNT(*) FROM users;"
   ```

3. 聯繫技術支援並提供以上資訊

---

## 2026-02-07 - v1.9.4 還原流程增強

### 問題描述

- 備份檔案還原後驗證顯示 0 個資料表（實際有資料）
- 誤判為損壞而執行 migrate 重建空資料庫，導致資料遺失
- uninstall.sh 備份時 WAL checkpoint 在備份**後**執行，備份可能不完整

### 修復內容

**uninstall.sh**
- WAL checkpoint 移至備份**前**執行
- 備份後 sleep 1 確保 checkpoint 完成

**restore.sh**
- 還原前驗證備份檔案中的資料庫有效性
- 複製後執行 `sync` 確保寫入磁碟
- 使用 `sqlite3 -readonly` 驗證，避免建立 WAL/SHM
- 驗證失敗時：二次驗證 → 移出檔案再驗證 → 若有效則還原（避免誤判）
- 關鍵時機清除 WAL/SHM：複製前、誤判還原時、最終驗證前、結構檢查前

### 若登入卡住

還原後若登入卡住轉圈，請重啟服務：
```bash
sudo systemctl restart project-system-dev
```

---

**版本：** v1.9.4  
**日期：** 2026-02-07  
**狀態：** ✅ 已修復並測試

