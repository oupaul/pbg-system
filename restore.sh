#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 還原腳本

# 注意：不要使用 set -e，因為我們需要捕獲錯誤並正確處理
# set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日誌函數（必須在最前面定義）
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

# 專案目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 列出 /opt 下可能的安裝目錄
list_install_dirs() {
    local dirs=()
    local index=1
    
    echo "可用的安裝目錄：" >&2
    # 掃描 /opt 下所有包含 package.json 的目錄
    while IFS= read -r dir; do
        if [ -d "$dir" ] && [ -f "${dir}/package.json" ]; then
            dirs+=("$dir")
            local dirname=$(basename "$dir")
            local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "未知")
            printf "  [%2d] %s (大小: %s)\n" "$index" "$dir" "$size" >&2
            ((index++))
        fi
    done < <(find /opt -maxdepth 1 -type d 2>/dev/null | sort)
    
    # 也檢查當前目錄（如果是開發環境）
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
        read -p "$(echo -e ${YELLOW}請選擇要還原到的安裝目錄編號 [1-${#dirs[@]}]，或按 q 取消:${NC}) " selection
        if [[ "$selection" =~ ^[Qq]$ ]]; then
            log "還原操作已取消" >&2
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
    # 掃描所有包含 invoice-bonus 或類似名稱的服務（排除 backup 和 timer）
    while IFS= read -r service; do
        if [ -n "$service" ]; then
            services+=("$service")
            local status=$(systemctl is-active "$service" 2>/dev/null || echo "unknown")
            local enabled=$(systemctl is-enabled "$service" 2>/dev/null || echo "unknown")
            printf "  [%2d] %s (狀態: %s, 啟用: %s)\n" "$index" "$service" "$status" "$enabled" >&2
            ((index++))
        fi
    done < <(systemctl list-unit-files --type=service 2>/dev/null | grep -E "(invoice-bonus|invoice.*bonus|project-system|fund-weekly)" | grep -v -E "(backup|timer)" | awk '{print $1}' | sort)
    
    if [ ${#services[@]} -eq 0 ]; then
        echo "  未找到相關服務" >&2
        return 1
    fi
    
    # 返回選中的服務
    while true; do
        read -p "$(echo -e ${YELLOW}請選擇要操作的服務編號 [1-${#services[@]}]，或按 s 跳過:${NC}) " selection
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
    INSTALL_DIR="/opt/${INSTALL_DIR_NAME}"
    BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
    warning "未找到配置文件，使用預設值"
fi

# 備份目錄：優先使用 /opt 下的備份目錄，否則使用專案目錄下的備份目錄
BACKUP_BASE_DIR="$BACKUP_DIR"
if [ ! -d "$BACKUP_BASE_DIR" ]; then
    BACKUP_DIR="${PROJECT_DIR}/backups"
else
    BACKUP_DIR="$BACKUP_BASE_DIR"
fi

# 確定當前用戶（用於設定檔案所有權）
CURRENT_USER=${SUDO_USER:-$USER}
if [ -z "$CURRENT_USER" ] || [ "$CURRENT_USER" = "root" ]; then
    CURRENT_USER=$(whoami)
fi

# 追蹤服務狀態（用於還原後決定是否重啟）
SERVICE_WAS_RUNNING=0

# 確認函數
confirm() {
    # 如果設置了 NON_INTERACTIVE，自動確認
    if [ -n "$NON_INTERACTIVE" ]; then
        log "非交互式模式，自動確認"
        return 0
    fi
    read -p "$(echo -e ${YELLOW}$1${NC}) [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        return 1
    fi
    return 0
}

# 開始還原
echo "============================================"
echo "  專案開立發票業績認列獎金計算總表系統"
echo "  還原程式"
echo "============================================"
echo ""

# 初始化 SERVICE_NAME 變數（將在選擇服務時設定）
SERVICE_NAME=""

# 列出所有備份檔案並返回陣列
declare -a BACKUP_FILES_ARRAY

list_backups() {
    BACKUP_FILES_ARRAY=()
    local index=1
    
    # 查找所有備份檔案（包括 backup_*.tar.gz 和 uninstall_backup_*.tar.gz）
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            BACKUP_FILES_ARRAY+=("$file")
        fi
    done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "backup_*.tar.gz" -o -name "uninstall_backup_*.tar.gz" \) 2>/dev/null | sort -r)
    
    if [ ${#BACKUP_FILES_ARRAY[@]} -eq 0 ]; then
        echo "  無備份檔案"
        return 1
    fi
    
    echo "可用的備份檔案："
    for file in "${BACKUP_FILES_ARRAY[@]}"; do
        local filename=$(basename "$file")
        local size=$(du -h "$file" | cut -f1)
        local mtime=$(stat -c %y "$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1 2>/dev/null || stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$file" 2>/dev/null || echo "未知")
        printf "  [%2d] %s\n" "$index" "$filename"
        printf "       大小: %s, 建立時間: %s\n" "$size" "$mtime"
        ((index++))
    done
    
    return 0
}

# 檢查備份檔案
if [ -z "$1" ]; then
    # 互動式選擇備份檔案
    if ! list_backups; then
        error "沒有可用的備份檔案"
    fi
    
    echo ""
    
    # 讓用戶選擇（非交互模式下不應該進入這裡，但如果進入了，選擇第一個）
    if [ -n "$NON_INTERACTIVE" ]; then
        if [ ${#BACKUP_FILES_ARRAY[@]} -gt 0 ]; then
            BACKUP_FILE="${BACKUP_FILES_ARRAY[0]}"
            log "非交互式模式，自動選擇第一個備份: $(basename "$BACKUP_FILE")"
        else
            error "非交互式模式下沒有可用的備份檔案"
        fi
    else
    while true; do
        read -p "$(echo -e ${YELLOW}請選擇要還原的備份編號 [1-${#BACKUP_FILES_ARRAY[@]}]，或按 q 取消:${NC}) " selection
        if [[ "$selection" =~ ^[Qq]$ ]]; then
            log "還原操作已取消"
            exit 0
        fi
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#BACKUP_FILES_ARRAY[@]}" ]; then
            BACKUP_FILE="${BACKUP_FILES_ARRAY[$((selection-1))]}"
            break
        else
            echo -e "${RED}無效的選擇，請輸入 1-${#BACKUP_FILES_ARRAY[@]} 之間的數字，或按 q 取消${NC}"
        fi
    done
    fi
else
    BACKUP_FILE="$1"
    
    # 如果提供的是完整路徑，直接使用
    if [[ "$BACKUP_FILE" == /* ]]; then
        # 已經是絕對路徑，直接使用
        if [ ! -f "$BACKUP_FILE" ]; then
            error "備份檔案不存在: $BACKUP_FILE"
        fi
    elif [[ "$BACKUP_FILE" == ./* ]]; then
        # 相對路徑，轉換為絕對路徑
        BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
    if [ ! -f "$BACKUP_FILE" ]; then
        error "備份檔案不存在: $BACKUP_FILE"
        fi
    else
        # 只提供檔名，嘗試在多個位置查找
        local found=0
        # 先嘗試 BACKUP_DIR
        if [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
            BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
            found=1
        # 再嘗試專案目錄下的備份目錄
        elif [ -f "${PROJECT_DIR}/backups/${BACKUP_FILE}" ]; then
            BACKUP_FILE="${PROJECT_DIR}/backups/${BACKUP_FILE}"
            found=1
        fi
        
        if [ $found -eq 0 ]; then
            error "備份檔案不存在: $BACKUP_FILE (已檢查: ${BACKUP_DIR} 和 ${PROJECT_DIR}/backups)"
        fi
    fi
fi

# 確保備份檔案為絕對路徑（避免後續 cd 之後路徑失效）
# 如果還不是絕對路徑，轉換為絕對路徑
if [[ "$BACKUP_FILE" != /* ]]; then
    # 如果已經是相對路徑，轉換為絕對路徑
    if [[ "$BACKUP_FILE" == ./* ]]; then
        BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
    else
    BACKUP_FILE="${PROJECT_DIR}/${BACKUP_FILE#./}"
    fi
fi

# 再次確認檔案存在
if [ ! -f "$BACKUP_FILE" ]; then
    error "備份檔案不存在: $BACKUP_FILE"
fi

log "找到備份檔案: $BACKUP_FILE"
if [ ! -f "$BACKUP_FILE" ]; then
    error "備份檔案不存在或無法讀取: $BACKUP_FILE"
fi
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
BACKUP_BYTES=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")
log "備份大小: $BACKUP_SIZE ($BACKUP_BYTES bytes)"
if [ "$BACKUP_BYTES" -eq 0 ]; then
    error "備份檔案大小為 0，檔案可能損壞"
fi
info "備份大小: $BACKUP_SIZE"

# 警告訊息
warning "還原操作將覆蓋現有的資料庫和上傳檔案！"
# 確認操作（confirm 函數內部會檢查 NON_INTERACTIVE）
if ! confirm "確定要繼續還原嗎？"; then
    log "還原操作已取消"
    exit 0
fi

# 在還原前先備份現有資料
log "在還原前先備份現有資料..."
TEMP_BACKUP="${BACKUP_DIR}/temp_backup_before_restore_$(date +'%Y%m%d_%H%M%S').tar.gz"
mkdir -p "${PROJECT_DIR}/temp_restore_backup"
if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    cp "${PROJECT_DIR}/data/invoice_bonus.db" "${PROJECT_DIR}/temp_restore_backup/invoice_bonus.db"
fi
if [ -d "${PROJECT_DIR}/uploads" ] && [ "$(ls -A ${PROJECT_DIR}/uploads 2>/dev/null)" ]; then
    cp -r "${PROJECT_DIR}/uploads" "${PROJECT_DIR}/temp_restore_backup/" 2>/dev/null || true
fi
cd "${PROJECT_DIR}"
tar -czf "$TEMP_BACKUP" -C "${PROJECT_DIR}/temp_restore_backup" . 2>/dev/null || true
rm -rf "${PROJECT_DIR}/temp_restore_backup"
if [ -f "$TEMP_BACKUP" ]; then
    log "現有資料已備份至: $(basename $TEMP_BACKUP)"
fi

# 解壓備份檔案
log "解壓備份檔案..."
log "備份檔案路徑: $BACKUP_FILE"
log "備份檔案大小: $(du -h "$BACKUP_FILE" | cut -f1)"

TEMP_DIR="/tmp/invoice_bonus_restore_$(date +'%Y%m%d_%H%M%S')"
mkdir -p "$TEMP_DIR" || error "無法創建臨時目錄: $TEMP_DIR"
cd "$TEMP_DIR" || error "無法進入臨時目錄: $TEMP_DIR"

log "開始解壓到: $TEMP_DIR"
tar -xzf "$BACKUP_FILE" || error "備份檔案解壓失敗"

# 調試：列出解壓後的內容
log "解壓後的目錄內容："
ls -la "$TEMP_DIR" || true
log "解壓後的目錄樹結構："
find "$TEMP_DIR" -maxdepth 3 -type f -o -type d | head -30 | sed "s|^|  |" || true

# 檢查備份內容（支援多種備份格式）
RESTORE_DIR=""
log "檢查解壓後的目錄結構..."

# 先嘗試查找 backup.sh 創建的備份格式（backup_YYYYMMDD_HHMMSS）
if [ -z "$RESTORE_DIR" ]; then
    RESTORE_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d -name "backup_*" 2>/dev/null | head -n 1)
    if [ -n "$RESTORE_DIR" ]; then
        RESTORE_DIR=$(basename "$RESTORE_DIR")
        log "找到 backup.sh 格式的備份目錄: $RESTORE_DIR"
    fi
fi

    # 嘗試查找 uninstall.sh 創建的備份格式（temp_uninstall_backup）
if [ -z "$RESTORE_DIR" ]; then
    if [ -d "$TEMP_DIR/temp_uninstall_backup" ]; then
        RESTORE_DIR="temp_uninstall_backup"
        log "找到 uninstall.sh 格式的備份目錄: $RESTORE_DIR"
    fi
fi

# 如果還是找不到，檢查是否有直接解壓的檔案
if [ -z "$RESTORE_DIR" ]; then
    if [ -f "$TEMP_DIR/invoice_bonus.db" ] || [ -d "$TEMP_DIR/data" ] || [ -d "$TEMP_DIR/uploads" ]; then
        RESTORE_DIR="."
        log "找到直接解壓的檔案，使用當前目錄"
    fi
fi

# 最後嘗試搜尋整個臨時目錄
if [ -z "$RESTORE_DIR" ]; then
    log "搜尋整個臨時目錄..."
    FOUND_DB=$(find "$TEMP_DIR" -name "invoice_bonus.db" -type f 2>/dev/null | head -n 1)
    if [ -n "$FOUND_DB" ]; then
        RESTORE_DIR=$(dirname "$FOUND_DB")
        RESTORE_DIR="${RESTORE_DIR#$TEMP_DIR/}"
        if [ "$RESTORE_DIR" = "$TEMP_DIR" ]; then
            RESTORE_DIR="."
        fi
        log "通過搜尋找到資料庫，備份目錄: $RESTORE_DIR"
    fi
fi

if [ -z "$RESTORE_DIR" ]; then
    error "無法找到備份目錄。解壓後的內容：$(ls -la $TEMP_DIR 2>&1)"
fi

log "使用備份目錄: $RESTORE_DIR"

# 檢查資料庫位置（使用絕對路徑）
log "檢查資料庫位置..."
RESTORE_FULL_DIR="$TEMP_DIR"
if [ "$RESTORE_DIR" != "." ]; then
    RESTORE_FULL_DIR="$TEMP_DIR/$RESTORE_DIR"
fi

log "完整備份目錄路徑: $RESTORE_FULL_DIR"

log "備份內容："
if [ -f "$RESTORE_FULL_DIR/backup_info.txt" ]; then
    cat "$RESTORE_FULL_DIR/backup_info.txt"
    echo ""
elif [ -f "$RESTORE_FULL_DIR/uninstall_info.txt" ]; then
    cat "$RESTORE_FULL_DIR/uninstall_info.txt"
    echo ""
fi

# 還原資料庫（支援多種備份格式）
log "還原資料庫..."
DB_SOURCE=""

# 按優先順序檢查可能的資料庫位置
log "檢查資料庫位置，RESTORE_FULL_DIR: $RESTORE_FULL_DIR"
log "檢查路徑 1: $RESTORE_FULL_DIR/invoice_bonus.db"
log "檢查路徑 2: $RESTORE_FULL_DIR/data/invoice_bonus.db"
log "檢查路徑 3: $TEMP_DIR/invoice_bonus.db"
log "檢查路徑 4: $TEMP_DIR/data/invoice_bonus.db"

if [ -f "$RESTORE_FULL_DIR/invoice_bonus.db" ]; then
    # backup.sh 格式：資料庫直接在備份目錄下
    DB_SOURCE="$RESTORE_FULL_DIR/invoice_bonus.db"
    log "✓ 找到資料庫（backup.sh 格式）: $DB_SOURCE"
    DB_SIZE=$(stat -f%z "$DB_SOURCE" 2>/dev/null || stat -c%s "$DB_SOURCE" 2>/dev/null || echo "0")
    log "  資料庫大小: $DB_SIZE bytes"
elif [ -f "$RESTORE_FULL_DIR/data/invoice_bonus.db" ]; then
    # uninstall.sh 格式：資料庫在 data 子目錄下
    DB_SOURCE="$RESTORE_FULL_DIR/data/invoice_bonus.db"
    log "✓ 找到資料庫（uninstall.sh 格式）: $DB_SOURCE"
    DB_SIZE=$(stat -f%z "$DB_SOURCE" 2>/dev/null || stat -c%s "$DB_SOURCE" 2>/dev/null || echo "0")
    log "  資料庫大小: $DB_SIZE bytes"
elif [ -f "$TEMP_DIR/invoice_bonus.db" ]; then
    # 直接解壓在臨時目錄的情況
    DB_SOURCE="$TEMP_DIR/invoice_bonus.db"
    log "✓ 找到資料庫（直接解壓）: $DB_SOURCE"
    DB_SIZE=$(stat -f%z "$DB_SOURCE" 2>/dev/null || stat -c%s "$DB_SOURCE" 2>/dev/null || echo "0")
    log "  資料庫大小: $DB_SIZE bytes"
elif [ -f "$TEMP_DIR/data/invoice_bonus.db" ]; then
    # 直接解壓在臨時目錄的 data 子目錄
    DB_SOURCE="$TEMP_DIR/data/invoice_bonus.db"
    log "✓ 找到資料庫（直接解壓 data 子目錄）: $DB_SOURCE"
    DB_SIZE=$(stat -f%z "$DB_SOURCE" 2>/dev/null || stat -c%s "$DB_SOURCE" 2>/dev/null || echo "0")
    log "  資料庫大小: $DB_SIZE bytes"
else
    log "✗ 未在預期位置找到資料庫，開始搜尋..."
    find "$TEMP_DIR" -name "invoice_bonus.db" -type f 2>/dev/null | while read found_db; do
        log "  找到資料庫: $found_db"
    done
fi

if [ -n "$DB_SOURCE" ] && [ -f "$DB_SOURCE" ]; then
    # 驗證資料庫檔案大小
    SOURCE_SIZE=$(stat -f%z "$DB_SOURCE" 2>/dev/null || stat -c%s "$DB_SOURCE" 2>/dev/null || echo "0")
    log "資料庫來源檔案: $DB_SOURCE, 大小: $SOURCE_SIZE bytes"
    
    if [ "$SOURCE_SIZE" -lt 1000 ]; then
        warning "資料庫檔案過小 (${SOURCE_SIZE} bytes)，可能損壞或為空"
    fi
    
    # 確保目標目錄存在
    mkdir -p "${PROJECT_DIR}/data" || error "無法創建資料目錄: ${PROJECT_DIR}/data"
    
    # 如果目標檔案存在，先備份
    if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        log "備份現有資料庫..."
        mv "${PROJECT_DIR}/data/invoice_bonus.db" "${PROJECT_DIR}/data/invoice_bonus.db.backup_$(date +'%Y%m%d_%H%M%S')" || warning "無法備份現有資料庫"
    fi
    
    # 處理服務狀態
    # ⚠️ 重要：better-sqlite3 需要重啟服務才能載入還原的資料庫
    # 無論交互或非交互模式，都需要停止服務
    # 如果之前没有选择服务，现在选择
    if [ -z "$SERVICE_NAME" ]; then
        SELECTED_SERVICE=$(list_services)
        if [ -n "$SELECTED_SERVICE" ]; then
            SERVICE_NAME=$(echo "$SELECTED_SERVICE" | sed 's/\.service$//')
            log "已選擇服務: $SERVICE_NAME"
        fi
    fi
    SERVICE_WAS_RUNNING=0
    
    log "停止服務以確保資料庫檔案安全還原..."
    if [ -n "$SERVICE_NAME" ] && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
        if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
            SERVICE_WAS_RUNNING=1
            log "服務正在運行，先停止服務..."
            sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || warning "無法停止服務"
            
            # 等待服務完全停止
            sleep 3
            
            # 檢查並清理佔用端口的進程（從配置文件讀取端口，或使用預設值 3000）
            PORT=$(grep -E "^PORT=" "${DEPLOY_CONFIG_FILE}" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "3000")
            PORT_PID=$(sudo lsof -ti:${PORT} 2>/dev/null || echo "")
            if [ -n "$PORT_PID" ]; then
                warning "檢測到端口 ${PORT} 仍被佔用 (PID: $PORT_PID)，正在終止..."
                sudo kill -9 "$PORT_PID" 2>/dev/null || warning "無法終止進程，可能需要手動處理"
                sleep 2
            fi
            
            # 再次確認服務狀態
            if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
                warning "服務可能仍在運行，嘗試強制停止..."
                sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
                sleep 2
            else
                log "✓ 服務已成功停止"
            fi
        else
            log "服務未運行，直接還原..."
            # 即使服務未運行，也檢查端口是否被佔用（可能有殘留進程）
            PORT=$(grep -E "^PORT=" "${DEPLOY_CONFIG_FILE}" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "3000")
            PORT_PID=$(sudo lsof -ti:${PORT} 2>/dev/null || echo "")
            if [ -n "$PORT_PID" ]; then
                warning "檢測到端口 ${PORT} 被佔用 (PID: $PORT_PID)，正在清理..."
                sudo kill -9 "$PORT_PID" 2>/dev/null || true
                sleep 1
            fi
        fi
    else
        log "systemd 服務不存在，直接還原..."
    fi
    
    # 複製資料庫檔案
    log "複製資料庫檔案從 $DB_SOURCE 到 ${PROJECT_DIR}/data/invoice_bonus.db"
    
    # 如果目標檔案存在，先移除（確保完全替換）
    # ⚠️ 重要：also remove WAL and SHM files (better-sqlite3 WAL mode)
    if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        log "移除現有資料庫檔案和 WAL 檔案..."
        rm -f "${PROJECT_DIR}/data/invoice_bonus.db" || warning "無法移除現有資料庫檔案"
        rm -f "${PROJECT_DIR}/data/invoice_bonus.db-wal" || true
        rm -f "${PROJECT_DIR}/data/invoice_bonus.db-shm" || true
        log "✓ 已清理所有資料庫相關檔案（包含 WAL/SHM）"
    fi
    
    # 執行複製
    cp "$DB_SOURCE" "${PROJECT_DIR}/data/invoice_bonus.db" || error "資料庫還原失敗: 無法複製檔案"
    
    # 設置正確的權限和所有權
    chmod 644 "${PROJECT_DIR}/data/invoice_bonus.db" || warning "無法設置資料庫檔案權限"
    chown ${CURRENT_USER}:${CURRENT_USER} "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || true
    
    # 驗證還原後的資料庫檔案
    if [ ! -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        error "資料庫還原失敗: 目標檔案不存在"
    fi
    
    RESTORED_SIZE=$(stat -f%z "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || stat -c%s "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || echo "0")
    log "還原後資料庫檔案大小: $RESTORED_SIZE bytes"
    
    if [ "$RESTORED_SIZE" -ne "$SOURCE_SIZE" ]; then
        error "資料庫檔案大小不一致 (原始: ${SOURCE_SIZE}, 還原後: ${RESTORED_SIZE})"
    fi
    
    if [ "$RESTORED_SIZE" -eq 0 ]; then
        error "資料庫還原失敗: 檔案大小為 0"
    fi
    
    log "✓ 資料庫檔案複製成功"
    
    DB_SIZE=$(du -h "${PROJECT_DIR}/data/invoice_bonus.db" | cut -f1)
    log "資料庫還原完成，大小: $DB_SIZE"
    
    # 嘗試驗證資料庫內容（如果 sqlite3 可用）
    if command -v sqlite3 >/dev/null 2>&1; then
        log "驗證資料庫內容..."
        # 等待一下，確保檔案已完全寫入
        sleep 2
        TABLE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
        log "資料表數量: $TABLE_COUNT"
        
        if [ "$TABLE_COUNT" -gt 0 ]; then
            log "資料庫包含 $TABLE_COUNT 個資料表"
            # 檢查是否有資料
            PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
            CUSTOMER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
            INVOICE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
            PAYMENT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM payments;" 2>/dev/null || echo "0")
            USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
            log "資料統計：專案 $PROJECT_COUNT 筆，客戶 $CUSTOMER_COUNT 筆，發票 $INVOICE_COUNT 筆，收款 $PAYMENT_COUNT 筆，用戶 $USER_COUNT 筆"
            
            if [ "$PROJECT_COUNT" -eq 0 ] && [ "$CUSTOMER_COUNT" -eq 0 ] && [ "$INVOICE_COUNT" -eq 0 ] && [ "$USER_COUNT" -eq 0 ]; then
                warning "資料庫檔案存在但沒有資料，可能備份時資料庫為空或備份失敗"
            else
                log "✓ 資料庫包含資料，還原成功"
            fi
        else
            warning "資料庫檔案存在但沒有資料表，可能損壞或格式不兼容（舊版 sql.js）"
            warning "嘗試自動修復資料庫結構..."
            
            # 備份損壞的資料庫
            mv "${PROJECT_DIR}/data/invoice_bonus.db" "${PROJECT_DIR}/data/invoice_bonus.db.corrupted-$(date +%Y%m%d_%H%M%S)"
            log "已備份損壞的資料庫檔案"
            
            # 執行資料庫遷移來重建結構
            log "執行資料庫遷移..."
            cd "${PROJECT_DIR}"
            npm run migrate >/dev/null 2>&1
            
            if [ $? -eq 0 ]; then
                # 再次驗證
                NEW_TABLE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
                if [ "$NEW_TABLE_COUNT" -gt 0 ]; then
                    warning "✓ 資料庫結構已重建（$NEW_TABLE_COUNT 個資料表）"
                    warning "⚠️  注意：資料庫已重建為全新結構，原備份資料不兼容"
                    warning "⚠️  預設管理員帳號: admin / admin123"
                    warning "⚠️  請使用今天的備份（編號 3 或 4）來恢復實際資料"
                else
                    error "資料庫修復失敗"
                fi
            else
                error "資料庫遷移失敗，請手動執行: cd ${PROJECT_DIR} && npm run migrate"
            fi
        fi
    else
        warning "sqlite3 不可用，無法驗證資料庫內容"
    fi
else
    warning "備份中沒有直接找到資料庫檔案，嘗試搜尋..."
    FOUND_DB=$(find "$TEMP_DIR" -name "invoice_bonus.db" 2>/dev/null | head -n 1)
    if [ -n "$FOUND_DB" ] && [ -f "$FOUND_DB" ]; then
        log "找到資料庫（搜尋結果）: $FOUND_DB"
        # 驗證資料庫檔案大小
        SOURCE_SIZE=$(stat -f%z "$FOUND_DB" 2>/dev/null || stat -c%s "$FOUND_DB" 2>/dev/null || echo "0")
        if [ "$SOURCE_SIZE" -lt 1000 ]; then
            warning "資料庫檔案過小 (${SOURCE_SIZE} bytes)，可能損壞或為空"
        fi
        
        mkdir -p "${PROJECT_DIR}/data"
        cp "$FOUND_DB" "${PROJECT_DIR}/data/invoice_bonus.db" || error "資料庫還原失敗"
        
        # 驗證還原後的資料庫檔案
        RESTORED_SIZE=$(stat -f%z "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || stat -c%s "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || echo "0")
        if [ "$RESTORED_SIZE" -ne "$SOURCE_SIZE" ]; then
            warning "資料庫檔案大小不一致 (原始: ${SOURCE_SIZE}, 還原後: ${RESTORED_SIZE})"
        fi
        
        DB_SIZE=$(du -h "${PROJECT_DIR}/data/invoice_bonus.db" | cut -f1)
        log "資料庫還原完成，大小: $DB_SIZE"
        
        # 嘗試驗證資料庫內容（如果 sqlite3 可用）
        if command -v sqlite3 >/dev/null 2>&1; then
            log "驗證資料庫內容..."
            TABLE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
            if [ "$TABLE_COUNT" -gt 0 ]; then
                log "資料庫包含 $TABLE_COUNT 個資料表"
                # 檢查是否有資料
                PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
                CUSTOMER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
                INVOICE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
                log "資料統計：專案 $PROJECT_COUNT 筆，客戶 $CUSTOMER_COUNT 筆，發票 $INVOICE_COUNT 筆"
            else
                warning "資料庫檔案存在但沒有資料表，可能損壞"
            fi
        fi
    else
        warning "備份中沒有資料庫檔案，搜尋也未找到"
        log "已檢查的位置："
        log "  - ${RESTORE_DIR}/invoice_bonus.db"
        log "  - ${RESTORE_DIR}/data/invoice_bonus.db"
        log "  - ${TEMP_DIR}/invoice_bonus.db"
        log "  - ${TEMP_DIR}/data/invoice_bonus.db"
    fi
fi

# 還原上傳檔案
log "還原上傳檔案..."
UPLOADS_SOURCE=""
if [ -d "$RESTORE_FULL_DIR/uploads" ] && [ "$(ls -A $RESTORE_FULL_DIR/uploads 2>/dev/null)" ]; then
    UPLOADS_SOURCE="$RESTORE_FULL_DIR/uploads"
    log "找到上傳檔案目錄: $RESTORE_FULL_DIR/uploads"
elif [ -d "$TEMP_DIR/uploads" ] && [ "$(ls -A $TEMP_DIR/uploads 2>/dev/null)" ]; then
    UPLOADS_SOURCE="$TEMP_DIR/uploads"
    log "找到上傳檔案目錄: $TEMP_DIR/uploads"
fi

if [ -n "$UPLOADS_SOURCE" ] && [ -d "$UPLOADS_SOURCE" ]; then
    log "上傳檔案來源目錄: $UPLOADS_SOURCE"
    mkdir -p "${PROJECT_DIR}/uploads" || error "無法創建上傳目錄: ${PROJECT_DIR}/uploads"
    
    # 備份現有上傳檔案
    if [ -d "${PROJECT_DIR}/uploads" ] && [ "$(ls -A ${PROJECT_DIR}/uploads 2>/dev/null)" ]; then
        log "備份現有上傳檔案..."
        mv "${PROJECT_DIR}/uploads" "${PROJECT_DIR}/uploads.backup_$(date +'%Y%m%d_%H%M%S')" || warning "無法備份現有上傳檔案"
    fi
    
    # 重新創建上傳目錄
    mkdir -p "${PROJECT_DIR}/uploads" || error "無法創建上傳目錄"
    
    # 複製上傳檔案
    log "複製上傳檔案從 $UPLOADS_SOURCE 到 ${PROJECT_DIR}/uploads"
    cp -r "${UPLOADS_SOURCE}"/* "${PROJECT_DIR}/uploads/" 2>/dev/null || warning "部分上傳檔案還原失敗"
    
    # 設置正確的權限
    chmod -R 755 "${PROJECT_DIR}/uploads" || warning "無法設置上傳目錄權限"
    
    UPLOADS_COUNT=$(find "${PROJECT_DIR}/uploads" -type f 2>/dev/null | wc -l)
    log "上傳檔案還原完成，檔案數: $UPLOADS_COUNT"
    
    if [ "$UPLOADS_COUNT" -eq 0 ]; then
        warning "上傳檔案目錄為空，可能還原失敗"
    fi
else
    info "備份中沒有上傳檔案或上傳檔案目錄不存在"
fi

# 還原設定檔
log "還原設定檔..."
if [ -f "$RESTORE_FULL_DIR/.env" ]; then
    log "找到 .env 檔案: $RESTORE_FULL_DIR/.env"
    # 備份現有 .env
    if [ -f "${PROJECT_DIR}/.env" ]; then
        cp "${PROJECT_DIR}/.env" "${PROJECT_DIR}/.env.backup_$(date +'%Y%m%d_%H%M%S')" || warning "無法備份現有 .env"
    fi
    cp "$RESTORE_FULL_DIR/.env" "${PROJECT_DIR}/.env" || warning ".env 檔案還原失敗"
    chmod 644 "${PROJECT_DIR}/.env" || warning "無法設置 .env 檔案權限"
    log ".env 檔案還原完成"
else
    info "備份中沒有 .env 檔案"
fi

# 清理臨時目錄
log "清理臨時檔案..."
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR" || warning "無法完全清理臨時目錄: $TEMP_DIR"
log "臨時檔案已清理"
else
    log "臨時目錄不存在，跳過清理"
fi

# 檢查套件版本（僅提示）
if [ -f "$RESTORE_FULL_DIR/package.json" ]; then
    info "備份時的套件版本資訊："
    BACKUP_VERSION=$(grep -A 1 '"version"' "$RESTORE_FULL_DIR/package.json" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -n 1)
    if [ -f "${PROJECT_DIR}/package.json" ]; then
        CURRENT_VERSION=$(grep -A 1 '"version"' "${PROJECT_DIR}/package.json" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -n 1)
        if [ "$BACKUP_VERSION" != "$CURRENT_VERSION" ]; then
            warning "備份版本 ($BACKUP_VERSION) 與當前版本 ($CURRENT_VERSION) 不同"
            info "建議執行: npm install 以確保套件版本一致"
        fi
    fi
fi

# 最終驗證
log "進行最終驗證..."
if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    FINAL_SIZE=$(stat -f%z "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || stat -c%s "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || echo "0")
    if [ "$FINAL_SIZE" -gt 0 ]; then
        log "✓ 資料庫檔案驗證成功，大小: $FINAL_SIZE bytes"
        
        # 確保資料庫檔案權限正確
        chmod 644 "${PROJECT_DIR}/data/invoice_bonus.db" || warning "無法設置資料庫檔案權限"
        chown ${CURRENT_USER}:${CURRENT_USER} "${PROJECT_DIR}/data/invoice_bonus.db" 2>/dev/null || true
        
        # 如果 sqlite3 可用，驗證資料庫結構
        if command -v sqlite3 >/dev/null 2>&1; then
            # 等待一下，確保檔案已完全寫入
            sleep 1
            TABLE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
            if [ "$TABLE_COUNT" -gt 0 ]; then
                PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
                CUSTOMER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
                INVOICE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
                PAYMENT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM payments;" 2>/dev/null || echo "0")
                log "✓ 資料庫包含 $TABLE_COUNT 個資料表，專案 $PROJECT_COUNT 筆，客戶 $CUSTOMER_COUNT 筆，發票 $INVOICE_COUNT 筆，收款 $PAYMENT_COUNT 筆"
                
                if [ "$PROJECT_COUNT" -eq 0 ] && [ "$CUSTOMER_COUNT" -eq 0 ] && [ "$INVOICE_COUNT" -eq 0 ]; then
                    warning "資料庫檔案存在但沒有資料，可能備份時資料庫為空"
                fi
            else
                warning "資料庫檔案存在但沒有資料表，可能損壞"
            fi
        fi
    else
        error "資料庫檔案大小為 0，還原可能失敗"
    fi
else
    error "資料庫檔案不存在，還原失敗"
fi

# 執行資料庫遷移（確保資料庫結構是最新的）
log "執行資料庫遷移以確保結構最新..."
cd "${PROJECT_DIR}"
if [ -d "${PROJECT_DIR}/migrations" ]; then
    log "執行增量遷移..."
    npm run migrate:project-code 2>/dev/null || warning "專案編號唯一約束遷移失敗（可能已存在）"
    npm run migrate:project-customer 2>/dev/null || warning "專案編號+客戶唯一約束遷移失敗（可能已存在）"
    npm run migrate:project-name 2>/dev/null || warning "專案編號+客戶+專案名稱唯一約束遷移失敗（可能已存在）"
    npm run migrate:user-roles 2>/dev/null || warning "使用者角色遷移失敗（可能已存在）"
    npm run migrate:system-settings 2>/dev/null || warning "系統設定表遷移失敗（可能已存在）"
    npm run migrate:project-types 2>/dev/null || warning "專案類型表遷移失敗（可能已存在）"
          npm run migrate:remove-project-type-check 2>/dev/null || warning "移除專案類型 CHECK 約束遷移失敗（可能已存在）"
          npm run migrate:sales-discount 2>/dev/null || warning "銷貨折讓欄位遷移失敗（可能已存在）"
          npm run migrate:costs 2>/dev/null || warning "成本明細表遷移失敗（可能已存在）"
          npm run migrate:update-total-received 2>/dev/null || warning "更新收款總額計算遷移失敗（可能已存在）"
    log "✓ 資料庫遷移完成"
else
    warning "找不到 migrations 目錄，跳過資料庫遷移"
fi

# 檢查並更新資料庫結構（處理舊備份缺少新欄位的情況）
log "檢查資料庫結構是否需要更新..."
if command -v sqlite3 >/dev/null 2>&1; then
    if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        # 檢查 expected_invoice_year_month 欄位是否存在
        FIELD_EXISTS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "PRAGMA table_info(projects);" 2>/dev/null | grep "expected_invoice_year_month" || echo "")
        
        if [ -z "$FIELD_EXISTS" ]; then
            log "偵測到舊備份：缺少 expected_invoice_year_month 欄位，正在添加..."
            
            # 備份資料庫（以防萬一）
            BACKUP_PATH="${PROJECT_DIR}/data/invoice_bonus.db.before-field-update-$(date +%Y%m%d_%H%M%S)"
            cp "${PROJECT_DIR}/data/invoice_bonus.db" "$BACKUP_PATH"
            log "資料庫已備份: $BACKUP_PATH"
            
            # 添加欄位
            ADD_RESULT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT;" 2>&1)
            ADD_EXIT_CODE=$?
            
            if [ $ADD_EXIT_CODE -eq 0 ]; then
                log "✓ expected_invoice_year_month 欄位添加成功"
            elif echo "$ADD_RESULT" | grep -q "duplicate column name"; then
                log "✓ expected_invoice_year_month 欄位已存在（跳過添加）"
            else
                warning "欄位添加失敗: $ADD_RESULT"
                warning "嘗試繼續更新視圖..."
            fi
            
            # 無論添加是否成功，都嘗試更新視圖
            if [ $ADD_EXIT_CODE -eq 0 ] || echo "$ADD_RESULT" | grep -q "duplicate column name"; then
                
                # 更新視圖定義（確保包含新欄位）
                log "更新 v_project_summary 視圖..."
                sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" <<'EOF'
BEGIN TRANSACTION;
DROP VIEW IF EXISTS v_project_summary;
CREATE VIEW v_project_summary AS
SELECT 
  p.id,
  p.project_code,
  p.contract_year,
  p.contract_month,
  p.status,
  p.project_type,
  p.project_name,
  p.price_with_tax,
  p.price_without_tax,
  p.is_new_customer,
  p.salesperson_id,
  p.customer_id,
  p.expected_invoice_year_month,
  p.notes,
  p.created_at,
  p.updated_at,
  s.name as salesperson_name,
  s.status as salesperson_status,
  c.customer_code,
  c.tax_id,
  c.company_name,
  COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as total_invoiced,
  p.price_with_tax - COALESCE((SELECT SUM(amount_with_tax) FROM invoices WHERE project_id = p.id), 0) as uninvoiced_amount,
  COALESCE((SELECT SUM(bank_deposit_amount) FROM payments WHERE project_id = p.id), 0) as total_received
FROM projects p
LEFT JOIN salespeople s ON p.salesperson_id = s.id
LEFT JOIN customers c ON p.customer_id = c.id;
COMMIT;
EOF
                
                if [ $? -eq 0 ]; then
                    log "✓ 視圖更新成功"
                    
                    # 驗證欄位
                    VERIFY=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "PRAGMA table_info(projects);" | grep "expected_invoice_year_month")
                    if [ -n "$VERIFY" ]; then
                        log "✓ 欄位驗證成功"
                    else
                        warning "欄位驗證失敗，但會繼續"
                    fi
                    
                    # 驗證視圖
                    VIEW_CHECK=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT sql FROM sqlite_master WHERE type='view' AND name='v_project_summary';" | grep "expected_invoice_year_month" || echo "")
                    if [ -n "$VIEW_CHECK" ]; then
                        log "✓ 視圖驗證成功（包含 expected_invoice_year_month）"
                    else
                        warning "視圖驗證失敗，但會繼續"
                    fi
                else
                    warning "視圖更新失敗，但會繼續"
                fi
            fi
        else
            log "✓ 資料庫結構已是最新（包含 expected_invoice_year_month）"
        fi
        
        # 檢查 users 表是否有 salesperson_id 欄位
        USER_FIELD_EXISTS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "PRAGMA table_info(users);" 2>/dev/null | grep "salesperson_id" || echo "")
        
        if [ -z "$USER_FIELD_EXISTS" ]; then
            log "偵測到舊備份：缺少 users.salesperson_id 欄位，正在添加..."
            sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "ALTER TABLE users ADD COLUMN salesperson_id INTEGER REFERENCES salespeople(id);" 2>/dev/null
            
            if [ $? -eq 0 ]; then
                log "✓ users.salesperson_id 欄位添加成功"
            else
                warning "users.salesperson_id 欄位添加失敗（可能已存在）"
            fi
        else
            log "✓ users 表結構已是最新（包含 salesperson_id）"
        fi
    else
        warning "資料庫檔案不存在，跳過結構檢查"
    fi
else
    warning "sqlite3 不可用，跳過資料庫結構檢查"
fi

# 處理服務重啟（⚠️ better-sqlite3 需要重啟服務才能重新連接資料庫）
log "處理服務狀態..."
if [ -n "$SERVICE_NAME" ] && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    # 使用之前記錄的 SERVICE_WAS_RUNNING 變數
    if [ "$SERVICE_WAS_RUNNING" -eq 1 ]; then
        log "⚠️  重要：better-sqlite3 需要重啟服務才能載入還原的資料庫"
        log "正在啟動服務..."
        
        # 啟動服務前，再次確認端口未被佔用
        PORT=$(grep -E "^PORT=" "${DEPLOY_CONFIG_FILE}" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "3000")
        PORT_PID=$(sudo lsof -ti:${PORT} 2>/dev/null || echo "")
        if [ -n "$PORT_PID" ]; then
            warning "檢測到端口 ${PORT} 被佔用 (PID: $PORT_PID)，正在清理..."
            sudo kill -9 "$PORT_PID" 2>/dev/null || true
            sleep 2
        fi
        
        # 啟動服務（在交互模式下，服務已經被停止了）
        sudo systemctl start "${SERVICE_NAME}" 2>/dev/null || warning "無法啟動服務"
        sleep 3
        
        if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
            log "✓ 服務已成功啟動"
            
            # 等待服務完全啟動
            sleep 2
            
            # 驗證資料庫（服務啟動後）
            if command -v sqlite3 >/dev/null 2>&1; then
                if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
                    log "驗證還原後的資料..."
                    FINAL_PROJECT_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
                    FINAL_CUSTOMER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
                    FINAL_INVOICE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
                    FINAL_USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
                    
                    log "📊 還原後資料統計："
                    log "  - 專案: $FINAL_PROJECT_COUNT 筆"
                    log "  - 客戶: $FINAL_CUSTOMER_COUNT 筆"
                    log "  - 發票: $FINAL_INVOICE_COUNT 筆"
                    log "  - 使用者: $FINAL_USER_COUNT 筆"
                    
                    # 檢查預計開票欄位
                    EXPECTED_INVOICE_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '';" 2>/dev/null || echo "0")
                    if [ "$EXPECTED_INVOICE_COUNT" -gt 0 ]; then
                        log "  - 已設定預計開票: $EXPECTED_INVOICE_COUNT 筆"
                    fi
                    
                    # 檢查非管理員使用者
                    NON_ADMIN_USER_COUNT=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT COUNT(*) FROM users WHERE username != 'admin';" 2>/dev/null || echo "0")
                    if [ "$NON_ADMIN_USER_COUNT" -gt 0 ]; then
                        log "  - 非管理員使用者: $NON_ADMIN_USER_COUNT 筆"
                    fi
                fi
            fi
        else
            error "服務無法正常啟動，請檢查日誌：sudo journalctl -u ${SERVICE_NAME} -n 50"
        fi
    else
        log "服務之前未運行，保持停止狀態"
        log "⚠️  提醒：使用還原的資料庫前，請先啟動服務："
        log "   sudo systemctl start ${SERVICE_NAME}"
    fi
else
    info "systemd 服務不存在，跳過服務操作"
    log "⚠️  提醒：手動啟動應用時，請重新啟動 Node.js 進程以載入還原的資料庫"
fi

echo ""
echo "============================================"
echo -e "${GREEN}  還原完成！${NC}"
echo "============================================"
echo ""
log "還原操作完成"
info "資料庫位置: ${PROJECT_DIR}/data/invoice_bonus.db"
info "上傳目錄: ${PROJECT_DIR}/uploads"
echo ""
echo "建議操作："
echo "  1. 檢查系統是否正常運作"
echo "  2. 如有問題，可使用備份還原: $TEMP_BACKUP"
echo ""

