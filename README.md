# 專案開立發票業績認列獎金計算總表系統

[![版本](https://img.shields.io/badge/版本-v1.16.0-blue.svg)](https://github.com/oupaul/pbg-system)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![資料庫](https://img.shields.io/badge/資料庫-SQLite-orange.svg)](https://github.com/WiseLibs/better-sqlite3)

基於 Node.js + SQLite 的專案管理與業績獎金計算系統，支援發票、收款、業務獎金及多角色權限控制。

---

## 快速開始

### 全新安裝

```bash
# 公開 Repo
bash <(curl -fsSL https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)

# 私有 Repo（支援 ghp_ 與 github_pat_ 格式）
export GH_TOKEN=github_pat_xxxxxxxxxxxx
bash <(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)
```

### 更新現有安裝

```bash
export GH_TOKEN=github_pat_xxxxxxxxxxxx
bash <(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  https://raw.githubusercontent.com/oupaul/pbg-system/develop/update.sh)
```

`setup.sh` 自動安裝 git、clone repo，並移交 `deploy.sh` 完成部署。  
`update.sh` 自動偵測安裝目錄、rsync 同步程式碼（保留 `data/`、`uploads/`），再執行增量遷移。

> **私有 Repo 說明**：`raw.githubusercontent.com` 同樣需要認證，curl 指令本身必須加 `-H "Authorization: Bearer $GH_TOKEN"`，光設環境變數不夠。

### 本機手動部署

```bash
sudo ./deploy.sh
```

首次安裝時互動式設定服務名稱、安裝目錄、端口等，後續執行自動執行增量遷移與重啟。

---

## 預設帳號

| 帳號    | 密碼       |
|---------|------------|
| `admin` | `admin123` |

**首次登入後請立即變更密碼。**

---

## 系統需求

- Ubuntu 24.04 LTS（推薦）或其他 Linux
- Node.js 20.x
- 記憶體 512MB 以上、硬碟 1GB 以上

---

## 腳本說明

| 腳本                    | 用途                               |
|-------------------------|------------------------------------|
| `setup.sh`              | 全新主機一鍵安裝（從 GitHub）      |
| `update.sh`             | 更新現有安裝到最新版本             |
| `deploy.sh`             | 本機部署（首次安裝 / 增量更新）    |
| `backup.sh`             | 手動備份                           |
| `restore.sh`            | 還原備份                           |
| `setup-backup-timer.sh` | 設定 Systemd Timer 自動備份排程   |
| `uninstall.sh`          | 移除系統（自動備份後再移除）       |

---

## 角色與權限

| 角色                 | 說明                                               |
|----------------------|----------------------------------------------------|
| 系統管理員（admin）  | 完整系統權限                                       |
| 專案管理員（user）   | 完整編輯，可使用匯入/匯出與毛利分析（可見所有專案）|
| 業務員（salesperson）| 唯讀，僅見自己負責的專案                           |
| 老闆（boss）         | 唯讀，可查看所有專案                               |

角色支援自訂，可在「角色管理」建立額外角色並設定細粒度權限（`project_view_scope`: all / assigned / own / none）。

---

## 主要功能

- **專案管理**：新增/編輯/刪除，多維度篩選（年度、狀態、類型、業務、預計開票月份），附件上傳
- **發票管理**：開立、作廢、整筆/部分折讓，軟刪除與還原
- **收款管理**：一張發票可分多次收款，匯費差異處理
- **獎金計算**：依專案類型自動計算（食驗室/純廣/專案），簽約/結案獎金分開發放
- **業務績效**：依業務彙總專案數、金額、開票、收款、獎金
- **毛利分析**：依專案、業務、類型彙總，支援 Excel/PDF 匯出（admin/user 限定）
- **帳齡分析**：應收帳款帳齡分區，Excel/PDF 匯出
- **備份還原**：Systemd Timer 定期備份，支援 NAS 異地備份，智能還原舊備份
- **匯入/匯出**：Excel 匯入現有總表，匯出專案總表/獎金報表
- **修改記錄**：完整 Audit Log，支援 CSV 匯出
- **系統監控**：DB 狀態、記憶體用量、備份排程（admin 限定）

---

## 技術架構

- **後端**：Node.js 20 / Express 4 / better-sqlite3
- **前端**：EJS / Bootstrap 5 / Bootstrap Icons
- **認證**：Session-based，密碼 Argon2id（向後兼容 bcrypt）
- **安全**：登入速率限制（10次/10分鐘）、RBAC 路由保護、SQL 參數化查詢

---

## 資料庫主要資料表

| 資料表                   | 說明                       |
|--------------------------|----------------------------|
| `projects`               | 專案基本資料               |
| `invoices`               | 發票記錄（含折讓/作廢）    |
| `payments`               | 收款記錄（支援分次收款）   |
| `bonus_calculations`     | 獎金計算記錄               |
| `salespeople`            | 業務人員                   |
| `customers`              | 客戶                       |
| `roles`                  | 角色與權限定義             |
| `users`                  | 使用者帳號                 |
| `user_salesperson_access`| 使用者可存取業務員對照     |
| `audit_logs`             | 完整修改記錄               |
| `v_project_summary`      | 視圖：專案彙總（含發票、收款加總）|

---

## NAS 異地備份

系統備份頁面提供 GUI 設定（備份 → 設定 NAS）：

1. 在伺服器上設定 SSH Key 免密登入到 NAS：`ssh-keygen` → `ssh-copy-id user@nas-ip`
2. 在系統備份頁面填入 NAS IP、帳號、備份路徑，測試連線後儲存
3. 後續備份時自動 rsync 到 NAS

---

## 更新日誌

### v1.16.0（2026-06-09）RBAC 強化
- `project_view_scope` 四種範圍（all/assigned/own/none），`user_salesperson_access` 多業務存取
- 匯入/匯出頁面限 admin/user，毛利分析角色過濾
- 登入速率限制 middleware，儀表板統計快取
- 常數集中管理（`src/constants.js`），範本動態讀取專案類型
- `deploy.sh` / `restore.sh` / `install.sh` migration 清單補齊

### v1.15.x（2026-02-12 ～ 2026-03-27）
一筆發票分多次收款、儀表板獨立加總改為依專案類型、開立發票提醒業務員限制、專案詳情顯示備註

### v1.14.0（2026-02-06）
業務績效圖表、收款提醒、發票與收款軟刪除、部分折讓、專案範本、稽核紀錄匯出

### v1.13.0 ～ v1.8.x
毛利分析、業務績效儀表板、PDF 匯出、應收帳齡、全域搜尋、發票作廢、附件管理、角色管理系統、閒置自動登出、Select2 下拉選單
