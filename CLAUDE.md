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

`update.sh` 已加上：更新前顯示明確版本來源（GitHub commit hash，不只是不可靠的 `package.json` version 欄位）、更新前要求手動確認並提醒先跑 `backup.sh`（可用 `SKIP_UPDATE_CONFIRM=1` 跳過供全自動情境使用）、deploy.sh 失敗會停止並印出排查方式、部署完成後呼叫 `scripts/health-check.sh`（優先打 `GET /healthz`，會實際讀一次資料庫；舊版沒有該端點時退回 `GET /login`）驗證服務真的有回應。

- `rsync --delete` 的排除清單包含這台主機專屬的 `.env`、`.env.*`、`deploy.config.sh`、`deploy.config.json`、`nas_config.json`（異地備份設定存在安裝目錄根），不會被更新刪掉
- 同步程式碼前會把目前的程式碼（不含 node_modules、data、uploads、backups）打包存到 `<安裝目錄>-backups/code_before_update_*.tar.gz`，保留最近 3 份；失敗訊息會附上回滾指令。**仍然沒有自動回滾**，回滾需手動解開快照並視情況用 `data/invoice_bonus.db.backup-*` 還原資料庫

## `deploy.sh` 已修的風險

- migration 失敗（`node migrations/runner.js` 非 0）現在會停止部署、不啟動服務，而不是印警告後繼續（`runner.js` 本身已經是「失敗的 migration 不標記完成、下次重跑會自動重試」，所以停下來是安全的，不會卡住進度）
- 停服務時的 `kill -9`（含首次安裝那個分支）現在會先確認佔用該 port 的程序指令包含 `app.js` 才殺，且都改用 `${PORT}` 而非寫死 3000；驗證失敗會停止部署並印出 PID／指令，不會誤殺無關程序
- 依賴以 `package-lock.json` 鎖定（已提交，不再 gitignore），部署使用 `npm ci` 讓每家公司的主機得到完全相同的版本；有鎖定檔時**不會**在主機上自動 `npm audit fix`（會讓各主機版本漂移）——漏洞請在開發環境執行 `npm audit fix`、測試後提交更新的鎖定檔，需要在主機強制執行時設定 `RUN_AUDIT_FIX=1`；沒有鎖定檔時維持舊行為（`npm install` + 自動 audit fix，`SKIP_AUDIT_FIX=1` 可略過）。`package.json` 有 `engines`（Node >=20 <25）與 `.nvmrc`（22）；Node 26 與 better-sqlite3 的 ABI 不相容
- 部署前的資料庫備份與 `migrations/runner.js` 執行前的快照（`data/invoice_bonus.db.pre-migrate-*`，保留最近 3 份，`SKIP_MIGRATION_SNAPSHOT=1` 可略過）都改用 SQLite 線上備份（`.backup`／`VACUUM INTO`），並檢查 `PRAGMA integrity_check`；備份失敗就中止，不再在沒有備份時變更資料庫。`runner.js` 遇到第一個失敗的 migration 就停止，不再繼續執行後面可能依賴它的 migration

## 備份與還原

- `backup.sh` 用 `sqlite3 .backup`（沒有 sqlite3 時改用 `scripts/sqlite-backup.js`）產生一致的資料庫備份並檢查完整性，**不再直接 `cp` 運作中的 WAL 資料庫**；備份含 `data/branding/`（自訂分頁圖示）；`umask 077`，備份目錄 700、備份檔 600
- 備份完成後若「備份還原」頁面已啟用 NAS 同步，會呼叫 `scripts/nas-sync.js` 同步一份到 NAS（異地備份，失敗只警告）；NAS 設定欄位有格式驗證（拒絕以 `-` 開頭的主機/使用者，避免 ssh 參數注入），rsync 也會使用設定的連接埠
- `restore.sh` 還原前用線上備份取得一致快照（失敗就中止還原），服務停止後才把現有資料庫連同 `-wal`／`-shm` 一起改名保留，還原後檢查 `PRAGMA integrity_check`，DB 與 `.env` 權限為 600
- 這些腳本只做過語法檢查與核心指令（`.backup`、`scripts/sqlite-backup.js`、migration 快照）的隔離測試，**尚未在真實主機上完整跑過一次備份→還原流程**；上線後請先在測試 VM 驗證

