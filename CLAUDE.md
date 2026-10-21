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
- 停服務時的 `kill -9`（含首次安裝那個分支，以及 `restore.sh`、`uninstall.sh`）現在只看「監聽」該 port 的程序（`lsof -sTCP:LISTEN`，連到該 port 的用戶端如 SSH 通道不算），並先確認指令包含 `app.js`（`uninstall.sh` 要求是本安裝目錄的 `src/app.js`）才殺，且都改用 `${PORT}` 而非寫死 3000；驗證失敗會停止部署並印出 PID／指令，不會誤殺無關程序
- 依賴以 `package-lock.json` 鎖定（已提交，不再 gitignore），部署使用 `npm ci` 讓每家公司的主機得到完全相同的版本；有鎖定檔時**不會**在主機上自動 `npm audit fix`（會讓各主機版本漂移）——漏洞請在開發環境執行 `npm audit fix`、測試後提交更新的鎖定檔，需要在主機強制執行時設定 `RUN_AUDIT_FIX=1`；沒有鎖定檔時維持舊行為（`npm install` + 自動 audit fix，`SKIP_AUDIT_FIX=1` 可略過）。`package.json` 有 `engines`（Node >=20 <25）與 `.nvmrc`（22）；Node 26 與 better-sqlite3 的 ABI 不相容
- 部署前的資料庫備份與 `migrations/runner.js` 執行前的快照（`data/invoice_bonus.db.pre-migrate-*`，保留最近 3 份，`SKIP_MIGRATION_SNAPSHOT=1` 可略過）都改用 SQLite 線上備份（`.backup`／`VACUUM INTO`），並檢查 `PRAGMA integrity_check`；備份失敗就中止，不再在沒有備份時變更資料庫。`runner.js` 遇到第一個失敗的 migration 就停止，不再繼續執行後面可能依賴它的 migration

## 服務執行帳號（非 root）與特權輔助程式

