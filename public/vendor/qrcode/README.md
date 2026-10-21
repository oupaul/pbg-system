# qrcode-generator（vendored）

- 來源：https://www.npmjs.com/package/qrcode-generator （作者 Kazuhiko Arase）
- 版本：1.4.4
- 授權：MIT（授權聲明在 `qrcode.js` 檔頭）
- 用途：雙因素驗證設定頁在瀏覽器端把 `otpauth://` 網址畫成 QR code（不需要把密鑰傳給任何外部服務）
- 為什麼放在 `public/vendor/` 而不是 `package.json`：單一檔案、無相依，自行託管可避免多一個 npm 依賴與供應鏈風險
- 更新方式：`npm pack qrcode-generator@<新版本>`，解開後把 `qrcode.js` 複製到這裡並更新上面的版本；檔案內容必須與 npm 套件一致
