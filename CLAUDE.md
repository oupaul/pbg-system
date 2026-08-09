# CLAUDE.md

本檔案提供 Claude Code 在此 repo 工作時的專案背景與安全邊界。

## 專案概要

Node.js + Express + SQLite（`better-sqlite3`）的發票／業績獎金／CRM 系統，繁體中文介面。正式環境透過 `deploy.sh` 產生的 systemd service 直接跑在客戶自有主機上（repo 內目前沒有 Dockerfile／compose.yaml；若日後導入容器化部署，比照下方「高風險操作」的謹慎程度處理）。系統管理的是客戶的真實財務與客戶資料，任何操作都應以「這是正式環境，沒有 staging」的態度對待。

深入架構背景見 [`docs/internal/system-architecture-context.md`](docs/internal/system-architecture-context.md)（給撰寫文件用的內部資訊來源，非公開文件，內容可能過時，以程式碼與目前分支為準）。

## 高風險操作 — 一律先取得使用者明確同意，不自行判斷執行

維運腳本（`deploy.sh`、`update.sh`、`setup.sh`、`uninstall.sh`、`restore.sh`、`backup.sh`）本身可以視任務需要編輯，但以下操作即使看起來與當下任務相關，也必須先詢問使用者並取得明確同意才能執行（不是編輯，是「跑」）：

- **執行**上述任一維運腳本，尤其是對著真實 VM／正式主機跑
- 執行任何 migration：`npm run migrate*`、`node migrations/runner.js` 或個別 migration 檔
- 操作 Docker（container/volume）、連線到正式主機／VM、直接查詢或寫入資料庫（含 `data/*.db`）
- `git commit`、`git push`，或其他會改變遠端/共享狀態的 git 操作
- 刪除或覆寫 `data/`、`uploads/`、`backups/` 底下的內容（皆為 gitignored，可能是唯一副本）

## 密鑰與敏感設定放在哪裡

- Gitignored 設定檔：`.env`、`deploy.config.json`、`deploy.config.sh`、`nas_config.json`
- `SESSION_SECRET`：`deploy.sh` 首次部署時以 `openssl rand -hex 32` 產生，直接寫入 systemd unit 的 `Environment=`，不會落地在 repo 內任何檔案；本機開發若未設定，`src/app.js` 會每次啟動自動產生一組亂數金鑰，代表每次重啟都會讓所有人被登出
- SMTP／LINE 憑證**不是環境變數**，存在 SQLite 的 `system_settings` 資料表，透過「系統設定」頁面（`src/routes/settings.js`）維護與讀取（`src/services/EmailService.js`）——這些值目前是明文存在資料庫裡
- 本專案未安裝 `dotenv`，`.env` 不會被自動載入；`.env.example` 只是文件用範本

## 已知需要留意的技術現況（動手改 `src/` 前先確認）

- EJS 樣板混用三種輸出寫法，多數頁面靠 template literal 拼字串，`${...}` **不會自動 escape**；改動任何 view 前先確認該頁用的是哪一種寫法，避免重新引入 XSS（本次 session 才修過一輪，細節見架構文件第 3 節）
- `migrations/runner.js` 的 `MIGRATIONS` 陣列只能在尾端新增，不可插入或調整既有順序；新 migration 避免對既有欄位下死值 CHECK 約束清單（不同環境起家的 schema 版本不一致，曾因此在部分環境炸掉）
- 全新安裝的預設帳號是 `admin`/`admin123`（`migrations/migrate.js`、`migrate_users.js`）；文件或範例中提到帳密時務必用假資料，不要把任何真實部署的憑證寫進 commit 或訊息

## 本機開發／測試 vs VM 測試

- 本機（`npm run dev`）：`NODE_ENV=development`、假資料、`data/invoice_bonus.db` 可隨意重建，用來驗證功能邏輯/畫面
- VM（`deploy.sh`／`update.sh`）：`NODE_ENV=production`、真實客戶資料、沒有 staging；只有在 VM 上才能真正驗證部署腳本本身（systemd 整合、port、rsync exclude 等），但正式 VM 沒有沙盒，測部署流程優先用獨立測試 VM，不要拿正式主機當測試環境
- 完整差異表見 [`README.md`](README.md) 的「本機測試 vs VM 測試」一節

## `update.sh` 目前的行為（供改動前參考）