## 執行期保護

- `src/utils/asyncRoutes.js`：async 路由 handler 丟出的錯誤會交給全域錯誤處理（Express 4 預設會讓請求卡住）；production 的錯誤頁只顯示錯誤代碼，詳細訊息只在日誌
- `SIGTERM`/`SIGINT` 會先停止接收請求再關閉資料庫（最多等 10 秒）；`GET /healthz` 不需登入、不建 session，會實際讀一次資料庫
- `src/models/db.js`：`busy_timeout=5000`、`synchronous=NORMAL`；資料庫忙碌/鎖定/IO 錯誤/損毀不再被 `get()`/`all()` 當成「查無資料」吞掉（schema 差異類錯誤仍維持原本的容錯）；錯誤日誌不記錄 SQL 參數
- Excel 專案匯入與成本明細匯入包在單一交易裡，單一工作表上限 20000 列
- 角色旗標已實際強制：`can_manage_users`（`requireAdmin`：使用者、修改記錄、登入紀錄、系統健康、廣播通知、客戶匯入匯出）、`can_manage_roles`（`requireManageRoles`：角色管理）、`can_manage_settings`（`requireManageSettings`：系統設定與各類選項／類型／狀態／簽核關卡管理、分頁圖示）、`can_backup_restore`（`requireBackupRestore`：備份還原），皆由 `requireRoleFlag` 產生，內建 `admin` 角色永遠放行（防止角色被改壞後無人能進管理頁）。沒有 `can_manage_users` 的角色管理者不能授予或移除「使用者管理」旗標（避免自行提權）。`migrate_role_admin_flags` 會把既有 `can_manage_users=1` 角色的其餘三個旗標補成 1，讓升級前後行為一致；新增管理頁面時請選對應的 middleware，不要一律用 `requireAdmin`
- 上傳驗證（`src/utils/uploadValidation.js`）：附件採副檔名白名單且檔頭必須與副檔名相符（html/svg/js/exe/sh 與含巨集的 .xlsm/.docm 都不在白名單），Excel 匯入只接受結構正常的 .xlsx（含 zip bomb 檢查）；新增上傳端點請用 `guardedSingleUpload`，不要直接 `upload.single()`。路由順序注意：`/batch-*` 這類固定路徑必須定義在 `/:id` 之前
- 附件線上預覽（專案頁）：以檔案內容（魔術位元組）判斷類型，不信任副檔名/MIME；SVG/HTML 一律不預覽。圖片/PDF/文字/CSV 由伺服器供應；Word（.docx）、Excel（.xlsx）由瀏覽器端解析（mammoth 為 `public/vendor/mammoth/` 內的 vendored 檔案，ExcelJS 由 `/vendor/exceljs/exceljs.min.js` 提供），伺服器只驗證 OOXML ZIP 結構（防 zip bomb：條目數／解壓總量上限）並以 `application/octet-stream` 回傳原始位元組（`/projects/:id/attachments/:attachmentId/office`）。Word 預覽經白名單消毒（`public/js/attachment-preview.js`），Excel 一律用 `textContent`；舊版 .doc/.xls 不支援預覽，只能下載
- 自動測試：`npm test`（jest，`tests/`）目前涵蓋跳脫/重導/CSRF Origin 檢查/帳號鎖定/備份檔名白名單/NAS 設定驗證等純函式；尚無需要資料庫的整合測試

## 一個刻意沒修的風險：`deploy.sh` 裡的 ad-hoc `ALTER TABLE`

`deploy.sh` 步驟 2 有一段用 `sqlite3` CLI 直接幫 `projects` 表加 `expected_invoice_year_month` 欄位，繞過 `migrations/runner.js` 的追蹤機制。**這不是單純的技術債，而是目前唯一會幫「既有安裝」補上這個欄位的機制**：

