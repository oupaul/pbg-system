# Select2 部署檢查清單

## 🎯 問題：下拉選單沒有變成 Select2 樣式

## ✅ 解決方案：全域初始化

已將 Select2 初始化移至 `main.js`，自動處理所有帶有 `select2-dropdown` class 的下拉選單。

---

## 📦 步驟 1：上傳檔案

```bash
cd "c:\Users\Paul Ou\Dropbox\Cursor 專案開發\專案發票獎金計算系統 - dev"

# 上傳修改過的檔案到伺服器
scp src/views/layout.ejs username@server:/path/to/project/src/views/layout.ejs
scp src/views/projects/form.ejs username@server:/path/to/project/src/views/projects/form.ejs
scp public/js/main.js username@server:/path/to/project/public/js/main.js
scp public/css/style.css username@server:/path/to/project/public/css/style.css
```

**或使用 WinSCP/FileZilla** 上傳以下檔案：
- ✅ `src/views/layout.ejs`
- ✅ `src/views/projects/form.ejs`
- ✅ `public/js/main.js`
- ✅ `public/css/style.css`

---

## 🔄 步驟 2：重啟服務

```bash
ssh username@server
sudo systemctl restart invoice-bonus-system.service

# 檢查服務狀態
sudo systemctl status invoice-bonus-system.service
```

---

## 🧹 步驟 3：清除瀏覽器快取（重要！）

### 方法 1：強制重新載入（推薦）

- **Windows/Linux**：按 `Ctrl + Shift + R`
- **Mac**：按 `Cmd + Shift + R`

### 方法 2：清空快取

1. 按 `F12` 打開開發者工具
2. 右鍵點擊「重新整理」按鈕
3. 選擇「清空快取並強制重新載入」

### 方法 3：使用無痕模式測試

- **Windows/Linux**：`Ctrl + Shift + N`
- **Mac**：`Cmd + Shift + N`

---

## 🔍 步驟 4：驗證 Select2 是否載入

### 4.1 打開開發者工具

按 `F12`，切換到 **Console**（控制台）分頁

### 4.2 檢查 jQuery

輸入：
```javascript
typeof $
```

**預期結果**：`"function"`

❌ 如果顯示 `"undefined"`，表示 jQuery 未載入

### 4.3 檢查 Select2

輸入：
```javascript
typeof $.fn.select2
```

**預期結果**：`"function"`

❌ 如果顯示 `"undefined"`，表示 Select2 未載入

### 4.4 查看初始化訊息

重新整理頁面後，控制台應該顯示：

```
[Select2] 已初始化 2 個下拉選單
```

或類似的訊息。

---

## 🎨 步驟 5：檢查外觀

進入「專案管理」→「新增專案」

### 業務人員欄位應該：

**修復前（標準 select）：**
```
┌────────────────────┐
│ -- 選擇業務 --    ▼│  ← 普通下拉
└────────────────────┘
```

**修復後（Select2）：**
```
┌────────────────────┐
│ -- 選擇業務 --  ✕ ▼│  ← 有清除按鈕和特殊樣式
└────────────────────┘
點擊後：
┌────────────────────┐
│ 🔍 搜尋業務...     │  ← 有搜尋框
├────────────────────┤
│ 王小明             │  ← 選項
│ 李大華             │
└────────────────────┘
```

### 視覺特徵：

- ✅ 有搜尋圖示或搜尋框
- ✅ 有 ✕ 清除按鈕（選擇後）
- ✅ 下拉箭頭樣式不同
- ✅ 整體看起來更美觀（圓角、陰影）
- ✅ 點擊後顯示搜尋框
- ✅ 輸入文字會即時篩選

---

## 🧪 步驟 6：功能測試

### 測試 1：搜尋功能

1. 點擊「業務人員」欄位
2. 輸入部分名稱（例如「王」）
3. **預期**：只顯示包含「王」的業務人員

### 測試 2：鍵盤導航

1. 點擊「業務人員」欄位
2. 按 ↓ 或 ↑ 鍵
3. **預期**：可以用鍵盤瀏覽選項
4. 按 Enter
5. **預期**：選擇當前選項

### 測試 3：清除功能

1. 選擇一個業務人員
2. 點擊 ✕ 按鈕
3. **預期**：清除選擇，恢復到「-- 選擇業務 --」

---

## 🐛 故障排除

### 問題 1：控制台顯示 "$ is not defined"

**原因**：jQuery 未載入

**檢查**：
1. 開啟 Network 分頁
2. 重新整理頁面
3. 搜尋 `jquery`
4. 檢查是否有 `jquery-3.7.1.min.js`（狀態應為 200）

**解決**：
- 確認 `layout.ejs` 中有 `<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>`
- 確認順序：jQuery → Bootstrap → Select2

### 問題 2：控制台顯示 "select2 is not a function"

**原因**：Select2 未載入或載入順序錯誤

**檢查**：
1. Network 分頁中搜尋 `select2`
2. 應該有 `select2.min.js` 和 `select2.min.css`

