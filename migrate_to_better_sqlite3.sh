#!/bin/bash

# 遷移到 better-sqlite3
# 這個腳本會將系統從 sql.js 遷移到 better-sqlite3

set -e

PROJECT_DIR="/opt/invoice-bonus-system"
SERVICE_NAME="invoice-bonus-system.service"

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[錯誤]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

info() {
    echo -e "${BLUE}[資訊]${NC} $1"
}

echo "=================================================="
echo "  遷移到 better-sqlite3"
echo "=================================================="
echo ""

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then 
    error "請使用 sudo 執行此腳本"
    exit 1
fi

# 步驟 1: 停止服務
log "步驟 1: 停止服務"
systemctl stop "$SERVICE_NAME"
info "✓ 服務已停止"

# 步驟 2: 備份當前資料庫
log "步驟 2: 備份資料庫"
BACKUP_FILE="${PROJECT_DIR}/data/invoice_bonus.db.backup_before_migration_$(date +%Y%m%d_%H%M%S)"
cp "${PROJECT_DIR}/data/invoice_bonus.db" "$BACKUP_FILE"
info "✓ 資料庫已備份至: $BACKUP_FILE"

# 步驟 3: 安裝 better-sqlite3
log "步驟 3: 安裝 better-sqlite3"
cd "$PROJECT_DIR"

# 移除 sql.js
npm uninstall sql.js

# 安裝 better-sqlite3
npm install better-sqlite3@^11.8.1

info "✓ better-sqlite3 已安裝"

# 步驟 4: 備份舊的 db.js
log "步驟 4: 備份舊的 db.js"
if [ -f "${PROJECT_DIR}/src/models/db.js" ]; then
    cp "${PROJECT_DIR}/src/models/db.js" "${PROJECT_DIR}/src/models/db_old.js.backup"
    info "✓ 舊的 db.js 已備份至 db_old.js.backup"
fi

# 步驟 5: 替換 db.js
log "步驟 5: 替換資料庫驅動"
if [ -f "${PROJECT_DIR}/src/models/db_new.js" ]; then
    mv "${PROJECT_DIR}/src/models/db_new.js" "${PROJECT_DIR}/src/models/db.js"
    info "✓ 已啟用新的資料庫驅動 (better-sqlite3)"
else
    error "找不到 db_new.js 文件"
    exit 1
fi

# 步驟 6: 驗證資料庫
log "步驟 6: 驗證資料庫"
sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    info "✓ 資料庫驗證通過"
else
    error "資料庫驗證失敗"
    exit 1
fi

# 步驟 7: 啟動服務
log "步驟 7: 啟動服務"
systemctl start "$SERVICE_NAME"
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
    info "✓ 服務已啟動"
else
    error "✗ 服務啟動失敗"
    echo ""
    error "正在回滾..."
    
    # 回滾：恢復舊的 db.js
    if [ -f "${PROJECT_DIR}/src/models/db_old.js.backup" ]; then
        mv "${PROJECT_DIR}/src/models/db_old.js.backup" "${PROJECT_DIR}/src/models/db.js"
        warning "已恢復舊的 db.js"
    fi
    
    # 重新安裝 sql.js
    cd "$PROJECT_DIR"
    npm uninstall better-sqlite3
    npm install sql.js@^1.11.0
    warning "已恢復 sql.js"
    
    # 重新啟動服務
    systemctl start "$SERVICE_NAME"
    
    error "遷移失敗，已回滾到 sql.js"
    echo ""
    error "請查看日誌："
    journalctl -u "$SERVICE_NAME" -n 50 --no-pager
    exit 1
fi

# 步驟 8: 檢查服務日誌
log "步驟 8: 檢查服務日誌"
journalctl -u "$SERVICE_NAME" -n 20 --no-pager

echo ""
echo "=================================================="
echo "  遷移完成"
echo "=================================================="
echo ""
log "✅ 已成功遷移到 better-sqlite3！"
echo ""
info "優勢："
echo "  ✓ 資料自動同步到磁碟（無需手動儲存）"
echo "  ✓ 即時反映外部資料庫修改"
echo "  ✓ 更好的效能"
echo "  ✓ 更穩定可靠"
echo ""
info "測試更新功能："
echo "  1. 清除瀏覽器快取"
echo "  2. 進入任一專案詳情頁"
echo "  3. 選擇預計開票年月"
echo "  4. 點擊更新"
echo "  5. 重新整理頁面，確認資料已儲存"
echo ""
info "監控日誌："
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo ""