- 真正對應這個欄位的 migration（`migrations/migrate_expected_invoice_date.js`）是孤兒檔案——用的是舊版 `sql.js` driver，從未被加進 `runner.js` 的 `MIGRATIONS` 陣列，`package.json` 也已經沒有對應的 npm script 了
- `migrations/migrate.js`（bootstrap 腳本）雖然也有補這個欄位的防呆邏輯，但 `deploy.sh` 只在資料庫「完全不存在」時才會呼叫它，既有安裝升級時永遠不會執行到那段
- `runner.js` 陣列裡已追蹤的幾個 migration（`migrate_sales_discount`、`migrate_update_total_received_with_fee`、`migrate_fix_v_project_summary_invoice_filters`、`migrate_invoice_status`、`migrate_remove_project_type_check`）都只是「重建 `v_project_summary` 時，若欄位存在才把它加進 SELECT」，本身不會去新增這個欄位

因為新 migration 只能加在陣列**尾端**，而上面這些會依欄位是否存在來決定要不要把它塞進視圖的 migration 全部排在更前面——如果把加欄位的邏輯改成陣列尾端的新 migration，這些既有 migration 執行當下會判定欄位還不存在，用「不含這個欄位」的版本重建 `v_project_summary`，且不會再被後面加欄位的 migration 動到視圖。結果是：欄位加上了，但 `v_project_summary`（儀表板/報表在用）會永久漏掉這個欄位，直到未來又有新 migration 剛好重建一次視圖為止。

要修正這個必須連動改好幾個既有 migration 的視圖重建邏輯，風險遠高於上面三項，這次刻意不動，維持 `deploy.sh` 原本的 ad-hoc 寫法（它本身邏輯是安全、冪等的，只是架構上不理想）。之後如果要處理，需要先完整盤點所有會重建 `v_project_summary` 的 migration，一次改齊。

## 登入紀錄地區判斷（GeoLite2）

`src/services/GeoIpService.js` 用 MaxMind GeoLite2 的離線資料庫把登入 IP 轉成國碼，顯示在「登入紀錄」頁面。這個資料庫**不隨 repo 提供**（授權與檔案大小考量，見 `.gitignore` 的 `data/` 規則），需要手動下載：

1. 到 [MaxMind](https://www.maxmind.com/en/geolite2/signup) 註冊免費帳號，取得 license key
2. 下載 `GeoLite2-Country.mmdb`，放到 `data/GeoLite2-Country.mmdb`
3. 重啟服務即可生效

沒有這個檔案不會影響登入或其他功能，只是地區欄位一律顯示「-」（`GeoIpService` 有防呆，找不到檔案只會警告一次，不會每次登入都重試/報錯）。**這個資料庫本身沒有自動更新機制**，MaxMind 的 IP 對照資料會隨時間過時，需要自己定期重新下載覆蓋。

畫面上只顯示 ISO 國碼轉成的國旗 emoji（`countryCodeToFlag()`，純用代碼機械轉換），刻意不使用資料庫內建的地名字串——地緣政治相關的地名命名可能有爭議，用代碼可以完全避開這個問題。

## Docker／Compose

Repo 目前**沒有任何 Dockerfile 或 compose.yaml**，部署完全走 systemd + VM。若有人要求「整理 Docker Compose 設定」，先確認清楚：這是要新建一套僅供本機開發/測試用的容器環境（不影響現有 systemd 部署方式），還是誤以為 repo 已經有相關設定——不要在沒問清楚的情況下憑空生出一套容器化部署。

## 常用指令

- `npm run dev` — nodemon 開發模式
- `npm start` — 正式啟動（純 `node`，不會自動 reload）
- `npm test` — jest
- `npm run migrate:run` — 執行 migrations/runner.js（見上方「高風險操作」，需先確認）
- `scripts/health-check.sh <PORT>` — 打 `GET /login` 驗證服務是否正常回應，`update.sh` 會自動呼叫，也可隨時手動執行