**解決**：
- 確認 `layout.ejs` 中有 Select2 的 script 和 link 標籤
- 確認 Select2 在 jQuery 之後載入

### 問題 3：控制台沒有 "[Select2] 已初始化" 訊息

**原因**：`main.js` 未正確載入或執行

**檢查**：
1. Network 分頁搜尋 `main.js`
2. 確認狀態為 200
3. 點擊檔案查看內容，確認有 Select2 初始化代碼

**手動測試**：
在控制台執行：
```javascript
$('.select2-dropdown').select2({theme: 'bootstrap-5'})
```

如果成功，表示 Select2 可用，只是 `main.js` 有問題。

### 問題 4：看到 Select2 樣式但無法搜尋

**原因**：可能是樣式問題或配置問題

**檢查**：
- 確認 `select2.min.css` 已載入
- 確認 `select2-bootstrap-5-theme.min.css` 已載入
- 確認 `style.css` 中有 Select2 自訂樣式

### 問題 5：瀏覽器快取問題

**症狀**：檔案已更新，但看不到變化

**解決方案**：

1. **完全清除快取**：
   - Chrome：設定 → 隱私權和安全性 → 清除瀏覽資料
   - 選擇「快取的圖片和檔案」
   - 時間範圍：「不限時間」

2. **使用無痕模式**：
   - `Ctrl + Shift + N`（Windows/Linux）
   - `Cmd + Shift + N`（Mac）

3. **停用快取**（測試時）：
   - 開發者工具（F12）→ Network 分頁
   - 勾選「Disable cache」
   - 保持開發者工具開啟

---

## 📋 完整檢查清單

部署後請逐項確認：

### 檔案上傳

- [ ] `src/views/layout.ejs` 已上傳
- [ ] `src/views/projects/form.ejs` 已上傳
- [ ] `public/js/main.js` 已上傳
- [ ] `public/css/style.css` 已上傳

### 服務

- [ ] 服務已重啟
- [ ] 服務狀態正常（active/running）

### 瀏覽器

- [ ] 已清除快取（Ctrl+Shift+R）
- [ ] 或使用無痕模式測試

### JavaScript 檢查（開發者工具 Console）

- [ ] `typeof $` 顯示 `"function"`
- [ ] `typeof $.fn.select2` 顯示 `"function"`
- [ ] 看到 `[Select2] 已初始化 2 個下拉選單` 訊息
- [ ] 沒有紅色錯誤訊息

### 外觀檢查

- [ ] 業務人員欄位有 Select2 樣式
- [ ] 客戶欄位有 Select2 樣式
- [ ] 有清除按鈕 ✕
- [ ] 整體樣式美觀（圓角、陰影）

### 功能檢查

- [ ] 可以點擊開啟下拉選單
- [ ] 有搜尋框可以輸入
- [ ] 輸入文字會即時篩選
- [ ] 可以用鍵盤導航（↑↓ Enter）
- [ ] 可以清除選擇
- [ ] 可以正常提交表單

---

## 🆘 如果全部都不行

### 方案 1：手動初始化測試

在專案表單頁面，開啟控制台，執行：

```javascript
// 確保 jQuery 和 Select2 已載入
console.log('jQuery:', typeof $);
console.log('Select2:', typeof $.fn.select2);

// 手動初始化
$('#salesperson_id').select2({
  theme: 'bootstrap-5',
  placeholder: '-- 選擇業務 --',
  allowClear: true,
  width: '100%'
});

$('#customer_id').select2({
  theme: 'bootstrap-5',
  placeholder: '-- 選擇客戶 --',
  allowClear: true,
  width: '100%'
});
```

如果手動執行成功，表示：
- ✅ Select2 正常
- ❌ 自動初始化有問題

### 方案 2：檢查 HTML 結構

在控制台執行：

```javascript
// 檢查是否有 select2-dropdown class
console.log('找到的 select2-dropdown:', $('.select2-dropdown').length);
console.log('業務人員欄位:', $('#salesperson_id').length);
console.log('客戶欄位:', $('#customer_id').length);
```

### 方案 3：查看完整錯誤

在控制台執行：

```javascript
// 嘗試初始化並捕獲錯誤
try {
  $('.select2-dropdown').select2({theme: 'bootstrap-5'});
  console.log('✅ 初始化成功');
} catch(e) {
  console.error('❌ 初始化失敗:', e);
}
```

---

## 📞 需要協助時提供

如果問題仍未解決，請提供以下資訊：

1. **瀏覽器和版本**：（例如：Chrome 120）

2. **控制台輸出**：
   ```javascript
   {
     jquery: typeof $,
     select2: typeof $.fn.select2,
     bootstrap: typeof bootstrap,
     selectCount: $('.select2-dropdown').length
   }
   ```

3. **Network 分頁截圖**：
   - 篩選顯示：jquery, select2, main.js
   - 顯示狀態碼

4. **Console 分頁截圖**：
   - 包含所有錯誤訊息

5. **頁面截圖**：
   - 業務人員和客戶欄位的實際外觀

---

**部署日期**：2026-01-12  
**問題版本**：v1.8.7  
**修復方式**：全域初始化
