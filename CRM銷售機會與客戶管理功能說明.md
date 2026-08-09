# CRM：銷售機會、客戶審核與通知中心功能說明

## 📋 功能概述

本次擴充在既有的專案/發票/獎金系統上，加入一套完整的**業務前端 CRM 流程**：

客戶/廠商管理 → 銷售機會（潛在商機）追蹤 → 客戶活動紀錄 → 轉入專案，並搭配**審核機制**（新增客戶、刪除資料皆需審核）與**站內＋Email／LINE 通知中心**，讓業務人員、專案管理員、系統管理員之間的協作與追蹤有完整紀錄。

開發分支：`feature/pipeline-form-and-customer-approval`（[PR #5](https://github.com/oupaul/pbg-system/pull/5)，尚未合併至 `develop`）。

---

## 🗂️ 資料庫異動總覽（migrations）

| Migration 檔案 | 用途 |
|---|---|
| `migrate_crm_pipeline_activity` | 建立 `pipelines`（銷售機會）、`activities`（客戶活動紀錄）資料表 |
| `migrate_customer_contact_owner` | 客戶新增聯絡人、負責業務欄位 |
| `migrate_customer_level_industry_status` | 客戶等級／產業別／往來狀態欄位 |
| `migrate_crm_edit_permission` | 角色新增 `can_edit_crm` 權限旗標 |
| `migrate_deletion_requests` | 刪除審核（銷售機會／活動紀錄）資料表 |
| `migrate_customer_vendor_party_type` | 客戶／廠商身份與廠商類型（個人／公司）欄位 |
| `migrate_customer_bank_info` / `migrate_customer_address` | 銀行帳戶、地址欄位 |
| `migrate_customer_owner_to_user` / `migrate_pipeline_owner_user` | 「負責業務」欄位從業務員表改綁使用者（客戶關係負責人） |
| `migrate_customer_creation_requests` | 新客戶／廠商審核佇列 |
| `migrate_customer_request_pipeline_bundle` | 審核佇列支援「客戶＋銷售機會」一併送審與核准後同時建立 |
| `migrate_notifications` / `migrate_notification_channels` | 站內通知中心資料表、Email／LINE 使用者欄位與系統設定 |
| `migrate_business_event_notify_recipients` | 銷售機會／活動紀錄異動的通知收件人設定 |
| `migrate_smtp_reject_unauthorized` | SMTP 憑證驗證開關（因應內部自簽憑證郵件伺服器） |
| `migrate_system_base_url` | 系統對外網址設定（讓通知連結顯示完整網址） |
| `migrate_activity_reminder_days`（已存在，本次新增對應設定頁 UI） | 客戶追蹤提醒天數 |

執行方式：`node migrations/runner.js`（依 `schema_migrations` 表追蹤，只跑尚未執行過的項目）。

---

## 1. 客戶／廠商管理

- 身份區分：客戶／廠商／兩者皆是；廠商再分個人／公司類型
- 欄位：客戶編號、統一編號、公司名稱、聯絡人（對方窗口）、聯絡電話／信箱、銀行名稱／帳號、地址、客戶等級（A/B/C）、產業別、往來狀態（往來中／暫停往來／已流失）
- **客戶關係負責人**：綁定「使用者」（非業務員表），下拉選單排除系統管理員
- 列表／詳情頁支援全欄位排序（`sortBy`/`sortOrder`），類型篩選為階層式（客戶／廠商 → 個人／公司）
- 權限範圍：業務員只看得到自己相關的客戶（依 `project_view_scope`），管理員／專案管理員看全部

**相關檔案**：`src/models/Customer.js`、`src/routes/customers.js`、`src/views/customers/`

---

## 2. 新客戶／廠商審核流程

- **判斷依據**：`canCreateCustomerDirectly = role === 'admin' || role === 'user'`
- **管理員／專案管理員**：快速新增即直接建立客戶
- **其餘角色（業務員等）**：送出的新客戶資料不會直接寫入 `customers`，而是進入 `customer_creation_requests` 審核佇列（`request_status = 'pending'`），管理員於「客戶審核」頁面核准／駁回
- 核准時可先編輯申請內容，核准後才真正建立 `customers` 資料列
- 駁回不建立資料，並記錄駁回原因

**相關檔案**：`src/models/CustomerCreationRequest.js`、`src/routes/customerApprovals.js`、`src/views/customer-approvals/`

---

## 3. 銷售機會（Pipeline）管理

### 欄位設計
- 銷售機會名稱、客戶（必選）、業務人員、預估專案類型（可複選）、預估金額（下拉常用金額 + 自訂輸入）、成交機率（下拉：10%初步接洽／30%需求分析／50%提案報價／100%商務談判）、預計成交月份（年/月下拉）、備註
- 狀態：洽談中／已成交／已流失；已成交可再轉入正式專案（`converted_project_id`）

### 快速新增客戶＋銷售機會（本次重新設計的流程）
過去的問題：點快速新增建立客戶後會離開新增銷售機會頁面，且非管理員角色送出審核後前面填的商機資料會遺失。

**新流程**：
1. 點「快速新增」填客戶資料 → 「新增並選擇」
2. **管理員／專案管理員**：立即建立真實客戶，選入下拉選單，停留在原頁面，可繼續正常送出 `POST /pipelines`
3. **其餘角色**：不呼叫後端，只在前端「暫存」客戶資料（`window.stagedCustomerData`），下拉選單顯示「（待審核）公司名稱 (客戶編號)」的暫存選項，**停留在原頁面**
4. 使用者填完整張銷售機會表單後按「建立」：
   - 若選取的是暫存客戶，改用 `fetch` 送到 `/customers/quick-add`，把客戶資料＋銷售機會欄位（`pipeline_data`）一併打包
   - 後端 `CustomerCreationRequest.approve()` 核准時會**同時**建立客戶與銷售機會（`created_pipeline_id`），不會有「客戶審核通過但銷售機會不見了」的問題

### 列表排序
- 表頭全部可點擊排序（建立日期／最後更新日期／銷售機會名稱／客戶／業務／預估金額／成交機率／預計成交月份／狀態）
- **預設 `sortBy=win_probability`、`sortOrder=DESC`**（成交機率由高到低）
- 排序時保留目前的狀態篩選（全部／洽談中／已成交／已流失）

**相關檔案**：`src/models/Pipeline.js`、`src/routes/pipelines.js`、`src/views/pipelines/`

---

## 4. 客戶活動紀錄

- 類型：拜訪／電話／客訴／其他；記錄內容、活動日期
- 顯示於客戶詳情頁的時間軸
- 刪除需走審核流程（`deletion_requests`），不可直接刪除

### 客戶追蹤提醒（本次新增設定 UI）
- 邏輯：客戶已指派「客戶關係負責人」時，若最後一筆活動紀錄（不分類型）超過 N 天，或從未有過活動紀錄，即視為逾期
- 天數設定：`activity_reminder_days`（預設 14 天），**先前只能改資料庫，本次已在「系統設定」頁新增「客戶追蹤提醒設定」卡片，管理員可直接調整（1–90 天）**
- 觸發時機：使用者每次 GET 請求時由 auth middleware 重新計算（非排程），透過 `Notification.createIfNotExists` 避免同一則未讀提醒重複產生
- 顯示位置：首頁儀表板「客戶追蹤提醒」表格＋導覽列通知中心

**已知限制**（尚未處理，供後續評估）：
- 已標記「已流失」的客戶目前仍會持續產生追蹤提醒（判斷條件未排除客戶狀態）
- 提醒一旦被標記已讀，只要客戶依然逾期，下次瀏覽任何頁面就會立刻再產生新提醒，沒有「已讀後至少隔幾天才再提醒」的冷卻機制

**相關檔案**：`src/services/ActivityReminderService.js`、`src/services/NotificationService.js`（`generateReminderNotifications`）

---

## 5. 刪除審核流程

- 銷售機會、活動紀錄的刪除都會建立 `deletion_requests` 申請，需具備 `can_delete` 權限的角色核准後才真正刪除
- 管理頁面：「刪除審核」

**相關檔案**：`src/models/DeletionRequest.js`、`src/routes/deletionRequests.js`

---

## 6. 通知中心（站內）

- 兩種來源：
  1. **事件觸發**：客戶審核送出／核准／駁回、刪除審核送出／核准／駁回、銷售機會新增／編輯／狀態變更／轉入專案、客戶活動紀錄新增
  2. **系統提醒**：客戶追蹤逾期、開票提醒（邏輯獨立於首頁儀表板，互不影響）
- 導覽列鈴鐺下拉選單即時輪詢未讀數；`/notifications` 頁面可查看全部並標記已讀

**相關檔案**：`src/models/Notification.js`、`src/services/NotificationService.js`、`src/views/layout.ejs`（鈴鐺選單）、`src/views/notifications/`

---

## 7. Email／LINE 外部通知

- 僅「重要事件」（審核送出／核准／駁回、銷售機會 CRUD、活動紀錄新增）會嘗試對外發送，一般系統提醒（客戶追蹤、開票）不發送，避免轟炸
- **Email**：透過 nodemailer 走通用 SMTP（相容 Gmail／M365 等任何支援 SMTP AUTH 的服務；M365 若租戶已停用 SMTP Basic Auth 則需另外處理，目前未實作 OAuth2）
  - 主旨自動帶入部署設定的系統名稱（`deploy.config.json` 的 `siteName`）
  - 內文改為結構化摘要（`formatPipelineSummary` / `formatActivitySummary`），不再只是幾個欄位逗號拼接
  - 新增「驗證 SMTP 憑證」開關，處理內部自簽憑證郵件伺服器的 `unable to get local issuer certificate` 錯誤
  - 設定頁提供「測試發送」功能，可用畫面上尚未儲存的值直接測試
- **LINE**：透過 LINE Messaging API 推播，需使用者填寫自己的 LINE User ID
- **系統網址設定（本次新增）**：`system_base_url`，設定後 Email／LINE 通知中的「請登入系統查看」會顯示**完整可點擊網址**而非只有相對路徑；同時修正了 LINE 設定卡片裡「Webhook URL 建議值」原本引用一個從未真正串接的變數、永遠顯示佔位文字的問題
- **通知收件人設定**：`business_event_notify_user_ids`，管理員可在系統設定頁指定哪些使用者要收到銷售機會／活動紀錄異動通知

**相關檔案**：`src/services/EmailService.js`、`src/services/LineService.js`、`src/views/settings/index.ejs`

---

## 8. 權限與範圍

- `can_edit_crm`：角色是否能編輯客戶／銷售機會／活動紀錄
- 客戶／銷售機會列表依 `project_view_scope`（全部／僅自己／指定業務員／無）過濾，業務員只看得到自己負責或相關的資料
- 客戶審核（`customer-approvals`）、刪除審核（`deletion-requests`）僅限對應權限角色（admin/user、`can_delete`）

---

## 🚀 未來規劃 / 待評估項目

1. 客戶追蹤提醒排除已流失／暫停往來客戶、加上已讀冷卻機制
2. Email 若需支援已停用 SMTP Basic Auth 的 M365 租戶，需另外實作 OAuth2 或改走 Microsoft Graph API
3. PR #5 描述僅反映分支最初開發範圍，尚未更新為目前完整內容（銷售機會通知、Email/LINE、系統網址設定、排序功能等皆未列入），建議合併前更新 PR 說明

---

**分支**：`feature/pipeline-form-and-customer-approval`
**狀態**：開發完成，已於瀏覽器逐項實測；PR #5 尚未合併
**文件建立日期**：2026-07-18
