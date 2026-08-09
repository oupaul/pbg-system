# pbg-system 技術文件撰寫資訊包（提供給 Claude Design）
> 本文件為輔助 Claude Code/Claude Desktop 理解專案的內部技術背景資料。
> 內容可能過時，正式狀態請以目前 Git branch、tag、程式碼與部署環境為準。
> 請勿將本文件發布到公開 repository。


> 本文件是給另一個 Claude 對話／工具用來撰寫正式技術文件的**資訊來源**，不是文件本身。
> 涵蓋整個系統：技術棧、架構、資料庫、所有功能模組、權限模型、部署方式，以及目前開發狀態。

---

## 1. 專案基本資訊

- **名稱**：`invoice-bonus-system`（`package.json` 內部名稱），對外顯示名稱「專案開立發票業績認列獎金計算總表系統」
- **一句話定位**：Node.js + SQLite 的專案管理、發票開立、業績獎金計算系統，後續擴充了完整的 CRM（客戶/銷售機會）前端流程
- **版本現況**：`package.json` 的 `version` 欄位停留在 `1.0.0`（未隨 git tag 更新，是個過時但無害的欄位）；實際功能版本以 git tag 為準，最新為 `v1.15.3`
- **語言**：全站繁體中文介面

## 2. 技術棧

| 類別 | 選型 |
|---|---|
| 執行環境 | Node.js 20.x（`node@22` 也可，開發機用 `/opt/homebrew/opt/node@22/bin`） |
| Web 框架 | Express 4 |
| 樣板引擎 | EJS 3（見下方「樣板寫法」說明，同專案混用兩種風格） |
| 資料庫 | SQLite（`better-sqlite3`，同步 API），單一檔案 `data/invoice_bonus.db` |
| Session | `express-session`（伺服器端 session，非 JWT） |
| 密碼雜湊 | argon2（新密碼）／bcrypt（相容舊資料）／sha256（更舊資料相容） |
| Email | nodemailer，通用 SMTP（非綁定特定服務商） |
| LINE 通知 | LINE Messaging API（webhook + push） |
| Excel 匯入匯出 | exceljs |
| PDF 產生 | pdfkit |
| 檔案上傳 | multer |
| 日期處理 | dayjs |
| 開發工具 | nodemon（`npm run dev`，**注意：正式啟動 `npm start` 用純 `node`，不會自動重載**） |
| 測試 | jest（設定存在，實際覆蓋率待確認） |

## 3. 專案目錄結構

```
src/
  app.js              # Express 進入點，掛載所有路由與中介層
  routes/             # 每個功能一個檔案，命名對應功能（見下方模組總覽）
  models/             # 資料存取層，直接寫 SQL（無 ORM），每個 model 對應一或多張表
  services/           # 商業邏輯／跨模組邏輯（通知、備份、Excel、PDF、毛利分析等）
  middleware/          # auth.js（登入驗證＋權限旗標注入）
  views/              # EJS 樣板，資料夾對應路由模組
  config/             # deploy.js（讀取 deploy.config.json，部署時客製化站名等）
  utils/               # 共用小工具（authHelper 等）
migrations/           # 增量 migration 腳本 + runner.js（見下方）
scripts/              # 維運腳本（清理附件、密碼工具等）
public/               # 靜態資源（js/main.js 含全域 showToast、通知輪詢等）
deploy.sh / setup.sh / update.sh / backup.sh / restore.sh / uninstall.sh / setup-backup-timer.sh
                       # 部署與維運腳本（見下方部署章節）
```

### 樣板寫法（重要，會影響任何要改頁面的人）

同一個專案混用兩種 EJS 寫法：

1. **多數頁面**：`<%- include('../layout', { body: \`...\` }) %>`——用 JS 樣板字面值（backtick）拼出整個 body，再丟給 layout 包版。這種寫法裡 `${...}` **不會自動 HTML escape**，所有輸出使用者可控資料的地方都要手動呼叫 escape 函式（很多既有頁面各自在檔案開頭定義一個 `escapeHtml`/`h`/`esc` 函式，寫法不完全一致）。
2. **少數頁面**（`layout.ejs`、`settings/index.ejs`、`reportGroups/index.ejs`、`projectTypes/index.ejs` 等）：用純 `<% %>` + `bodyHtml +=` 字串拼接建構整頁 HTML。
3. **`auth/login.ejs`、`backup-restore/index.ejs`**：用標準 EJS `<%= %>` 標籤（**這個會自動 escape**，是全站唯一真正安全預設的寫法）。

