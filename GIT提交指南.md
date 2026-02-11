# Git 提交與推送指南

## 保護穩定版：分支策略（建議）

目前 `main` 為穩定版本（如 v1.9.4）。若要避免日後開發覆蓋穩定版，可採用以下方式。

### 方式一：開發分支（推薦）

| 分支 | 用途 |
|------|------|
| `main` | 僅放**已測試、可上線**的穩定版，不直接開發 |
| `develop` 或 `dev` | 日常開發、新功能、修復，完成後再合併回 main |

**日常流程：**
```bash
# 1. 從 main 建立開發分支（僅在要開始新一輪開發時做一次）
git checkout main
git pull origin main
git checkout -b develop
git push -u origin develop

# 2. 之後都在 develop 上開發、提交、推送
git checkout develop
# ... 修改程式 ...
git add -A
git commit -m "feat: 新功能說明"
git push origin develop

# 3. 測試沒問題後，再合併到 main 並打標籤（發布穩定版）
git checkout main
git pull origin main
git merge develop
git tag -a v1.9.5 -m "v1.9.5  release"
git push origin main
git push origin v1.9.5
```

這樣 **main 只會在您主動合併時變動**，不會被日常提交覆蓋。

### 方式二：用標籤固定穩定版（最簡單）

不強制改分支，但每次覺得「這版是穩定版」時就打標籤，之後可隨時回到該版本：

```bash
# 為目前 main 打上穩定版標籤（例如 v1.9.4 已推送後可補打）
git tag -a v1.9.4-stable -m "穩定版 v1.9.4"
git push origin v1.9.4-stable

# 日後若 main 被改壞，可依標籤還原或開新分支
git checkout -b recovery v1.9.4-stable
```

### 方式三：雙遠端或備份倉庫

- 再建一個「僅放穩定版」的遠端或私有倉庫，例如 `stable`，只在發布時 push 過去。
- 或定期從 GitHub 下載 `main` 的 zip 備份，作為穩定版快照。

### 建議組合

- **main**：穩定版，只接受從 `develop` 合併或經過確認的 hotfix。
- **develop**：日常開發。
- **標籤**：每次發布穩定版時打 `v1.9.4`、`v1.9.5`，方便日後還原或比對。

若您決定採用「開發分支」，可先執行一次：  
`git checkout -b develop && git push -u origin develop`，之後新功能都在 `develop` 上開發即可。

---

## 本次更新內容

### 修改的檔案
1. `src/models/Project.js` - 修正未收款篩選邏輯，新增排序欄位支援
2. `src/routes/projects.js` - 新增排序連結和圖示
3. `src/views/projects/index.ejs` - 更新表頭為可排序連結
4. `fix-roles-table.sh` - 動態讀取配置和服務名稱
5. `fix-user-role-constraint.sh` - 動態檢測目錄和服務名稱
6. `README.md` - 更新版本號和更新日誌
7. `專案管理排序與篩選功能更新說明.md` - 新增技術文件

## Git 提交步驟

### 1. 檢查 Git 狀態
```bash
cd "C:\Users\Paul Ou\Dropbox\Cursor 專案開發\專案發票獎金計算系統 - Github"
git status
```

### 2. 添加修改的檔案
```bash
git add src/models/Project.js
git add src/routes/projects.js
git add src/views/projects/index.ejs
git add fix-roles-table.sh
git add fix-user-role-constraint.sh
git add README.md
git add 專案管理排序與篩選功能更新說明.md
```

或者一次性添加所有修改：
```bash
git add -A
```

### 3. 提交變更
```bash
git commit -m "feat: 修復未收款篩選功能並新增排序功能 (v1.8.9)

- 修正未收款篩選邏輯，正確顯示所有有未收款金額的專案
- 新增未開發票、未收款、預計開票欄位排序功能
- 修復腳本硬編碼問題，改為動態讀取部署配置
- 更新技術文件"
```

### 4. 推送到 GitHub
```bash
git push origin main
```

## 如果還沒有初始化 Git 倉庫

### 1. 初始化倉庫
```bash
cd "C:\Users\Paul Ou\Dropbox\Cursor 專案開發\專案發票獎金計算系統 - Github"
git init
```

### 2. 添加遠程倉庫
```bash
git remote add origin https://github.com/your-username/your-repo-name.git
```

### 3. 創建 .gitignore 檔案（如果還沒有）
```bash
# 創建 .gitignore
cat > .gitignore << EOF
node_modules/
data/
uploads/
backups/
*.log
.DS_Store
.env
deploy.config.json
deploy.config.sh
EOF
```

### 4. 首次提交
```bash
git add .
git commit -m "Initial commit: 專案開立發票業績認列獎金計算總表系統 v1.8.9"
git branch -M main
git push -u origin main
```

## 提交訊息格式建議

使用以下格式的提交訊息：
```
feat: 簡短描述

詳細說明：
- 修改點 1
- 修改點 2
- 修改點 3
```

常見的提交類型：
- `feat`: 新功能
- `fix`: 修復問題
- `docs`: 文檔更新
- `refactor`: 代碼重構
- `style`: 代碼格式調整
- `test`: 測試相關
- `chore`: 構建/工具相關
