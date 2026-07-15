# 業務績效儀表板與 PDF 匯出功能說明

## 更新日期
2026-02-07

---

## 一、業務績效儀表板

### 功能概述

依業務人員彙總專案數量、金額、發票、收款與獎金等數據，便於檢視各業務的業績表現與獎金狀況。

### 顯示位置

導覽列 → **業務績效**（admin、user、salesperson 可見）

### 彙總欄位

| 欄位 | 說明 |
|------|------|
| 專案數 | 該業務負責的專案數量 |
| 專案金額 | 專案總價（含稅）合計 |
| 已開發票 | 已開立發票金額合計 |
| 未開發票 | 專案金額 − 已開發票 |
| 已收款 | 實際收款金額合計 |
| 未收款 | 已開發票 − 已收款 − 銷貨折讓 |
| 總獎金 | 該業務獎金合計 |
| 已發放 | 已發放獎金 |
| 待發放 | 待發放獎金 |

### 年度篩選

- 全部年度：不限定專案簽約年度
- 指定年度：僅統計該年度專案

### 權限

- **admin / user**：可檢視所有業務績效
- **salesperson**：僅可檢視自己的績效
- **boss**：依系統權限設定

### 快速連結

每筆績效列提供「專案」「獎金」按鈕，可快速跳轉至對應頁面並帶入篩選條件。

### 相關檔案

- `src/services/SalesPerformanceService.js` - 績效彙總服務
- `src/routes/salesPerformance.js` - 路由
- `src/views/sales-performance/index.ejs` - 視圖
- `src/app.js` - 路由註冊
- `src/views/layout.ejs` - 導覽連結

---

## 二、PDF 匯出

### 功能概述

支援將專案總表、獎金報表、應收帳款帳齡分析匯出為 PDF 格式，方便列印與分享。

### 匯出入口

**匯入/匯出** 頁面 → 匯出報表區塊

### 支援報表

| 報表 | 路徑 | 說明 |
|------|------|------|
| 專案總表 | `/import-export/export/pdf/projects/:year` | 橫向 A4，含專案編號、名稱、客戶、業務、類型、價格、已開發票、已收款、未收款 |
| 獎金報表 | `/import-export/export/pdf/bonuses/:year` | 直向 A4，含業務、專案、類型、獎金類型、金額、發放日、狀態 |
| 帳齡分析 | `/import-export/export/pdf/aging?year=` | 直向 A4，含帳齡、專案、發票、業務、未收金額、預計收款日 |

### 版面設定

- 列高：25pt
- 表頭：淺灰底色 (#e9ecef)
- 欄寬：依報表類型優化，避免文字擁擠
- 分頁：內容超出時自動換頁

### 中文字型（選用）

預設字型不支援中文，若需正確顯示中文，請：

1. 下載 [Google Noto Sans CJK TC](https://github.com/googlefonts/noto-cjk) 字型
2. 將 `NotoSansTC-Regular.ttf` 或 `NotoSansCJKtc-Regular.otf` 置於專案 `fonts/` 目錄
3. 重新產生 PDF

未放置字型時，中文可能顯示為方塊或亂碼。

### 相關檔案

- `src/services/PdfExportService.js` - PDF 產生服務
- `src/routes/importExport.js` - 匯出路徑
- `package.json` - 依賴：`pdfkit`
- `fonts/README.md` - 中文字型說明

---

## 三、應收帳齡 Excel 匯出

### 功能概述

應收帳款帳齡分析除 PDF 外，新增 Excel 格式匯出，方便於 Excel 中進一步分析或編輯。

### 匯出入口

**匯入/匯出** 頁面 → 應收帳款帳齡分析 → Excel 按鈕

### 路徑

- 全部：`/import-export/export/aging`
- 指定年度：`/import-export/export/aging?year=2024`

### 欄位

帳齡、專案編號、專案名稱、發票號碼、業務、未收金額、預計收款日

### 相關檔案

- `src/services/ExcelExportService.js` - `exportReceivablesAging()` 方法
- `src/routes/importExport.js` - `/export/aging` 路徑
- `src/views/import-export/index.ejs` - Excel 按鈕

---

## 四、部署說明

### 新增依賴

```bash
npm install
```

`package.json` 已包含 `pdfkit`，執行 `npm install` 即可安裝。

### 無需遷移

本版本無資料庫結構變更，無需執行遷移腳本。

### 升級步驟

使用 `deploy.sh` 一鍵部署即可：

```bash
sudo ./deploy.sh
```