- `deploy.sh`（含 `update.sh` 呼叫的部署）預設讓服務以**專用的系統帳號**執行（帳號名稱預設等於服務名稱，記錄在 `deploy.config.sh` 的 `SERVICE_USER`），不再是 root：萬一應用程式被入侵，影響範圍只有資料庫與附件，不會直接取得整台主機。條件不足時（安裝目錄不在 `/opt`、沒有 `visudo`/`useradd`、`/etc/sudoers` 沒啟用 `sudoers.d`）自動退回 root 並印出原因。緊急退回：`sudo SERVICE_RUN_AS=root bash deploy.sh`（會記錄到 `deploy.config.sh`，之後的更新維持 root；改回專用帳號用 `SERVICE_RUN_AS=dedicated`）。舊安裝第一次更新時會自動升級（重寫 unit、建立帳號、修正擁有者）
- 檔案權限：安裝目錄與全部程式碼 `root:root` 且 group/其他人不可寫（服務帳號不能改自己的程式碼，也不能竄改要以 root 執行的腳本）；`data/`、`uploads/`、`nas_config.json` 歸服務帳號（700/600）；備份目錄 `root:<服務帳號群組>` 750，備份檔 640（網頁可列出/下載，但**不可寫入或植入備份檔**）。`restore.sh` 還原後會把 `data/`、`uploads/` 擁有者改回服務帳號；`backup.sh` 會維持備份目錄/檔案的群組權限。新增「應用程式需要寫入」的路徑時，要在 `deploy.sh` 的 `apply_service_permissions` 與 `restore.sh` 一併處理擁有者
- systemd 防護：`UMask=0077`、`PrivateDevices`、`ProtectSystem=full`、`ProtectHome=read-only`、`ProtectKernel*`、`ProtectControlGroups`、`RestrictRealtime`、`LockPersonality`。**刻意沒有** `NoNewPrivileges`（服務要用 sudo 呼叫輔助程式）、`PrivateTmp`（還原程序的日誌寫在 `/tmp`，要與服務共用）、`ProtectSystem=strict`（備份腳本要寫備份目錄）
- 需要 root 的動作（備份、還原、刪除備份、測試 NAS 連線）一律走 `scripts/pbg-privileged.js`：`sudo -n <node> <安裝目錄>/scripts/pbg-privileged.js <動作> <參數>`，網頁端用 `src/services/PrivilegedClient.js` 呼叫。sudoers（`/etc/sudoers.d/<服務名稱>`，由 `deploy.sh` 以 `visudo -cf` 驗證後安裝）**只允許這一條指令**。輔助程式把呼叫者視為不可信：參數全部白名單驗證（備份檔名、操作 ID 格式）、不經 shell、不繼承環境變數、日誌檔以 `O_EXCL|O_NOFOLLOW` 由 root 建立，且**執行前先檢查安裝目錄內會被 root 載入/執行的檔案都是 root 擁有、不可被 group/其他人寫入、不是符號連結**（否則拒絕）。輔助程式與它載入的模組**不可以載入資料庫**（以 root 開資料庫會產生 root 擁有的 `-wal`/`-shm`）。新增特權動作時：在 `parseInvocation` 加白名單、更新 `tests/privilegedHelper.test.js`、不要放寬 sudoers 規則
- 這些流程在 DEV01 實測過：舊安裝升級、首次安裝（另開一個獨立實例）、緊急退回 root 再切回、網頁端備份/下載/刪除/還原/NAS 測試（在與正式服務相同的 systemd 沙盒設定下以服務帳號身分執行）、定時備份的檔案權限

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
- 角色旗標已實際強制：`can_manage_users`（`requireAdmin`：使用者、修改記錄、登入紀錄、系統健康、廣播通知、客戶匯入匯出）、`can_manage_roles`（`requireManageRoles`：角色管理）、`can_manage_settings`（`requireManageSettings`：系統設定與各類選項／類型／狀態／簽核關卡管理、分頁圖示）、`can_backup_restore`（`requireBackupRestore`：備份還原）、`can_import`（`requireImport`：專案總表／成本明細批次匯入，另需通過 `/import-export` 的 `can_edit` 檢查；客戶/廠商與活動紀錄匯入仍用 `requireAdmin`，因為它們直接建立資料、繞過新客戶審核），皆由 `requireRoleFlag` 產生，內建 `admin` 角色永遠放行（防止角色被改壞後無人能進管理頁）。沒有 `can_manage_users` 的角色管理者不能授予或移除「使用者管理」旗標（避免自行提權）。`migrate_role_admin_flags` 會把既有 `can_manage_users=1` 角色的其餘三個旗標補成 1，讓升級前後行為一致；新增管理頁面時請選對應的 middleware，不要一律用 `requireAdmin`
- 上傳驗證（`src/utils/uploadValidation.js`）：附件採副檔名白名單且檔頭必須與副檔名相符（html/svg/js/exe/sh 與含巨集的 .xlsm/.docm 都不在白名單），Excel 匯入只接受結構正常的 .xlsx（含 zip bomb 檢查）；新增上傳端點請用 `guardedSingleUpload`，不要直接 `upload.single()`。路由順序注意：`/batch-*` 這類固定路徑必須定義在 `/:id` 之前
- 儀表板「本月概況」（`src/services/DashboardSummaryService.js`、`src/views/partials/dashboard-monthly.ejs`）：本月 vs 上月的開票／收款／新簽專案、逾期未收、進行中銷售機會（狀態不是 `is_won`/`is_lost` 的機會，加權金額 = 預估金額 × 成交機率），以及近 12 個月開票/收款長條圖（`src/utils/dashboardChart.js` 於伺服器端產生 SVG，不依賴前端圖表函式庫）。範圍規則與儀表板其他區塊相同（業務員只看自己、排除「獨立加總」類型）；逾期卡片與銷售機會卡片只對有對應權限的角色顯示。收款金額算法與 `Payment.calculateActualReceived` 一致（只有差異類型為「匯費」才把差異算進去）
- 逾期收款自動提醒（`src/services/OverdueReminderService.js`，設定在「系統設定」頁、`migrate_overdue_reminder` 建立設定，**預設停用**）：程序內排程（`app.js` 啟動時 `start()`，每 5 分鐘檢查；不需額外 systemd timer）。到設定時間且當天沒跑過就執行：每週一（錯過會在滿 7 天後補發）或週一至週五每天；先寫入 `overdue_reminder_last_run_date` 再發送以避免重複。資料來源是 `ReceivablesAgingService.getPaymentReminder`（預計收款日已過／N 天內到期且未收齊），彙整成**一則**訊息：負責業務綁定的使用者只收到自己的發票，`overdue_reminder_notify_user_ids` 指定的財務/主管收到全公司彙總（依業務分組）。透過 `NotificationService.notify` 發送（類型 `payment_overdue_digest` 在 `EXTERNAL_CHANNEL_TYPES` 內，所以有填 Email/LINE ID 且管道已啟用者會外送）。設定頁有「發送測試給我自己」按鈕，不影響排程。沒有逾期或即將到期的發票時不發送
- 匯入前預覽（`src/utils/importFlow.js`、`importStaging.js`、`importSummaries.js`、`views/import-export/preview.ejs`）：專案總表、成本明細、客戶/廠商、活動紀錄四種 Excel 匯入都是「上傳 → 試跑預覽 → 確認才寫入」。試跑是把整批匯入包在交易裡、最後 `ROLLBACK`（`ExcelImportService` 的 `{ dryRun: true }`），所以去重判斷與逐列驗證和正式匯入完全相同，預覽數字等於實際結果；匯入路徑上不可以加資料庫以外的副作用（寄信、寫檔、外部呼叫），否則試跑會真的觸發。上傳檔暫存於 `uploads/import-staging/<token>.xlsx`（600 權限、僅建立者本人與同類型可取用、30 分鐘失效、確認時 `claim` 只能取一次避免重複匯入）。確認匯入時會先用 `VACUUM INTO` 保存資料庫快照（`utils/dbSnapshot.js`，`data/invoice_bonus.db.pre-import-<時間>`，600 權限，保留最近 5 份；快照失敗就中止匯入、暫存檔保留可重試）；要還原時停服務，把快照複製回 `data/invoice_bonus.db`、刪除 `-wal`/`-shm`，再啟動（會連同快照之後的所有修改一起退回，只當緊急手段）。新增匯入類型請用 `mountImportFlow`，不要自己寫直接寫入的上傳端點；匯入服務新增的資料一定要在單一交易內完成。專案匯入的 `results.salespeople/customers` 是「處理列數」，真正新增的筆數看回傳的 `created`
- 專案檢視範圍（`getVisibleSalespersonIds`）要套用到**所有**會列出專案相關資料的地方，不只專案列表：近期收款、儀表板應收帳齡（`getAgingReport` 的 `onlySalespersonIds`）都曾漏掉而洩漏他人資料；全公司範圍的匯出報表（`/import-export/export/*`）一律要求範圍為「全部」（`requireFullProjectScope`）。整合測試的 `03_projectScope` 會檢查這些頁面，新增列出資料的頁面請一併加進去
- 轉介紹獎勵的可見範圍（`models/ReferralReward.js` 的 `scopeClause`）：專案檢視範圍為「全部」不限制；其他角色只看得到 ①領取人是自己的獎勵 ②有關聯專案且專案在自己範圍內的獎勵 ③沒有關聯專案且介紹人（客戶）的客戶關係負責人是自己的獎勵。因「領取人是自己」而可見、但專案在範圍外的列，會遮蔽專案編號與名稱。`findAll`/`findByCustomer` 的 `user` 參數必填（沒傳視為沒有權限，不是不限制）；修改/刪除前用 `isVisibleTo`，新增或改關聯專案時專案必須在範圍內。目前表單不提供「關聯專案」欄位，所以多數獎勵是客戶層級（沒有專案），業務員只看得到自己負責客戶的。測試見 `tests/integration/06_referralRewards.test.js`
- 發票號碼唯一性：同一個號碼同時只能有一張「有效」發票（忽略大小寫與前後空白；已作廢、已刪除的不佔用，所以作廢重開可以沿用同號碼；不分專案）。三層防護：`Invoice.create/update/restore` 先檢查並給友善錯誤（`findActiveByNumber`／`assertNumberAvailable`）；資料庫部分唯一索引 `idx_invoices_number_active`（`migrate_invoice_number_unique` 建立）作最後防線；Excel 匯入時同專案已有相同號碼的有效發票視為重複略過、其他專案已使用則該列失敗。既有資料若已有重複，migration **不會中斷部署也不會改資料**，只列出重複清單並略過建索引（應用程式層的檢查仍生效）；人工處理後執行 `node scripts/check-invoice-duplicates.js --create-index`（不加參數只列出重複）。新增任何會寫入 `invoices.invoice_number` 的路徑都必須走 `Invoice.create/update`，不要直接寫 SQL
- 資料保留與自動清理（`services/DataRetentionService.js`，設定在「系統設定」頁、`migrate_data_retention`）：修改記錄（`system_logs`）、登入紀錄（`login_history`）、已讀通知可設定保留天數，**全部預設 0＝不清理**（修改記錄是稽核證據、登入紀錄是資安紀錄，由管理員依公司規定決定）；天數必須是 0 或不小於最小值（修改記錄與登入紀錄 30、已讀通知 7）且不超過 3650，設定值不合法一律視為不清理；未讀通知永遠不清理。程序內排程每 30 分鐘檢查，每天 3:30 之後執行一次（先寫入 `retention_last_run_date` 再刪，分批 5000 筆），並留一筆 `retention_cleanup` 修改記錄；設定頁有各項目的目前筆數、最舊日期、「依目前設定將清理」筆數與「立即清理一次」按鈕（需「系統設定」權限）。注意：專案附件的軟刪除清理（`attachment_cleanup_retention_days`）是另一套、仍需手動或 cron 執行 `npm run cleanup:attachments`，不在這個排程內
- 雙因素驗證（TOTP，`models/TwoFactor.js`、`routes/account.js`、`utils/totp.js`、`utils/secretBox.js`；`migrate_two_factor`）：用 Node 內建 crypto 實作 RFC 6238（SHA-1、6 位數、30 秒、前後各容許一步），沒有新增 npm 依賴；QR code 由瀏覽器端的 vendored `public/vendor/qrcode/`（qrcode-generator 1.4.4，MIT）畫出，密鑰不經過任何外部服務。**預設沒有任何人啟用、沒有任何角色強制**，升級不影響登入；管理員在「角色管理」對角色勾選「強制雙因素驗證」（`roles.require_2fa`）後，該角色尚未啟用的使用者登入後會被導向設定頁（`enforceTwoFactorSetup`，優先順序在強制改密碼之後），已啟用者不可自行停用。使用者可在右上角選單「帳號安全」自行啟用/停用/重新產生復原碼（停用與重新產生需要目前密碼＋驗證碼）。
  - 登入流程：密碼正確後若已啟用，`session.pending2fa`（5 分鐘，沒有 `session.user`）→ `/login/2fa` 輸入驗證碼或復原碼 → `finishLogin`（登入紀錄與 session 換發都在這一步之後）。防護：驗證碼失敗有獨立的帳號鎖定計數器（5 次鎖 15 分鐘，與密碼失敗**分開**，避免有人用假帳號名稱鎖住別人）、`totp_last_step` 以條件式 UPDATE 防重放（同一時間步只能成功一次，含並行請求）、復原碼每組只能用一次（條件式 UPDATE）。
  - 儲存：`users.totp_secret` 以 AES-256-GCM 加密（金鑰由 `SESSION_SECRET` 經 HKDF 衍生）；復原碼只存帶金鑰的 HMAC 雜湊，產生時只顯示一次。**`SESSION_SECRET` 不同的主機（例如把備份還原到全新安裝、或開發環境每次啟動隨機）會解不開密鑰 → 登入直接拒絕（fail closed，不會放行），該使用者必須由管理員重設。** 重設方式：使用者列表的「重設」按鈕（需使用者管理權限，會留稽核記錄並通知該使用者）；若所有管理員都進不去，在主機上以服務帳號執行 `sudo -u <服務帳號> node scripts/reset-2fa.js <使用者名稱>`（不要直接用 root，避免產生 root 擁有的資料庫暫存檔）。
  - 新增會建立 session 的登入路徑時，必須經過 `finishLogin`／第二步驗證，不可自行寫 `req.session.user`。測試見 `tests/integration/08_twoFactor.test.js`（含 RFC 測試向量的單元測試 `tests/totp.test.js`）
