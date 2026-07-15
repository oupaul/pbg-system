#!/bin/bash

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日誌函數
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
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

# 主標題
echo "============================================"
echo "  修復 users.role CHECK 約束"
echo "  讓自訂角色可以正常使用"
echo "============================================"
echo ""

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    error "請使用 root 權限執行此腳本（sudo ./fix-user-role-constraint.sh）"
fi

# 列出可用的安裝目錄
list_install_dirs() {
    local dirs=()
    local index=1
    
    echo "可用的安裝目錄：" >&2
    # 掃描 /opt 下所有包含 package.json 的目錄
    while IFS= read -r dir; do
        if [ -d "$dir" ] && [ -f "${dir}/package.json" ]; then
            # 檢查是否包含我們的專案
            if grep -q "invoice-bonus-system" "${dir}/package.json" 2>/dev/null; then
                dirs+=("$dir")
                local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "未知")
                printf "  [%2d] %s (大小: %s)\n" "$index" "$dir" "$size" >&2
                ((index++))
            fi
        fi
    done < <(find /opt -maxdepth 1 -type d 2>/dev/null | sort)
    
    # 也檢查當前目錄
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${SCRIPT_DIR}/package.json" ] && [ "$SCRIPT_DIR" != "/opt"* ]; then
        if grep -q "invoice-bonus-system" "${SCRIPT_DIR}/package.json" 2>/dev/null; then
            dirs+=("$SCRIPT_DIR")
            local size=$(du -sh "$SCRIPT_DIR" 2>/dev/null | cut -f1 || echo "未知")
            printf "  [%2d] %s (當前目錄, 大小: %s)\n" "$index" "$SCRIPT_DIR" "$size" >&2
            ((index++))
        fi
    fi
    
    if [ ${#dirs[@]} -eq 0 ]; then
        echo "  未找到安裝目錄" >&2
        return 1
    fi
    
    # 返回選中的目錄
    while true; do
        read -p "$(echo -e ${YELLOW}請選擇要修復的安裝目錄編號 [1-${#dirs[@]}]，或按 q 取消:${NC}) " selection
        if [[ "$selection" =~ ^[Qq]$ ]]; then
            exit 0
        fi
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#dirs[@]}" ]; then
            echo "${dirs[$((selection-1))]}"
            return 0
        else
            echo -e "${RED}無效的選擇，請輸入 1-${#dirs[@]} 之間的數字${NC}" >&2
        fi
    done
}

# 選擇安裝目錄
PROJECT_DIR=$(list_install_dirs)
if [ -z "$PROJECT_DIR" ]; then
    error "未選擇安裝目錄"
fi

log "已選擇目錄: $PROJECT_DIR"

# 載入該目錄的配置（如果存在）
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
if [ -f "$DEPLOY_CONFIG_FILE" ]; then
    source "$DEPLOY_CONFIG_FILE"
    log "已載入配置: $DEPLOY_CONFIG_FILE"
fi

# 檢查資料庫
DB_PATH="$PROJECT_DIR/data/invoice_bonus.db"
if [ ! -f "$DB_PATH" ]; then
    error "找不到資料庫檔案: $DB_PATH"
fi

log "找到資料庫: $DB_PATH"

# 檢查是否有 CHECK 約束
info "檢查當前的 users 表結構..."
SCHEMA=$(sqlite3 "$DB_PATH" "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';" 2>/dev/null)

if echo "$SCHEMA" | grep -q "CHECK.*role IN"; then
    warning "檢測到 users.role 有 CHECK 約束限制"
    echo ""
    echo "目前的 CHECK 約束限制角色只能是："
    echo "  - admin"
    echo "  - user"
    echo "  - salesperson"
    echo "  - boss"
    echo ""
    echo "移除此約束後，即可使用角色管理功能中的自訂角色。"
    echo ""
    read -p "是否要移除此約束？[y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "取消操作"
        exit 0
    fi
else
    info "✓ users.role 沒有 CHECK 約束限制"
    echo ""
    info "您的資料庫已經可以使用自訂角色了！"
    exit 0
fi

# 備份資料庫
log "備份資料庫..."
BACKUP_PATH="${DB_PATH}.backup-$(date +%Y%m%d_%H%M%S)"
cp "$DB_PATH" "$BACKUP_PATH"
log "✓ 資料庫已備份: $BACKUP_PATH"

# 尋找服務名稱
log "尋找 systemd 服務..."

# 先嘗試從配置文件讀取服務名稱（配置文件已在前面被 source）
if [ -n "${SERVICE_NAME:-}" ]; then
    log "從配置文件讀取服務名稱: $SERVICE_NAME"
fi

# 如果配置文件不存在或沒有服務名稱，嘗試從 systemd 服務文件推斷
if [ -z "${SERVICE_NAME:-}" ]; then
    for svc_file in /etc/systemd/system/*.service; do
        if [ -f "$svc_file" ]; then
            if grep -q "WorkingDirectory=${PROJECT_DIR}" "$svc_file" 2>/dev/null; then
                SERVICE_NAME=$(basename "$svc_file" .service)
                log "從 systemd 服務文件推斷服務名稱: $SERVICE_NAME"
                break
            fi
        fi
    done
    
    # 如果還是找不到，使用目錄名稱作為備選
    if [ -z "${SERVICE_NAME:-}" ]; then
        SERVICE_NAME=$(basename "$PROJECT_DIR")
        warning "無法確定服務名稱，使用目錄名稱作為備選: $SERVICE_NAME"
    fi
fi

# 停止服務
if [ -n "$SERVICE_NAME" ] && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    log "停止服務: $SERVICE_NAME"
    systemctl stop "$SERVICE_NAME" || warning "服務停止失敗，繼續執行..."
    sleep 2
else
    if [ -z "$SERVICE_NAME" ]; then
        warning "未找到 systemd 服務，跳過服務停止"
    else
        warning "服務 ${SERVICE_NAME}.service 不存在，跳過服務停止"
    fi
fi

# 執行遷移
log "執行遷移腳本..."
cd "$PROJECT_DIR"

if [ -f "migrations/migrate_remove_user_role_check.js" ]; then
    npm run migrate:remove-user-role-check
    MIGRATION_RESULT=$?
else
    error "找不到遷移腳本: migrations/migrate_remove_user_role_check.js"
fi

# 驗證結果
if [ $MIGRATION_RESULT -eq 0 ]; then
    log "✓ 遷移成功"
    
    # 驗證約束是否已移除
    SCHEMA_AFTER=$(sqlite3 "$DB_PATH" "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';" 2>/dev/null)
    if echo "$SCHEMA_AFTER" | grep -q "CHECK.*role IN"; then
        error "CHECK 約束仍然存在，遷移可能失敗"
    else
        log "✓ CHECK 約束已成功移除"
    fi
else
    error "遷移失敗，請檢查錯誤訊息"
fi

# 重啟服務
if [ -n "$SERVICE_NAME" ] && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    log "重啟服務: $SERVICE_NAME"
    systemctl start "$SERVICE_NAME"
    sleep 3
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "✓ 服務已成功啟動"
    else
        error "服務啟動失敗，請檢查：sudo systemctl status $SERVICE_NAME"
    fi
else
    if [ -z "$SERVICE_NAME" ]; then
        warning "未找到服務，請手動啟動應用程式"
    else
        warning "服務 ${SERVICE_NAME}.service 不存在，請手動啟動應用程式"
    fi
fi

# 完成
echo ""
echo "============================================"
echo "  修復完成！"
echo "============================================"
echo ""
info "現在您可以："
echo "  1. 在角色管理中新增自訂角色"
echo "  2. 在使用者管理中為使用者分配自訂角色"
echo ""
info "備份位置: $BACKUP_PATH"
echo ""
