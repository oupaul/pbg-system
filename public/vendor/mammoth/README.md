# mammoth.js（瀏覽器版）

- 版本：1.13.0（npm 套件 `mammoth`，檔案 `mammoth.browser.min.js`）
- 授權：BSD-2-Clause（見同目錄 `LICENSE`）
- 用途：附件預覽時，在使用者的瀏覽器把 .docx 轉成 HTML（`public/js/attachment-preview.js` 會再過濾成白名單標籤才顯示）
- 以原檔放在 repo 內（不從 CDN 載入、也不加進伺服器的 npm 相依，避免多一個只在瀏覽器用的伺服器端套件與其間接相依的稽核噪音）
- 更新方式：到 npm 下載新版 `mammoth` 後，用其 `mammoth.browser.min.js` 與 `LICENSE` 覆蓋這兩個檔並更新本檔的版本號，再用真實 .docx 重新驗證預覽