> 本次 session 才剛修過一輪全站的 XSS（詳見第 8 節），寫技術文件時如果要提到「輸出安全」，這個混用现況是重點素材。

## 4. 資料庫結構

無 ORM／schema 定義檔，schema 由 migrations 逐步建立。核心資料表：

| 資料表 | 用途 |
|---|---|
| `users` | 登入帳號，含 `role`（admin/user/salesperson/boss 或自訂角色）、`salesperson_id`（若本人也是業務員）、`email`/`line_user_id`（通知用） |
| `roles` | 角色權限定義（`can_edit`/`can_delete`/`can_manage_users`/`can_manage_roles`/`can_edit_crm` 等旗標），支援新增自訂角色 |
| `salespeople` | 業務員名冊（獨立於 users，一個 user 可綁定一個 salesperson） |
| `user_salesperson_access` | 「指定業務員」權限範圍用的授權對照表 |
| `projects` | 專案主表（專案編號、類型、金額未稅/含稅、業務員、客戶、簽約年月、預計開票年月、報表群組等） |
| `project_types` | 專案類型管理（顯示顏色、儀表板顯示與否、毛利警示閾值） |
| `project_templates` | 專案範本（快速建立常用專案設定） |
| `project_attachments` | 專案附件（軟刪除＋定期清理排程） |
| `invoices` | 發票（狀態、預計收款日、部分折讓、軟刪除） |
| `payments` | 收款紀錄（支援一張發票分多次收款、軟刪除） |
| `costs` | 專案成本 |
| `bonus_tiers` / `bonus_calculations` | 獎金級距與計算結果 |
| `revenue_recognition` | 業績認列 |
| `department_allocations` | 部門分攤（毛利分析用） |
| `report_groups` | 報表群組（多個專案合併彙總毛利） |
| `customers` | 客戶／廠商主檔（身份類型、等級、產業別、往來狀態、銀行資訊、客戶關係負責人） |
| `customer_creation_requests` | 新客戶／廠商送審佇列，可綁定一筆待建立的銷售機會一併送審／核准 |
| `pipelines` | 銷售機會（CRM，本次擴充的主要模組） |
| `activities` | 客戶活動紀錄（拜訪/電話/客訴/其他），含軟刪除審核 |
| `deletion_requests` | 通用刪除審核佇列（銷售機會、活動紀錄皆走此流程） |
| `notifications` | 站內通知中心 |
| `system_settings` | 全站設定 key-value（型別：string/number/boolean/json） |
| `system_logs` | 稽核紀錄 |
| `schema_migrations` | migration 執行紀錄（runner.js 用來判斷哪些要跑） |

**SQL Views（跨表彙總，供列表/儀表板查詢用）**：`v_project_summary`、`v_invoice_summary`、`v_bonus_summary`

### Migration 機制

- 新版：`migrations/runner.js` 內建 `MIGRATIONS` 陣列（依序執行，只能在陣列尾端新增，不可插入或調整既有順序），用 `schema_migrations` 表追蹤已執行項目；每個 migration 各自是獨立可執行的 `.js` 檔（`db.exec()`/`db.prepare()` 直接寫 SQL），執行方式 `node migrations/runner.js`，內部用 `execSync` 逐一以子行程跑每支腳本。
- 舊版：`migrations/migrate.js`、`migrate_users.js` 是專案早期的一次性 bootstrap 腳本（建表＋建預設管理員帳號），目前新環境的 schema 由這兩者之一起家，之後才交給 runner.js 接手增量演進。**這造成一個已知坑**：不同環境起家的 schema 版本不同，若某 migration 假設過嚴（例如寫死允許值的 CHECK 約束），可能在部分較舊環境炸掉（本次 session 才修過一個真實案例：`migrate_user_roles.js` 對 `role` 欄位下了寫死 CHECK 清單，遇到已存在自訂角色值的環境會直接失敗，已改為偵測「目前是否還有限制性 CHECK」而非比對特定角色名稱）。

## 5. 功能模組總覽

