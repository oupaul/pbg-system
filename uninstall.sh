#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 移除腳本（含備份）

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 專案目錄
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 載入部署配置
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
if [ -f "$DEPLOY_CONFIG_FILE" ]; then
    source "$DEPLOY_CONFIG_FILE"
else
    # 如果配置文件不存在，使用預設值
    INSTALL_DIR_NAME="invoice-bonus-system"
    BACKUP_DIR_NAME="invoice-bonus-backups"
    INSTALL_DIR="/opt/${INSTALL_DIR_NAME}"
    BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
fi
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
UNINSTALL_BACKUP="${BACKUP_DIR}/uninstall_backup_${TIMESTAMP}.tar.gz"
TEMP_BACKUP_DIR="${PROJECT_DIR}/temp_uninstall_backup"

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

# 確認函數
confirm() {
    read -p "$(echo -e ${YELLOW}$1${NC}) [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        return 1
    fi
    return 0
}

# 列出可能的安裝目錄
list_install_dirs() {
    local dirs=()
    local index=1
    local seen_dirs=()
    
    echo "可用的安裝目錄：" >&2
    
    # 掃描 /opt 下所有包含 package.json 的目錄
    while IFS= read -r dir; do
        if [ -d "$dir" ] && [ -f "${dir}/package.json" ]; then
            local normalized_dir=$(cd "$dir" 2>/dev/null && pwd || echo "$dir")
            # 檢查是否已經在列表中
            local found=0
            for seen_dir in "${seen_dirs[@]}"; do
                if [ "$seen_dir" = "$normalized_dir" ]; then
                    found=1
                    break
                fi
            done
            if [ $found -eq 0 ]; then
                dirs+=("$normalized_dir")
                seen_dirs+=("$normalized_dir")
                local size=$(du -sh "$normalized_dir" 2>/dev/null | cut -f1 || echo "未知")
                printf "  [%2d] %s (大小: %s)\n" "$index" "$normalized_dir" "$size" >&2
                ((index++))
            fi
        fi
    done < <(find /opt -maxdepth 1 -type d 2>/dev/null | sort)
    
    # 也從 systemd 服務文件中提取 WorkingDirectory
    while IFS= read -r service_file; do
        if [ -f "$service_file" ] && grep -q "app.js" "$service_file" 2>/dev/null; then
            # 提取 WorkingDirectory
            local work_dir=$(grep "^WorkingDirectory=" "$service_file" 2>/dev/null | cut -d'=' -f2- | tr -d ' ' || echo "")
            if [ -n "$work_dir" ] && [ -d "$work_dir" ] && [ -f "${work_dir}/package.json" ]; then
                local normalized_dir=$(cd "$work_dir" 2>/dev/null && pwd || echo "$work_dir")
                # 檢查是否已經在列表中
                local found=0
                for seen_dir in "${seen_dirs[@]}"; do
                    if [ "$seen_dir" = "$normalized_dir" ]; then
                        found=1
                        break
                    fi
                done
                if [ $found -eq 0 ]; then
                    local service_name=$(basename "$service_file" .service)
                    dirs+=("$normalized_dir")
                    seen_dirs+=("$normalized_dir")
                    local size=$(du -sh "$normalized_dir" 2>/dev/null | cut -f1 || echo "未知")
                    printf "  [%2d] %s (來自服務: %s, 大小: %s)\n" "$index" "$normalized_dir" "$service_name" "$size" >&2
                    ((index++))
                fi
            fi
        fi
    done < <(find /etc/systemd/system -maxdepth 1 -name "*.service" 2>/dev/null | sort)
    
    if [ ${#dirs[@]} -eq 0 ]; then
        echo "  未找到安裝目錄" >&2
        return 1
    fi
    
    # 返回選中的目錄
    while true; do
        read -p "$(echo -e ${YELLOW}請選擇要移除的安裝目錄編號 [1-${#dirs[@]}]，或按 q 取消:${NC}) " selection >&2
        if [[ "$selection" =~ ^[Qq]$ ]]; then
            log "移除操作已取消" >&2
            exit 0
        fi
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#dirs[@]}" ]; then
            echo "${dirs[$((selection-1))]}"
            return 0
        else
            echo -e "${RED}無效的選擇，請輸入 1-${#dirs[@]} 之間的數字，或按 q 取消${NC}" >&2
        fi
    done
}

# 列出相關的 systemd 服務
list_services() {
    local services=()
    local index=1
    
    echo "" >&2
    echo "可用的 systemd 服務：" >&2
    # 掃描所有包含 invoice-bonus 或類似名稱的服務，以及通過 service 文件檢查 app.js 路徑的服務
    while IFS= read -r service; do
        if [ -n "$service" ]; then
            services+=("$service")
            local status=$(systemctl is-active "$service" 2>/dev/null || echo "unknown")
            local enabled=$(systemctl is-enabled "$service" 2>/dev/null || echo "unknown")
            printf "  [%2d] %s (狀態: %s, 啟用: %s)\n" "$index" "$service" "$status" "$enabled" >&2
            ((index++))
        fi
    done < <(systemctl list-unit-files --type=service 2>/dev/null | grep -E "(invoice-bonus|invoice.*bonus|project-system)" | awk '{print $1}' | sort)
    
    # 也檢查是否有服務的 ExecStart 包含 app.js（可能是其他名稱的服務）
    while IFS= read -r service_file; do
        if [ -f "$service_file" ]; then
            local service_name=$(basename "$service_file" .service)
            # 檢查是否已經在列表中
            local found=0
            for existing_service in "${services[@]}"; do
                if [ "$existing_service" = "$service_name" ]; then
                    found=1
                    break
                fi
            done
            # 如果服務文件包含 app.js 且不在列表中，加入列表
            if [ $found -eq 0 ] && grep -q "app.js" "$service_file" 2>/dev/null; then
                services+=("$service_name")
                local status=$(systemctl is-active "$service_name" 2>/dev/null || echo "unknown")
                local enabled=$(systemctl is-enabled "$service_name" 2>/dev/null || echo "unknown")
                printf "  [%2d] %s (狀態: %s, 啟用: %s)\n" "$index" "$service_name" "$status" "$enabled" >&2
                ((index++))
            fi
        fi
    done < <(find /etc/systemd/system -maxdepth 1 -name "*.service" 2>/dev/null | sort)
    
    if [ ${#services[@]} -eq 0 ]; then
        echo "  未找到相關服務" >&2
        return 1
    fi
    
    # 返回選中的服務
    while true; do
        read -p "$(echo -e ${YELLOW}請選擇要移除的服務編號 [1-${#services[@]}]，或按 s 跳過:${NC}) " selection
        if [[ "$selection" =~ ^[Ss]$ ]]; then
            return 1
        fi
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#services[@]}" ]; then
            echo "${services[$((selection-1))]}"
            return 0
        else
            echo -e "${RED}無效的選擇，請輸入 1-${#services[@]} 之間的數字，或按 s 跳過${NC}" >&2
        fi
    done
}

# 開始移除
echo "============================================"
echo "  專案開立發票業績認列獎金計算總表系統"
echo "  移除程式（含備份）"
echo "============================================"
echo ""

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    error "移除操作需要 root 權限，請使用 sudo 執行此腳本：sudo ./uninstall.sh"
fi

# 選擇安裝目錄
SELECTED_INSTALL_DIR=$(list_install_dirs)
if [ -z "$SELECTED_INSTALL_DIR" ]; then
    error "未選擇安裝目錄"
fi

PROJECT_DIR="$SELECTED_INSTALL_DIR"
log "已選擇安裝目錄: $PROJECT_DIR"

# 載入該目錄的配置（如果存在）
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
if [ -f "$DEPLOY_CONFIG_FILE" ]; then
    source "$DEPLOY_CONFIG_FILE"
    log "已載入配置: $DEPLOY_CONFIG_FILE"
else
    # 如果配置文件不存在，使用預設值
    INSTALL_DIR_NAME=$(basename "$PROJECT_DIR")
    BACKUP_DIR_NAME="${INSTALL_DIR_NAME}-backups"
    BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
    warning "未找到配置文件，使用預設值"
fi

TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
UNINSTALL_BACKUP="${BACKUP_DIR}/uninstall_backup_${TIMESTAMP}.tar.gz"
TEMP_BACKUP_DIR="${PROJECT_DIR}/temp_uninstall_backup"

warning "此操作將移除整個系統，包括："
echo "  - 所有專案檔案"
echo "  - 資料庫"
echo "  - 上傳檔案"
echo "  - node_modules"
echo ""
info "但在移除前會自動建立完整備份"
echo ""

if ! confirm "確定要移除系統嗎？"; then
    log "移除操作已取消"
    exit 0
fi

# 步驟 1: 自動備份
log "步驟 1/4: 自動備份系統資料..."
# 創建備份目錄（需要 root 權限）
if [ "$EUID" -ne 0 ]; then
    error "移除操作需要 root 權限，請使用 sudo 執行此腳本：sudo ./uninstall.sh"
fi
mkdir -p "$BACKUP_DIR"
chmod 755 "$BACKUP_DIR" || true

# 創建臨時備份目錄
rm -rf "$TEMP_BACKUP_DIR"
mkdir -p "$TEMP_BACKUP_DIR"

# 備份資料庫
if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    # ⚠️ 重要：先執行 WAL checkpoint，確保所有資料都寫入主檔案
    # 這必須在備份之前執行，否則備份的資料庫可能不完整
    if command -v sqlite3 >/dev/null 2>&1; then
        log "執行 WAL checkpoint（合併 WAL 到主檔案）..."
        sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || warning "WAL checkpoint 失敗，但繼續備份"
        # 等待一下，確保 checkpoint 完成
        sleep 1
    fi
    
    # 驗證資料庫檔案大小（checkpoint 後）
    DB_FILE_SIZE=$(stat -f%z "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || stat -c%s "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || echo "0")
    if [ "$DB_FILE_SIZE" -lt 1000 ]; then
        warning "資料庫檔案過小 (${DB_FILE_SIZE} bytes)，可能為空或損壞"
    fi
    
    mkdir -p "${TEMP_BACKUP_DIR}/data"
    cp "${PROJECT_DIR}/data/invoice_bonus.db" "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" || error "資料庫備份失敗"
    
    # 驗證備份後的檔案
    BACKUP_DB_SIZE=$(stat -f%z "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" 2>/dev/null || stat -c%s "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" 2>/dev/null || echo "0")
    if [ "$BACKUP_DB_SIZE" -ne "$DB_FILE_SIZE" ]; then
        error "資料庫備份失敗：檔案大小不一致 (原始: ${DB_FILE_SIZE}, 備份: ${BACKUP_DB_SIZE})"
    fi
    
    DB_SIZE=$(du -h "${PROJECT_DIR}/data/invoice_bonus.db" | cut -f1)
    log "資料庫已備份，大小: $DB_SIZE"
    
    # 驗證資料庫內容（使用備份檔案統計，與 backup.sh 邏輯一致）
    if command -v sqlite3 >/dev/null 2>&1; then
        PROJECT_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
        CUSTOMER_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
        INVOICE_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
        PAYMENT_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM payments;" 2>/dev/null || echo "0")
        USER_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
        EXPECTED_INVOICE_COUNT=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '';" 2>/dev/null || echo "0")
        
        log "📊 備份資料統計："
        log "  - 專案: $PROJECT_COUNT 筆"
        log "  - 客戶: $CUSTOMER_COUNT 筆"
        log "  - 發票: $INVOICE_COUNT 筆"
        log "  - 收款: $PAYMENT_COUNT 筆"
        log "  - 使用者: $USER_COUNT 筆"
        log "  - 已設定預計開票: $EXPECTED_INVOICE_COUNT 筆"
        
        # 顯示非管理員使用者
        if [ "$USER_COUNT" -gt 1 ]; then
            USER_LIST=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT username, name, role FROM users WHERE username != 'admin';" 2>/dev/null || echo "")
            if [ -n "$USER_LIST" ]; then
                log "  - 非管理員使用者: $USER_LIST"
            fi
        fi
        
        # 顯示預計開票範例
        if [ "$EXPECTED_INVOICE_COUNT" -gt 0 ]; then
            EXPECTED_SAMPLE=$(sqlite3 "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" "SELECT project_code, expected_invoice_year_month FROM projects WHERE expected_invoice_year_month IS NOT NULL LIMIT 1;" 2>/dev/null || echo "")
            if [ -n "$EXPECTED_SAMPLE" ]; then
                log "  - 預計開票範例: $EXPECTED_SAMPLE"
            fi
        fi
    fi
fi

# 備份上傳檔案
if [ -d "${PROJECT_DIR}/uploads" ] && [ "$(ls -A ${PROJECT_DIR}/uploads 2>/dev/null)" ]; then
    cp -r "${PROJECT_DIR}/uploads" "${TEMP_BACKUP_DIR}/" 2>/dev/null || true
    UPLOADS_COUNT=$(find "${PROJECT_DIR}/uploads" -type f 2>/dev/null | wc -l)
    log "上傳檔案已備份，檔案數: $UPLOADS_COUNT"
fi

# 備份設定檔
if [ -f "${PROJECT_DIR}/.env" ]; then
    cp "${PROJECT_DIR}/.env" "${TEMP_BACKUP_DIR}/.env"
    log ".env 檔案已備份"
fi

# 備份 package.json
if [ -f "${PROJECT_DIR}/package.json" ]; then
    cp "${PROJECT_DIR}/package.json" "${TEMP_BACKUP_DIR}/package.json"
fi
if [ -f "${PROJECT_DIR}/package-lock.json" ]; then
    cp "${PROJECT_DIR}/package-lock.json" "${TEMP_BACKUP_DIR}/package-lock.json"
fi

# 確認臨時備份目錄內容
log "備份內容預覽（壓縮前）："
find "${TEMP_BACKUP_DIR}" -maxdepth 2 -type f -print | sed "s|^|  - |"
if [ ! -f "${TEMP_BACKUP_DIR}/data/invoice_bonus.db" ]; then
    warning "未找到資料庫檔案，請確認路徑是否正確（預期為 data/invoice_bonus.db）"
fi

# 創建備份資訊
cat > "${TEMP_BACKUP_DIR}/uninstall_info.txt" << EOF
移除時間: $(date +'%Y-%m-%d %H:%M:%S')
備份名稱: uninstall_backup_${TIMESTAMP}
系統資訊:
  - 作業系統: $(uname -a)
  - Node.js 版本: $(node -v 2>/dev/null || echo "未安裝")
  - npm 版本: $(npm -v 2>/dev/null || echo "未安裝")
專案資訊:
  - 專案目錄: $PROJECT_DIR
備份內容:
  - 資料庫: data/invoice_bonus.db
  - 上傳檔案: uploads/
  - 設定檔: .env (如果存在)
  - 套件資訊: package.json, package-lock.json
還原說明:
  1. 解壓此備份檔案
  2. 將檔案複製回專案目錄
  3. 執行: npm install
  4. 執行: npm run migrate
EOF

# 壓縮備份
cd "$PROJECT_DIR"
tar -czf "$UNINSTALL_BACKUP" -C "$PROJECT_DIR" "temp_uninstall_backup" || error "備份壓縮失敗"
rm -rf "$TEMP_BACKUP_DIR"
BACKUP_SIZE=$(du -h "$UNINSTALL_BACKUP" | cut -f1)
log "備份完成，備份檔案: $(basename $UNINSTALL_BACKUP)，大小: $BACKUP_SIZE"

# 確認壓縮後備份包含資料庫與上傳檔
if tar -tzf "$UNINSTALL_BACKUP" | grep -q "temp_uninstall_backup/data/invoice_bonus.db"; then
    log "備份檔案內含資料庫檔案"
else
    warning "備份檔案內未找到資料庫檔案！請檢查備份流程"
fi
UPLOADS_IN_TAR=$(tar -tzf "$UNINSTALL_BACKUP" | grep -c "temp_uninstall_backup/uploads/" || true)
log "備份檔案內 uploads 相關項目: ${UPLOADS_IN_TAR} 條"

# 步驟 2: 確認移除
echo ""
warning "備份已完成，即將開始移除系統檔案"
if ! confirm "確定要繼續移除嗎？"; then
    log "移除操作已取消，備份檔案已保留: $UNINSTALL_BACKUP"
    exit 0
fi

# 步驟 2: 停止並移除 systemd 服務
log "步驟 2/4: 停止並移除 systemd 服務..."

# 從選中的安裝目錄載入配置以獲取服務名稱
if [ -f "${PROJECT_DIR}/deploy.config.sh" ]; then
    source "${PROJECT_DIR}/deploy.config.sh"
fi

# 如果配置中沒有服務名稱，嘗試從服務文件中檢測
if [ -z "$SERVICE_NAME" ]; then
    # 嘗試查找相關服務
    SELECTED_SERVICE=$(list_services)
    if [ -n "$SELECTED_SERVICE" ]; then
        SERVICE_NAME="$SELECTED_SERVICE"
    else
        # 如果找不到服務，使用預設值
        SERVICE_NAME="invoice-bonus-system"
        warning "無法自動檢測服務名稱，使用預設值: $SERVICE_NAME"
    fi
fi

# 停止 systemd 服務
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    log "停止 systemd 服務: ${SERVICE_NAME}..."
    if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
        sleep 2
        log "等待服務停止..."
    fi
    
    log "禁用服務..."
    sudo systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    
    log "移除服務文件..."
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null || true
    
    # 同時移除相關的 timer 服務（如果有）
    if systemctl list-unit-files | grep -q "^${SERVICE_NAME}-backup.timer"; then
        log "停止並移除備份 timer 服務..."
        sudo systemctl stop "${SERVICE_NAME}-backup.timer" 2>/dev/null || true
        sudo systemctl disable "${SERVICE_NAME}-backup.timer" 2>/dev/null || true
        sudo rm -f "/etc/systemd/system/${SERVICE_NAME}-backup.timer" 2>/dev/null || true
        sudo rm -f "/etc/systemd/system/${SERVICE_NAME}-backup.service" 2>/dev/null || true
    fi
    
    sudo systemctl daemon-reload 2>/dev/null || true
    log "systemd 服務已移除"
else
    log "systemd 服務 ${SERVICE_NAME} 不存在，跳過"
fi

# 檢查並終止所有相關 Node.js 進程
log "檢查並終止相關 Node.js 進程..."
# 查找所有運行中的 app.js 進程
APP_PIDS=$(ps aux | grep "[n]ode.*app.js" | grep -v grep | awk '{print $2}' || echo "")
if [ -n "$APP_PIDS" ]; then
    log "找到運行中的 Node.js 進程，正在終止..."
    for pid in $APP_PIDS; do
        if [ -n "$pid" ]; then
            log "終止進程 PID: $pid"
            sudo kill -9 "$pid" 2>/dev/null || true
        fi
    done
    sleep 1
fi

# 檢查並清理端口 3000
log "檢查端口 3000 佔用情況..."
PORT_PID=$(sudo lsof -ti:3000 2>/dev/null || echo "")
if [ -n "$PORT_PID" ]; then
    warning "檢測到端口 3000 仍被佔用 (PID: $PORT_PID)，正在終止..."
    sudo kill -9 "$PORT_PID" 2>/dev/null || true
    sleep 1
    # 再次檢查
    PORT_PID=$(sudo lsof -ti:3000 2>/dev/null || echo "")
    if [ -n "$PORT_PID" ]; then
        warning "端口 3000 仍被佔用，可能需要手動處理"
    else
        log "端口 3000 已釋放"
    fi
else
    log "端口 3000 未被佔用"
fi

# 確認服務已完全停止
if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    warning "服務仍在運行，嘗試強制停止..."
    sudo systemctl kill --kill-who=all "${SERVICE_NAME}" 2>/dev/null || true
    sleep 2
    if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        error "無法停止服務，請手動檢查：sudo systemctl status ${SERVICE_NAME}"
    else
        log "服務已強制停止"
    fi
fi

# 步驟 3: 移除檔案
log "步驟 3/4: 移除系統檔案和目錄..."

# 移除 node_modules
if [ -d "${PROJECT_DIR}/node_modules" ]; then
    log "移除 node_modules..."
    rm -rf "${PROJECT_DIR}/node_modules"
    log "node_modules 已移除"
fi

# 移除資料庫和 data 目錄
if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    log "移除資料庫..."
    rm -f "${PROJECT_DIR}/data/invoice_bonus.db"
    log "資料庫已移除"
fi
# 如果 data 目錄為空，也移除它
if [ -d "${PROJECT_DIR}/data" ]; then
    if [ -z "$(ls -A ${PROJECT_DIR}/data 2>/dev/null)" ]; then
        log "移除空的 data 目錄..."
        rmdir "${PROJECT_DIR}/data" 2>/dev/null || true
        log "data 目錄已移除"
    else
        log "data 目錄中還有其他檔案，保留目錄"
    fi
fi

# 移除上傳檔案和 uploads 目錄
if [ -d "${PROJECT_DIR}/uploads" ]; then
    log "移除上傳檔案..."
    rm -rf "${PROJECT_DIR}/uploads"/*
    # 如果 uploads 目錄為空，也移除它
    if [ -z "$(ls -A ${PROJECT_DIR}/uploads 2>/dev/null)" ]; then
        rmdir "${PROJECT_DIR}/uploads" 2>/dev/null || true
        log "uploads 目錄已移除"
    else
        log "uploads 目錄中還有其他檔案，保留目錄"
    fi
    log "上傳檔案已移除"
fi

# 移除日誌檔案
log "清理日誌檔案..."
rm -f "${PROJECT_DIR}"/*.log 2>/dev/null || true

# 移除臨時檔案和目錄
log "清理臨時檔案..."
rm -rf "${PROJECT_DIR}/temp_restore_"* 2>/dev/null || true
rm -rf "${PROJECT_DIR}/temp_uninstall_backup" 2>/dev/null || true
rm -rf "${PROJECT_DIR}/temp_restore_backup" 2>/dev/null || true

# 移除其他可能的臨時目錄
rm -rf "${PROJECT_DIR}/.tmp" 2>/dev/null || true
rm -rf "${PROJECT_DIR}/tmp" 2>/dev/null || true

# 移除可能的快取目錄
if [ -d "${PROJECT_DIR}/.cache" ]; then
    log "移除快取目錄..."
    rm -rf "${PROJECT_DIR}/.cache"
    log "快取目錄已移除"
fi

# 移除可能的建置產物
if [ -d "${PROJECT_DIR}/dist" ]; then
    log "移除建置產物目錄..."
    rm -rf "${PROJECT_DIR}/dist"
    log "建置產物目錄已移除"
fi
if [ -d "${PROJECT_DIR}/build" ]; then
    log "移除建置目錄..."
    rm -rf "${PROJECT_DIR}/build"
    log "建置目錄已移除"
fi

# 移除可能的測試覆蓋率報告
if [ -d "${PROJECT_DIR}/coverage" ]; then
    log "移除測試覆蓋率報告..."
    rm -rf "${PROJECT_DIR}/coverage"
    log "測試覆蓋率報告已移除"
fi

# 步驟 4: 移除整個安裝目錄（如果是在 /opt 下）
log "步驟 4/4: 移除安裝目錄..."
if [ "$PROJECT_DIR" = "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR" ]; then
    log "移除安裝目錄: $INSTALL_DIR"
    # 先確保服務已停止（使用前面檢測到的服務名稱）
    if [ -n "$SERVICE_NAME" ] && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
        sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
        sudo systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
        sleep 2
    fi
    # 移除整個安裝目錄
    rm -rf "$INSTALL_DIR" || warning "無法完全移除安裝目錄，可能需要手動清理"
    log "安裝目錄已移除"
elif [ "$(dirname "$PROJECT_DIR")" = "/opt" ]; then
    # 如果是在 /opt 下但不是 INSTALL_DIR，也移除
    log "移除安裝目錄: $PROJECT_DIR"
    rm -rf "$PROJECT_DIR" || warning "無法完全移除安裝目錄，可能需要手動清理"
    log "安裝目錄已移除"
else
    log "不在標準安裝目錄中（非 /opt 路徑），跳過移除安裝目錄步驟"
    info "如需移除開發目錄，請手動執行: rm -rf $PROJECT_DIR"
fi

log "移除完成"

echo ""
echo "============================================"
echo -e "${GREEN}  系統移除完成！${NC}"
echo "============================================"
echo ""
log "移除操作完成"
info "備份檔案已保留: $(basename $UNINSTALL_BACKUP)"
info "備份位置: $BACKUP_DIR"
echo ""
echo "已移除的內容："
echo "  ✓ node_modules/"
echo "  ✓ data/ 目錄（含資料庫）"
echo "  ✓ uploads/ 目錄（含上傳檔案）"
echo "  ✓ 日誌檔案"
echo "  ✓ 臨時檔案和目錄"
echo "  ✓ 快取目錄"
echo "  ✓ 建置產物目錄"
echo ""
echo "保留的內容："
echo "  - 原始碼 (src/)"
echo "  - 靜態資源 (public/)"
echo "  - 遷移腳本 (migrations/)"
echo "  - 設定檔 (package.json 等)"
echo "  - 備份檔案 (backups/)"
echo ""
echo "重新安裝系統："
echo "  ./install.sh"
echo ""
echo "還原備份："
echo "  ./restore.sh uninstall_backup_${TIMESTAMP}.tar.gz"
echo ""

