# PDF 中文字型

PDF 匯出功能預設字型不支援中文，若需正確顯示中文，請將支援 CJK 的字型檔置於此目錄。

**建議字型：**
- [Google Noto Sans CJK TC](https://github.com/googlefonts/noto-cjk)（思源黑體繁體中文）
- 檔名範例：`NotoSansTC-Regular.ttf` 或 `NotoSansCJKtc-Regular.otf`

**放置方式：**
1. 下載 Noto Sans CJK TC 的 TTF 或 OTF 檔
2. 將字型檔複製到本專案的 `fonts/` 目錄
3. 重新產生 PDF 即可正確顯示中文

若未放置字型，PDF 中的中文可能顯示為方塊或亂碼。
