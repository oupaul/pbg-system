# Select2 問題排查指南

## 問題：只看到文字，沒有看到可以篩選或輸入的地方

## 🔧 快速修復步驟

### 1. 上傳最新檔案

```bash
# 上傳修改過的檔案
scp src/views/layout.ejs username@your-server:/path/to/project/src/views/layout.ejs
scp public/js/main.js username@your-server:/path/to/project/public/js/main.js
```

### 2. 重啟服務

```bash
ssh username@your-server
sudo systemctl restart invoice-bonus-system.service
```

### 3. 清除瀏覽器快取

**重要！** 必須強制重新載入頁面：

- **Windows/Linux**: 按 `Ctrl` + `Shift` + `R`
- **Mac**: 按 `Cmd` + `Shift` + `R`

或者：

1. 按 `F12` 打開開發者工具
2. 右鍵點擊重新整理按鈕
3. 選擇「清空快取並強制重新載入」

## 🔍 驗證步驟

### 檢查 1：檢查網路載入

1. 按 `F12` 打開開發者工具
2. 切換到「Network」（網路）分頁
3. 重新整理頁面
4. 檢查以下檔案是否成功載入（狀態碼應為 200）：
   - ✅ `jquery-3.7.1.min.js`
   - ✅ `select2.min.js`
   - ✅ `select2.min.css`
   - ✅ `select2-bootstrap-5-theme.min.css`

### 檢查 2：檢查 JavaScript 錯誤

1. 開發者工具切換到「Console」（控制台）分頁
2. 重新整理頁面
3. 查看是否有紅色錯誤訊息

**常見錯誤**：
- ❌ `$ is not defined` → jQuery 未載入
- ❌ `select2 is not a function` → Select2 未載入或載入順序錯誤

### 檢查 3：手動測試 Select2

在控制台輸入以下命令：

```javascript
// 檢查 jQuery 是否載入
typeof jQuery
// 應該顯示: "function"

// 檢查 $ 是否可用
typeof $
// 應該顯示: "function"

// 檢查 Select2 是否可用
typeof $.fn.select2
// 應該顯示: "function"

// 手動初始化 Select2
$('#salesperson_id').select2({theme: 'bootstrap-5'})
// 如果成功，下拉選單應該變成 Select2 樣式
```

## 🎯 預期效果

正確載入後，業務人員和客戶欄位應該：

1. **外觀變化**：
   - 有搜尋圖示或搜尋框
   - 有下拉箭頭 ▼
   - 有 ✕ 清除按鈕（選擇後）
   - 樣式更美觀（圓角、陰影）

2. **功能測試**：
   - 點擊欄位會顯示下拉選單
   - 下拉選單頂部有搜尋框
   - 輸入文字會即時篩選選項
   - 按 ↑↓ 鍵可以瀏覽選項
   - 按 Enter 可以選擇

## 🐛 常見問題

### 問題 1：仍然看不到 Select2 樣式

**原因**：瀏覽器快取

**解決方案**：
1. 完全關閉瀏覽器
2. 重新打開瀏覽器
3. 或使用無痕模式測試（Ctrl+Shift+N 或 Cmd+Shift+N）

### 問題 2：控制台顯示 "$ is not defined"

**原因**：jQuery 未正確載入

**解決方案**：
檢查 `src/views/layout.ejs` 的 script 載入順序：

```html
<!-- 正確順序 -->
<script src="jquery.js"></script>        <!-- 1. 先 jQuery -->
<script src="bootstrap.js"></script>    <!-- 2. 再 Bootstrap -->
<script src="select2.js"></script>      <!-- 3. 最後 Select2 -->
```

### 問題 3：Select2 載入但沒有初始化

**原因**：初始化代碼未執行

**解決方案**：
在瀏覽器控制台手動執行：

```javascript
$(document).ready(function() {
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
});
```

如果手動執行成功，表示初始化代碼有問題。

### 問題 4：下拉選單被遮蓋

**原因**：z-index 層級問題

**解決方案**：
已在 `public/css/style.css` 中設定：

```css
.select2-dropdown {
  z-index: 1056 !important;
}
```

確認此檔案已上傳並清除快取。

## 📋 完整檢查清單

部署後請逐項檢查：

- [ ] 已上傳 `src/views/layout.ejs`
- [ ] 已上傳 `src/views/projects/form.ejs`
- [ ] 已上傳 `public/css/style.css`
- [ ] 已上傳 `public/js/main.js`
- [ ] 已重啟服務
- [ ] 已清除瀏覽器快取（Ctrl+Shift+R）
- [ ] jQuery 正確載入（控制台輸入 `typeof $` 顯示 "function"）
- [ ] Select2 正確載入（控制台輸入 `typeof $.fn.select2` 顯示 "function"）
- [ ] 業務人員欄位顯示 Select2 樣式
- [ ] 客戶欄位顯示 Select2 樣式
- [ ] 可以輸入文字篩選
- [ ] 可以使用鍵盤導航
- [ ] 可以清除選擇

## 🆘 緊急回退

如果問題無法解決，可以暫時回退到原始方式：

```bash
# 從 Git 或備份還原檔案
git checkout HEAD -- src/views/projects/form.ejs
git checkout HEAD -- src/views/layout.ejs

# 重啟服務
sudo systemctl restart invoice-bonus-system.service
```

## 📞 聯繫支援

如果以上步驟都無法解決，請提供以下資訊：

1. **瀏覽器版本**：（例如：Chrome 120）
2. **控制台錯誤訊息**：（截圖或複製文字）
3. **Network 分頁截圖**：顯示 JavaScript 檔案載入狀態
4. **手動測試結果**：執行 `typeof $.fn.select2` 的結果

---

**文件版本**：v1.0  
**最後更新**：2026-01-12