### 5.1 核心：專案／發票／獎金（系統最原始的功能）
- **專案管理**（`routes/projects.js`）：建立/編輯專案，含類型、業務員、客戶、金額、簽約年月、預計開票年月；發票/收款/成本/附件都掛在專案底下；支援報表群組彙總
- **發票管理**（`routes/invoices.js`）：狀態流轉、預計收款日、部分折讓、軟刪除＋還原
- **收款管理**（`routes/payments.js`）：一張發票可分多次收款，軟刪除＋還原
- **成本管理**（`routes/costs.js`）
- **業績獎金**（`routes/bonuses.js`）：獎金級距、計算、發放狀態
- **毛利分析**（`routes/grossProfit.js` + `GrossProfitAnalysisService`）：依類型/群組彙總、PDF 匯出、部門分攤
- **業務績效**（`routes/salesPerformance.js` + `SalesPerformanceService`）：業務員維度的統計圖表（Chart.js），含銷售機會預估營收
- **應收帳款帳齡**（`ReceivablesAgingService`）：全域搜尋＋收款提醒邏輯
- **近期收款**（`routes/recentPayments.js`）

### 5.2 CRM（本次擴充的完整前端業務流程）
- **客戶／廠商管理**（`routes/customers.js`、`models/Customer.js`）：身份區分（客戶/廠商/兩者皆是）、廠商類型（個人/公司）、等級、產業別、往來狀態、銀行資訊、客戶關係負責人（綁定使用者）
- **新客戶／廠商審核**（`routes/customerApprovals.js`、`models/CustomerCreationRequest.js`）：非管理員/專案管理員新增客戶需送審；支援「客戶＋銷售機會」一併送審、核准後同時建立兩者
- **銷售機會（Pipeline）**（`routes/pipelines.js`、`models/Pipeline.js`）：預估專案類型（複選）、預估金額、成交機率（10/30/50/100% 對應四個銷售階段）、預計成交月份；已成交可轉入正式專案（`converted_project_id`）；列表全欄位可排序，預設依成交機率高到低
- **客戶活動紀錄**（`models/Activity.js`）：拜訪/電話/客訴/其他，客戶詳情頁時間軸呈現
- **客戶追蹤提醒**（`ActivityReminderService`）：客戶超過 N 天無活動紀錄即提醒，天數可在系統設定調整（1–90 天，預設 14）
- **刪除審核**（`routes/deletionRequests.js`、`models/DeletionRequest.js`）：銷售機會、活動紀錄的刪除都需審核

### 5.3 通知中心與外部通知
- **站內通知**（`routes/notifications.js`、`models/Notification.js`、`NotificationService`）：事件觸發（審核送出/核准/駁回、銷售機會 CRUD、活動新增）＋系統提醒（客戶追蹤逾期、開票提醒）兩種來源；導覽列鈴鐺輪詢
- **Email 通知**（`EmailService`）：通用 SMTP，支援自簽憑證環境（可關閉憑證驗證）、系統網址設定（讓信件連結顯示完整網址而非相對路徑）、主旨自動帶部署設定的站名、內文為結構化摘要
- **LINE 通知**（`LineService`、`routes/lineWebhook.js`）：LINE Messaging API 推播＋webhook（簽章驗證＋自助取得 User ID）
- **通知收件人設定**：管理員可指定哪些使用者接收銷售機會/活動異動通知

### 5.4 權限與系統管理
- **角色管理**（`routes/roles.js`、`models/Role.js`）：內建 admin/user/salesperson/boss，可新增自訂角色，權限旗標：`can_edit`、`can_delete`、`can_edit_crm`、`can_manage_users`、`can_manage_roles`
- **使用者管理**（`routes/users.js`、`models/User.js`）：綁定業務員、指定業務員存取範圍（`user_salesperson_access`）、Email/LINE 通知欄位
- **權限範圍**（`project_view_scope`）：`ALL`（全部）／`OWN`（僅自己負責）／`ASSIGNED`（指定業務員）／`NONE`，套用在專案、客戶、銷售機會金額的可見範圍
- **系統設定**（`routes/settings.js`）：開票提醒天數、閒置自動登出、附件清理保留天數、客戶追蹤提醒天數、Email/LINE 設定、通知收件人、系統對外網址
- **稽核紀錄**（`routes/auditLogs.js`、`AuditLogService`）：關鍵操作的異動紀錄與匯出
- **系統健康檢查**（`routes/health.js`）