- 專案時間軸（專案頁的「時間軸」分頁；`models/ProjectTimeline.js` 查詢、`utils/projectTimeline.js` 把修改記錄轉成易讀事件、`views/projects/timeline.ejs` 為 HTML 片段、端點 `GET /projects/:id/timeline`）：資料來源是 `system_logs`（專案、發票、收款、成本、獎金、附件），子表的記錄以 `record_id` 對到該專案的列，已被永久刪除的記錄則由記錄內容裡的 `project_id` 找回（`json_valid` 保護，壞掉的 JSON 不會讓查詢失敗）；沒有「新增」修改記錄的資料（記錄功能上線前、或直接匯入資料庫的）以資料本身的 `created_at` 補一個「新增」事件。系統每次儲存都會記一筆更新，沒有實際欄位變動的更新不顯示。可見性：必須通過專案範圍檢查（`requireProjectScopeFromParam`）；**獎金事件只有 `canEdit` 的角色看得到**（與專案頁獎金分頁一致）；篩選種類與游標都會驗證，不認得的值忽略。**id 重用**：資料被永久刪除（資料保留清理）後 SQLite 會重用 id，所以記錄用 record_id 歸屬時另有兩道防護——記錄內容的 `project_id`（字串或數字都轉成整數比較）必須等於本專案、記錄時間不能早於該筆資料的 `created_at`；同一秒內重用 id 仍分不出來（殘留限制，實務上幾乎不會發生）。所有顯示文字由 EJS 跳脫。新增會寫入 `system_logs` 的資料表、並希望出現在時間軸時，在 `utils/projectTimeline.js` 的 `TABLES` 加入欄位中文名稱，並在 `ProjectTimeline.js` 的 `CHILD_TABLES` 登記（該表要有 `project_id` 欄位）。測試見 `tests/projectTimeline.test.js` 與 `tests/integration/09_projectTimeline.test.js`
- 附件線上預覽（專案頁）：以檔案內容（魔術位元組）判斷類型，不信任副檔名/MIME；SVG/HTML 一律不預覽。圖片/PDF/文字/CSV 由伺服器供應；Word（.docx）、Excel（.xlsx）由瀏覽器端解析（mammoth 為 `public/vendor/mammoth/` 內的 vendored 檔案，ExcelJS 由 `/vendor/exceljs/exceljs.min.js` 提供），伺服器只驗證 OOXML ZIP 結構（防 zip bomb：條目數／解壓總量上限）並以 `application/octet-stream` 回傳原始位元組（`/projects/:id/attachments/:attachmentId/office`）。Word 預覽經白名單消毒（`public/js/attachment-preview.js`），Excel 一律用 `textContent`；舊版 .doc/.xls 不支援預覽，只能下載
- 自動測試：`npm test` 跑兩組（jest projects）。`unit`（`tests/*.test.js`）是不碰資料庫的純函式測試；`integration`（`tests/integration/`）是**權限整合測試**：`globalSetup` 把 `src/migrations/scripts/public` 複製到系統暫存目錄、在那裡建全新資料庫、灌入種子資料（12 種角色/使用者 × 業務 A、B 各一套專案與財務資料）並啟動真正的伺服器，測試再用 HTTP 打它，**不會碰到真實的 `data/` 與 `uploads/`**。涵蓋：未登入掃描（每條路由除明確列出的公開路由外都必須被擋下，用注入在「複製版」app.js 的 `/__test/routes` 取得路由清單）、角色 × 端點權限矩陣、變更類路由的「寫入面」凍結（老闆／業務員實際能打到的 POST 必須剛好等於清單）、專案範圍 IDOR（含列表、匯出、儀表板不洩漏他人資料）、CSRF Origin、登入鎖定與 session 失效、角色提權防護、附件與匯入的上傳驗證、匯入預覽/確認/快照流程。需要 better-sqlite3 能在目前的 Node 載入（`.nvmrc` 為 22；Node 版本不符時整組整合測試自動略過並印警告，不會失敗）。`npm run test:unit` / `npm run test:integration` 可分開跑。**新增路由或權限規則時請同步更新**：新的公開路由要加進 `01_routeAuth` 的 `PUBLIC`，新的權限端點加進 `02_permissionMatrix` 的 `ENDPOINTS`；老闆／業務員的「寫入面」清單變動前先確認真的該開放。這些測試用「刻意弄壞再確認會失敗」驗證過（拿掉 requireAuth、範圍檢查、CSRF、快照等）
- 獎金對帳單（獎金頁「獎金對帳單」按鈕；端點 `GET /bonuses/statement?salesperson_id=&year=&period=`，period 為 `year`／`q1`～`q4`／`m1`～`m12`）：單一業務、單一期間的 PDF（A4 橫式），供發放前業務與財務簽核。純邏輯在 `utils/bonusStatement.js`（期間解析、分組、合計、編號、檔名），版面在 `utils/bonusStatementPdf.js`，查詢與組裝在 `services/BonusStatementService.js`。**分組規則**：「本期已發放」＝狀態已發放且發放日在期間內；「本期充公」＝狀態充公且（發放日，沒有時用最後更新日）在期間內；「待發放」＝所有待發放獎金，**不受期間限制**（發放前讓業務確認還有哪些沒發）；其餘不列入。每份對帳單有編號 `BS-<業務ID>-<期間>-<產出時間>`，每次產出都寫一筆 `system_logs`（action=`generate_statement`、table_name=`bonus_statements`、record_id=業務 ID，內容含編號、筆數、合計；**不可用 `bonus_calculations` 當表名**，否則專案時間軸會把業務 ID 當成獎金 ID 誤認）。**權限**：與獎金頁一致，用 `getVisibleSalespersonIds` 限制，業務只能產出自己（範圍外 403，且不寫稽核）；參數不合法回 400；回應 `Cache-Control: private, no-store`。**字型**：專案內建 `fonts/NotoSansCJKtc-Subset-Regular.otf`（繁體常用字子集，授權見 `fonts/OFL.txt`，重新產生方式見 `fonts/README.md`），罕用字會顯示成方框；放入完整字型到 `fonts/` 時優先使用（`PdfExportService.getChineseFontPath`）。日期依 `date_calendar_system`（民國／西元），幣別取 `currency_symbol`，公司名稱取 `company_name`。測試見 `tests/bonusStatement.test.js` 與 `tests/integration/10_bonusStatement.test.js`
- 金額精度（`utils/money.js`）：金額欄位在資料庫是 REAL（浮點數），`0.1 + 0.2` 會是 `0.30000000000000004`，曾造成「分次收款剛好收齊」被判成未收、畫面顯示紅色「未收 $0」。規則：**寫入前**一律用 `toMoney()`（去千分位逗號、四捨五入到 2 位小數；路由與 model 都用，不要再直接 `parseFloat` 金額）；**加總或相減後**用 `round2()`／`sumMoney()` 再比較大於／小於零；SQL 裡比較未收金額用 `ROUND(..., 2)`；視圖（`v_project_summary`、`v_invoice_summary`）查出的列用 `roundMoneyFields()` 收斂（它依欄位名稱判斷哪些是金額，百分比／比率／筆數不動）。百分比、機率欄位不是金額，不要套用。**沒有**對既有資料做改寫的 migration（讀取端已會收斂）。測試見 `tests/money.test.js` 與 `tests/integration/11_moneyPrecision.test.js`
- 批次刪除／還原發票與收款（專案頁的發票明細、收款明細分頁，勾選後出現「刪除選取／還原選取」；端點 `POST /invoices/batch-delete|batch-restore`、`POST /payments/batch-delete|batch-restore`，邏輯在 `utils/batchOps.js` 的 `runBatch`）：刪除是軟刪除（可再批次還原）；**整批必須是同一個專案**、專案要在使用者範圍內（`userCanAccessProject`，先全部檢查再動手）、需要編輯權限、一次最多 200 筆、ids 只接受正整數；**全有或全無**——整批包在 `db.transaction` 裡，任何一筆失敗（例如還原時發票號碼已被另一張有效發票使用）整批復原，稽核紀錄一起復原；已是目標狀態的資料略過並在訊息中說明；有變動時清除儀表板快取。**這兩組路由必須定義在 `/:id` 之前**，否則會被 `/:id` 當成 id 吃掉而回 404。完成後導回 `#pane-invoices`／`#pane-payments` 分頁（頁面載入完成後才切換，因為 Bootstrap 在頁面後段才載入）。專案本身（硬刪除）與成本（硬刪除）刻意**沒有**批次刪除。表格的勾選框用 `form="invBatchForm"` 屬性關聯到表格外的獨立表單，避免巢狀 form。測試見 `tests/integration/12_batchOps.test.js`（批次測試要用自己的專案，不要往共用專案塞事件——時間軸測試每頁只看前 30 筆）
- 轉介紹獎勵的「建立者」（`referral_rewards.created_by_user_id`，migration `migrate_referral_rewards_created_by`）：新增時由伺服器依登入者帶入（`routes/referralRewards.js` 傳 `createdByUserId`，**不讀表單欄位**，偽造無效），總覽頁與客戶詳情頁顯示建立者姓名與建立日期；使用者被刪除時欄位設為 NULL。既有資料由 migration 從 `system_logs` 的建立記錄補：記錄裡的 `user_info` 是姓名，**只有姓名剛好對到唯一一位使用者才補**，同名、查無此人、沒有建立記錄的一律留空（顯示「-」），不亂猜。測試見 `tests/integration/13_referralCreator.test.js`
- 雙因素驗證「信任此裝置」（`models/TrustedDevice.js`、`utils/cookies.js`、migration `migrate_two_factor_trusted_devices`、資料表 `trusted_devices`）：登入第二步勾選「在這台裝置上信任 N 天」，通過驗證碼後發 `pbg_td` cookie（HttpOnly、SameSite=Lax、HTTPS 時 Secure、32 位元組隨機值），期間內該裝置密碼通過後略過第二步（`routes/auth.js` 登入處理）。資料庫只存帶金鑰的雜湊（`secretBox.keyedHash`），憑證**綁定使用者**（A 的憑證對 B 無效）、**固定到期日**（不因使用延長）、每人最多 10 台（超過刪最舊）。**不發憑證**：沒勾選、驗證碼錯誤、用復原碼登入（多半是手機遺失）。**一律失效**（`revokeAll`）：改密碼（`User.updatePassword`，登入時舊雜湊升級成 argon2id 傳 `keepTrustedDevices: true` 不算）、停用／管理員重設／重新啟用 2FA（`TwoFactor.clear`／`enable`）、帳號被停用（`User.update` 的 `is_active`）。使用者在「帳號安全」可看到清單（標示目前這台）、撤銷單台或全部。系統設定 `two_factor_trust_days`（預設 30、0–90，**0 = 停用此功能**：不顯示勾選、不發憑證、既有憑證也不再被接受；改回後仍在效期內的憑證恢復有效）。信任只略過第二步驗證碼，不影響密碼、帳號鎖定、角色強制 2FA 的要求。稽核動作：`2fa_device_trusted`、`2fa_skipped_trusted_device`、`2fa_device_revoked`、`2fa_devices_revoked_all`。測試見 `tests/integration/14_trustedDevice.test.js`（每個測試用各自的 `u_td_N` 使用者，因為驗證碼防重放是逐人計算）
- `User.findById` 只找啟用中的帳號；管理員要處理可能已停用的帳號（重新啟用、重設 2FA）請用 `User.findByIdAnyStatus`（原本停用後的「啟用」按鈕會 404）

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
- `npm test` — jest（單元＋權限整合測試；整合測試需 Node 22，見上方「自動測試」）
- `npm run test:integration` — 只跑權限整合測試
- `npm run migrate:run` — 執行 migrations/runner.js（見上方「高風險操作」，需先確認）
- `scripts/health-check.sh <PORT>` — 打 `GET /login` 驗證服務是否正常回應，`update.sh` 會自動呼叫，也可隨時手動執行
