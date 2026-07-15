#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 備份腳本

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 專案目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 日誌函數（需要在 list_install_dirs 之前定義）
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
    
    # 也檢查當前目錄（如果是開發環境，且不在 /opt 下，或不在列表中）
    if [ -f "${SCRIPT_DIR}/package.json" ]; then
        # 檢查 SCRIPT_DIR 是否已經在 dirs 陣列中
        local already_in_list=false
        for dir in "${dirs[@]}"; do
            if [ "$dir" = "$SCRIPT_DIR" ]; then
                already_in_list=true
                break
            fi
        done
        
        # 如果不在列表中，且不在 /opt 下（開發環境），則添加
        if [ "$already_in_list" = false ] && [[ "$SCRIPT_DIR" != /opt/* ]]; then
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
        read -p "$(echo -e ${YELLOW}請選擇要備份的安裝目錄編號 [1-${#dirs[@]}]，或按 q 取消:${NC}) " selection
        if [[ "$selection" =~ ^[Qq]$ ]]; then
            log "備份操作已取消" >&2
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

# 選擇安裝目錄（非交互模式下自動選擇）
# 條件：NON_INTERACTIVE 有設定，或 stdin 非 TTY（如 systemd 排程執行）
if [ -n "$NON_INTERACTIVE" ] || [ ! -t 0 ]; then
    # 非交互模式：自動選擇當前目錄或安裝目錄
    if [ -f "${SCRIPT_DIR}/package.json" ]; then
        SELECTED_INSTALL_DIR="$SCRIPT_DIR"
        log "非交互模式，自動選擇安裝目錄: $SELECTED_INSTALL_DIR"
    else
        # 檢查 /opt 下的標準安裝目錄
        if [ -d "/opt/invoice-bonus-system" ] && [ -f "/opt/invoice-bonus-system/package.json" ]; then
            SELECTED_INSTALL_DIR="/opt/invoice-bonus-system"
            log "非交互模式，自動選擇安裝目錄: $SELECTED_INSTALL_DIR"
        else
            error "非交互模式下無法確定安裝目錄"
        fi
    fi
else
    # 交互模式：讓用戶選擇
    SELECTED_INSTALL_DIR=$(list_install_dirs)
    if [ -z "$SELECTED_INSTALL_DIR" ]; then
        error "未選擇安裝目錄"
    fi
fi

PROJECT_DIR="$SELECTED_INSTALL_DIR"
log "已選擇安裝目錄: $PROJECT_DIR"

# 載入該目錄的配置（如果存在）
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
if [ -f "$DEPLOY_CONFIG_FILE" ]; then
    source "$DEPLOY_CONFIG_FILE"
    log "已載入配置: $DEPLOY_CONFIG_FILE"
    USE_INSTALL_BACKUP_DIR=1
else
    # 如果配置文件不存在，使用預設值
    INSTALL_DIR_NAME=$(basename "$PROJECT_DIR")
    BACKUP_DIR_NAME="${INSTALL_DIR_NAME}-backups"
    BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
    USE_INSTALL_BACKUP_DIR=1
    warning "未找到配置文件，使用預設值"
fi

# 備份目錄：統一使用 /opt 下的備份目錄（如果已安裝），否則使用專案目錄下的備份目錄
if [ "$USE_INSTALL_BACKUP_DIR" -eq 1 ]; then
    # 已安裝環境，統一使用 /opt 下的備份目錄
    # 確保備份目錄存在（需要 root 權限）
    if [ "$EUID" -eq 0 ]; then
        mkdir -p "$BACKUP_DIR"
        chmod 755 "$BACKUP_DIR" || true
    else
        # 如果不是 root，嘗試創建（可能失敗，但會在下一個 mkdir 中處理）
        mkdir -p "$BACKUP_DIR" 2>/dev/null || true
    fi
else
    # 開發環境，使用專案目錄下的備份目錄
    BACKUP_DIR="${PROJECT_DIR}/backups"
fi
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
BACKUP_NAME="backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# 開始備份
echo "============================================"
echo "  專案開立發票業績認列獎金計算總表系統"
echo "  備份程式"
echo "============================================"
echo ""

log "開始備份流程..."

# 檢查專案目錄
if [ ! -d "$PROJECT_DIR" ]; then
    error "專案目錄不存在: $PROJECT_DIR"
fi

# 創建備份目錄
mkdir -p "$BACKUP_DIR" || error "無法創建備份目錄"
log "備份目錄: $BACKUP_DIR"

# 創建本次備份目錄
mkdir -p "$BACKUP_PATH" || error "無法創建備份目錄: $BACKUP_PATH"
log "備份名稱: $BACKUP_NAME"

# 備份資料庫
log "備份資料庫..."
DB_FILE="${PROJECT_DIR}/data/invoice_bonus.db"
if [ -f "$DB_FILE" ]; then
    # ⚠️ 重要：執行 WAL checkpoint，確保所有資料都寫入主檔案
    if command -v sqlite3 >/dev/null 2>&1; then
        log "執行 WAL checkpoint（合併 WAL 到主檔案）..."
        sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || warning "WAL checkpoint 失敗，但繼續備份"
    fi
    
    # 驗證資料庫檔案大小
    DB_FILE_SIZE=$(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE" 2>/dev/null || echo "0")
    if [ "$DB_FILE_SIZE" -lt 1000 ]; then
        warning "資料庫檔案過小 (${DB_FILE_SIZE} bytes)，可能為空或損壞"
    fi
    
    cp "$DB_FILE" "${BACKUP_PATH}/invoice_bonus.db" || error "資料庫備份失敗"
    
    # 驗證備份後的檔案
    BACKUP_DB_SIZE=$(stat -f%z "${BACKUP_PATH}/invoice_bonus.db" 2>/dev/null || stat -c%s "${BACKUP_PATH}/invoice_bonus.db" 2>/dev/null || echo "0")
    if [ "$BACKUP_DB_SIZE" -ne "$DB_FILE_SIZE" ]; then
        error "資料庫備份失敗：檔案大小不一致 (原始: ${DB_FILE_SIZE}, 備份: ${BACKUP_DB_SIZE})"
    fi
    
    DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
    log "資料庫備份完成，大小: $DB_SIZE"
    
    # ⚠️ 重要：驗證資料庫內容時，使用備份檔案而不是原始檔案
    # 因為原始檔案可能還在被使用，統計結果可能不準確
    if command -v sqlite3 >/dev/null 2>&1; then
        log "驗證備份檔案內容..."
        PROJECT_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
        CUSTOMER_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")
        INVOICE_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM invoices;" 2>/dev/null || echo "0")
        PAYMENT_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM payments;" 2>/dev/null || echo "0")
        USER_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
        BONUS_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM bonus_calculations;" 2>/dev/null || echo "0")
        
        log "📊 備份資料統計："
        log "  - 專案: $PROJECT_COUNT 筆"
        log "  - 客戶: $CUSTOMER_COUNT 筆"
        log "  - 發票: $INVOICE_COUNT 筆"
        log "  - 收款: $PAYMENT_COUNT 筆"
        log "  - 使用者: $USER_COUNT 筆"
        log "  - 獎金: $BONUS_COUNT 筆"
        
        # 檢查預計開票欄位資料（使用備份檔案）
        EXPECTED_INVOICE_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '';" 2>/dev/null || echo "0")
        if [ "$EXPECTED_INVOICE_COUNT" -gt 0 ]; then
            log "  - 已設定預計開票: $EXPECTED_INVOICE_COUNT 筆"
            # 顯示預計開票的範例
            EXPECTED_SAMPLES=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT project_code, expected_invoice_year_month FROM projects WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != '' LIMIT 3;" 2>/dev/null || echo "")
            if [ -n "$EXPECTED_SAMPLES" ]; then
                log "  - 預計開票範例: $EXPECTED_SAMPLES"
            fi
        fi
        
        # 檢查是否有非管理員使用者（使用備份檔案）
        NON_ADMIN_USER_COUNT=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT COUNT(*) FROM users WHERE username != 'admin';" 2>/dev/null || echo "0")
        if [ "$NON_ADMIN_USER_COUNT" -gt 0 ]; then
            log "  - 非管理員使用者: $NON_ADMIN_USER_COUNT 筆"
            # 顯示使用者名稱（不顯示密碼）
            USER_LIST=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "SELECT username, name, role FROM users WHERE username != 'admin';" 2>/dev/null || echo "")
            if [ -n "$USER_LIST" ]; then
                log "  - 使用者列表: $USER_LIST"
            fi
        fi
        
        # 驗證資料庫結構（檢查關鍵欄位，使用備份檔案）
        FIELD_CHECK=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "PRAGMA table_info(projects);" 2>/dev/null | grep "expected_invoice_year_month" || echo "")
        if [ -n "$FIELD_CHECK" ]; then
            log "✓ 資料庫結構驗證通過（包含 expected_invoice_year_month 欄位）"
        else
            warning "資料庫結構可能過舊（缺少 expected_invoice_year_month 欄位）"
        fi
        
        USER_FIELD_CHECK=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "PRAGMA table_info(users);" 2>/dev/null | grep "salesperson_id" || echo "")
        if [ -n "$USER_FIELD_CHECK" ]; then
            log "✓ 使用者表結構驗證通過（包含 salesperson_id 欄位）"
        else
            warning "使用者表結構可能過舊（缺少 salesperson_id 欄位）"
        fi
    fi
else
    warning "資料庫檔案不存在: $DB_FILE"
fi

# 備份上傳檔案
log "備份上傳檔案..."
UPLOADS_DIR="${PROJECT_DIR}/uploads"
if [ -d "$UPLOADS_DIR" ] && [ "$(ls -A $UPLOADS_DIR 2>/dev/null)" ]; then
    mkdir -p "${BACKUP_PATH}/uploads"
    cp -r "$UPLOADS_DIR"/* "${BACKUP_PATH}/uploads/" 2>/dev/null || warning "部分上傳檔案備份失敗"
    UPLOADS_COUNT=$(find "$UPLOADS_DIR" -type f | wc -l)
    log "上傳檔案備份完成，檔案數: $UPLOADS_COUNT"
else
    info "上傳目錄為空或不存在，跳過備份"
fi

# 備份設定檔（如果有的話）
log "備份設定檔..."
if [ -f "${PROJECT_DIR}/.env" ]; then
    cp "${PROJECT_DIR}/.env" "${BACKUP_PATH}/.env" || warning ".env 檔案備份失敗"
    log ".env 檔案備份完成"
fi

# 備份 package.json 和 package-lock.json（用於還原時確認版本）
log "備份套件資訊..."
cp "${PROJECT_DIR}/package.json" "${BACKUP_PATH}/package.json" || warning "package.json 備份失敗"
if [ -f "${PROJECT_DIR}/package-lock.json" ]; then
    cp "${PROJECT_DIR}/package-lock.json" "${BACKUP_PATH}/package-lock.json" || warning "package-lock.json 備份失敗"
fi
log "套件資訊備份完成"

# 創建備份資訊檔案
log "建立備份資訊..."
BACKUP_INFO="${BACKUP_PATH}/backup_info.txt"
cat > "$BACKUP_INFO" << EOF
備份時間: $(date +'%Y-%m-%d %H:%M:%S')
備份名稱: $BACKUP_NAME
系統資訊:
  - 作業系統: $(uname -a)
  - Node.js 版本: $(node -v 2>/dev/null || echo "未安裝")
  - npm 版本: $(npm -v 2>/dev/null || echo "未安裝")
專案資訊:
  - 專案目錄: $PROJECT_DIR
  - 資料庫檔案: $DB_FILE
  - 資料庫大小: $(du -h "$DB_FILE" 2>/dev/null | cut -f1 || echo "未知")
備份內容:
  - 資料庫: invoice_bonus.db
  - 上傳檔案: uploads/
  - 設定檔: .env (如果存在)
  - 套件資訊: package.json, package-lock.json
EOF
log "備份資訊已記錄"

# 壓縮備份
log "壓縮備份檔案..."
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME" || error "備份壓縮失敗"
rm -rf "$BACKUP_NAME" || warning "無法刪除臨時備份目錄"
BACKUP_SIZE=$(du -h "${BACKUP_NAME}.tar.gz" | cut -f1)
log "備份壓縮完成，大小: $BACKUP_SIZE"

# 清理舊備份（保留最近 10 個備份）
log "清理舊備份..."
BACKUP_COUNT=$(ls -1t "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
    OLD_BACKUPS=$(ls -1t "${BACKUP_DIR}"/backup_*.tar.gz | tail -n +11)
    for old_backup in $OLD_BACKUPS; do
        rm -f "$old_backup"
        log "已刪除舊備份: $(basename $old_backup)"
    done
    log "已清理舊備份，保留最近 10 個備份"
else
    info "備份數量: $BACKUP_COUNT，無需清理"
fi

# 列出所有備份
echo ""
echo "============================================"
echo -e "${GREEN}  備份完成！${NC}"
echo "============================================"
echo ""
info "備份檔案: ${BACKUP_NAME}.tar.gz"
info "備份大小: $BACKUP_SIZE"
info "備份位置: $BACKUP_DIR"
echo ""
echo "所有備份列表："
ls -lh "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null | awk '{print "  - " $9 " (" $5 ")"}' || echo "  無備份檔案"
echo ""
echo "還原備份："
echo "  ./restore.sh ${BACKUP_NAME}.tar.gz"
echo ""