`update.sh` 已加上：更新前顯示明確版本來源（GitHub commit hash，不只是不可靠的 `package.json` version 欄位）、更新前要求手動確認並提醒先跑 `backup.sh`（可用 `SKIP_UPDATE_CONFIRM=1` 跳過供全自動情境使用）、deploy.sh 失敗會停止並印出排查方式、部署完成後呼叫 `scripts/health-check.sh` 打 `GET /login` 驗證服務真的有回應（而不是只看 `systemctl is-active`）。**沒有自動回滾**——失敗時腳本只會停下來給出資訊，不會自己嘗試修復或還原。

## `deploy.sh` 已修的風險

- migration 失敗（`node migrations/runner.js` 非 0）現在會停止部署、不啟動服務，而不是印警告後繼續（`runner.js` 本身已經是「失敗的 migration 不標記完成、下次重跑會自動重試」，所以停下來是安全的，不會卡住進度）
- 停服務時的 `kill -9`（含首次安裝那個分支）現在會先確認佔用該 port 的程序指令包含 `app.js` 才殺，且都改用 `${PORT}` 而非寫死 3000；驗證失敗會停止部署並印出 PID／指令，不會誤殺無關程序
- `npm audit fix`（不含 `--force`）預設會在每次部署時自動執行——這只會套用 npm 認定不含破壞性變更的修復；需要 `--force` 才能修的項目（代表會有破壞性變更，例如降版某個依賴）不會自動套用，會印出來但需要人工評估後手動執行。可設定 `SKIP_AUDIT_FIX=1` 完全跳過

## 一個刻意沒修的風險：`deploy.sh` 裡的 ad-hoc `ALTER TABLE`

`deploy.sh` 步驟 2 有一段用 `sqlite3` CLI 直接幫 `projects` 表加 `expected_invoice_year_month` 欄位，繞過 `migrations/runner.js` 的追蹤機制。**這不是單純的技術債，而是目前唯一會幫「既有安裝」補上這個欄位的機制**：

- 真正對應這個欄位的 migration（`migrations/migrate_expected_invoice_date.js`）是孤兒檔案——用的是舊版 `sql.js` driver，從未被加進 `runner.js` 的 `MIGRATIONS` 陣列，`package.json` 也已經沒有對應的 npm script 了
- `migrations/migrate.js`（bootstrap 腳本）雖然也有補這個欄位的防呆邏輯，但 `deploy.sh` 只在資料庫「完全不存在」時才會呼叫它，既有安裝升級時永遠不會執行到那段
- `runner.js` 陣列裡已追蹤的幾個 migration（`migrate_sales_discount`、`migrate_update_total_received_with_fee`、`migrate_fix_v_project_summary_invoice_filters`、`migrate_invoice_status`、`migrate_remove_project_type_check`）都只是「重建 `v_project_summary` 時，若欄位存在才把它加進 SELECT」，本身不會去新增這個欄位

因為新 migration 只能加在陣列**尾端**，而上面這些會依欄位是否存在來決定要不要把它塞進視圖的 migration 全部排在更前面——如果把加欄位的邏輯改成陣列尾端的新 migration，這些既有 migration 執行當下會判定欄位還不存在，用「不含這個欄位」的版本重建 `v_project_summary`，且不會再被後面加欄位的 migration 動到視圖。結果是：欄位加上了，但 `v_project_summary`（儀表板/報表在用）會永久漏掉這個欄位，直到未來又有新 migration 剛好重建一次視圖為止。

要修正這個必須連動改好幾個既有 migration 的視圖重建邏輯，風險遠高於上面三項，這次刻意不動，維持 `deploy.sh` 原本的 ad-hoc 寫法（它本身邏輯是安全、冪等的，只是架構上不理想）。之後如果要處理，需要先完整盤點所有會重建 `v_project_summary` 的 migration，一次改齊。

## Docker／Compose

Repo 目前**沒有任何 Dockerfile 或 compose.yaml**，部署完全走 systemd + VM。若有人要求「整理 Docker Compose 設定」，先確認清楚：這是要新建一套僅供本機開發/測試用的容器環境（不影響現有 systemd 部署方式），還是誤以為 repo 已經有相關設定——不要在沒問清楚的情況下憑空生出一套容器化部署。

## 常用指令

- `npm run dev` — nodemon 開發模式
- `npm start` — 正式啟動（純 `node`，不會自動 reload）
- `npm test` — jest
- `npm run migrate:run` — 執行 migrations/runner.js（見上方「高風險操作」，需先確認）
- `scripts/health-check.sh <PORT>` — 打 `GET /login` 驗證服務是否正常回應，`update.sh` 會自動呼叫，也可隨時手動執行
