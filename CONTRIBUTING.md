# 開發流程指南

本文件說明如何在**不影響正式環境**的前提下開發新功能。正式環境沒有 staging，`data/invoice_bonus.db` 裝的是真實客戶財務與客戶資料，部署完全靠 `update.sh`／`deploy.sh` 直接上到客戶自有主機的 systemd service——任何操作都應以「這是正式環境」的態度對待（更完整的背景與安全邊界見 [`CLAUDE.md`](CLAUDE.md)，本文件是給人看的流程指南，兩者可交叉參考）。

## 1. 核心原則

- **正式環境即正式資料，沒有 staging**：任何驗證都要先在本機或隔離複本做完，才碰正式主機。
- **優先「新增」而非「修改既有」**：新表、新路由、新欄位盡量設為選填，把對既有功能的風險降到最低。例如「銷售機會活動紀錄」功能，是把資料庫裡本來就存在但沒接上的 `activities.pipeline_id` 欄位接起來，不動任何既有欄位或資料；「金額選項自訂」則是整個新增一張 `pipeline_amount_options` 表，同樣不碰既有 schema。

## 2. Git 分支節奏

1. 開新功能前先 `git fetch`，確認要從**最新的 `develop`** 切分支：
   ```bash
   git fetch origin
   git checkout develop && git pull origin develop
   git checkout -b feature/<name>
   ```
   不要疊在別人可能已經合併過的舊分支上開發——舊分支一旦被 PR 合併，之後在它上面繼續改動，切新分支時容易因為兩邊都動過同一批檔案而卡住（`git checkout` 會拒絕切換）。判斷一個分支是否已經合併：
   ```bash
   git merge-base --is-ancestor <branch> origin/develop && echo "已合併"
   ```
2. 開發完 commit、push，開 PR 進 `develop`。
3. 確認測試沒問題後合併 PR，並把該分支刪乾淨（遠端 + 本機都刪）：
   ```bash
   gh pr merge <PR號> --merge --delete-branch
   git checkout develop && git pull origin develop
   git fetch origin --prune   # 清掉本機殘留的 remote-tracking 分支
   git branch -D feature/<name>
   ```

## 3. 資料庫 migration 紀律

- 新 migration 檔案放在 `migrations/`，並只能加在 `migrations/runner.js` 的 `MIGRATIONS` 陣列**尾端**，不可調整既有順序（陣列順序就是執行順序，插隊會打亂既有安裝的遷移歷程）。
- 建表用 `CREATE TABLE IF NOT EXISTS`，新增欄位要考慮既有安裝可能已經用其他方式加過同一欄位（參考既有 migration 裡常見的 try/catch 防呆寫法），避免對既有欄位下死值 CHECK 約束清單。
- **絕對不要在未取得使用者明確同意前，對正式 `data/*.db` 執行任何 migration**——先在隔離複本驗證過（見第 4 節），再詢問是否要對正式庫執行。
- `install.sh`／`restore.sh`／`deploy.sh` 現在都統一呼叫 `node migrations/runner.js`，新 migration 只要顧好 `runner.js` 陣列這一處就會自動涵蓋全新部署、更新、還原三種情境，不用再擔心多支腳本要分別同步。

## 4. 本機驗證：隔離測試複本

**環境提醒**：本機全域 Node 版本可能跟 `better-sqlite3` 編譯時用的版本不一致，直接執行會出現 `NODE_MODULE_VERSION` 錯誤。請用 `.claude/launch.json` 裡指定的 Node 版本執行（目前是 `/opt/homebrew/opt/node@22/bin/node`），或把它加到 `PATH` 前面——`migrations/runner.js` 內部用 `execSync('node ...')` 起子行程執行每個 migration，子行程也會吃到這個版本問題。

**正式資料庫的帳密已經改過，不要用猜測或重設正式帳密的方式測試。** 改用隔離複本：

```bash
SRC="/path/to/pbg-system"
DEST="/path/to/scratchpad/pbg-system-test"
rsync -a --exclude 'node_modules' --exclude '.git' "$SRC/" "$DEST/"
ln -s "$SRC/node_modules" "$DEST/node_modules"   # 共用已編譯好的 native module，不用重新編譯
```

`data/` 會被整個複製一份，變成一個獨立的 db 檔案，不會動到正式資料。要登入測試時，直接在複本上用 `argon2`（本系統密碼雜湊已升級為 argon2id，不是 bcrypt）幫 admin 重設一個測試密碼：

```bash
node -e "
const argon2 = require('argon2');
const Database = require('better-sqlite3');
const db = new Database('data/invoice_bonus.db');
(async () => {
  const hash = await argon2.hash('testpass123', { type: argon2.argon2id });
  db.prepare(\"UPDATE users SET password_hash = ? WHERE username = 'admin'\").run(hash);
})();
"
```

想模擬全新部署（`install.sh` 的路徑），把複本的 `data/` 整個刪掉，重跑 `node migrations/migrate.js`（bootstrap）再跑 `node migrations/runner.js`（跑完整批 migration），確認資料表與預設值都正確建立。

在 `.claude/launch.json` 臨時加一組指向這個複本的設定（不同 port），就能用 Browser 工具實際點過整個 UI flow。**測完記得把臨時加的 launch.json 設定和整個暫存目錄清掉**，不要留著。

## 5. 上線前的最後一哩：主機實測

沒有 staging，所以「部署腳本本身」的行為（systemd 整合、port、rsync exclude 等）永遠只能在主機上驗證；本機隔離複本驗證的是「程式邏輯」，兩者互補、缺一不可。

慣例做法：完成程式碼與本機驗證後 push 分支，由使用者在主機上把該分支的程式碼部署上去、跑 `update.sh` 做最終驗證，確認沒問題後才回頭要求合併進 `develop`。

## 6. 高風險操作提醒

以下操作即使看起來與當下任務相關，也一律要先詢問使用者、取得明確同意才能執行（完整清單見 [`CLAUDE.md`](CLAUDE.md)）：

- 執行任何 migration，或執行 `deploy.sh`／`update.sh`／`restore.sh` 等維運腳本，尤其是對著正式主機／VM 跑
- 操作 Docker、連線到正式主機、直接查詢或寫入正式資料庫
- `git commit`、`git push`，或其他會改變遠端/共享狀態的 git 操作
- 刪除或覆寫 `data/`、`uploads/`、`backups/` 底下的內容
