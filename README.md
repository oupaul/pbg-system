# 專案開立發票業績認列獎金計算總表系統

基於 Node.js + SQLite 的專案管理與業績獎金計算系統。

---

## 安裝

### 一鍵安裝（從 GitHub）

```bash
# 公開 Repo
bash <(curl -fsSL https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)

# 私有 Repo（curl 本身也需帶 token）
export GH_TOKEN=github_pat_xxxxxxxxxxxx
bash <(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)
```

`setup.sh` 自動安裝 git、clone repo，並執行 `deploy.sh` 完成部署。

### 本機手動部署

```bash
sudo ./deploy.sh
```

首次安裝時互動式設定服務名稱、安裝目錄、port；後續執行自動增量遷移並重啟服務。

### 預設帳號

| 帳號    | 密碼       |
|---------|------------|
| `admin` | `admin123` |

**首次登入後請立即變更密碼。**

### 環境變數（進階，選填）

透過 `setup.sh`／`deploy.sh` 部署不需要處理這一步（`SESSION_SECRET` 等會自動產生）。若要用 `npm run dev` 或手動啟動，可參考 [`.env.example`](.env.example) 設定 `PORT`、`NODE_ENV`、`SESSION_SECRET` 等變數（本專案未使用 dotenv，需自行 `export`）。

---

## 更新

```bash
# 從安裝目錄執行（最常用）
sudo /opt/your-install-dir/update.sh

# 或遠端一行指令
export GH_TOKEN=github_pat_xxxxxxxxxxxx
bash <(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  https://raw.githubusercontent.com/oupaul/pbg-system/develop/update.sh)
```

`update.sh` 自動偵測安裝目錄、rsync 同步程式碼（保留 `data/`、`uploads/`），再執行增量 migration。執行前會顯示目前／最新版本與 commit hash，並要求手動確認（建議先執行一次 `backup.sh`）；部署完成後會自動跑健康檢查（`scripts/health-check.sh`），若 migration 或健康檢查失敗會停止並印出排查方式，不會自動重試或回滾。全自動情境可設定 `SKIP_UPDATE_CONFIRM=1` 跳過確認步驟。

---

## 本機測試 vs VM 測試

兩者環境差異不小，測試結論不能直接互相取代：

| | 本機（`npm run dev`） | VM（`deploy.sh`／`update.sh`） |
|---|---|---|
| 執行環境 | `NODE_ENV=development`，會印出除錯訊息、SQL log | `NODE_ENV=production`，寫進 systemd unit |
| 資料 | 本機 `data/invoice_bonus.db`，可隨時砍掉重建 | 客戶的真實資料，沒有 staging 環境 |
| `SESSION_SECRET` | 未設定的話每次啟動都換一組（開發用途無妨，見 [`.env.example`](.env.example)） | 首次部署自動產生並固定寫入 systemd unit |
| 啟動方式 | 手動 `npm run dev` | 透過 systemd 服務常駐、`Restart=always` |
| 適合驗證什麼 | 功能邏輯、畫面、UI 互動 | 部署腳本本身、systemd 整合、實際 port/服務設定是否正確 |

**驗證 `update.sh`／`deploy.sh` 這類部署腳本的行為，本機跑不出來**（沒有 systemd、没有真實安裝目錄結構），必須在 VM 上測試；但正式 VM 沒有 staging，所以：

- 若要測試更新流程本身，優先在一台獨立的測試 VM 上（用 `setup.sh` 建一份全新安裝）跑過一輪，而不是直接對正式主機做實驗
- 若只能對正式主機操作，至少先手動執行 `backup.sh`，並利用 `update.sh` 內建的確認步驟仔細看清楚要更新到哪個 commit
- 一般功能開發／改 bug，優先用本機 `npm run dev` 驗證，不需要動到 VM

---

## 備份

### 手動備份

```bash
sudo /opt/your-install-dir/backup.sh
```

### 設定自動備份排程

```bash
sudo /opt/your-install-dir/setup-backup-timer.sh
```

設定 Systemd Timer，每日自動備份至本機 `backups/` 目錄。

### NAS 異地備份

在系統「備份管理 → 設定 NAS」頁面操作：

1. 在伺服器設定 SSH Key 免密登入 NAS：
   ```bash
   ssh-keygen
   ssh-copy-id user@nas-ip
   ```
2. 在備份設定頁面填入 NAS IP、帳號、路徑，測試連線後儲存。
3. 後續每次備份自動 rsync 到 NAS。

---

## 還原

```bash
sudo /opt/your-install-dir/restore.sh
```

互動式選擇備份檔（本機或 NAS），自動停止服務、還原資料庫、重啟。

---

## 腳本一覽

| 腳本                    | 用途                                   |
|-------------------------|----------------------------------------|
| `setup.sh`              | 全新主機一鍵安裝（從 GitHub）          |
| `update.sh`             | 更新現有安裝至最新版本                 |
| `deploy.sh`             | 本機部署（首次安裝 / 增量更新）        |
| `backup.sh`             | 手動備份                               |
| `restore.sh`            | 還原備份                               |
| `setup-backup-timer.sh` | 設定 Systemd Timer 自動備份排程        |
| `uninstall.sh`          | 移除系統（自動備份後再刪除）           |
| `scripts/health-check.sh` | 部署後／手動健康檢查（`update.sh` 會自動呼叫） |

---

## 系統需求

- Ubuntu 24.04 LTS（推薦）或其他 Linux
- Node.js 20.x
- 記憶體 512MB 以上、硬碟 1GB 以上