### 5.5 其他輔助模組
- **匯入／匯出**（`routes/importExport.js` + `ExcelExportService`/`ExcelImportService`）
- **專案類型管理**（`routes/projectTypes.js`）、**專案範本**（`routes/projectTemplates.js`）、**報表群組**（`routes/reportGroups.js`）
- **搜尋**（`routes/search.js`）：全域搜尋
- **備份還原**（`routes/backupRestore.js` + `BackupRestoreService`/`BackupProgressService`/`NasConfigService`）：手動備份、Systemd Timer 排程自動備份、NAS 異地備份（SSH/rsync）

## 6. 權限模型摘要

角色（`role`）決定：能否編輯財務資料（`can_edit`）、能否刪除（`can_delete`）、能否編輯 CRM 資料（`can_edit_crm`，業務開發權限獨立於財務唯讀限制之外）、能否管理使用者/角色。
`project_view_scope` 決定看得到哪些人的專案/客戶/銷售機會金額（業務員預設只看自己，可設定為看指定業務員或全部）。
客戶/廠商列表本身對所有登入者開放瀏覽，只有「金額」欄位依權限範圍過濾。

## 7. 部署與維運

```
setup.sh              # 全新主機一鍵安裝（從 GitHub 一行指令）
deploy.sh             # 本機部署（首次安裝互動式設定服務名稱/目錄/port；後續增量更新）
update.sh             # 從安裝目錄更新到最新版（rsync 同步、保留 data/ 與 uploads/，跑增量 migration）
backup.sh             # 手動備份
restore.sh            # 互動式還原（本機或 NAS 備份）
setup-backup-timer.sh # 設定 Systemd Timer 自動每日備份
uninstall.sh          # 自動備份後移除
```

- 執行環境：Ubuntu 24.04 LTS（推薦）、Node.js 20.x、512MB 記憶體/1GB 硬碟以上
- 服務以 systemd 管理；`deploy.config.json`（gitignored）存放每個部署環境客製化的站名/port 等，由 `src/config/deploy.js` 讀取

## 8. 目前開發狀態（撰寫文件時的時間點資訊）

- **分支**：`main`（正式）、`develop`（開發整合，目前與 main 內容一致）、`fix/crm-xss-escaping`（本次 session 建立，領先 develop 2 個 commit，**尚未合併**）
- **最新已合併內容（develop/main）**：完整 CRM 前端流程（客戶審核、銷售機會、活動紀錄、通知中心、Email/LINE、系統網址設定、客戶追蹤提醒設定、銷售機會列表排序），對應 PR #5（已合併），另有 `migrate_user_roles.js` 的相容性修正
- **`fix/crm-xss-escaping` 分支內容（未合併）**：
  1. 銷售機會/客戶頁面的儲存型 XSS 修正（`opportunity_name`、`customer_name`、`salesperson_name`、`customer_code`、`company_name` 等自由文字欄位輸出未跳脫）
  2. 全站 `?error=`/`?success=` 反射型 XSS 修正（19 個檔案，橫跨全系統多數功能模組，非僅 CRM）
- **文件現況**：`README.md` 已刻意簡化為純部署手冊（不含功能說明）；另有 40+ 份各功能的獨立說明文件（`*.md`，多為過去逐一功能上線時所寫，未系統化整理，也沒有涵蓋本次 CRM 擴充與這次的安全性修正）；本次 session 已補寫一份 `CRM銷售機會與客戶管理功能說明.md`

## 9. 撰寫技術文件時建議涵蓋/留意的重點

- 系統整體定位與模組地圖（第 5 節）是主幹，建議文件先建立「發票獎金核心」vs「CRM 前端流程」兩大主軸再往下細分
- 樣板寫法混用（第 3 節）與最近的 XSS 修正（第 8 節）是「程式碼品質/安全」章節的好素材
- migration 機制與已知的新舊 schema 落差（第 4 節）是「維運/升級注意事項」章節的好素材
- 現有 40+ 份散落文件內容可以整併引用，避免重新造輪子；`README.md` 保持精簡是刻意決策，不建議把功能說明塞回去
