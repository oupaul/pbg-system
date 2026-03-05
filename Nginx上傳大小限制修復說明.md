# Nginx 413 Request Entity Too Large 修復說明

## 問題說明

在專案管理上傳附件時，若檔案超過約 1MB，網頁出現 **413 Request Entity Too Large** 錯誤。

**原因**：Nginx 反向代理預設 `client_max_body_size` 為 **1MB**，請求在到達 Node.js 應用前就被 Nginx 拒絕。

**應用程式限制**：本系統 Multer 設定為 10MB，可接受較大檔案，但需先通過 Nginx 檢查。

---

## 修復方式

### 方式一：修改 Nginx 站點設定（推薦）

1. **找到 Nginx 設定檔**

   常見路徑：
   - `/etc/nginx/sites-available/default`
   - `/etc/nginx/conf.d/default.conf`
   - `/etc/nginx/nginx.conf`

2. **在 `server` 或 `location` 區塊內加入**

   ```nginx
   client_max_body_size 10M;
   ```

3. **完整範例**

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       # 允許上傳最大 10MB（與應用程式 Multer 限制一致）
       client_max_body_size 10M;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

4. **驗證並重載 Nginx**

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

### 方式二：全域設定（影響所有站點）

編輯 `/etc/nginx/nginx.conf`，在 `http` 區塊內加入：

```nginx
http {
    # ... 其他設定 ...
    client_max_body_size 10M;
}
```

---

### 方式三：僅針對上傳路徑

若只想放寬上傳相關路徑：

```nginx
location /projects/ {
    client_max_body_size 10M;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## 建議值

| 用途           | 建議值   |
|----------------|----------|
| 專案附件上傳   | 10M      |
| Excel 匯入     | 10M      |
| 若需更大檔案   | 20M 或 50M |

---

## 驗證修復

1. 重載 Nginx 後，嘗試上傳約 1.8MB 的檔案
2. 若仍出現 413，檢查：
   - 設定檔是否正確重載：`sudo nginx -t && sudo systemctl reload nginx`
   - 是否有其他 `client_max_body_size` 覆蓋（如 `location` 內較小值）
   - 是否使用 CDN 或負載平衡器，需一併調整

---

## 相關檔案

- 應用程式上傳限制：`src/routes/projects.js`（專案附件 10MB）、`src/app.js`（Excel 匯入 10MB）
