# CLAUDE.md

本檔案提供 Claude Code 在此 repo 工作時的專案背景與安全邊界。

## 專案概要

Node.js + Express + SQLite（`better-sqlite3`）的發票／業績獎金／CRM 系統，繁體中文介面。正式環境透過 `deploy.sh` 產生的 systemd service 直接跑在客戶自有主機上（repo 內目前沒有 Dockerfile／compose.yaml；若日後導入容器化部署，比照下方「高風險操作」的謹慎程度處理）。系統管理的是客戶的真實財務與客戶資料，任何操作都應以「這是正式環境，沒有 staging」的態度對待。

深入架構背景見 [`docs/internal/system-architecture-context.md`](docs/internal/system-architecture-context.md)（給撰寫文件用的內部資訊來源，非公開文件，內容可能過時，以程式碼與目前分支為準）。

## 高風險操作 — 一律先取得使用者明確同意，不自行判斷執行

以下操作即使看起來與當下任務相關，也必須先詢問使用者並取得明確同意才能執行：

- 執行維運腳本：`deploy.sh`、`update.sh`、`setup.sh`、`uninstall.sh`、`restore.sh`、`backup.sh`
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

## 常用指令

- `npm run dev` — nodemon 開發模式
- `npm start` — 正式啟動（純 `node`，不會自動 reload）
- `npm test` — jest
- `npm run migrate:run` — 執行 migrations/runner.js（見上方「高風險操作」，需先確認）
