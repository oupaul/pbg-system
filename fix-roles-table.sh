#!/bin/bash
# 修復角色表 - 用於還原舊備份後補建角色表

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

echo "============================================"
echo "  角色表修復工具"
echo "  用於還原舊備份後補建角色表"
echo "============================================"
echo ""

# 列出可用的安裝目錄
list_install_dirs() {
    local dirs=()
    local index=1
    
    echo "可用的安裝目錄：" >&2
    # 掃描 /opt 下所有包含 package.json 的目錄
    while IFS= read -r dir; do
        if [ -d "$dir" ] && [ -f "${dir}/package.json" ]; then
            dirs+=("$dir")
            local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "未知")
            printf "  [%2d] %s (大小: %s)\n" "$index" "$dir" "$size" >&2
            ((index++))
        fi
    done < <(find /opt -maxdepth 1 -type d 2>/dev/null | sort)
    
    # 也檢查當前目錄
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${SCRIPT_DIR}/package.json" ] && [ "$SCRIPT_DIR" != "/opt"* ]; then
        dirs+=("$SCRIPT_DIR")
        local size=$(du -sh "$SCRIPT_DIR" 2>/dev/null | cut -f1 || echo "未知")
        printf "  [%2d] %s (當前目錄, 大小: %s)\n" "$index" "$SCRIPT_DIR" "$size" >&2
        ((index++))
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

# 檢查資料庫是否存在
DB_FILE="${PROJECT_DIR}/data/invoice_bonus.db"
if [ ! -f "$DB_FILE" ]; then
    error "找不到資料庫檔案: $DB_FILE"
fi

log "找到資料庫: $DB_FILE"

# 檢查 roles 表是否存在
info "檢查 roles 表是否存在..."
ROLES_TABLE_EXISTS=$(sqlite3 "$DB_FILE" "SELECT name FROM sqlite_master WHERE type='table' AND name='roles';" 2>/dev/null)

if [ -n "$ROLES_TABLE_EXISTS" ]; then
    # 檢查是否有資料
    ROLES_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM roles;" 2>/dev/null)
    if [ "$ROLES_COUNT" -gt 0 ]; then
        warning "roles 表已存在且包含 $ROLES_COUNT 筆資料"
        echo ""
        echo "現有角色："
        sqlite3 "$DB_FILE" "SELECT role_key, role_name, is_active FROM roles;" | while IFS='|' read -r key name active; do
            if [ "$active" = "1" ]; then
                echo "  - $key ($name) [啟用]"
            else
                echo "  - $key ($name) [停用]"
            fi
        done
        echo ""
        read -p "是否要重建角色表？這將刪除現有角色資料 [y/N]: " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            log "操作已取消"
            exit 0
        fi
    else
        warning "roles 表存在但沒有資料，將插入預設角色"
    fi
else
    info "roles 表不存在，將建立新表"
fi

# 備份資料庫
BACKUP_FILE="${DB_FILE}.backup-before-role-fix-$(date +%Y%m%d_%H%M%S)"
log "備份資料庫到: $BACKUP_FILE"
cp "$DB_FILE" "$BACKUP_FILE" || error "備份失敗"

# 執行角色遷移
log "執行角色遷移..."
cd "$PROJECT_DIR"

# 檢查是否有 migrate:roles 腳本
if ! grep -q "migrate:roles" package.json 2>/dev/null; then
    error "找不到 migrate:roles 腳本，請確保使用最新版本的系統"
fi

# 執行遷移
npm run migrate:roles

if [ $? -eq 0 ]; then
    log "✓ 角色遷移完成"
    
    # 驗證結果
    info "驗證角色表..."
    ROLES_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM roles;" 2>/dev/null)
    
    if [ "$ROLES_COUNT" -gt 0 ]; then
        log "✓ 成功建立 $ROLES_COUNT 個角色"
        echo ""
        echo "角色列表："
        sqlite3 "$DB_FILE" "SELECT role_key, role_name FROM roles ORDER BY display_order;" | while IFS='|' read -r key name; do
            echo "  - $key: $name"
        done
        echo ""
        
        # 檢查是否需要重啟服務
        # 先嘗試從配置文件讀取服務名稱
        DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
        SERVICE_NAME=""
        if [ -f "$DEPLOY_CONFIG_FILE" ]; then
            source "$DEPLOY_CONFIG_FILE"
            if [ -n "$SERVICE_NAME" ]; then
                log "從配置文件讀取服務名稱: $SERVICE_NAME"
            fi
        fi
        
        # 如果配置文件不存在或沒有服務名稱，嘗試從 systemd 服務文件推斷
        if [ -z "$SERVICE_NAME" ]; then
            # 查找所有 systemd 服務，檢查工作目錄是否匹配
            for svc_file in /etc/systemd/system/*.service; do
                if [ -f "$svc_file" ]; then
                    if grep -q "WorkingDirectory=${PROJECT_DIR}" "$svc_file" 2>/dev/null; then
                        SERVICE_NAME=$(basename "$svc_file" .service)
                        log "從 systemd 服務文件推斷服務名稱: $SERVICE_NAME"
                        break
                    fi
                fi
            done
        fi
        
        # 如果還是找不到，使用目錄名稱作為備選
        if [ -z "$SERVICE_NAME" ]; then
            SERVICE_NAME=$(basename "$PROJECT_DIR")
            warning "無法確定服務名稱，使用目錄名稱作為備選: $SERVICE_NAME"
        fi
        
        if systemctl is-active "${SERVICE_NAME}.service" &>/dev/null; then
            echo ""
            read -p "是否要重啟服務 ${SERVICE_NAME}.service？ [Y/n]: " restart
            if [[ ! "$restart" =~ ^[Nn]$ ]]; then
                log "重啟服務..."
                systemctl restart "${SERVICE_NAME}.service"
                if [ $? -eq 0 ]; then
                    log "✓ 服務重啟成功"
                else
                    warning "服務重啟失敗，請手動重啟"
                fi
            fi
        else
            info "服務 ${SERVICE_NAME}.service 未運行或不存在"
        fi
        
        echo ""
        log "✅ 角色表修復完成！"
        info "備份檔案保存在: $BACKUP_FILE"
        
    else
        error "角色表建立後沒有資料，請檢查遷移腳本"
    fi
else
    error "角色遷移失敗"
fi
