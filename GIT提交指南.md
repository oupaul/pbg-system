# Git 提交與推送指南

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
git push origin master
```

或者如果主分支是 `main`：
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
