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

`update.sh` 自動偵測安裝目錄、rsync 同步程式碼（保留 `data/`、`uploads/`），再執行增量 migration。

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

---

## 系統需求

- Ubuntu 24.04 LTS（推薦）或其他 Linux
- Node.js 20.x
- 記憶體 512MB 以上、硬碟 1GB 以上
