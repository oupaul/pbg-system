#!/bin/bash
# 測試備份和還原流程

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日誌函數
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[錯誤]${NC} $1"
    exit 1
}

warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

info() {
    echo -e "${BLUE}[資訊]${NC} $1"
}

PROJECT_DIR="/opt/invoice-bonus-system"
BACKUP_DIR="/opt/invoice-bonus-backups"

echo "============================================"
echo "  備份還原流程測試"
echo "============================================"
echo ""

# 步驟 0: 檢查初始狀態
log "步驟 0: 檢查初始狀態..."
if [ ! -d "$PROJECT_DIR" ]; then
    error "專案目錄不存在: $PROJECT_DIR"
fi

if [ ! -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    error "資料庫檔案不存在"
fi

# 記錄當前資料
log "記錄當前資料庫內容..."
if command -v sqlite3 >/dev/null 2>&1; then
    BEFORE_PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
    BEFORE_USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
    BEFORE_EXPECTED_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '';" 2>/dev/null || echo "0")
    
    log "📊 還原前資料統計："
    log "  - 專案: $BEFORE_PROJECT_COUNT 筆"
    log "  - 使用者: $BEFORE_USER_COUNT 筆"
    log "  - 已設定預計開票: $BEFORE_EXPECTED_COUNT 筆"
    
    # 記錄特定資料作為驗證
    log "記錄使用者帳號..."
    BEFORE_USERS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT username, name FROM users ORDER BY id;" 2>/dev/null || echo "")
    echo "$BEFORE_USERS" > /tmp/before_users.txt
    log "使用者列表已保存到 /tmp/before_users.txt"
    
    log "記錄預計開票資料..."
    BEFORE_EXPECTED=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT project_code, expected_invoice_year_month FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '' ORDER BY id;" 2>/dev/null || echo "")
    echo "$BEFORE_EXPECTED" > /tmp/before_expected.txt
    log "預計開票資料已保存到 /tmp/before_expected.txt"
else
    error "sqlite3 不可用，無法執行測試"
fi

# 步驟 1: 執行備份
log ""
log "步驟 1: 執行備份..."
cd "$PROJECT_DIR"
./backup.sh || error "備份失敗"

# 找到最新的備份
LATEST_BACKUP=$(ls -t ${BACKUP_DIR}/backup_*.tar.gz 2>/dev/null | head -n 1)
if [ -z "$LATEST_BACKUP" ]; then
    error "找不到備份檔案"
fi
log "最新備份: $LATEST_BACKUP"

# 驗證備份內容
log "驗證備份內容..."
if tar -tzf "$LATEST_BACKUP" | grep -q "invoice_bonus.db"; then
    log "✓ 備份包含資料庫檔案"
else
    error "備份不包含資料庫檔案"
fi

# 步驟 2: 模擬資料修改（修改一些資料用於測試）
log ""
log "步驟 2: 模擬資料修改（刪除一些資料）..."
sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "DELETE FROM users WHERE username != 'admin';" 2>/dev/null || true
sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "UPDATE projects SET expected_invoice_year_month = NULL;" 2>/dev/null || true

AFTER_MOD_USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
AFTER_MOD_EXPECTED_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL;" 2>/dev/null || echo "0")
log "修改後資料統計："
log "  - 使用者: $AFTER_MOD_USER_COUNT 筆（應該只剩 admin）"
log "  - 已設定預計開票: $AFTER_MOD_EXPECTED_COUNT 筆（應該是 0）"

# 步驟 3: 執行還原
log ""
log "步驟 3: 執行還原..."
log "還原備份: $(basename $LATEST_BACKUP)"

# 使用非交互模式還原
NON_INTERACTIVE=1 ./restore.sh "$LATEST_BACKUP" || error "還原失敗"

# 等待服務完全啟動
log "等待服務啟動..."
sleep 5

# 步驟 4: 驗證還原結果
log ""
log "步驟 4: 驗證還原結果..."

# 檢查服務狀態
if systemctl is-active --quiet "invoice-bonus-system"; then
    log "✓ 服務正在運行"
else
    warning "服務未運行"
fi

# 驗證資料
AFTER_PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
AFTER_USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
AFTER_EXPECTED_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '';" 2>/dev/null || echo "0")

log "📊 還原後資料統計："
log "  - 專案: $AFTER_PROJECT_COUNT 筆"
log "  - 使用者: $AFTER_USER_COUNT 筆"
log "  - 已設定預計開票: $AFTER_EXPECTED_COUNT 筆"

# 比對結果
echo ""
echo "============================================"
echo "  驗證結果"
echo "============================================"
echo ""

SUCCESS=true

# 驗證專案數量
if [ "$AFTER_PROJECT_COUNT" -eq "$BEFORE_PROJECT_COUNT" ]; then
    log "✓ 專案數量正確 ($AFTER_PROJECT_COUNT = $BEFORE_PROJECT_COUNT)"
else
    error "✗ 專案數量不符 ($AFTER_PROJECT_COUNT != $BEFORE_PROJECT_COUNT)"
    SUCCESS=false
fi

# 驗證使用者數量
if [ "$AFTER_USER_COUNT" -eq "$BEFORE_USER_COUNT" ]; then
    log "✓ 使用者數量正確 ($AFTER_USER_COUNT = $BEFORE_USER_COUNT)"
else
    error "✗ 使用者數量不符 ($AFTER_USER_COUNT != $BEFORE_USER_COUNT)"
    SUCCESS=false
fi

# 驗證預計開票數量
if [ "$AFTER_EXPECTED_COUNT" -eq "$BEFORE_EXPECTED_COUNT" ]; then
    log "✓ 預計開票數量正確 ($AFTER_EXPECTED_COUNT = $BEFORE_EXPECTED_COUNT)"
else
    error "✗ 預計開票數量不符 ($AFTER_EXPECTED_COUNT != $BEFORE_EXPECTED_COUNT)"
    SUCCESS=false
fi

# 詳細比對使用者
log ""
log "詳細驗證使用者帳號..."
AFTER_USERS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT username, name FROM users ORDER BY id;" 2>/dev/null || echo "")
echo "$AFTER_USERS" > /tmp/after_users.txt

if diff /tmp/before_users.txt /tmp/after_users.txt > /dev/null 2>&1; then
    log "✓ 使用者帳號完全一致"
else
    warning "✗ 使用者帳號有差異："
    diff /tmp/before_users.txt /tmp/after_users.txt || true
    SUCCESS=false
fi

# 詳細比對預計開票
log ""
log "詳細驗證預計開票資料..."
AFTER_EXPECTED=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT project_code, expected_invoice_year_month FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '' ORDER BY id;" 2>/dev/null || echo "")
echo "$AFTER_EXPECTED" > /tmp/after_expected.txt

if diff /tmp/before_expected.txt /tmp/after_expected.txt > /dev/null 2>&1; then
    log "✓ 預計開票資料完全一致"
else
    warning "✗ 預計開票資料有差異："
    diff /tmp/before_expected.txt /tmp/after_expected.txt || true
    SUCCESS=false
fi

# 最終結果
echo ""
echo "============================================"
if [ "$SUCCESS" = true ]; then
    echo -e "${GREEN}  ✅ 所有驗證通過！${NC}"
    echo "============================================"
    exit 0
else
    echo -e "${RED}  ❌ 驗證失敗！${NC}"
    echo "============================================"
    echo ""
    echo "可能的原因："
    echo "  1. 服務未正確重啟"
    echo "  2. 資料庫檔案未正確替換"
    echo "  3. better-sqlite3 未重新載入資料庫"
    echo ""
    echo "請檢查："
    echo "  1. sudo systemctl status invoice-bonus-system"
    echo "  2. sudo journalctl -u invoice-bonus-system -n 50"
    echo "  3. ls -lh ${PROJECT_DIR}/data/invoice_bonus.db"
    exit 1
fi

