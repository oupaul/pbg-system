# 專案開立發票業績認列獎金計算總表系統

[![版本](https://img.shields.io/badge/版本-v1.9.4-blue.svg)](https://github.com/your-repo/invoice-bonus-system)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![資料庫](https://img.shields.io/badge/資料庫-better--sqlite3-orange.svg)](https://github.com/WiseLibs/better-sqlite3)
[![授權](https://img.shields.io/badge/授權-MIT-lightgrey.svg)](LICENSE)

基於 Node.js + SQLite 的專案管理與獎金計算系統，用於管理專案、發票、收款及業務獎金。

## 🚀 最新更新（v1.9.4 - 2026-02-07）

- 🔧 **備份還原修復** - uninstall.sh WAL checkpoint 順序、restore.sh 驗證邏輯與 WAL/SHM 清除、誤判還原處理
- 📋 **部署顯示名稱** - 備份還原頁面瀏覽器分頁與左上角名稱依部署設定顯示
- 🚪 **登入表單** - 排除全域 spinner 避免還原後登入卡住

[查看完整更新日誌](#更新日誌)

## 📚 快速導航

- [系統需求](#系統需求)
- [快速開始](#快速開始) - 一鍵部署
- [版本升級指南](#版本升級指南) - 從舊版本遷移 🆕
- [從 Windows 部署](#從-windows-部署到-ubuntu-伺服器-) - Windows 用戶
- [系統管理腳本](#系統管理腳本)
- [功能特色](#功能特色)
- [更新日誌](#更新日誌)

---

## 系統需求

### 作業系統
- Ubuntu 24.04 LTS（推薦）
- 其他 Linux 發行版（需自行調整安裝腳本）

### 運行環境
- Node.js 20.x（推薦）或 Node.js 18+
- npm（隨 Node.js 安裝）

### 資料庫
- SQLite 3（系統內建，無需額外安裝）

### 密碼加密
- **Argon2**（推薦）- 使用 Argon2id 模式進行密碼雜湊
- **bcrypt**（向後兼容）- 系統同時支援舊的 bcrypt 格式密碼驗證

> **注意**：部署時會自動安裝 `argon2` 套件。如果安裝失敗（需要編譯原生模組），系統會自動回退到 bcrypt。建議確保系統已安裝 `build-essential` 和 `python3` 以支援原生模組編譯。

### 系統資源
- 記憶體：建議至少 512MB
- 硬碟空間：建議至少 1GB（含資料庫與上傳檔案）

### NAS 異地備份（選用）
如需啟用 NAS 異地備份功能，需要安裝以下元件：
- **rsync**（推薦）- 用於高效率的檔案同步
- **openssh-client** - 用於 SSH/SCP 連接
- **SSH Key 認證** - 配置免密碼登入

詳細設定請參閱「NAS 異地備份設定」章節。

## 快速開始

### 一鍵部署（唯一入口）

**deploy.sh 是唯一的部署腳本**，自動偵測首次安裝或更新：

```bash
# 賦予腳本執行權限
chmod +x deploy.sh backup.sh restore.sh uninstall.sh setup-backup-timer.sh

# 執行一鍵部署（首次安裝或更新）
sudo ./deploy.sh
```

**首次安裝時會自動**：
- ✅ **互動式配置部署參數**（瀏覽器分頁名稱、網站名稱、頁尾文字、服務端口、服務名稱、安裝目錄、備份目錄）
- ✅ 檢查並安裝 Node.js 20.x（如未安裝）
- ✅ 複製專案文件到自訂安裝目錄（預設：/opt/invoice-bonus-system）
- ✅ 創建必要目錄（data, uploads, backups）
- ✅ 安裝所有專案依賴
- ✅ 初始化資料庫結構
- ✅ 插入種子資料（獎金級距設定）
- ✅ 創建 systemd 服務（開機自動啟動）
- ✅ **互動式設定自動備份**（可選擇備份頻率）
- ✅ 啟動服務

**更新部署時會自動**：
- ✅ 停止服務並釋放端口
- ✅ 更新依賴套件（如果 package.json 有變更）
- ✅ 自動檢查並更新資料庫結構
- ✅ 執行必要的資料庫遷移
- ✅ 更新 systemd 服務配置
- ✅ 重啟服務
- ✅ 驗證服務狀態
- ✅ **提示設定或修改自動備份**

### 手動安裝步驟

#### 1. 安裝 Node.js（如尚未安裝）

```bash
# 使用 NodeSource 安裝 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. 安裝專案依賴

```bash
cd invoice-bonus-system
npm install
```

#### 3. 初始化資料庫

```bash
# 執行資料庫遷移
npm run migrate

# 如果已有資料庫，需要更新專案編號唯一約束（允許同編號不同類型）
npm run migrate:project-code

# 插入種子資料（獎金級距設定）
npm run seed
```

#### 4. 啟動系統

```bash
# 開發模式（自動重啟）
npm run dev

# 生產模式
npm start
```

系統將運行於 http://localhost:3000

---

## 版本升級指南

### 從 v1.8.5 或更早版本升級到 v1.8.6

v1.8.6 新增了閒置自動登出功能，會自動添加新的系統設定項。以下提供升級方式：

#### 自動升級（推薦）⭐

使用 `deploy.sh` 一鍵升級：

```bash
# 1. 上傳最新代碼到伺服器
scp -r ./* username@your-server:/path/to/project/

# 2. 登入伺服器
ssh username@your-server

# 3. 進入專案目錄
cd /path/to/project

# 4. 執行一鍵部署
sudo ./deploy.sh
```

**deploy.sh 會自動**：
- ✅ 執行系統設定遷移（`migrate:system-settings`）
- ✅ 添加閒置登出的配置項（如果不存在）
- ✅ 設定預設值（閒置時間：30 分鐘，警告時間：2 分鐘）
- ✅ 重啟服務

#### 升級後驗證

1. **檢查系統設定**：
```bash
cd /opt/invoice-bonus-system
sqlite3 data/database.sqlite "SELECT * FROM system_settings WHERE setting_key LIKE 'idle_%';"
```

**預期輸出**：應該看到 2 個設定項（idle_timeout_minutes 和 idle_warning_minutes）

2. **測試閒置登出功能**：
   - 登入系統
   - 打開瀏覽器開發者工具（F12）查看控制台
   - 應該看到：`[閒置檢測] 已啟用`
   - 等待設定的時間後，應該會看到警告對話框

3. **調整設定**（可選）：
   - 使用管理員帳號登入
   - 進入「系統設定」頁面
   - 找到「閒置自動登出設定」區塊
   - 調整參數並儲存

#### 停用閒置登出功能

如果不需要此功能，可以停用：

1. 進入「系統設定」頁面
2. 將「閒置時間」設定為 0
3. 點擊「儲存設定」
4. 通知使用者重新整理頁面

---

### 從 v1.8.4 或更早版本升級到 v1.8.5

v1.8.5 引入了完整的角色管理系統，需要執行資料庫遷移。以下提供三種升級方式：

#### 方式一：自動升級（強烈推薦）⭐

使用 `deploy.sh` 一鍵升級，自動執行所有必要的遷移：

```bash
# 1. 上傳最新代碼到伺服器
scp -r ./* username@your-server:/path/to/project/

# 2. 登入伺服器
ssh username@your-server

# 3. 進入專案目錄
cd /path/to/project

# 4. 執行一鍵部署
sudo ./deploy.sh
```

**deploy.sh 會自動執行**：
- ✅ 停止服務
- ✅ 備份當前資料庫
- ✅ 更新依賴套件
- ✅ 執行角色表遷移（`migrate:roles`）
- ✅ 移除 users.role CHECK 約束（`migrate:remove-user-role-check`）
- ✅ 重啟服務
- ✅ 驗證服務狀態

#### 方式二：手動升級

如果您想要更多控制，可以手動執行升級步驟：

```bash
# 1. 進入安裝目錄（根據您的實際安裝路徑調整）
cd /opt/invoice-bonus-system  # 或 /opt/project-system

# 2. 停止服務
sudo systemctl stop invoice-bonus-system.service

# 3. 備份資料庫（重要！）
cp data/database.sqlite data/database.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 4. 更新代碼（從您的開發環境上傳）
# 使用 scp、rsync 或其他方式

# 5. 更新依賴（如果 package.json 有變更）
npm install

# 6. 執行資料庫遷移
npm run migrate:roles
npm run migrate:remove-user-role-check

# 7. 重啟服務
sudo systemctl start invoice-bonus-system.service

# 8. 檢查服務狀態
sudo systemctl status invoice-bonus-system.service

# 9. 檢查日誌
sudo journalctl -u invoice-bonus-system.service -f
```

#### 方式三：一鍵修復腳本（適用於升級後遇到問題）

如果升級後遇到角色相關錯誤，可使用修復腳本：

```bash
# 修復 users.role CHECK 約束問題
chmod +x fix-user-role-constraint.sh
sudo ./fix-user-role-constraint.sh

# 或修復角色表缺失問題
chmod +x fix-roles-table.sh
sudo ./fix-roles-table.sh
```

### 升級後驗證

升級完成後，請執行以下檢查：

#### 1. 檢查角色表是否建立成功

```bash
# 進入安裝目錄
cd /opt/invoice-bonus-system

# 使用 sqlite3 檢查
sqlite3 data/database.sqlite "SELECT * FROM roles;"
```

**預期輸出**：應該看到 4 個預設角色（admin, user, salesperson, boss）

#### 2. 檢查角色管理功能

1. 登入系統（使用管理員帳號）
2. 點擊左側選單「角色管理」
3. 應該看到 4 個預設角色
4. 嘗試新增一個自訂角色
5. 嘗試編輯和更新角色

#### 3. 檢查使用者管理功能

1. 進入「使用者管理」
2. 新增或編輯使用者
3. 角色下拉選單應該顯示所有啟用的角色（包括自訂角色）

#### 4. 檢查儀表板權限

1. 使用非管理員帳號登入（如 user、boss、salesperson）
2. 儀表板應該**不顯示**以下內容：
   - 通知系統狀態（調試資訊）
   - 總獎金統計
   - 待發放獎金統計
3. 使用管理員帳號登入，應該可以看到所有資訊

### 從舊備份還原後的升級

如果您從 v1.8.4 或更早版本的備份還原，roles 表可能不存在，需要手動執行遷移：

#### 還原後立即執行

```bash
# 1. 進入安裝目錄
cd /opt/invoice-bonus-system

# 2. 執行角色遷移
npm run migrate:roles
npm run migrate:remove-user-role-check

# 3. 重啟服務
sudo systemctl restart invoice-bonus-system.service
```

#### 使用自動修復腳本

```bash
# 一鍵修復角色表和約束問題
chmod +x fix-roles-table.sh
sudo ./fix-roles-table.sh
```

### 常見升級問題與解決方案

#### 問題 1：角色選單顯示空白

**症狀**：使用者管理頁面的角色下拉選單是空的

**原因**：roles 表未建立或資料遷移失敗

**解決方案**：
```bash
npm run migrate:roles
sudo systemctl restart invoice-bonus-system.service
```

#### 問題 2：更新使用者時出現 CHECK constraint failed 錯誤

**症狀**：`CHECK constraint failed: role IN ('admin', 'user', 'salesperson', 'boss')`

**原因**：users.role 欄位仍有舊的 CHECK 約束

**解決方案**：
```bash
# 方法 1：使用遷移腳本
npm run migrate:remove-user-role-check

# 方法 2：使用一鍵修復腳本
sudo ./fix-user-role-constraint.sh
```

詳細修復步驟請參考：`角色CHECK約束修復指南.md`

#### 問題 3：角色編輯無法儲存（一直顯示「處理中...」）

**症狀**：點擊「更新角色」後無法儲存

**原因**：可能是瀏覽器快取或靜態檔案未更新

**解決方案**：
```bash
# 1. 確保 public 目錄已上傳
ls -la public/css/style.css
ls -la public/js/main.js

# 2. 重啟服務
sudo systemctl restart invoice-bonus-system.service

# 3. 清除瀏覽器快取（Ctrl+Shift+R 或 Cmd+Shift+R）
```

#### 問題 4：備份頁面顯示錯誤的備份目錄路徑

**症狀**：備份頁面注意事項顯示 `/opt/invoice-bonus-backups`，但實際備份在其他路徑

**原因**：使用了自訂安裝目錄

**解決方案**：
- v1.8.5 已修復此問題，會自動偵測實際備份目錄
- 執行 `deploy.sh` 更新即可

#### 問題 5：JavaScript 錯誤 "role is not defined"

**症狀**：瀏覽器控制台顯示 `ReferenceError: role is not defined`

**原因**：EJS 模板變數未正確渲染

**解決方案**：
- 確保已更新到最新版本的 `src/views/roles/form.ejs`
- 重新部署並清除瀏覽器快取

### 升級回滾

如果升級後遇到問題，可以快速回滾：

```bash
# 1. 停止服務
sudo systemctl stop invoice-bonus-system.service

# 2. 還原資料庫備份
cd /opt/invoice-bonus-system
cp data/database.sqlite.backup.YYYYMMDD_HHMMSS data/database.sqlite

# 3. 還原舊版本代碼（如果有保留）
# 或從 Git 檢出舊版本

# 4. 重啟服務
sudo systemctl start invoice-bonus-system.service
```

### 相關技術文件

升級過程中如遇問題，請參閱以下詳細文件：

- 📄 **角色管理功能部署說明.md** - 角色管理完整指南
- 📄 **舊備份還原指南.md** - 舊備份還原解決方案  
- 📄 **角色CHECK約束修復指南.md** - CHECK 約束修復詳細指南
- 📄 **使用者管理角色選單修復說明.md** - 角色選單動態化實現
- 📄 **備份目錄動態偵測修復說明.md** - 備份目錄偵測原理
- 📄 **儀表板權限與角色編輯修復說明.md** - 權限控制修復
- 📄 **備份路徑與角色更新修復說明.md** - 最新修復總結
- 📄 **角色功能完整修復總結.md** - 完整開發記錄

### 升級檢查清單

升級完成後，請按以下清單逐項檢查：

- [ ] 服務正常啟動（`sudo systemctl status invoice-bonus-system.service`）
- [ ] 角色表已建立（`sqlite3 data/database.sqlite "SELECT COUNT(*) FROM roles;"`）
- [ ] 角色管理頁面可訪問且顯示 4 個預設角色
- [ ] 可以新增、編輯、刪除自訂角色
- [ ] 使用者管理的角色下拉選單顯示所有角色
- [ ] 可以指派自訂角色給使用者
- [ ] 儀表板權限正確（非管理員看不到敏感資訊）
- [ ] 備份頁面顯示正確的備份目錄路徑
- [ ] 無 JavaScript 錯誤（檢查瀏覽器控制台）
- [ ] 審計日誌正常記錄角色相關操作

---

## 系統管理腳本

### 一鍵部署（deploy.sh）

**deploy.sh 是系統唯一的部署腳本**，智能偵測並處理：
- 🆕 **首次安裝** - 完整安裝流程
- 🔄 **更新部署** - 安全更新現有系統

```bash
sudo ./deploy.sh
```

#### 智能偵測機制
腳本會自動檢查 systemd 服務是否存在：
- **不存在** → 執行首次安裝流程
- **已存在** → 執行更新部署流程

#### 首次安裝流程
1. ✅ **互動式配置部署參數**（瀏覽器分頁名稱、網站名稱、頁尾文字、服務端口、服務名稱、安裝目錄名稱、備份目錄名稱）
2. ✅ 檢查並安裝 Node.js 20.x
3. ✅ 複製專案到自訂安裝目錄（預設：/opt/invoice-bonus-system）
4. ✅ 創建必要目錄和設定權限
5. ✅ 安裝 npm 依賴套件
6. ✅ 初始化資料庫和種子資料
7. ✅ 創建並啟用 systemd 服務
8. ✅ 互動式設定自動備份

#### 更新部署流程
1. ✅ 停止服務並清理端口
2. ✅ 檢查並更新資料庫結構
3. ✅ 更新 npm 依賴套件
4. ✅ 執行資料庫遷移
5. ✅ 更新 systemd 服務配置
6. ✅ 啟動服務並驗證
7. ✅ 提示修改自動備份設定

**重要特性**：
- ⚙️ **支援自訂配置** - 互動式輸入部署參數（服務名稱、安裝目錄、備份目錄等）
- 🔍 自動偵測運行環境
- 🛡️ 安全的資料庫更新（自動備份）
- 📦 智能依賴管理
- 🔄 零停機更新策略
- 💾 整合自動備份設定

#### 自訂部署配置

執行 `deploy.sh` 時，會提示輸入以下配置（可直接按 Enter 使用預設值）：
- **瀏覽器分頁顯示名稱** - 顯示在瀏覽器標籤頁的標題（預設：業績獎金系統）
- **網站名稱** - 顯示在網站導航欄的名稱（預設：業績獎金系統）
- **頁尾顯示文字** - 顯示在網站頁尾的文字（預設：專案開立發票業績認列獎金計算總表系統 ©）
- **服務端口** - 應用程式監聽的端口（預設：3000）
- **服務名稱** - systemd 服務名稱（預設：invoice-bonus-system）
- **安裝目錄名稱** - `/opt` 下的資料夾名稱（預設：invoice-bonus-system）
- **備份目錄名稱** - `/opt` 下的備份資料夾名稱（預設：invoice-bonus-backups）

> **注意**：備份服務名稱會自動根據服務名稱生成，格式為 `{服務名稱}-backup`。例如，如果服務名稱是 `project-system`，備份服務名稱會是 `project-system-backup`。

### 自動備份設定 🆕

系統使用 **Systemd Timer**（現代化方式）進行定期自動備份。

#### 設定自動備份

```bash
sudo ./setup-backup-timer.sh
```

**互動式選項**：
1. **每日備份** - 每天凌晨 2:00
2. **每週備份** - 每週日凌晨 2:00
3. **每日兩次** - 每天 2:00 和 14:00
4. **進階自訂** - 使用 systemd OnCalendar 格式
5. **停用自動備份**
6. **每日自訂時間** - 輸入 時:分（如 `03:30` 表示每天 3:30）

#### 自訂時間格式範例（選項 4 進階）

```bash
# 每天凌晨 3:00
*-*-* 03:00:00

# 每週一、三、五凌晨 2:00
Mon,Wed,Fri 02:00:00

# 每月 1 號凌晨 2:00
*-*-01 02:00:00

# 每 6 小時（0:00, 6:00, 12:00, 18:00）
*-*-* 00/6:00:00
```

#### 管理自動備份

> **注意**：以下命令中的服務名稱 `invoice-bonus-backup` 為預設值。如果您使用自訂服務名稱（例如：`project-system`），備份服務名稱會是 `project-system-backup`，請相應修改命令。

```bash
# 查看備份計畫和下次執行時間（請替換為實際的備份服務名稱）
sudo systemctl list-timers {服務名稱}-backup.timer

# 查看 timer 狀態
sudo systemctl status {服務名稱}-backup.timer

# 立即執行一次備份（測試用）
sudo systemctl start {服務名稱}-backup.service

# 查看備份執行日誌
sudo journalctl -u {服務名稱}-backup.service -n 50

# 停用自動備份
sudo systemctl disable {服務名稱}-backup.timer
sudo systemctl stop {服務名稱}-backup.timer

# 重新啟用自動備份
sudo systemctl enable {服務名稱}-backup.timer
sudo systemctl start {服務名稱}-backup.timer

# 修改備份設定（會自動從 deploy.config.sh 讀取配置）
sudo ./setup-backup-timer.sh
```

**範例**（使用預設服務名稱 `invoice-bonus-system`）：
```bash
sudo systemctl list-timers invoice-bonus-backup.timer
sudo systemctl status invoice-bonus-backup.timer
sudo systemctl start invoice-bonus-backup.service
sudo journalctl -u invoice-bonus-backup.service -n 50
```

**範例**（使用自訂服務名稱 `project-system`）：
```bash
sudo systemctl list-timers project-system-backup.timer
sudo systemctl status project-system-backup.timer
sudo systemctl start project-system-backup.service
sudo journalctl -u project-system-backup.service -n 50
```

> **提示**：`setup-backup-timer.sh` 腳本會自動從安裝目錄下的 `deploy.config.sh` 讀取配置，因此無需手動指定服務名稱。如果配置文件不存在，會使用預設值。

#### 自動備份排程問題排查

若部署完成後自動備份未正確顯示下次執行時間，請參閱 **[自動備份排程檢查與修正指南.md](自動備份排程檢查與修正指南.md)**，內含：
- 檢查方式（timer 狀態、下次執行時間、腳本權限）
- 修正方式（daemon-reload、手動設定、權限修復）
- 常見原因與解決對照表

#### 非互動模式（腳本自動化）

```bash
# 設定每日備份（凌晨 2:00）
sudo ./setup-backup-timer.sh 1

# 設定每週備份
sudo ./setup-backup-timer.sh 2

# 設定每日自訂時間（如每天 3:30）
sudo ./setup-backup-timer.sh 6 03:30

# 設定進階自訂時間
sudo ./setup-backup-timer.sh 4 "*-*-* 03:00:00"

# 停用自動備份
sudo ./setup-backup-timer.sh 5
```

### 手動備份

```bash
sudo ./backup.sh
```

備份腳本會自動：
- 備份資料庫檔案
- 備份上傳檔案
- 備份設定檔
- 壓縮備份檔案
- 自動清理舊備份（保留最近 10 個）
- 如已設定 NAS，自動同步到 NAS

備份檔案會儲存在 `/opt/invoice-bonus-backups/` 目錄，格式為 `backup_YYYYMMDD_HHMMSS.tar.gz`

**建議**：設定自動備份後，手動備份主要用於重要操作前的額外保險。

---

## 從 Windows 部署到 Ubuntu 伺服器 🆕

系統提供 PowerShell 和批次檔腳本，讓您可以從 Windows 開發環境一鍵部署到 Ubuntu 伺服器。

### 前置準備

#### 1. 安裝必要工具

**選項 A：Git for Windows（推薦）**
- 下載並安裝 [Git for Windows](https://git-scm.com/download/win)
- 安裝時選擇「Use Git and optional Unix tools from the Command Prompt」
- 這會自動安裝 `ssh` 和 `rsync`

**選項 B：使用 WSL（Windows Subsystem for Linux）**
```powershell
# 在 PowerShell（管理員模式）執行
wsl --install
```

#### 2. 設定 SSH 連線

**測試 SSH 連線：**
```powershell
ssh root@your-server-ip
```

**（選用）設定 SSH Key 免密碼登入：**
```powershell
# 生成 SSH Key（如果還沒有）
ssh-keygen -t rsa -b 4096

# 複製公鑰到伺服器
type $env:USERPROFILE\.ssh\id_rsa.pub | ssh root@your-server-ip "cat >> ~/.ssh/authorized_keys"
```

#### 3. 修改伺服器資訊

編輯 `快速部署到伺服器.ps1`，修改以下設定：

```powershell
$SERVER_USER = "root"              # 伺服器登入帳號
$SERVER_IP = "your-server-ip"      # 伺服器 IP 或域名（請修改這裡！）
$SERVER_PATH = "/root/pbg-ins"     # 伺服器上的專案目錄
```

### 部署方式

#### 方式一：使用 PowerShell 腳本（推薦）⭐

```powershell
# 1. 開啟 PowerShell（以系統管理員身分執行）

# 2. 允許執行腳本（首次使用時需要）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 3. 執行部署腳本
.\快速部署到伺服器.ps1
```

**腳本會自動：**
- ✅ 測試 SSH 連線
- ✅ 複製檔案到伺服器（排除 node_modules、資料庫等）
- ✅ 在伺服器上執行 `deploy.sh`
- ✅ 驗證服務狀態

#### 方式二：使用批次檔（.bat）

1. 編輯 `快速部署到伺服器.bat`，修改伺服器資訊
2. 雙擊執行 `快速部署到伺服器.bat`

#### 方式三：手動部署

```powershell
# 1. 複製文件到伺服器
rsync -av --exclude="node_modules" --exclude=".git" --exclude="*.log" `
  --exclude="data/*.db" --exclude="uploads/*" `
  . root@your-server-ip:/root/pbg-ins/

# 2. SSH 登入伺服器
ssh root@your-server-ip

# 3. 執行部署腳本
cd /root/pbg-ins
sudo ./deploy.sh
```

### 部署後驗證

**在伺服器上執行：**

```bash
# 檢查服務狀態
sudo systemctl status invoice-bonus-system.service

# 應該看到：Active: active (running)

# 查看日誌（確認使用 better-sqlite3）
sudo journalctl -u invoice-bonus-system.service -n 20 --no-pager | grep better-sqlite3

# 應該看到：✓ 資料庫已連接 (better-sqlite3)
```

**在瀏覽器中測試：**
```
http://your-server-ip:3000
```

使用預設帳號登入：
- 帳號：`admin`
- 密碼：`admin123`

### 常見問題

**Q: `rsync: command not found`**

A: 安裝 Git for Windows 並確保選擇「Use Git and optional Unix tools」，或使用 `scp` 替代：
```powershell
scp -r * root@your-server-ip:/root/pbg-ins/
```

**Q: PowerShell 腳本無法執行**

A: 以管理員模式開啟 PowerShell，執行：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Q: SSH 連線失敗**

A: 
1. 檢查伺服器 IP/域名是否正確
2. 檢查防火牆設定
3. 嘗試手動 SSH 連線：`ssh -v root@your-server-ip`

**Q: 部署後服務無法啟動**

A: SSH 登入伺服器後執行：
```bash
sudo journalctl -u invoice-bonus-system.service -n 100 --no-pager
```

查看錯誤訊息，常見問題：
- 資料庫錯誤：檢查 `/opt/invoice-bonus-system/data/` 權限
- 端口被佔用：檢查是否有其他服務使用 port 3000

### 最佳實踐

1. **定期備份**
   - 部署前先執行備份：`sudo /opt/invoice-bonus-system/backup.sh`
   - 設定自動備份：`sudo /opt/invoice-bonus-system/setup-backup-timer.sh`

2. **版本控制**
   - 使用 Git 管理程式碼
   - 每次部署前建立 Git tag：
     ```powershell
     git tag -a v1.7.2 -m "版本 1.7.2 - 還原流程增強"
     git push origin v1.7.2
     ```

3. **監控**
   - 定期檢查服務狀態
   - 設定異常告警（可使用 systemd 的 OnFailure）

---

### NAS 異地備份設定

系統支援自動將備份檔案同步到 Synology NAS 或其他支援 SSH 的 NAS 設備，實現異地備份功能。

#### 前置需求（Ubuntu 24.04）

**1. 安裝必要套件**

```bash
# 更新套件列表
sudo apt update

# 安裝 rsync（用於 rsync 協定，推薦）
sudo apt install -y rsync

# 安裝 OpenSSH 客戶端（用於 SSH/SCP）
sudo apt install -y openssh-client
```

**2. 驗證安裝**

```bash
# 檢查 rsync 版本
rsync --version

# 檢查 SSH 版本
ssh -V
```

**3. 配置 SSH Key 免密碼登入（重要！）**

```bash
# 生成 SSH 金鑰對（如果還沒有的話）
ssh-keygen -t rsa -b 4096 -C "invoice-backup"

# 按 Enter 使用預設路徑 (~/.ssh/id_rsa)
# 可以設定密碼或直接按 Enter 不設密碼

# 將公鑰複製到您的 NAS
# 請替換 username 和 nas-ip-address 為實際值
ssh-copy-id username@nas-ip-address

# 如果您的 NAS SSH 埠不是 22，使用：
ssh-copy-id -p 埠號 username@nas-ip-address
```

**4. 測試連接**

```bash
# 測試 SSH 連接（應該不需要輸入密碼）
ssh username@nas-ip-address "echo 'SSH 連接成功'"

# 測試 rsync 連接（dry-run 模式，不會實際傳輸）
rsync -avz --dry-run /tmp/ username@nas-ip-address:/path/to/backup/
```

#### Synology NAS 特殊設定

如果您使用的是 Synology NAS，需要在 NAS 上進行以下設定：

1. **啟用 SSH 服務**
   - 控制台 → 終端機和 SNMP → 啟用 SSH 服務
   - 建議修改 SSH 埠為非標準埠（如 2222）以提高安全性

2. **啟用使用者家目錄服務**
   - 控制台 → 使用者 → 進階 → 啟用使用者家目錄服務
   - 這樣才能使用 `ssh-copy-id` 複製公鑰

3. **建立備份目錄**
   ```bash
   # SSH 登入 NAS 後執行
   mkdir -p /volume1/backups/invoice-bonus
   chmod 755 /volume1/backups/invoice-bonus
   ```

4. **配置 SSH 公鑰認證**
   ```bash
   # 在 NAS 上建立 .ssh 目錄（如果不存在）
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   
   # 將公鑰添加到 authorized_keys
   # 公鑰內容來自系統伺服器的 ~/.ssh/id_rsa.pub
   cat >> ~/.ssh/authorized_keys
   # 貼上公鑰內容，然後按 Ctrl+D
   
   chmod 600 ~/.ssh/authorized_keys
   ```

#### 在系統中設定 NAS 備份

完成前置作業後，在系統的「備份與還原」頁面進行設定：

1. 登入系統（需要管理員權限）
2. 前往「備份與還原」頁面
3. 點選「設定 NAS」按鈕
4. 填寫以下資訊：
   - **啟用 NAS 異地備份**：勾選啟用
   - **傳輸協定**：選擇 `rsync`（推薦）或 `SCP/SSH`
   - **NAS 主機地址**：輸入 NAS 的 IP 地址或主機名稱（如：`192.168.1.100`）
   - **連接埠**：輸入 SSH 埠（預設：22）
   - **用戶名稱**：輸入 NAS 的登入帳號（如：`admin`）
   - **備份路徑**：輸入 NAS 上的備份目錄（如：`/volume1/backups/invoice-bonus`）
5. 點選「測試連接」確認設定正確
6. 點選「儲存設定」完成設定

#### 權限設定注意事項

```bash
# 如果您是以 root 執行 Node.js 應用
# 確保 root 使用者的 SSH key 已配置
ls -la /root/.ssh/

# 如果是以一般使用者執行
# 確保該使用者的 SSH key 已配置
ls -la ~/.ssh/

# 測試該使用者能否連接 NAS
sudo -u username ssh nas-username@nas-ip "echo 'Success'"
```

#### NAS 備份工作流程

啟用 NAS 異地備份後，系統會在每次備份完成時自動：

1. 建立本地備份檔案
2. 使用 rsync 或 SCP 將備份檔案同步到 NAS
3. 在 NAS 上保留完整的備份歷史
4. 本地仍會保留最近 10 個備份檔案

#### 安裝檢查清單

完成設定後，請確認以下項目：

- ✅ **rsync** - 已安裝
- ✅ **openssh-client** - 已安裝
- ✅ **SSH Key** - 已生成並複製到 NAS
- ✅ **SSH 免密登入** - 已測試成功
- ✅ **NAS 目錄** - 已建立並設定權限
- ✅ **系統設定** - 已在網頁介面完成設定
- ✅ **連接測試** - 已通過測試

#### 故障排除

**Q: 測試連接失敗**
```bash
# 檢查 SSH 連接
ssh -v username@nas-ip-address

# 檢查防火牆設定
sudo ufw status

# 檢查 NAS SSH 服務是否啟用
```

**Q: rsync 同步失敗**
```bash
# 手動測試 rsync
rsync -avz --progress /path/to/backup/ username@nas-ip:/path/to/nas/backup/

# 檢查 rsync 是否已安裝
which rsync
```

**Q: 權限被拒絕**
```bash
# 確認 SSH key 權限
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub

# 確認 NAS 上的 authorized_keys 權限
ssh username@nas-ip "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### 還原備份

```bash
# 列出所有備份
sudo ./restore.sh

# 還原指定備份
sudo ./restore.sh backup_20241205_143022.tar.gz
```

#### 智能還原機制 🆕

還原腳本會：
- ✅ 在還原前自動備份現有資料
- ✅ 停止服務
- ✅ 還原資料庫
- ✅ **自動偵測並修復舊備份** 🌟
  - 自動添加缺少的資料庫欄位
  - 自動更新所有視圖定義
  - 自動處理 sql.js 舊備份
  - 完整的驗證和錯誤處理
- ✅ 還原上傳檔案
- ✅ 還原設定檔
- ✅ 執行資料庫遷移（確保結構最新）
- ✅ 重啟服務
- ✅ 顯示備份資訊和驗證結果

#### 支援的備份類型

- ✅ **最新備份** - 直接還原
- ✅ **缺少欄位的備份** - 自動添加並更新視圖
- ✅ **sql.js 舊備份** - 自動重建資料庫結構
- ✅ **任何版本的備份** - 智能升級到最新結構

#### 自動修復示例

**還原缺少欄位的備份：**
```
[檢查資料庫結構是否需要更新...]
偵測到舊備份：缺少 expected_invoice_year_month 欄位，正在添加...
✓ expected_invoice_year_month 欄位添加成功
✓ 視圖更新成功
✓ 欄位驗證成功
```

**還原 sql.js 舊備份：**
```
⚠️  資料庫檔案存在但沒有資料表（舊版 sql.js）
⚠️  嘗試自動修復資料庫結構...
✓ 資料庫結構已重建（11 個資料表）
⚠️  注意：原備份資料不兼容，資料庫已重建為全新結構
```

### 移除系統（含備份）

```bash
sudo ./uninstall.sh
```

移除腳本會：
- **自動建立完整備份**（移除前）
- 停止並移除 systemd 服務
- 停用並移除自動備份 timer
- 移除 node_modules
- 移除資料庫
- 移除上傳檔案
- 清理日誌和臨時檔案
- 保留原始碼和備份檔案

⚠️ **警告**：移除操作不可逆，請確認已備份重要資料！

## 功能特色

### 儀表板 🆕
- 🔔 **智能開票提醒**：當月倒數第3天自動顯示提醒通知
- 📊 **關鍵指標統計**：
  - 專案數量（總數、未結案、已結案）
  - 專案總金額（含稅）
  - 總獎金、已發放獎金、待發放獎金
  - 已開立發票總額、未開立發票金額
- 📈 **專案類型分布**：視覺化顯示所有專案類型的金額占比，支援點擊類型直接導向專案管理頁面並自動篩選
- 📋 **最近專案列表**：快速查看最近更新的 10 個專案
- ⚡ **快速操作**：新增專案、匯入/匯出 Excel
- 🎯 **年度篩選**：可切換查看特定年度或全部年度的統計資料

### 專案管理
- 專案新增、編輯、刪除
- **快速新增客戶** 🆕：
  - 專案表單中直接新增客戶
  - Modal 彈出視窗，無需跳轉頁面
  - 新增成功後自動選擇
  - 保持當前表單填寫狀態
- **Select2 智能下拉選單** 🆕：
  - 業務人員和客戶選擇支援輸入即時篩選
  - 美觀的 Bootstrap 5 整合介面
  - 清除按鈕、鍵盤導航、中文友善
- **專案類型動態管理**：管理員可新增、編輯、刪除專案類型，支援自訂顏色
- **銷貨折讓功能**：專案價格新增銷貨折讓欄位，應收帳款自動扣除折讓金額
- 專案狀態追蹤（未結案/已結案/取消）
- 新/舊客戶標記
- 業務預計開立發票年月記錄與編輯
- **多維度篩選功能**：
  - 年度篩選
  - 狀態篩選（未結案/已結案）
  - 類型篩選（食驗室/純廣/專案）
  - 業務篩選
  - **預計開票年月篩選**
  - 客戶名稱搜尋
  - 關鍵字搜尋（專案編號/專案名稱/公司名稱）
- **快速篩選按鈕**：
  - 未開立發票專案
  - 未收款專案
  - 逾期未收款專案（預計收款日已過期）
- **靈活排序**：支援所有欄位正序/逆序排序
  - 新增：未開發票、未收款、預計開票欄位支援排序功能

### 發票管理
- 發票開立記錄
- 發票金額追蹤
- 未開發票金額自動計算
- **預計收款日**：每筆發票可記錄預計收款日期，便於應收帳款追蹤

### 收款管理
- 收款記錄登錄
- 匯費/違約金記錄
- **應收帳款追蹤**：自動扣除銷貨折讓金額，顯示實際應收帳款

### 獎金計算
- 依專案類型自動計算獎金基礎
  - 食驗室：未稅金額 100%（不扣成本）
  - 純廣：未稅金額 90%（扣成本 10%）
  - 專案：未稅金額 60%（扣成本 40%）
    - 簽約獎金 20%
    - 結案獎金 80%
- 獎金發放狀態追蹤
- 離職充公處理
- **批次刪除功能**：支援勾選多筆獎金記錄進行批次刪除（僅限管理員及一般使用者）

### 業務管理
- 業務人員資料維護
- 業績統計
- 獎金彙總

### 客戶管理
- 客戶資料維護
- 統一編號記錄
- 專案歷史查詢

### 備份與還原
- **Systemd Timer 自動備份**（現代化方式）
- 互動式備份頻率設定
- 支援每日、每週、自訂時間備份
- **下載備份檔案**：支援直接下載備份檔到本地
- **批次刪除功能**：支援勾選多個備份檔進行批次刪除
- 本地備份自動清理（保留最近 10 個）
- NAS 異地備份支援（rsync/SSH）
- 完整的還原機制
- 備份前自動快照保護

### Excel 匯入/匯出
- 支援匯入現有 Excel 總表
- 匯出專案總表
- 匯出獎金報表
- 支援合併儲存格處理
- 自動資料驗證與錯誤提示

### 使用者管理
- 使用者帳號建立、編輯、刪除
- **動態角色管理**：支援自訂角色和權限配置
- 帳號啟用/停用功能
- 密碼變更功能
- 最後登入時間追蹤
- 業務員綁定功能

### 角色管理系統 🆕
- **自訂角色**：支援建立無限數量的自訂角色
- **細粒度權限控制**：
  - 資料操作權限（編輯資料、刪除資料）
  - 管理權限（使用者管理、角色管理、系統設定管理）
  - 備份還原權限
  - 資料檢視權限（檢視所有專案、檢視自己的專案）
- **系統預設角色**：
  - 管理員（admin）：完整系統權限
  - 一般使用者（user）：完整編輯權限
  - 業務員（salesperson）：只能查看自己負責的專案（唯讀）
  - 老闆（boss）：可查看所有專案（唯讀）
- **角色特性**：
  - 系統角色保護機制（防止誤刪或誤改關鍵角色）
  - 角色啟用/停用功能
  - 顯示順序自訂
  - 角色使用者統計
  - 刪除前檢查（確保沒有使用者使用該角色）
- **動態選單整合**：使用者管理中的角色選單自動顯示所有啟用的角色

### 閒置自動登出 🆕
- **智能閒置檢測**：自動偵測使用者活動（滑鼠、鍵盤、觸控等）
- **彈性配置**：
  - 閒置時間：0-480 分鐘（0 表示停用）
  - 警告時間：1-10 分鐘（在自動登出前提醒）
- **友善提醒**：
  - 倒數計時顯示剩餘時間
  - 可選擇「繼續使用」延長會話
  - 可選擇「立即登出」主動登出
- **安全保障**：
  - 自動登出後清除會話
  - 防止未經授權存取
  - 適合共用電腦環境
- **管理員設定**：透過「系統設定」頁面調整參數

### 修改記錄（Audit Logs）
- 完整記錄所有資料異動
- 支援建立、更新、刪除操作記錄
- 記錄變更前後資料對比
- **中文易讀**：欄位名稱與資料表改為中文顯示，ID/專案顯示可識別資訊
- 支援依資料表、操作類型、時間範圍篩選
- 顯示操作人員與操作時間

### 系統健康監控 🆕（僅管理員）
- **資料庫狀態**：顯示資料庫檔案大小、修改時間、資料表數量及各資料表記錄數
- **系統資訊**：Node.js 版本、作業系統、運行時間、記憶體使用情況
- **資料統計**：各類資料數量統計及金額統計
- **備份狀態**：備份檔案數量、排程下次執行時間、最近備份資訊
- **最近活動**：顯示最近 10 筆審計日誌記錄

## 目錄結構

```
invoice-bonus-system/
├── data/                   # SQLite 資料庫
│   └── invoice_bonus.db   # 主資料庫檔案
├── backups/                # 本地備份檔案目錄
├── uploads/                # 上傳檔案暫存目錄
├── /opt/invoice-bonus-backups/  # 系統備份目錄（透過網頁備份功能）
├── migrations/             # 資料庫遷移腳本
├── public/                 # 靜態資源
│   ├── css/
│   └── js/
├── src/                    # 原始碼
│   ├── app.js              # 應用程式入口
│   ├── middleware/         # 中間件
│   │   └── auth.js         # 認證中間件
│   ├── models/             # 資料模型
│   │   ├── db.js           # 資料庫連線
│   │   ├── Project.js      # 專案模型
│   │   ├── Invoice.js      # 發票模型
│   │   ├── Payment.js      # 收款模型
│   │   ├── Bonus.js        # 獎金模型
│   │   ├── Salesperson.js  # 業務模型
│   │   ├── Customer.js     # 客戶模型
│   │   └── User.js         # 使用者模型
│   ├── routes/             # 路由
│   │   ├── index.js        # 首頁路由
│   │   ├── auth.js         # 認證路由
│   │   ├── projects.js     # 專案路由
│   │   ├── invoices.js     # 發票路由
│   │   ├── payments.js     # 收款路由
│   │   ├── bonuses.js      # 獎金路由
│   │   ├── salespeople.js  # 業務路由
│   │   ├── customers.js    # 客戶路由
│   │   ├── users.js        # 使用者路由
│   │   ├── importExport.js # 匯入匯出路由
│   │   ├── auditLogs.js    # 修改記錄路由
│   │   └── api.js          # API 路由
│   ├── services/           # 服務層
│   │   ├── ExcelImportService.js  # Excel 匯入服務
│   │   ├── ExcelExportService.js  # Excel 匯出服務
│   │   └── AuditLogService.js     # 修改記錄服務
│   ├── utils/              # 工具函數
│   │   └── authHelper.js   # 認證輔助函數
│   └── views/              # EJS 模板
│       ├── layout.ejs      # 主模板
│       ├── index.ejs       # 首頁
│       ├── projects/       # 專案相關頁面
│       ├── bonuses/        # 獎金相關頁面
│       ├── salespeople/    # 業務相關頁面
│       ├── customers/      # 客戶相關頁面
│       ├── users/          # 使用者相關頁面
│       ├── import-export/ # 匯入匯出頁面
│       ├── audit-logs/     # 修改記錄頁面
│       └── auth/           # 認證相關頁面
├── deploy.sh               # 一鍵部署腳本（安裝/更新）
├── backup.sh               # 手動備份腳本
├── restore.sh              # 還原腳本
├── uninstall.sh            # 移除腳本（含備份）
├── setup-backup-timer.sh   # 自動備份設定腳本（Systemd Timer）
└── package.json
```

## 使用說明

### 業務預計開立發票年月功能快速指南 🆕

#### 設定預計開票年月
1. 進入「專案管理」頁面
2. 點擊任一專案進入詳情頁
3. 在「業務預計開立發票年月」區塊（位於發票明細上方）
4. 選擇年份和月份（下拉選單）
5. 點擊「儲存」按鈕

#### 篩選預計開票專案
1. 在「專案管理」頁面的篩選表單中
2. 找到「預計開票」下拉選單
3. 選擇想要查詢的年月（例如：2025-01）
4. 點擊「搜尋」按鈕
5. 系統顯示該月份預計開票的所有專案

#### 查看預計開票資訊
- 專案列表的「預計開票」欄位會顯示設定值
- 可與其他篩選條件（年度、狀態、類型、業務等）組合使用
- 支援所有欄位的排序功能，不會影響篩選條件
- 篩選結果可匯出為 Excel

#### 智能提醒通知 🆕
- 🔔 **自動開票提醒**：當月倒數第3天開始，儀表板自動顯示提醒通知
- 📊 **即時統計**：顯示本月預計開票專案數量和金額
- 🎯 **快速操作**：直接跳轉到專案詳情或篩選結果頁面
- ⏰ **倒數計時**：顯示本月剩餘天數，提醒儘速處理

#### 應用場景
- 📅 **月度開票規劃**：查看本月預計開票的所有專案
- 💰 **業績預估**：統計特定月份的預計開票金額
- 📊 **工作排程**：提前準備開票所需文件
- 🔔 **到期提醒**：倒數第3天自動顯示提醒通知

## API 端點

### 專案相關
| 方法 | 端點 | 說明 |
|------|------|------|
| GET | /api/projects | 取得專案列表 |
| GET | /api/projects/:id | 取得專案詳情（含發票、收款、獎金） |
| GET | /api/projects/:id/invoices | 取得專案發票列表 |
| GET | /api/projects/:id/payments | 取得專案收款列表 |
| POST | /api/projects/:id/update-expected-invoice | 🆕 更新預計開票年月 |

### 發票相關
| 方法 | 端點 | 說明 |
|------|------|------|
| POST | /api/invoices | 建立發票 |
| PUT | /api/invoices/:id | 更新發票 |
| DELETE | /api/invoices/:id | 刪除發票 |

### 收款相關
| 方法 | 端點 | 說明 |
|------|------|------|
| POST | /api/payments | 建立收款記錄 |
| PUT | /api/payments/:id | 更新收款記錄 |
| DELETE | /api/payments/:id | 刪除收款記錄 |

### 獎金相關
| 方法 | 端點 | 說明 |
|------|------|------|
| GET | /api/bonuses | 取得獎金列表（可依年度篩選） |
| GET | /api/bonuses/stats/:year | 取得獎金統計 |
| PUT | /api/bonuses/:id | 更新獎金狀態 |

### 業務相關
| 方法 | 端點 | 說明 |
|------|------|------|
| GET | /api/salespeople | 取得業務列表 |
| GET | /api/salespeople/:id/performance/:year | 取得業務年度績效 |

### 客戶相關
| 方法 | 端點 | 說明 |
|------|------|------|
| GET | /api/customers | 取得客戶列表 |
| GET | /api/customers/search | 搜尋客戶（依公司名稱、編號、統編） |

### 統計相關
| 方法 | 端點 | 說明 |
|------|------|------|
| GET | /api/stats/dashboard/:year | 取得儀表板統計（專案、獎金、月度發票、月度收款） |

## 獎金計算規則

### 食驗室專案
- 計算基礎：未稅金額
- 不扣成本
- 依獎金級距計算

### 純廣專案
- 計算基礎：未稅金額 × 90%（扣成本 10%）
- 依獎金級距計算

### 專案類型
- 計算基礎：未稅金額 × 60%（扣成本 40%）
- 簽約獎金：計算基礎 × 20%
- 結案獎金：計算基礎 × 80%

### 開發獎金
- 新客戶專案另計開發獎金

### 離職處理
- 業務離職時，未發放獎金標記為「充公」

## 技術架構

### 後端技術
- **運行環境**：Node.js 20.x
- **框架**：Express 4.21.0
- **資料庫**：SQLite 3 (使用 sql.js 1.11.0)
- **Session 管理**：express-session
- **檔案上傳**：multer
- **日期處理**：dayjs

### 前端技術
- **模板引擎**：EJS 3.1.10
- **CSS 框架**：Bootstrap 5
- **圖示庫**：Bootstrap Icons
- **JavaScript**：原生 ES6+

### 資料處理
- **Excel 處理**：exceljs 4.4.0
  - 支援讀寫 Excel 檔案
  - 支援合併儲存格處理
  - 支援樣式設定

### 資料庫結構
系統使用 SQLite 資料庫，主要資料表包括：

#### 核心資料表
- **`projects`** - 專案資料
  - 包含專案基本資訊、合約金額、狀態等
  - 🆕 **`expected_invoice_year_month`** - 業務預計開立發票年月（格式：YYYY-MM）
- **`invoices`** - 發票記錄
  - 記錄發票號碼、開立日期、金額等
- **`payments`** - 收款記錄
  - 記錄收款日期、金額、匯費、違約金等
- **`bonus_calculations`** - 獎金計算記錄
  - 自動計算簽約獎金和結案獎金

#### 主檔資料表
- **`salespeople`** - 業務人員資料
- **`customers`** - 客戶資料
- **`bonus_tiers`** - 獎金級距設定

#### 系統資料表
- **`users`** - 使用者帳號與權限
- **`audit_logs`** - 完整修改記錄（稽核日誌）

#### 視圖（Views）
- **`v_project_summary`** - 專案彙總視圖
  - 整合專案、業務、客戶資訊
  - 包含已開立發票總額、未開立發票金額、已收款總額
  - 🆕 包含預計開票年月資訊

### 安全性
- Session-based 認證機制
- 密碼雜湊儲存（bcrypt）
- 路由保護（需登入才能訪問）
- 角色權限控制（管理員/一般使用者）
- SQL 注入防護（使用參數化查詢）

## 更新日誌

### 2026-01-12 - v1.8.8 快速新增客戶功能 ⚡

#### 新增功能

**快速新增客戶** ✨
- ✅ 專案表單中添加「快速新增」連結
- ✅ Bootstrap Modal 彈出視窗設計
- ✅ API 端點：`POST /customers/quick-add`
- ✅ 客戶新增表單：
  - 客戶編號（必填）
  - 公司名稱（必填）
  - 統一編號（選填，8 位數字驗證）
  - 是否新客戶（勾選框）
- ✅ 自動選擇新客戶：
  - 新增成功後自動添加到 Select2
  - 自動選擇該客戶
  - 無需離開當前頁面
- ✅ 完整的錯誤處理
- ✅ 成功提示訊息（Toast）
- ✅ 相關檔案：
  - `src/routes/customers.js` - 新增快速新增 API
  - `src/views/projects/form.ejs` - Modal 視窗和處理邏輯
  - `快速新增客戶功能說明.md` - 完整功能文件

#### 使用者體驗改進

- 🚀 **提升效率**：無需跳轉到客戶管理頁面
- 💾 **保持狀態**：保留當前專案表單的填寫內容
- 🎯 **一鍵完成**：新增和選擇一次搞定
- 📱 **響應式設計**：適配各種螢幕尺寸

#### 技術實現

- 🎨 **Bootstrap Modal**：美觀的對話框
- 📡 **Fetch API**：非同步請求
- 🔗 **Select2 整合**：自動添加選項並選擇
- ✅ **表單驗證**：必填欄位和格式檢查
- 🐛 **錯誤處理**：清晰的錯誤訊息

#### 向後兼容

- ✅ 完全向後兼容
- ✅ 不影響現有客戶管理功能
- ✅ 原有新增客戶方式仍可使用

---

### 2026-01-12 - v1.8.7 Select2 下拉選單改進 🎨

#### 新增功能

**Select2 智能下拉選單** ✨
- ✅ 引入 Select2 組件（v4.1.0-rc.0）
- ✅ 業務人員選擇升級：
  - 輸入文字即時篩選選項
  - 美觀的 Bootstrap 5 整合介面
  - 內建清除按鈕
  - 完整的鍵盤導航支援
  - 中文友善搜尋
- ✅ 客戶選擇升級：
  - 支援搜尋客戶名稱和編號
  - 即時篩選和高亮顯示
  - 統一的使用者體驗
- ✅ 視覺優化：
  - 焦點狀態陰影效果
  - Hover 高亮顯示
  - 無結果和搜尋中提示訊息
  - 響應式設計（桌面、平板、手機）
- ✅ 程式碼簡化：
  - 從 150+ 行 JavaScript 減少到 30 行
  - 移除複雜的 datalist 邏輯
  - 使用成熟的 Select2 API
- ✅ 相關檔案：
  - `src/views/layout.ejs` - 引入 Select2 和 jQuery
  - `src/views/projects/form.ejs` - 使用 Select2
  - `public/css/style.css` - Select2 自訂樣式
  - `Select2下拉選單改進說明.md` - 完整功能文件

#### 使用者體驗改進

- 🎯 **更快的選擇速度**：輸入文字立即篩選，無需滾動查找
- 🖱️ **更直觀的操作**：點擊、輸入、鍵盤導航都很流暢
- 👁️ **更清晰的視覺回饋**：焦點、hover、選中狀態明確
- ❌ **更方便的清除**：內建清除按鈕，一鍵清除選擇

#### 技術改進

- 📦 **引入成熟組件**：使用 Select2 而非自製邏輯
- 🎨 **樣式系統化**：統一的 Bootstrap 5 主題
- ⚡ **效能優化**：虛擬化渲染，支援大量選項
- 🌐 **跨瀏覽器兼容**：支援所有現代瀏覽器

#### CDN 資源

- **Select2**：v4.1.0-rc.0
- **Select2 Bootstrap 5 主題**：v1.3.0
- **jQuery**：v3.7.1

#### 向後兼容

- ✅ 完全向後兼容，不影響現有資料
- ✅ 表單提交邏輯不變
- ✅ 資料庫結構不變

---

### 2026-01-12 - v1.8.6 閒置自動登出功能 🔒

#### 新增功能

**閒置自動登出系統** ✨
- ✅ 智能閒置檢測：監聽使用者活動（滑鼠、鍵盤、觸控等）
- ✅ 自動重置計時器：任何使用者活動都會重置閒置計時
- ✅ 警告對話框：
  - 倒數計時顯示剩餘秒數
  - 「繼續使用」按鈕延長會話
  - 「立即登出」按鈕主動登出
- ✅ 系統設定介面：
  - 閒置時間配置（0-480 分鐘，0 表示停用）
  - 警告時間配置（1-10 分鐘）
  - 建議值和使用說明
- ✅ 安全機制：
  - 自動登出後清除會話
  - 強制重定向到登入頁面
  - 防止未經授權存取
- ✅ 效能優化：
  - 使用節流機制避免過度計算
  - 智能事件監聽管理
- ✅ 相關檔案：
  - `migrations/migrate_system_settings.js` - 新增閒置設定項
  - `public/js/main.js` - 前端閒置檢測邏輯
  - `src/app.js` - 全域配置傳遞
  - `src/views/layout.ejs` - 配置嵌入
  - `src/views/settings/index.ejs` - 設定介面
  - `src/routes/settings.js` - 設定驗證
  - `閒置自動登出功能說明.md` - 完整功能文件

#### 技術改進

- 🎯 **彈性配置系統**：管理員可根據需求調整閒置時間
- 🔒 **安全性增強**：防止他人在使用者離開時未經授權存取
- 📝 **使用者體驗**：友善的警告機制給予充分的延長機會
- 🛠️ **即時生效**：設定變更後重新整理頁面即可生效
- 🔍 **開發者模式**：控制台輸出詳細的檢測資訊

#### 資料庫變更

**system_settings 表新增欄位**：
- `idle_timeout_minutes` - 閒置時間（分鐘），預設 30
- `idle_warning_minutes` - 警告時間（分鐘），預設 2

#### 使用說明

**管理員**：
1. 進入「系統設定」頁面
2. 找到「閒置自動登出設定」區塊
3. 調整「閒置時間」和「警告提前時間」
4. 點擊「儲存設定」
5. 通知使用者重新整理頁面

**停用功能**：
- 將「閒置時間」設定為 0 即可停用

**一般使用者**：
- 正常操作時計時器會自動重置
- 看到警告時可選擇「繼續使用」或「立即登出」
- 無操作時會自動登出並返回登入頁面

#### 升級注意事項

**從舊版本升級**：
1. 執行 `deploy.sh` 會自動執行必要的遷移
2. 系統會自動添加預設的閒置設定（30 分鐘閒置，2 分鐘警告）
3. 管理員可在系統設定中調整參數

**向後兼容**：
- ✅ 完全向後兼容，不影響現有功能
- ✅ 預設啟用（30 分鐘），可隨時調整或停用
- ✅ 不需要修改任何現有資料

---

### 2026-01-12 - v1.8.5 角色管理與權限控制 🔐

#### 新增功能

**1. 完整的角色管理系統** ✨
- ✅ 新增角色管理介面（/roles）
- ✅ 支援建立、編輯、刪除自訂角色
- ✅ 細粒度權限配置：
  - 資料操作權限（編輯資料、刪除資料）
  - 管理權限（使用者管理、角色管理、系統設定管理、備份還原）
  - 資料檢視權限（檢視所有專案、檢視自己的專案）
- ✅ 系統角色保護機制
- ✅ 角色啟用/停用功能
- ✅ 顯示順序自訂
- ✅ 角色使用者統計與關聯檢查
- ✅ 完整的審計日誌記錄
- ✅ 相關檔案：
  - `migrations/migrate_roles.js` - 角色表遷移腳本
  - `src/models/Role.js` - 角色資料模型
  - `src/routes/roles.js` - 角色管理路由
  - `src/views/roles/` - 角色管理視圖（index, form, show）

**2. 使用者管理動態角色選單** 🔄
- ✅ 角色選單自動顯示所有啟用的角色（包括自訂角色）
- ✅ 按 display_order 和 role_name 排序
- ✅ 向後兼容（如果 roles 表不存在，使用預設角色）
- ✅ 使用者列表動態顯示角色名稱
- ✅ 修改檔案：
  - `src/routes/users.js` - 新增動態角色查詢
  - `src/views/users/form.ejs` - 角色選單動態生成
  - `src/views/users/index.ejs` - 角色名稱動態顯示

**3. 備份目錄動態偵測** 📂
- ✅ 自動識別實際備份目錄路徑
- ✅ 支援多種安裝配置（project-system, invoice-bonus-system, fund-weekly-report）
- ✅ 備份頁面注意事項顯示實際路徑
- ✅ 修改檔案：
  - `src/services/BackupRestoreService.js` - 新增 getBackupDir() 和 getInstallDir() 方法
  - `src/routes/backupRestore.js` - 傳遞實際路徑給視圖
  - `src/views/backup-restore/index.ejs` - 使用動態路徑

#### 問題修復

**1. 儀表板權限控制優化** 🎯
- ✅ 通知系統狀態資訊（調試資訊）僅管理員可見
- ✅ 總獎金統計僅管理員可見
- ✅ 待發放獎金統計僅管理員可見
- ✅ 其他角色（user, boss, salesperson）無法看到敏感財務資訊
- ✅ 修改檔案：`src/views/index.ejs`

**2. 角色編輯更新失敗修復** 🔧
- ✅ 問題：角色編輯後點擊「更新角色」一直顯示「處理中...」
- ✅ 原因：PUT 方法在某些環境下不穩定
- ✅ 解決：統一使用 POST 方法進行更新，提升穩定性
- ✅ 同時支持 PUT 和 POST 方法作為備選
- ✅ 修改檔案：
  - `src/routes/roles.js` - 提取共用處理函數，支援兩種方法
  - `src/views/roles/form.ejs` - 統一使用 POST 方法

**3. JavaScript 錯誤修復** 🐛
- ✅ 問題：`Uncaught ReferenceError: role is not defined`
- ✅ 原因：EJS 模板變數在 JavaScript 中未正確渲染
- ✅ 解決：在 EJS 渲染時就生成正確的 JavaScript 代碼
- ✅ 修改檔案：`src/views/roles/form.ejs`

**4. 舊備份還原後角色表缺失修復** 🔄
- ✅ 問題：從舊版本備份還原後，roles 表不存在
- ✅ 解決：創建遷移腳本和自動修復工具
- ✅ 相關檔案：
  - `migrations/migrate_remove_user_role_check.js` - 移除 users.role CHECK 約束
  - `fix-user-role-constraint.sh` - 一鍵修復腳本
  - `舊備份還原指南.md` - 詳細修復指南

**5. 專案類型預設移除** 🗑️
- ✅ 儀表板不再預載硬編碼的專案類型（食驗室、純廣、專案）
- ✅ 只顯示實際存在的專案類型
- ✅ 修改檔案：
  - `src/routes/index.js` - 移除硬編碼類型
  - `src/models/Project.js` - 移除向後兼容代碼
  - `src/routes/projects.js` - 動態類型顏色
  - `src/routes/bonuses.js` - 動態類型顏色
  - `src/routes/recentPayments.js` - 動態類型顏色

#### 技術改進

- 🎯 **動態權限系統**：從硬編碼角色升級為資料庫驅動的動態角色管理
- 🔒 **安全性增強**：移除資料庫 CHECK 約束，支援彈性角色擴展
- 📝 **程式碼品質**：改善 EJS 模板與 JavaScript 混用的處理
- 🛠️ **部署腳本更新**：deploy.sh 自動執行角色遷移和約束移除
- 🔍 **除錯增強**：添加詳細的前後端日誌輸出

#### 新增文件

- ✅ `角色管理功能部署說明.md` - 完整的角色管理功能說明
- ✅ `角色管理功能說明.txt` - 快速參考指南
- ✅ `舊備份還原指南.md` - 舊備份還原問題解決方案
- ✅ `fix-roles-table.sh` - 角色表自動修復腳本
- ✅ `fix-user-role-constraint.sh` - CHECK 約束自動修復腳本
- ✅ `角色CHECK約束修復指南.md` - 約束修復詳細指南
- ✅ `使用者管理角色選單修復說明.md` - 選單動態化說明
- ✅ `備份目錄動態偵測修復說明.md` - 備份目錄偵測說明
- ✅ `儀表板權限與角色編輯修復說明.md` - 權限和編輯修復指南
- ✅ `備份路徑與角色更新修復說明.md` - 綜合修復說明
- ✅ `角色功能完整修復總結.md` - 完整修復總結

#### 資料庫變更

**新增資料表**
- `roles` - 角色管理表
  - 欄位：id, role_key, role_name, description, can_edit, can_delete, can_manage_users, can_manage_roles, can_manage_settings, can_backup_restore, can_view_all_projects, can_view_own_projects, is_system_role, is_active, display_order, created_at, updated_at
  - 預設角色：admin, user, salesperson, boss

**資料表修改**
- `users` - 移除 role 欄位的 CHECK 約束，支援自訂角色

**遷移腳本**
- `migrate:roles` - 創建 roles 表並插入預設角色
- `migrate:remove-user-role-check` - 移除 users.role CHECK 約束

#### 升級注意事項

**從舊版本升級**：
1. 執行 `deploy.sh` 會自動執行必要的遷移
2. 如果從舊備份還原，需要執行 `npm run migrate:roles`
3. 如果遇到 CHECK 約束錯誤，執行 `npm run migrate:remove-user-role-check`
4. 可使用 `fix-user-role-constraint.sh` 進行一鍵修復

**向後兼容**：
- ✅ 完全向後兼容，不影響現有功能
- ✅ 原有的 4 個預設角色繼續正常工作
- ✅ 使用者資料不受影響

---

### 2026-02-07 - v1.9.4 備份還原與顯示修復 🔧

#### 備份還原修復

**1. uninstall.sh WAL checkpoint 順序**
- ✅ 修正：將 WAL checkpoint 移至**備份前**執行（原在備份後，導致備份不完整）
- ✅ 確保備份的資料庫主檔包含完整資料

**2. restore.sh 還原流程增強**
- ✅ 還原前驗證備份檔案中的資料庫有效性（資料表數量）
- ✅ 複製後執行 `sync` 確保寫入磁碟
- ✅ 使用 `sqlite3 -readonly` 驗證，避免建立 WAL/SHM 干擾
- ✅ 驗證失敗時二次驗證，避免 WAL 延遲誤判
- ✅ 誤判時將檔案移出後再次驗證，確認後還原正確檔案
- ✅ 關鍵時機清除 WAL/SHM：複製前、還原後、最終驗證前、結構檢查前

**3. 修改檔案**
- `uninstall.sh` - WAL checkpoint 順序
- `restore.sh` - 驗證邏輯、sync、WAL/SHM 清除、誤判處理

#### 部署顯示名稱

- ✅ 備份還原頁面瀏覽器分頁標題改為使用 `pageTitleSuffix`
- ✅ 備份還原頁面左上角名稱改為使用 `siteName`
- ✅ 修改檔案：`src/views/backup-restore/index.ejs`

#### 登入表單

- ✅ 登入表單排除全域表單 spinner，避免還原後若後端無回應時按鈕卡在「處理中...」
- ✅ 修改檔案：`public/js/main.js`
- ✅ 還原後若登入卡住，建議執行：`sudo systemctl restart project-system-dev`

---

### 2026-02-07 - v1.9.3 健康狀態備份排程顯示 ✨

#### 新增功能

**系統健康狀態頁面**
- ✅ 備份狀態區塊新增「排程下次執行」顯示
- ✅ 透過 systemctl list-timers 取得備份 timer 下次執行時間（僅 Linux）
- ✅ 若未設定排程或無法取得則不顯示

#### 修改檔案

- `src/routes/health.js` - 取得排程備份下次執行時間
- `src/views/health/index.ejs` - 顯示排程下次執行欄位

---

### 2026-02-07 - v1.9.2 排程備份修復 🔧

#### 問題修復

**1. 排程備份「無效的選擇」迴圈**
- ✅ 現象：systemd 排程執行時 journal 大量顯示「無效的選擇，請輸入 1-2 之間的數字」
- ✅ 原因：backup.sh 在非 TTY 環境仍進入互動模式（選擇安裝目錄）
- ✅ 修復：setup-backup-timer 產生的 service 改用 `ExecStart=/bin/bash -c 'NON_INTERACTIVE=1 exec /path/backup.sh'` 強制非互動
- ✅ 備援：backup.sh 增加 `[ ! -t 0 ]` 檢查，stdin 非 TTY 時自動走非互動模式

**2. Timer 下次執行時間顯示 n/a**
- ✅ setup-backup-timer 改為 `systemctl restart`（取代 start），強制 systemd 正確計算 NEXT

**3. 每日自訂時間選項**
- ✅ 新增選項 6：輸入 時:分（如 03:30）設定每日自訂備份時間
- ✅ 非互動用法：`./setup-backup-timer.sh 6 03:30`

#### 新增文件

- `自動備份排程檢查與修正指南.md` - 檢查方式、修正步驟、常見原因對照

#### 修改檔案

- `backup.sh` - 非互動條件增加 `[ ! -t 0 ]`
- `setup-backup-timer.sh` - ExecStart 改 bash -c 內聯 NON_INTERACTIVE、restart 取代 start、選項 6

---

### 2026-02-04 - v1.9.1 易讀性與篩選增強 ✨

#### 新增功能

**1. 修改紀錄易讀性改進**
- ✅ 資料庫欄位名稱改為中文顯示（如：project_code → 專案編號、invoice_date → 發票日期）
- ✅ 資料表與操作類型改為中文（projects → 專案、create → 新增）
- ✅ ID 與專案欄位顯示可識別資訊（如：123 (P001 食驗室 - 專案名稱)）
- ✅ 影響範圍：修改記錄頁面全部顯示內容

**2. 逾期未收款篩選**
- ✅ 專案管理新增「逾期未收款」快速篩選按鈕
- ✅ 篩選條件：有未收款金額且至少一筆發票的預計收款日已過期
- ✅ 排除「非營利專案」與「廣告交換」類型
- ✅ 影響範圍：專案管理頁面篩選功能

**3. 備份部署權限修復**
- ✅ deploy.config.sh 權限從 644 改為 755，確保可被正確讀取
- ✅ 建立 deploy.config.sh 後自動設定 backup.sh 與 setup-backup-timer.sh 為可執行
- ✅ 解決排程備份因腳本權限導致無法正確佈署的問題

#### 修改檔案

- `src/routes/auditLogs.js` - 欄位對應、專案解析、formatJsonWithHighlights
- `src/views/audit-logs/index.ejs` - 使用中文標籤顯示
- `src/models/Project.js` - 新增 overdue_unpaid 篩選
- `src/routes/projects.js` - 新增 overdue_unpaid 參數與查詢
- `src/views/projects/index.ejs` - 逾期未收款按鈕與 badge
- `deploy.sh` - deploy.config.sh 權限 755、備份腳本 chmod +x

---

### 2026-02-02 - v1.9.0 功能增強 ✨

#### 新增功能

**1. 儀表板已開立發票未收款總額**
- ✅ 新增「已開立發票未收款總額」統計卡片
- ✅ 計算公式：已開立發票總額 - 已收款總額 - 銷貨折讓總額
- ✅ 支援年度篩選，顯示已開票與已收款作為參考
- ✅ 影響範圍：儀表板發票統計區塊

**2. 發票明細預計收款日欄位**
- ✅ invoices 表新增 `expected_payment_date` 欄位（TEXT, 可選填）
- ✅ 發票新增/編輯表單支援預計收款日輸入
- ✅ 發票明細表格顯示預計收款日
- ✅ 應用啟動時自動檢查並添加欄位，確保向後兼容
- ✅ 遷移腳本：`migrate:invoice-expected-payment-date`

**3. 自動備份排程修復**
- ✅ 修正 deploy.sh 呼叫 setup-backup-timer.sh 時未傳參數導致互動卡住
- ✅ 預設傳入 "1"（每日凌晨 2:00）避免非互動或直接 Enter 導致未建立 timer
- ✅ 新增驗證邏輯確認 timer 是否建立成功

#### 技術改進

- 🎯 **儀表板統計**：新增 paymentStats 計算，使用 Payment.calculateActualReceived 確保收款金額一致
- 📋 **資料庫遷移**：新增 migrate_invoice_expected_payment_date.js，整合至 deploy.sh
- 🛠️ **部署體驗**：自動備份設定無需二次選擇，一次完成

#### 修改檔案

- `src/routes/index.js` - 新增收款統計與未收款總額計算
- `src/views/index.ejs` - 新增未收款總額卡片
- `src/models/Invoice.js` - 新增 expected_payment_date 支援
- `src/routes/invoices.js` - 傳遞 expected_payment_date
- `src/views/projects/show.ejs` - 發票表單與表格新增預計收款日
- `src/app.js` - 啟動時自動檢查並添加 expected_payment_date 欄位
- `deploy.sh` - 自動備份傳入預設參數 "1"

---

### 2026-01-13 - v1.8.9 修復與優化 🔧

#### 問題修復

**1. 未收款篩選功能修復**
- ✅ 修正未收款篩選邏輯：從只檢查「有開發票但沒有收款記錄」改為檢查「有未收款金額」
- ✅ 正確計算未收款金額：`已開立發票 - 已收款 - 銷貨折讓 > 0`
- ✅ 現在能正確篩選出所有有未收款金額的專案（包括部分收款的情況）
- ✅ 影響範圍：專案管理頁面的「未收款」篩選功能

**2. 排序功能增強**
- ✅ 新增「未開發票」欄位排序功能
- ✅ 新增「未收款」欄位排序功能（使用計算表達式）
- ✅ 新增「預計開票」欄位排序功能
- ✅ 所有新增排序欄位支援升序/降序切換
- ✅ 影響範圍：專案管理頁面表頭排序功能

**3. 修復腳本動態化改進**
- ✅ `fix-roles-table.sh`：改為動態讀取 `deploy.config.sh` 獲取服務名稱
- ✅ `fix-user-role-constraint.sh`：移除硬編碼目錄和服務名稱，改為動態檢測
- ✅ 兩個腳本都支援從配置文件、systemd 服務文件或目錄名稱推斷服務名稱
- ✅ 改善腳本在不同部署環境下的兼容性

#### 技術改進

- 🎯 **篩選邏輯優化**：改進未收款金額計算，確保篩選準確性
- 📊 **排序功能擴展**：新增三個重要欄位的排序支援
- 🛠️ **腳本動態化**：移除硬編碼，提升腳本在不同部署環境下的適應性

#### 相關文件更新

- ✅ 更新 `src/models/Project.js`：修正未收款篩選邏輯，新增排序欄位支援
- ✅ 更新 `src/routes/projects.js`：新增排序連結和圖示
- ✅ 更新 `src/views/projects/index.ejs`：新增排序表頭連結
- ✅ 更新 `fix-roles-table.sh`：動態讀取配置和服務名稱
- ✅ 更新 `fix-user-role-constraint.sh`：動態檢測目錄和服務名稱

---

### 2026-01-11 - v1.8.1 修復與優化 🔧

#### 問題修復

**1. 專案列表與專案詳情金額計算不一致問題修復**
- ✅ 修正 `v_project_summary` 視圖使用 JOIN 導致的笛卡爾積問題
- ✅ 改用子查詢計算 `total_invoiced` 和 `total_received`，確保金額計算準確
- ✅ 統一使用 `Payment.calculateActualReceived` 方法進行收款金額計算
- ✅ 影響範圍：專案列表、專案詳情、業務員統計、健康狀態頁面

**2. 未開立發票篩選條件修正**
- ✅ 修復篩選邏輯：從 `total_invoiced = 0` 改為 `price_with_tax > COALESCE(total_invoiced, 0)`
- ✅ 正確支援分批開發票的情況，顯示仍有未開立發票金額的專案
- ✅ 影響範圍：專案管理頁面的「未開立發票」篩選功能

**3. 特定專案類型排除功能**
- ✅ 新增排除邏輯：「非營利專案」和「廣告交換」類型排除在未開立發票與未收款查詢中
- ✅ 當勾選「未開立發票」或「未收款」篩選時，自動排除這兩種類型
- ✅ 影響範圍：專案管理頁面的「未開立發票」和「未收款」篩選功能

**4. 還原腳本服務選擇問題修復**
- ✅ 修復 `restore.sh` 和 `uninstall.sh` 顯示多個服務的問題
- ✅ 過濾掉 `invoice-bonus-backup.service` 和 `invoice-bonus-backup.timer`，只顯示主要應用服務
- ✅ 改善用戶體驗，避免選擇錯誤的服務

**5. backup.sh 腳本問題修復**
- ✅ 修復 `log: command not found` 錯誤：將 `log`、`error`、`warning`、`info` 函數定義移至腳本頂部
- ✅ 修復重複安裝目錄選擇問題：改進 `list_install_dirs` 函數邏輯
- ✅ 改善非交互模式支援：自動選擇當前目錄或標準安裝目錄

**6. 前端備份功能改進**
- ✅ 修復前端備份卡在 20% 的問題：使用 `sudo -E` 保留環境變數（特別是 `NON_INTERACTIVE`）
- ✅ 改善進度檢測：匹配更通用的輸出訊息
- ✅ 增強錯誤日誌：添加 `stderr` 實時日誌輸出

#### 技術改進

- 🎯 **資料庫視圖優化**：使用子查詢替代 JOIN，避免多對多關聯導致的資料重複
- 🔒 **計算邏輯統一**：統一收款金額計算方法，確保資料一致性
- 📝 **代碼重構**：改進篩選邏輯，提高可維護性
- 🛠️ **腳本穩定性**：修復多個腳本的函數定義順序和邏輯問題

#### 相關文件更新

- ✅ 更新 `migrations/migrate_update_total_received_with_fee.js`：視圖定義改用子查詢
- ✅ 更新 `src/models/Project.js`：篩選邏輯修正和類型排除
- ✅ 更新 `src/routes/projects.js`：統一使用 `Payment.calculateActualReceived`
- ✅ 更新 `restore.sh`、`uninstall.sh`、`backup.sh`：函數定義順序和邏輯改進
- ✅ 更新 `src/services/BackupRestoreService.js`：環境變數傳遞和日誌改進
- ✅ 更新 `setup-backup-timer.sh`：從 `deploy.config.sh` 讀取配置，支援自訂服務名稱和路徑
- ✅ 更新 `deploy.sh`：修復硬編碼路徑，使用配置變數

---

### 2025-12-29 - v1.8.0 功能增強與優化 ✨

#### 新增功能

**1. 備份與還原管理增強**
- ✅ 新增下載備份檔功能：每個備份檔旁提供下載按鈕，可直接下載到本地
- ✅ 批次勾選刪除功能：
  - 全選/取消全選功能
  - 可勾選多個備份檔進行批次刪除
  - 顯示已選數量
  - 確認對話框防止誤刪

**2. 專案管理銷貨折讓功能**
- ✅ 資料庫新增 `sales_discount` 欄位（REAL，預設 0）
- ✅ 專案新增/編輯表單增加「銷貨折讓」輸入欄位
- ✅ 專案詳細頁面顯示銷貨折讓金額
- ✅ 應收帳款計算自動扣除銷貨折讓：`應收帳款 = 已開發票金額 - 已收款金額 - 銷貨折讓`
- ✅ 支援專案列表和業務員統計的未收款金額計算

**3. 儀表板專案類型分佈優化**
- ✅ 動態顯示所有啟用的專案類型（不再限於三個固定類型）
- ✅ 點擊類型項目可直接導向專案管理頁面並自動篩選該類型
- ✅ 支援視覺提示（底線、hover 效果）和操作提示
- ✅ 使用 `project_types` 表中的顏色設定顯示

**4. 系統健康狀態頁面（僅管理員）**
- ✅ 資料庫狀態監控：檔案大小、修改時間、資料表統計
- ✅ 系統資訊顯示：Node.js 版本、作業系統、運行時間、記憶體使用
- ✅ 資料統計：各類資料數量及金額統計
- ✅ 備份狀態：備份檔案數量及最近備份資訊
- ✅ 最近活動：顯示最近 10 筆審計日誌記錄

#### 資料庫遷移

**新增遷移腳本：`migrate_sales_discount.js`**
- 自動添加 `projects` 表的 `sales_discount` 欄位
- 自動更新 `v_project_summary` 視圖包含新欄位
- 部署/還原時自動執行

#### 技術改進

- 🔧 **專案統計方法優化**：`Project.getStatistics()` 改為動態統計所有專案類型
- 🔧 **視圖同步機制**：遷移腳本自動檢查並更新視圖定義
- 🔧 **錯誤處理增強**：健康狀態頁面包含完整的錯誤處理機制

#### 使用說明

**銷貨折讓功能：**
```bash
# 執行遷移（部署時會自動執行）
npm run migrate:sales-discount

# 使用方式：在專案新增或編輯表單中輸入「銷貨折讓」金額
# 系統會自動從應收帳款中扣除折讓金額
```

**系統健康監控：**
- 路徑：`/health`（僅管理員可訪問）
- 功能：查看系統運行狀態、資料庫資訊、統計資料等
- 支援手動重新整理頁面更新資訊

---

### 2025-12-29 - v1.7.8 密碼加密升級 🔒 安全性增強

#### 更新內容

**1. 密碼加密方式升級**

- ✅ 從 **bcrypt** 升級至 **Argon2id**（Argon2 混合模式）
- ✅ Argon2 是 2015 年 Password Hashing Competition 獲勝者
- ✅ 提供更強的密碼學安全保證
- ✅ 更好的抗專用硬體攻擊能力（可調整記憶體成本）

**加密參數設定：**
```javascript
{
  type: argon2.argon2id,  // 混合模式，提供最好的安全性
  memoryCost: 65536,      // 64 MB 記憶體成本
  timeCost: 3,            // 3 次迭代
  parallelism: 4          // 4 個執行緒
}
```

**2. 向後兼容支援**

系統同時支援三種密碼格式的驗證：
- ✅ **SHA256**（舊格式，64 字元十六進位字串）
- ✅ **bcrypt**（舊格式，以 `$2a$`, `$2b$`, `$2y$` 開頭）
- ✅ **Argon2id**（新格式，以 `$argon2id$` 開頭）

**3. 自動密碼升級**

當用戶使用舊格式密碼登入時：
1. 系統會自動檢測密碼格式
2. 驗證密碼正確後，自動升級為 Argon2id 格式
3. 升級過程對用戶完全透明，無需任何操作

**升級日誌範例：**
```
[登入] 檢測到舊的 bcrypt 密碼格式，正在升級為 argon2id...
[登入] 密碼已成功升級為 argon2id
```

**4. 新增工具腳本**

**檢查密碼格式：**
```bash
npm run check:password-hash
```

功能：
- 列出所有用戶及其密碼雜湊格式
- 顯示統計摘要（SHA256/bcrypt/Argon2id 數量）
- 測試密碼雜湊功能是否正常
- 提供升級建議

**確認系統是否使用 Argon2id 加密方式：**

1. **執行檢查命令**：
```bash
cd /opt/invoice-bonus-system  # 或在專案目錄下
npm run check:password-hash
```

2. **查看輸出結果**：
   - ✅ **所有用戶都已使用 Argon2id** - 表示系統已完全使用 Argon2id 加密
   - ✅ **系統已支援 Argon2id，但仍有舊格式密碼** - 系統正常，舊密碼會在用戶登入時自動升級
   - ⚠️ **系統尚未使用 Argon2id** - 需要檢查 argon2 套件是否已安裝

3. **格式識別標準**：
   - **Argon2id**：雜湊以 `$argon2id$` 開頭（新格式 ✓）
   - **bcrypt**：雜湊以 `$2a$`、`$2b$` 或 `$2y$` 開頭（舊格式，會自動升級）
   - **SHA256**：64 個十六進位字元（舊格式，會自動升級）

4. **輸出範例**：
```
==========================================
密碼雜湊格式檢查工具
==========================================

找到 3 個用戶

[1] admin (系統管理員)
    角色: admin
    密碼雜湊長度: 98
    密碼雜湊前綴: $argon2id$v=19$m=65536...
    格式: Argon2 (新格式 ✓)
    狀態: ✓  新格式

==========================================
統計摘要
==========================================
總用戶數: 3
SHA256 格式: 0 個
bcrypt 格式: 0 個
Argon2 格式: 3 個 ✓
未知格式: 0 個

✅ 所有用戶都已使用 Argon2id 加密方式！

測試密碼雜湊功能...
✓ 密碼雜湊功能正常，使用 Argon2id
✓ 密碼驗證功能正常
```

**升級密碼工具：**
```bash
npm run upgrade:passwords
```

功能：
- 顯示需要升級的用戶列表
- 提供三種升級選項（自動升級/手動重置/批量重置）
- 指導如何完成密碼升級

#### 技術細節

**修改的檔案：**

| 檔案 | 修改內容 |
|------|---------|
| `package.json` | 新增 `argon2` 套件，保留 `bcrypt` 作為向後兼容 |
| `src/models/User.js` | `hashPassword()` 改用 Argon2id，`verifyPassword()` 支援三種格式 |
| `src/routes/auth.js` | 登入時自動檢測並升級舊格式密碼 |
| `src/routes/users.js` | 所有密碼相關操作改為 async/await |
| `migrations/migrate_users.js` | 預設管理員密碼使用 Argon2id 雜湊 |
| `scripts/check_password_hash.js` | 新增檢查工具（新建） |
| `scripts/upgrade_passwords.js` | 新增升級工具（新建） |

**Async/Await 調整：**

由於 Argon2 是異步操作，以下方法改為 async：
- `User.hashPassword()` → `async hashPassword()`
- `User.verifyPassword()` → `async verifyPassword()`
- `User.create()` → `async create()`
- `User.updatePassword()` → `async updatePassword()`
- `User.update()` → `async update()`

所有相關路由都已更新為 async 函數並正確使用 await。

#### 升級指南

**方法 1：自動升級（推薦）**

1. 通知所有用戶重新登入系統
2. 系統會自動將他們的密碼升級為 Argon2id 格式
3. 升級過程完全自動，用戶無需任何操作

**方法 2：手動檢查和升級**

1. 執行檢查腳本：
   ```bash
   npm run check:password-hash
   ```

2. 查看輸出，確認哪些用戶需要升級

3. 執行升級工具（如需批量操作）：
   ```bash
   npm run upgrade:passwords
   ```

**驗證升級結果：**

升級後執行：
```bash
npm run check:password-hash
```

應該會看到：
```
Argon2 格式: X 個 ✓
✅ 所有用戶都已使用 Argon2id 加密方式！
```

#### 安全性優勢

**Argon2id vs bcrypt：**

| 特性 | bcrypt | Argon2id |
|------|--------|----------|
| 演算法成熟度 | 成熟（1999年） | 現代（2015年獲獎） |
| 記憶體成本 | 固定 | 可調整（更靈活） |
| 抗專用硬體攻擊 | 良好 | 更強 |
| 密碼學證明 | 有 | 有（更完善） |
| 產業標準 | 廣泛使用 | 新興標準（推薦） |

**密碼雜湊格式特徵：**

- **Argon2id**：`$argon2id$v=19$m=65536,t=3,p=4$...`（約 97-98 字元）
- **bcrypt**：`$2b$10$...`（60 字元）
- **SHA256**：64 字元十六進位字串（不再使用）

#### 測試結果

✅ **功能測試通過：**
- 密碼雜湊功能正常，使用 Argon2id
- 密碼驗證功能正常
- 舊格式密碼可以正確驗證
- 自動升級功能正常運作

✅ **向後兼容測試通過：**
- SHA256 格式密碼可以驗證
- bcrypt 格式密碼可以驗證
- 登入時自動升級功能正常

#### 相關資源

- **Argon2 官方網站**：https://github.com/P-H-C/phc-winner-argon2
- **Node.js argon2 套件**：https://www.npmjs.com/package/argon2
- **密碼雜湊最佳實踐**：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

---

### 2025-12-26 (午後) - v1.7.7 開票通知優化 🔔

#### 問題反饋
用戶反映：
- ❌ 儀表板沒有看到預計開票的提醒通知
- ❌ 沒有找到設定提前通知天數的地方

#### 問題分析

**為什麼沒顯示通知？**

原始通知邏輯：只在**當月倒數第 3 天**才顯示

```javascript
// 舊邏輯：剩餘 ≤ 2 天才顯示（即倒數第 3、2、1 天）
const showNotification = daysUntilEndOfMonth <= 2;

// 問題：
// 今天是 12/26，12月有 31 天
// 剩餘天數 = 31 - 26 = 5 天
// 5 <= 2 ? ❌ 不滿足
// 結果：不顯示通知
```

**觸發時間太晚：**
- 只在倒數第 3 天才顯示
- 對於業務來說，3 天內處理發票太趕
- 用戶希望提前更多天收到提醒

#### 修復方案

**1. 提前通知時間（倒數第 7 天）**

```javascript
// 新邏輯：剩餘 ≤ 6 天就顯示（即倒數第 7 天開始）
const notificationDaysBeforeMonth = 6;
const showNotification = daysUntilEndOfMonth <= notificationDaysBeforeMonth;

// 現在：
// 今天是 12/26，12月有 31 天
// 剩餘天數 = 31 - 26 = 5 天
// 5 <= 6 ? ✅ 滿足
// 結果：顯示通知 ✅
```

**通知顯示時間範圍：**
| 日期 | 剩餘天數 | 是否顯示 | 說明 |
|------|---------|---------|------|
| 12/24 | 7天 | ❌ | 尚未進入通知期 |
| 12/25 | 6天 | ✅ | **開始顯示**（倒數第7天）|
| 12/26 | 5天 | ✅ | |
| 12/27 | 4天 | ✅ | |
| 12/28 | 3天 | ✅ | |
| 12/29 | 2天 | ✅ | |
| 12/30 | 1天 | ✅ | |
| 12/31 | 0天 | ✅ | 月底最後一天 |

**2. 添加調試資訊區塊**

在儀表板添加藍色資訊框，顯示通知系統狀態：

```
ℹ️ 通知系統狀態（調試資訊）
• 當前月份：2025-12
• 當月剩餘天數：5 天
• 通知條件：剩餘 ≤ 6 天（即倒數第 7 天開始）
• 是否顯示通知：✓ 是
• 符合條件的專案數：1 個
```

**幫助用戶：**
- ✅ 了解為什麼顯示/不顯示通知
- ✅ 檢查有多少專案符合條件
- ✅ 排查配置問題

**3. 通知天數可配置（代碼層面）**

在 `src/routes/index.js` 中添加註解說明：

```javascript
// 判斷是否在倒數第7天或之後（可在系統設定中調整，預設7天）
const notificationDaysBeforeMonth = 6; // 改此值可調整通知天數
// 6 = 倒數第 7 天開始（目前設定）
// 9 = 倒數第 10 天開始
// 2 = 倒數第 3 天開始（原始設定）
```

修改後重啟服務即可生效。

#### 測試步驟

**1. 設定測試專案**
```
進入專案管理 → 選擇未結案專案 → 設定「預計開票年月」為當月
```

**2. 查看儀表板**
```
返回首頁 → 查看藍色調試資訊框 → 確認通知條件
```

**3. 驗證通知**
```
如果條件滿足，應該會看到黃色警告框顯示開票提醒
```

#### 相關檔案

| 檔案 | 修改內容 |
|------|---------|
| `src/routes/index.js` | 通知天數改為 6（倒數第 7 天）|
| `src/views/index.ejs` | 添加調試資訊區塊 |
| `開票通知功能說明.md` | 新增完整的測試和使用文檔 |
| `README.md` | 更新到 v1.7.7 |

#### 未來規劃

**系統設定功能（計劃中）：**
- [ ] 網頁介面設定通知天數
- [ ] 啟用/停用通知功能
- [ ] 設定通知接收人員
- [ ] 郵件通知
- [ ] LINE 通知

#### 移除調試資訊

調試資訊區塊是為了測試和排查問題。確認通知功能正常後，可以移除：

```javascript
// 在 src/views/index.ejs 中註解或刪除此區塊：
<!-- 調試資訊區塊（可移除） -->
${typeof showNotification !== 'undefined' ? `
<div class="alert alert-info ...">
  ...
</div>
` : ''}
```

---

### 2025-12-26 (深夜2) - v1.7.6 備份統計修復 ⭐⭐ 終極修復

#### 問題發現（通過自動測試）

執行 `test-backup-restore.sh` 後發現：
- ❌ 備份時統計：2 個使用者
- ❌ 還原後驗證：1 個使用者
- ❌ WAL 檔案已正確清理（0 bytes）
- ❌ 但資料仍然不完整

**這表明問題不在還原，而在備份！**

#### 根本原因（WAL 模式的時間競爭）

**問題流程：**
```
時間 T0: WAL checkpoint 完成
       └─ 主檔案包含所有資料（2 個使用者）✅
       └─ WAL 檔案清空 ✅

時間 T1: 複製主檔案到備份目錄
       └─ 備份檔案：2 個使用者 ✅

時間 T2: 系統繼續運行，產生新寫入
       └─ 新的 WAL 檔案產生（可能包含第 2 個使用者的更新）

時間 T3: 統計原始資料庫（用於顯示備份資訊）
       └─ 查詢 $DB_FILE
       └─ SQLite 讀取：主檔案 + 新 WAL = 2 個使用者
       └─ 顯示：「✓ 使用者: 2 筆」❌ （誤導性的）

實際情況：備份檔案只有 1 個使用者！
```

**核心問題：**
- 統計的是 **正在運行的資料庫**（主檔案 + 動態 WAL）
- 備份的是 **靜態主檔案**（不包含新的 WAL）
- 兩者不一致 = 誤導性的統計資訊

#### 修復方案（統計備份檔案）

**backup.sh 修改：**
```bash
# 錯誤做法（之前的實現）
cp "$DB_FILE" "${BACKUP_PATH}/invoice_bonus.db"
USER_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM users;")
# ❌ 統計原始檔案 = 可能包含備份後的新資料

# 正確做法（新的實現）
cp "$DB_FILE" "${BACKUP_PATH}/invoice_bonus.db"
USER_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM users;")
# ✅ 統計備份檔案 = 精確反映備份內容
```

**修改的查詢：**
- ✅ 所有 `SELECT COUNT(*)` 查詢改為使用 `${BACKUP_PATH}/invoice_bonus.db`
- ✅ 所有 `PRAGMA table_info()` 查詢改為使用備份檔案
- ✅ 所有統計和驗證都基於實際備份的資料

#### 技術說明

**為什麼 WAL checkpoint 不夠？**

1. **Checkpoint 時機：**
   - Checkpoint 將 WAL 合併到主檔案
   - 但無法阻止新的寫入

2. **時間窗口：**
   ```
   checkpoint() → [時間窗口] → copy() → [時間窗口] → query()
              ↑                    ↑                   ↑
         合併 WAL              複製主檔案          可能有新 WAL
   ```

3. **解決方案：**
   - 不查詢原始資料庫（會受新 WAL 影響）
   - 只查詢備份檔案（靜態快照）

**為什麼不停止服務？**
- 停止服務會影響線上用戶
- 備份應該是非侵入性的操作
- 統計備份檔案可以在服務運行時進行

#### 驗證結果

**執行測試腳本：**
```bash
sudo ./test-backup-restore.sh

# 修復前：
[錯誤] ✗ 使用者數量不符 (1 != 2)  ❌

# 修復後（預期）：
✓ 使用者數量正確 (2 = 2)  ✅
✓ 預計開票數量正確 (1 = 1)  ✅
✓ 所有驗證通過！
```

#### 相關修改

| 修改項目 | 說明 |
|---------|------|
| `backup.sh` | 所有統計查詢改為使用備份檔案 |
| `uninstall.sh` | 新增 WAL checkpoint + 統計備份檔案 + 完整資料統計 |
| `WAL_FILE_FIX.md` | 新增第二階段修復說明 |
| `README.md` | 更新到 v1.7.6 |

#### 重要提醒

✅ **此修復完全向後兼容**
- 不影響現有備份檔案
- 不需要重新部署
- 只需上傳新的 `backup.sh` 和 `uninstall.sh`

🔄 **建議操作**
1. 上傳新的 `backup.sh` 和 `uninstall.sh` 到伺服器
2. 設定執行權限：`chmod +x backup.sh uninstall.sh`
3. 執行測試：`sudo ./test-backup-restore.sh`
4. 應該看到：✅ 所有驗證通過！

📋 **修復的腳本**
- ✅ `backup.sh` - 手動備份（統計備份檔案）
- ✅ `uninstall.sh` - 移除前自動備份（統計備份檔案 + WAL checkpoint）
- ✅ `restore.sh` - 還原前清理 WAL/SHM 檔案

---

### 2025-12-26 (深夜) - v1.7.5 WAL 檔案問題修復 ⭐ 關鍵更新

#### 問題發現
通過自動測試腳本 `test-backup-restore.sh` 發現備份還原後資料不完整：
- ❌ 還原前：3 個使用者
- ❌ 還原後：只有 1 個使用者（應該是 3 個）
- ❌ 預計開票資料也未正確還原

#### 根本原因
**better-sqlite3 的 WAL 模式檔案殘留：**

1. **WAL 模式產生的檔案：**
   ```
   invoice_bonus.db        # 主資料庫檔案
   invoice_bonus.db-wal    # WAL 日誌檔案（未提交的更改）
   invoice_bonus.db-shm    # 共享記憶體檔案
   ```

2. **問題流程：**
   ```
   1. 用戶修改資料（寫入 WAL 檔案）
   2. 執行還原（只替換 .db 檔案）
   3. 舊的 .db-wal 檔案仍然存在
   4. SQLite 讀取時：新.db + 舊.wal = 錯誤的資料 ❌
   ```

3. **實際案例：**
   - 備份時：3 個使用者（寫入主檔案）
   - 刪除 2 個使用者（寫入 WAL 檔案）
   - 還原：新主檔案（3個用戶）+ 舊WAL檔案（刪除2個）= 1個用戶 ❌

#### 修復方案

**backup.sh 修改：**
```bash
# 備份前執行 WAL checkpoint
sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"

# 這會：
# 1. 將 WAL 中的所有更改合併到主檔案
# 2. 清空 WAL 檔案
# 3. 確保主檔案包含所有最新資料
```

**restore.sh 修改：**
```bash
# 還原前清理 WAL/SHM 檔案
rm -f "${PROJECT_DIR}/data/invoice_bonus.db-wal"
rm -f "${PROJECT_DIR}/data/invoice_bonus.db-shm"

# 這會：
# 1. 刪除舊的 WAL 日誌檔案
# 2. 確保只使用新還原的主檔案
# 3. 避免舊資料干擾
```

#### 驗證方法

**使用自動測試腳本：**
```bash
cd /opt/invoice-bonus-system
chmod +x test-backup-restore.sh
sudo ./test-backup-restore.sh

# 預期結果：
✓ 專案數量正確
✓ 使用者數量正確  # 之前會失敗
✓ 預計開票數量正確 # 之前會失敗
✓ 使用者帳號完全一致
✓ 預計開票資料完全一致
```

**手動驗證：**
```bash
# 檢查 WAL 檔案
ls -lh /opt/invoice-bonus-system/data/invoice_bonus.db*

# 應該看到（還原後）：
invoice_bonus.db        # 主檔案
invoice_bonus.db-wal    # 新的空 WAL（服務啟動後產生）
invoice_bonus.db-shm    # 新的 SHM（服務啟動後產生）

# 驗證資料
sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db "SELECT COUNT(*) FROM users;"
# 應該顯示正確的使用者數量
```

#### 影響範圍
- ✅ 所有備份操作 - 確保備份包含完整資料
- ✅ 所有還原操作 - 確保還原不受舊資料干擾
- ✅ 向後兼容 - 不影響現有備份檔案

#### 重要提醒
⚠️ **如果您在 2025-12-26 之前建立了備份：**
- 這些備份可能沒有執行 WAL checkpoint
- 還原後請手動驗證資料完整性
- 建議重新執行備份

✅ **2025-12-26 之後的備份：**
- 自動執行 WAL checkpoint
- 確保包含所有最新資料
- 還原時自動清理舊 WAL 檔案

---

### 2025-12-26 (深夜) - v1.7.4 備份還原修復 🔧 關鍵更新

#### 問題修復
- 🐛 **修復備份還原資料遺失問題**
  - 修正 better-sqlite3 資料庫連接機制
  - 確保還原後一定會重啟服務（重新載入資料庫）
  - 無論交互或非交互模式，都會正確處理服務重啟
  - **修復 WAL 模式檔案殘留問題** ⭐ 重要
    - 還原前自動清理 WAL/SHM 檔案
    - 備份前執行 WAL checkpoint（合併資料）
  
- ✅ **增強備份驗證**
  - 備份時顯示完整資料統計（包含使用者、預計開票等）
  - 驗證資料庫結構完整性
  - 顯示預計開票和使用者資料範例

- 📊 **改進還原驗證**
  - 還原後自動驗證所有資料類型
  - 顯示詳細的資料統計資訊
  - 檢查預計開票欄位和使用者帳號

#### 技術細節

**根本原因 1：資料庫連接問題**
- better-sqlite3 在模組載入時建立資料庫連接
- 當資料庫檔案被替換後，舊的連接仍然指向舊檔案
- **必須重啟 Node.js 進程**才能重新連接到新的資料庫檔案

**根本原因 2：WAL 模式檔案殘留** ⚠️
- better-sqlite3 使用 WAL (Write-Ahead Logging) 模式
- WAL 模式會產生額外的檔案：
  - `invoice_bonus.db` - 主資料庫檔案
  - `invoice_bonus.db-wal` - WAL 日誌檔案（未提交的更改）
  - `invoice_bonus.db-shm` - 共享記憶體檔案
- **如果只還原 .db 檔案而不清理 WAL 檔案**：
  - SQLite 會合併 新.db + 舊WAL = 錯誤的資料
  - 導致還原後的資料不正確

**解決方案：**
```bash
# backup.sh 流程：
1. 執行 WAL checkpoint（合併 WAL 到主檔案）
2. 複製資料庫主檔案
3. 驗證備份內容

# restore.sh 流程：
1. 停止服務（釋放資料庫連接）
2. 清理舊的 WAL/SHM 檔案（避免殘留）
3. 還原資料庫檔案
4. 檢查並修復資料庫結構
5. 重新啟動服務（重新載入資料庫）
6. 驗證資料完整性
```

#### 使用建議

**正確的還原流程：**
```bash
# 1. 執行還原腳本
cd /opt/invoice-bonus-system
sudo ./restore.sh

# 2. 選擇要還原的備份編號
[選擇編號]

# 3. 確認還原操作
y

# 4. 等待還原完成（腳本會自動重啟服務）

# 5. 驗證資料
# 查看日誌中的資料統計：
📊 還原後資料統計：
  - 專案: XX 筆
  - 客戶: XX 筆
  - 發票: XX 筆
  - 使用者: XX 筆
  - 已設定預計開票: XX 筆
  - 非管理員使用者: XX 筆
```

#### 測試備份還原功能

**自動測試腳本：**
```bash
# 使用自動測試腳本驗證備份還原功能
cd /opt/invoice-bonus-system
chmod +x test-backup-restore.sh
sudo ./test-backup-restore.sh

# 腳本會自動：
# 1. 記錄當前資料
# 2. 執行備份
# 3. 模擬資料修改
# 4. 執行還原
# 5. 驗證資料完整性
# 6. 顯示詳細的差異報告
```

**測試結果：**
- ✅ 所有驗證通過 - 備份還原功能正常
- ❌ 驗證失敗 - 請查看錯誤訊息

**詳細測試文檔：** 請參閱 `測試備份還原流程.md`

**驗證還原是否成功：**
```bash
# 方法 1：查看服務狀態
sudo systemctl status invoice-bonus-system.service

# 方法 2：直接查詢資料庫
cd /opt/invoice-bonus-system
sqlite3 data/invoice_bonus.db "SELECT COUNT(*) FROM users;"
sqlite3 data/invoice_bonus.db "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL;"

# 方法 3：登入系統檢查
# 訪問 http://your-server:3000
# 查看專案管理和使用者管理頁面
```

#### 重要提醒

⚠️ **備份策略：**
- 在重要操作前先執行備份
- 定期檢查備份內容是否完整
- 保留多個時間點的備份

✅ **還原後檢查項目：**
- [ ] 服務正常啟動
- [ ] 所有使用者帳號都在
- [ ] 專案資料完整
- [ ] 預計開票欄位有資料
- [ ] 發票和收款記錄正確

---

### 2025-12-26 (晚上) - v1.7.3 智能開票提醒 🔔 自動通知

#### 新增功能
- 🔔 **儀表板開票提醒通知**
  - 當月倒數第3天自動顯示提醒通知
  - 顯示所有預計本月開票的未結案專案
  - 即時統計專案金額和開票狀態
  - 一鍵跳轉到專案詳情或篩選頁面
  - 倒數計時器顯示本月剩餘天數

#### 提醒邏輯
- ⏰ **觸發時間**：當月倒數第 3 天開始（例如：12月29日、30日、31日）
- 🎯 **篩選條件**：
  - 預計開票年月 = 當前年月（YYYY-MM）
  - 專案狀態 = 未結案
  - 按專案金額降序排列
- 📊 **顯示資訊**：
  - 專案編號、名稱、類型
  - 業務人員
  - 專案總金額
  - 已開立發票金額
  - 未開立發票金額（紅色加粗顯示）

#### 使用方式

**自動顯示：**
- 登入系統進入儀表板
- 符合條件時自動顯示橙色警告通知
- 通知可關閉（點擊右上角 X）

**快速操作：**
```
1. 點擊「查看」按鈕 → 進入專案詳情頁
2. 點擊「查看所有預計本月開票專案」→ 進入篩選結果頁
3. 關閉通知後重新整理頁面可再次顯示
```

#### 通知示例

```
🔔 開票提醒通知
本月還剩 3 天！以下 5 個專案預計在 2025-12 開立發票，請儘速處理：

專案編號  專案名稱         業務    專案金額     已開發票     未開發票
CU202501  某某行銷案      張三    $100,000     $50,000     $50,000
...
```

#### 技術實現
- 後端自動計算當月剩餘天數
- 資料庫查詢使用 `expected_invoice_year_month` 欄位
- 前端使用 Bootstrap Alert 組件
- 響應式設計，支援手機、平板、電腦

---

### 2025-12-26 (下午) - v1.7.2 還原流程增強 🛡️ 完美兼容

#### 重大改進
- 🛡️ **restore.sh 自動修復舊備份**
  - 自動偵測並修復缺少的資料庫欄位
  - 自動處理 sql.js 舊備份（重建資料庫結構）
  - 自動更新所有資料庫視圖
  - 完整的錯誤處理和驗證機制
  - 詳細的操作日誌輸出

#### 支援的備份類型
- ✅ **舊版 sql.js 備份** - 自動重建為 better-sqlite3 格式
- ✅ **缺少 expected_invoice_year_month 欄位** - 自動添加欄位並更新視圖
- ✅ **缺少 users.salesperson_id 欄位** - 自動添加欄位
- ✅ **任何版本的舊備份** - 智能升級到最新結構

#### 自動修復流程

**偵測缺少欄位時：**
```bash
[檢查資料庫結構是否需要更新...]
偵測到舊備份：缺少 expected_invoice_year_month 欄位，正在添加...
資料庫已備份: data/invoice_bonus.db.before-field-update-YYYYMMDD_HHMMSS
✓ expected_invoice_year_month 欄位添加成功
更新 v_project_summary 視圖...
✓ 視圖更新成功
✓ 欄位驗證成功
✓ 視圖驗證成功（包含 expected_invoice_year_month）
```

**偵測 sql.js 舊備份時：**
```bash
[驗證資料庫內容...]
⚠️  資料庫檔案存在但沒有資料表，可能損壞或格式不兼容（舊版 sql.js）
⚠️  嘗試自動修復資料庫結構...
已備份損壞的資料庫檔案
執行資料庫遷移...
✓ 資料庫結構已重建（11 個資料表）
⚠️  注意：資料庫已重建為全新結構，原備份資料不兼容
⚠️  預設管理員帳號: admin / admin123
```

#### 使用方式

**正常還原：**
```bash
cd /opt/invoice-bonus-system
./restore.sh

# 選擇備份編號
# restore.sh 會自動：
# 1. 還原資料庫
# 2. 偵測結構問題
# 3. 自動修復缺少的欄位
# 4. 更新所有視圖
# 5. 驗證修復結果
# 6. 重啟服務
```

**手動修復已還原的資料庫：**
```bash
cd /opt/invoice-bonus-system

# 停止服務
sudo systemctl stop invoice-bonus-system.service

# 添加缺少的欄位
sqlite3 data/invoice_bonus.db "ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT;"

# 更新視圖（完整 SQL 見上方日誌）
sqlite3 data/invoice_bonus.db < /path/to/update_view.sql

# 重啟服務
sudo systemctl restart invoice-bonus-system.service
```

#### 技術細節

**錯誤處理改進：**
- 不再忽略 sqlite3 錯誤訊息（移除 `2>/dev/null`）
- 智能識別「欄位已存在」錯誤
- 無論添加是否成功都嘗試更新視圖
- 完整的驗證流程

**驗證機制：**
1. ✅ 檢查 `projects` 表是否包含新欄位
2. ✅ 檢查 `users` 表是否包含新欄位
3. ✅ 檢查視圖定義是否包含新欄位
4. ✅ 測試 sqlite3 查詢是否正常

#### 注意事項

⚠️ **關於舊版 sql.js 備份：**
- 2025-12-25 之前的備份可能使用 sql.js 格式
- 這些備份在還原後會自動重建為全新資料庫
- **原始資料無法恢復**（格式不兼容）
- 建議使用 2025-12-26 之後的備份

✅ **關於缺少欄位的備份：**
- 自動添加所有缺少的欄位
- 自動更新所有視圖
- **資料完整保留**
- 完全透明，無需手動操作

---

### 2025-12-26 (早上) - v1.7.1 部署流程優化 🔧

#### 改進項目
- 🔧 **優化 deploy.sh 部署流程**
  - 自動更新資料庫視圖（確保包含最新欄位）
  - 自動驗證視圖定義是否正確
  - 每次部署前自動備份資料庫
  - 移除過時的手動操作步驟

- 🐛 **修復已知問題**
  - 移除 `src/routes/projects.js` 中不再需要的 `db.saveDatabase()` 調用
  - 修復視圖未更新導致前端看不到資料的問題
  - 確保 `expected_invoice_year_month` 欄位在所有情況下都能正確顯示

- ✨ **部署體驗改善**
  - **一鍵部署完成所有設定** - 無需手動執行額外步驟
  - 自動偵測並修復資料庫結構問題
  - 清晰的部署日誌和驗證訊息

#### 使用方式
```bash
# 執行一鍵部署（自動完成所有設定）
sudo ./deploy.sh
```

部署腳本會自動：
1. 停止服務
2. 備份資料庫
3. 檢查並添加缺少的欄位
4. 強制更新視圖定義
5. 驗證資料庫結構
6. 重啟服務

---

### 2024-12-25 (深夜) - v1.7.0 遷移到 better-sqlite3 🚀 重大升級

#### 重大改進
- 🚀 **從 sql.js 遷移到 better-sqlite3**
  - 資料自動同步到磁碟（無需手動儲存）
  - 即時反映外部資料庫修改
  - 大幅提升效能（原生綁定）
  - 啟用 WAL 模式（更好的並發）
  - 更穩定可靠

#### 技術優勢對比

**sql.js（舊）：**
- ❌ 載入資料庫到記憶體（啟動慢）
- ❌ 需要手動儲存（30秒間隔）
- ❌ 服務重啟才能看到外部修改
- ❌ 記憶體使用高

**better-sqlite3（新）：**
- ✅ 直接操作磁碟（啟動快 10 倍）
- ✅ 自動同步寫入（<1ms 延遲）
- ✅ 即時看到外部修改
- ✅ 記憶體使用正常

#### 遷移步驟

**方式一：使用 deploy.sh 自動遷移（最簡單）⭐**
```bash
# deploy.sh 會自動偵測並執行遷移
sudo ./deploy.sh
```
- ✅ 自動偵測是否使用 sql.js
- ✅ 自動安裝 better-sqlite3
- ✅ 自動替換資料庫驅動
- ✅ 無需額外步驟

**方式二：使用專用遷移腳本**
```bash
chmod +x migrate_to_better_sqlite3.sh
sudo ./migrate_to_better_sqlite3.sh
```

**詳細文件：** 請參閱 `MIGRATION_TO_BETTER_SQLITE3.md`

#### 影響範圍
- ✅ 完全向後兼容（無需修改應用代碼）
- ✅ 資料庫格式不變（SQLite 標準格式）
- ✅ API 保持一致
- ✅ 自動回滾機制（失敗時）

---

### 2024-12-25 (晚上) - v1.6.1 獎金批次刪除 + 預計開票修復 ✅ 已完成

#### 新增功能
- ✅ **獎金管理批次刪除**：支援勾選多筆獎金記錄進行批次刪除
  - 全選/取消全選功能
  - 即時顯示選取數量
  - 批次刪除確認對話框
  - 成功/失敗訊息提示
  - 權限控制（僅限管理員及一般使用者）

#### 問題修復
- 🐛 **業務預計開立發票年月更新問題**
  - 修復表單提交時隱藏欄位值未正確更新
  - 新增表單提交前驗證
  - 新增 Console 日誌以便除錯
  - 確保年月選擇器變更時即時更新隱藏欄位

#### 技術改進
- 🎨 優化批次操作使用者體驗
- 🔒 強化批次刪除權限控制
- 📝 更新 README.md 功能說明

---

### 2024-12-25 (晚上) - deploy.sh 統一部署 + Systemd Timer 自動備份 ✅ 已完成

#### 重大改進
- ✅ **deploy.sh 成為唯一部署腳本**
  - 智能偵測首次安裝或更新
  - 自動安裝 Node.js（首次安裝）
  - 自動複製文件到 /opt（首次安裝）
  - 統一入口，更簡潔易用
- ✅ **Systemd Timer 自動備份**（現代化方式）
- ✅ **互動式備份設定腳本** (`setup-backup-timer.sh`)
- ✅ **deploy.sh 整合自動備份設定**
- ✅ 支援多種備份頻率選項
- ✅ 支援自訂時間格式
- ✅ 非互動模式支援（腳本自動化）

#### 備份頻率選項
1. **每日備份** - 每天凌晨 2:00
2. **每週備份** - 每週日凌晨 2:00
3. **每日兩次** - 每天 2:00 和 14:00
4. **自訂時間** - 完全自訂（支援 systemd OnCalendar 格式）
5. **停用自動備份** - 僅保留手動備份

#### 技術特點
- 使用 Systemd Timer 替代傳統 Cron Job
- 支援 `Persistent=true`（錯過執行時間會補執行）
- 隨機延遲 0-300 秒（避免網路擁塞）
- 完整的日誌整合（journalctl）
- 低優先級執行（Nice=10, IOSchedulingClass=idle）
- 與 systemd 服務統一管理

#### 使用方式
```bash
# 方式一：在部署時設定（推薦）
sudo ./deploy.sh
# 部署完成後會自動詢問是否設定自動備份

# 方式二：單獨設定（互動式）
sudo ./setup-backup-timer.sh

# 查看備份計畫
sudo systemctl list-timers invoice-bonus-backup.timer

# 立即執行備份測試
sudo systemctl start invoice-bonus-backup.service

# 查看備份日誌
sudo journalctl -u invoice-bonus-backup.service -n 50
```

#### 系統改進
- ❌ 移除 `install.sh`（功能完全整合至 deploy.sh）
- ✅ **deploy.sh 智能偵測機制**
  - 自動判斷首次安裝或更新
  - 根據情況執行對應流程
  - 統一用戶體驗
- ✅ 首次安裝自動完成所有設定
- ✅ 更新部署安全且智能
- ✅ 整合自動備份設定流程

### 2024-12-25 (下午) - 專案管理新增「預計開票」篩選功能 ✅ 已完成並測試通過

#### 新增功能
- ✅ **專案管理頁面新增「預計開票」篩選器**
- ✅ 自動從資料庫讀取所有已設定的預計開票年月
- ✅ 下拉選單顯示格式：YYYY-MM
- ✅ 按年月降序排列（最新的在最上面）
- ✅ 支援與其他篩選條件組合使用
- ✅ 排序時自動保留篩選條件

#### 技術實作
- 新增 `Project.getExpectedInvoiceYearMonths()` 方法
- 在 `Project.findAll()` 中添加預計開票年月篩選邏輯
- 更新路由和視圖以支援新的篩選參數
- 只顯示非空的預計開票年月選項

#### 使用方式
1. 進入專案管理頁面
2. 在篩選表單中找到「預計開票」下拉選單
3. 選擇想要篩選的年月（例如：2025-01）
4. 點擊「搜尋」按鈕
5. 系統會顯示該月份預計開票的所有專案

#### 功能優勢
- 🎯 快速找到特定月份預計開票的專案
- 🔄 與年度、狀態、類型等篩選條件無縫整合
- 📊 便於業務人員規劃開票作業
- ✨ 操作流暢，用戶體驗優秀

### 2024-12-25 (上午) - 專案管理新增「業務預計開立發票年月」欄位 ✅ 已完成並測試通過

#### 新增功能
- ✅ 專案詳情頁新增獨立編輯區塊（位於發票明細上方）
- ✅ 專案列表顯示預計開票年月
- ✅ **優化的年月選擇器**（下拉選單，取代 HTML5 month input）
- ✅ 資料庫新增 `expected_invoice_year_month` 欄位
- ✅ 更新 `v_project_summary` 視圖包含新欄位
- ✅ **主遷移腳本已包含此欄位（全新安裝無需額外遷移）**
- ✅ **一鍵部署腳本自動更新資料庫結構**

#### UI 改進
- **優化的選擇器**：使用年份和月份分開的下拉選單
- **更好的用戶體驗**：操作流暢，兼容所有瀏覽器
- **即時顯示**：選擇後立即顯示當前設定值

#### 技術實作
- 年份範圍：當前年份 -1 到 +3 年
- 月份範圍：1-12 月
- 資料格式：YYYY-MM (例如: 2024-12)
- 向後兼容：舊資料該欄位為 NULL
- 獨立編輯表單，不影響專案主表單

#### 全新安裝（推薦）
執行一鍵部署腳本會自動包含此欄位：

```bash
sudo ./deploy.sh
```

**deploy.sh 會自動**：
- ✅ 偵測首次安裝並執行完整流程
- ✅ 包含所有必要的資料庫遷移
- ✅ 自動建立完整的資料庫結構
- ✅ 無需額外手動操作

#### 已安裝系統如何更新

**方式一：使用一鍵部署腳本（推薦）** ⭐

```bash
cd /opt/invoice-bonus-system
sudo ./deploy.sh
```

✅ 部署腳本會**自動完成所有更新**：
- 停止服務並釋放端口
- 檢查並添加 `expected_invoice_year_month` 欄位（如果缺少）
- 更新 `v_project_summary` 視圖
- 備份資料庫（修改前自動備份）
- 更新依賴套件
- 重啟服務並驗證

**方式二：手動更新（如果部署腳本不可用）**

```bash
# 1. 停止服務
sudo systemctl stop invoice-bonus-system.service

# 2. 進入專案目錄
cd /opt/invoice-bonus-system

# 3. 備份資料庫
cp data/invoice_bonus.db data/invoice_bonus.db.backup-$(date +%Y%m%d_%H%M%S)

# 4. 更新資料庫（添加欄位和更新視圖）
sqlite3 data/invoice_bonus.db <<'EOF'
BEGIN TRANSACTION;
ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT;
DROP VIEW IF EXISTS v_project_summary;
CREATE VIEW v_project_summary AS
SELECT 
  p.id, p.project_code, p.contract_year, p.contract_month, p.status,
  p.project_type, p.project_name, p.price_with_tax, p.price_without_tax,
  p.is_new_customer, p.salesperson_id, p.customer_id, 
  p.expected_invoice_year_month, p.notes, p.created_at, p.updated_at,
  s.name as salesperson_name, s.status as salesperson_status,
  c.customer_code, c.tax_id, c.company_name,
  COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
  p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as uninvoiced_amount,
  COALESCE((SELECT SUM(bank_deposit_amount) FROM payments WHERE project_id = p.id), 0) as total_received
FROM projects p
LEFT JOIN salespeople s ON p.salesperson_id = s.id
LEFT JOIN customers c ON p.customer_id = c.id;
COMMIT;
EOF

# 5. 驗證更新
sqlite3 data/invoice_bonus.db "PRAGMA table_info(projects);" | grep expected_invoice_year_month

# 6. 啟動服務
sudo systemctl start invoice-bonus-system.service

# 7. 檢查服務狀態
sudo systemctl status invoice-bonus-system.service
```

#### 驗證更新成功

```bash
# 檢查欄位是否存在
sqlite3 /opt/invoice-bonus-system/data/invoice_bonus.db "PRAGMA table_info(projects);" | grep expected_invoice_year_month

# 應該看到類似輸出：
# 15|expected_invoice_year_month|TEXT|0||0

# 檢查服務狀態
sudo systemctl status invoice-bonus-system.service

# 檢查最近的日誌
journalctl -u invoice-bonus-system.service -n 50
```

### 2024-12-24 - 新增 NAS 異地備份文件

#### 文件更新
- ✅ 新增 NAS 異地備份完整設定指南
- ✅ Ubuntu 24.04 必要元件安裝說明
- ✅ SSH Key 免密碼登入配置步驟
- ✅ Synology NAS 特殊設定說明
- ✅ 系統網頁介面設定流程
- ✅ 故障排除與測試方法

#### NAS 異地備份功能
- 支援 rsync 和 SCP/SSH 兩種傳輸協定
- 自動將備份檔案同步到 NAS
- 提供連接測試功能
- 完整的權限與安全性說明

### 2025-12-07 - 系統功能測試完成

#### 功能測試狀態
- ✅ **所有功能測試正常**
- ✅ Excel 匯入功能運作正常
- ✅ 專案管理功能正常
- ✅ 發票管理功能正常
- ✅ 收款管理功能正常
- ✅ 獎金計算功能正常
- ✅ 業務管理功能正常
- ✅ 客戶管理功能正常
- ✅ 使用者管理功能正常
- ✅ 修改記錄功能正常
- ✅ Excel 匯出功能正常

#### 已修復的問題

1. **`isNewProject` 變數初始化錯誤**
   - **問題**：在 `ExcelImportService.js` 第 498 行使用 `isNewProject` 變數時，該變數尚未定義（定義於第 761 行），導致匯入時出現 "Cannot access 'isNewProject' before initialization" 錯誤
   - **修復**：將第 498 行的 `isNewProject` 判斷改為使用 `isSameProject`（基於專案編號比較），可在使用前正確定義
   - **影響範圍**：專案匯入功能，處理專案主資訊行時繼承業務人員的邏輯
   - **狀態**：✅ 已修復並測試通過

2. **`syncCompanyName` 函數無限遞迴**
   - **問題**：在 `Customer.js` 的 `findOrCreate` 方法中，`syncCompanyName` 輔助函數在第 184 行最後調用了自己，造成無限遞迴，導致 "Maximum call stack size exceeded" 錯誤
   - **修復**：將 `syncCompanyName` 函數的最後一行從 `return syncCompanyName(customer);` 改為 `return customer;`
   - **影響範圍**：客戶建立或查找功能，當需要同步更新公司名稱時
   - **狀態**：✅ 已修復並測試通過

#### Excel 匯入測試結果

- ✅ 專案匯入：72 筆
- ✅ 發票匯入：83 筆
- ✅ 收款匯入：54 筆
- ✅ 獎金匯入：141 筆
- ✅ 業務匯入：146 筆
- ✅ 客戶匯入：0 筆（使用現有客戶）

#### 系統穩定性

- ✅ 所有核心功能運作正常
- ✅ 資料庫操作穩定
- ✅ 錯誤處理機制完善
- ✅ 使用者介面運作流暢

## 開發與維護

### 開發模式
```bash
npm run dev
```
使用 nodemon 自動重啟，適合開發時使用。

### 生產模式
```bash
npm start
```
使用 node 直接執行，適合生產環境。

### 資料庫遷移
系統提供多個遷移腳本：
- `npm run migrate` - 基本資料庫結構遷移
- `npm run migrate:users` - 使用者資料表遷移
- `npm run migrate:project-code` - 專案編號唯一約束遷移
- `npm run migrate:project-customer` - 專案客戶唯一約束遷移
- `npm run migrate:project-name` - 專案名稱唯一約束遷移
- `npm run migrate:expected-invoice` - 業務預計開立發票年月欄位遷移
- `npm run seed` - 插入種子資料（獎金級距）

### 環境變數
- `PORT` - 伺服器端口（預設：3000）
- `NODE_ENV` - 執行環境（development/production）
- `SESSION_SECRET` - Session 密鑰（生產環境請務必修改）

## 常見問題與故障排除

### 部署問題

**Q: 部署時出現權限錯誤**
```bash
# 解決方法：必須使用 sudo 執行部署腳本
sudo ./deploy.sh

# deploy.sh 需要 root 權限來：
# - 安裝 Node.js（首次安裝）
# - 創建 /opt 目錄（首次安裝）
# - 管理 systemd 服務
# - 設定系統級備份
```

**Q: Node.js 版本不符合要求**
```bash
# 檢查 Node.js 版本
node -v

# 如果版本過舊，重新安裝 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 啟動問題

**Q: 端口已被佔用**
```bash
# 找出佔用端口的程序
sudo lsof -i :3000

# 停止佔用端口的程序
sudo kill -9 $(sudo lsof -t -i :3000)
```

**Q: 資料庫檔案損壞**
```bash
# 從備份還原（推薦）
sudo ./restore.sh backup_YYYYMMDD_HHMMSS.tar.gz

# 或重新初始化資料庫（會清除所有資料）
npm run migrate
npm run seed
```

### 備份問題

**Q: 自動備份沒有執行**
```bash
# 檢查 timer 狀態
sudo systemctl status invoice-bonus-backup.timer

# 查看 timer 是否啟用
sudo systemctl list-timers invoice-bonus-backup.timer

# 重新啟用 timer
sudo systemctl enable invoice-bonus-backup.timer
sudo systemctl start invoice-bonus-backup.timer

# 立即測試備份
sudo systemctl start invoice-bonus-backup.service

# 查看備份日誌
sudo journalctl -u invoice-bonus-backup.service -n 50
```

**Q: 如何修改備份時間**
```bash
# 重新執行設定腳本
sudo ./setup-backup-timer.sh

# 或手動編輯 timer 文件
sudo nano /etc/systemd/system/invoice-bonus-backup.timer

# 修改後重新載入
sudo systemctl daemon-reload
sudo systemctl restart invoice-bonus-backup.timer
```

**Q: NAS 備份失敗**
```bash
# 測試 SSH 連接
ssh username@nas-ip-address

# 測試 rsync
rsync -avz --dry-run /opt/invoice-bonus-backups/ username@nas-ip:/path/to/backup/

# 檢查 SSH key 權限
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub

# 查看備份腳本日誌
sudo journalctl -u invoice-bonus-backup.service -n 100
```

### 功能問題

**Q: Excel 匯入失敗**
- 檢查 Excel 檔案格式是否符合範本
- 確認檔案大小不超過 10MB
- 檢查合併儲存格格式
- 查看系統日誌了解詳細錯誤

**Q: 無法登入系統**
- 確認使用預設帳號：`admin` / `admin123`
- 檢查帳號是否被停用（需管理員啟用）
- 清除瀏覽器 Cookie 後重試

**Q: 修改記錄無法顯示**
- 確認 `audit_logs` 資料表已建立
- 檢查資料庫權限
- 查看系統日誌

### 備份與還原

**Q: 備份檔案過大**
```bash
# 手動清理舊備份（保留最近 5 個）
cd backups
ls -t | tail -n +6 | xargs rm -f
```

**Q: 還原備份失敗**
- 確認備份檔案完整性
- 檢查磁碟空間是否足夠
- 確認資料庫檔案未被鎖定

### 效能問題

**Q: 系統運行緩慢**
- 檢查資料庫檔案大小
- 清理不必要的上傳檔案
- 檢查系統資源使用情況
- 考慮優化資料庫查詢

**Q: Excel 匯入/匯出速度慢**
- 大檔案建議分批處理
- 檢查系統記憶體是否足夠
- 關閉不必要的應用程式

## 授權

MIT License
