# 專案管理新增欄位：業務預計開立發票年月

## 功能說明

為專案管理模組新增「業務預計開立發票年月」欄位，用於記錄業務人員預計開立發票的年月時間。

## 資料庫變更

### 新增欄位

在 `projects` 表中新增：
- **欄位名稱**: `expected_invoice_year_month`
- **資料類型**: TEXT
- **格式**: YYYY-MM (例如: 2024-12)
- **允許空值**: 是
- **說明**: 業務預計開立發票的年月

### 視圖更新

更新 `v_project_summary` 視圖，包含新欄位。

## 執行遷移

### 方法一：使用 npm 命令（推薦）

```bash
npm run migrate:expected-invoice
```

### 方法二：直接執行腳本

```bash
node migrations/migrate_expected_invoice_date.js
```

## 遷移腳本功能

遷移腳本會自動：
1. 檢查欄位是否已存在（避免重複執行）
2. 添加 `expected_invoice_year_month` 欄位到 `projects` 表
3. 更新 `v_project_summary` 視圖以包含新欄位
4. 保存更新後的資料庫

## 使用方式

### 在專案詳情頁設定

**注意**: 此欄位不在新增/編輯專案表單中，而是在專案詳情頁面獨立設定。

1. 前往「專案管理」→ 點擊任一專案
2. 在專案詳情頁面頂部（發票明細區塊上方）會看到「業務預計開立發票年月」的獨立編輯區塊
3. 使用月份選擇器設定或修改預計開票年月
4. 點擊「更新」按鈕儲存
5. 格式會自動為 YYYY-MM

### 在列表中查看

在專案列表頁面，新欄位會顯示在「月份」和「類型」之間：
- 有設定值：顯示藍色文字的年月
- 未設定：顯示灰色的「-」

### 在詳情頁查看

在專案詳情頁面的「專案資訊」卡片中：
- 位於「簽約年度/月份」下方
- 有設定值：顯示藍色文字的年月
- 未設定：顯示灰色的「未設定」

## 資料格式範例

```javascript
// 正確格式
expected_invoice_year_month: "2024-12"  // ✅
expected_invoice_year_month: "2025-01"  // ✅

// 錯誤格式
expected_invoice_year_month: "2024/12"  // ❌
expected_invoice_year_month: "2024-1"   // ❌
expected_invoice_year_month: "202412"   // ❌
```

## 程式碼變更清單

### 1. 資料庫遷移
- ✅ `migrations/migrate_expected_invoice_date.js` - 遷移腳本

### 2. 模型層
- ✅ `src/models/Project.js` - 更新 create() 和 update() 方法

### 3. 視圖層
- ✅ `src/views/projects/index.ejs` - 新增列表欄位
- ✅ `src/views/projects/show.ejs` - 新增獨立編輯區塊（發票明細上方）

### 4. 路由層
- ✅ `src/routes/projects.js` - 新增 `/projects/:id/update-expected-invoice` 路由

### 5. 配置文件
- ✅ `package.json` - 新增 migrate:expected-invoice 命令

## 注意事項

1. **向後兼容**: 舊資料的該欄位為 NULL，不影響現有功能
2. **非必填**: 該欄位為選填，可以不設定
3. **格式驗證**: 使用 HTML5 month input type，瀏覽器會自動驗證格式
4. **資料庫備份**: 執行遷移前建議先備份資料庫

## 故障排除

### Q: 執行遷移後欄位沒有出現

**解決方法**:
```bash
# 1. 確認遷移是否成功執行
npm run migrate:expected-invoice

# 2. 檢查資料庫結構
sqlite3 data/invoice_bonus.db ".schema projects"

# 3. 重啟應用程式
npm run dev
```

### Q: 表單中看不到新欄位

**解決方法**:
1. 清除瀏覽器快取
2. 強制重新整理頁面 (Ctrl+F5 或 Cmd+Shift+R)
3. 確認 EJS 檔案已正確更新

### Q: 視圖查詢錯誤

**解決方法**:
```bash
# 手動重建視圖
sqlite3 data/invoice_bonus.db
> DROP VIEW IF EXISTS v_project_summary;
> -- 複製遷移腳本中的 CREATE VIEW 語句執行
```

## 更新日期

2024-12-24

