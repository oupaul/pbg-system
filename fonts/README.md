# PDF 中文字型

PDF 匯出（獎金對帳單、專案總表、獎金報表、帳齡分析、毛利分析）需要支援中文的字型。

## 內建字型

`NotoSansCJKtc-Subset-Regular.otf` 是 [Noto Sans CJK TC（思源黑體繁體中文）](https://github.com/notofonts/noto-cjk) Regular 的**精簡子集**（約 3.4 MB，原檔約 16 MB），授權為 SIL Open Font License 1.1（見同目錄的 `OFL.txt`，可自由散佈與內嵌於 PDF）。

- 包含：Big5 編碼內的全部繁體字（常用字、次常用字與標點符號）、ASCII、拉丁字母補充、常用符號、全形字元。
- **不包含**：罕見字與簡體字（姓名或專案名稱含有這類字時，PDF 中會顯示成方塊）。需要完整字集時，把完整的 `NotoSansTC-Regular.ttf` 或 `NotoSansCJKtc-Regular.otf` 放進這個目錄即可，程式會優先使用完整字型。

## 字型選用順序

1. `NotoSansTC-Regular.ttf`（自行放置的完整字型）
2. `NotoSansCJKtc-Regular.otf`（自行放置的完整字型）
3. `NotoSansCJKtc-Subset-Regular.otf`（內建的精簡字型）

## 重新產生精簡字型（需要 Python 與 fonttools）

```bash
# 1. 下載官方字型：https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf
# 2. 產生要保留的字元清單 chars.txt（Big5 全部字元 + ASCII + 常用符號與全形字元），再執行：
pyftsubset NotoSansCJKtc-Regular.otf --text-file=chars.txt \
  --output-file=NotoSansCJKtc-Subset-Regular.otf \
  --layout-features='' --no-hinting --notdef-outline --name-IDs='*' --drop-tables+=GSUB,GPOS,GDEF
```
