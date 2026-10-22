#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 備份腳本

set -e

# 備份含資料庫（密碼雜湊、客戶與財務資料）與 .env：所有新建的檔案與目錄預設只有擁有者可讀寫
umask 077

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
        if [ -n "${SERVICE_USER:-}" ] && [ "${SERVICE_RUN_AS:-dedicated}" != "root" ] && id "$SERVICE_USER" >/dev/null 2>&1; then
            # 服務以專用的非 root 帳號執行：服務帳號所屬群組只能讀取（列表/下載），不可寫入
            chgrp "$SERVICE_USER" "$BACKUP_DIR" || true
            chmod 750 "$BACKUP_DIR" || true
        else
            chmod 700 "$BACKUP_DIR" || true
        fi
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
    # ⚠️ 重要：不能直接 cp 運作中的 WAL 資料庫（備份可能是撕裂或過期的複本，且沒有帶上 -wal 檔）。
    # 使用 SQLite 線上備份：即使服務仍在寫入，也得到單一時間點、完整一致的複本。
    DB_FILE_SIZE=$(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE" 2>/dev/null || echo "0")
    if [ "$DB_FILE_SIZE" -lt 1000 ]; then
        warning "資料庫檔案過小 (${DB_FILE_SIZE} bytes)，可能為空或損壞"
    fi

    if command -v sqlite3 >/dev/null 2>&1; then
        log "使用 sqlite3 線上備份（一致性備份）..."
        sqlite3 "$DB_FILE" ".timeout 10000" ".backup '${BACKUP_PATH}/invoice_bonus.db'" || error "資料庫備份失敗"
        INTEGRITY=$(sqlite3 "${BACKUP_PATH}/invoice_bonus.db" "PRAGMA integrity_check;" 2>&1 | head -1)
        [ "$INTEGRITY" = "ok" ] || error "備份檔完整性檢查失敗: $INTEGRITY"
    elif command -v node >/dev/null 2>&1 && [ -f "${PROJECT_DIR}/scripts/sqlite-backup.js" ]; then
        log "未安裝 sqlite3，改用 Node 線上備份（含完整性檢查）..."
        (cd "$PROJECT_DIR" && node scripts/sqlite-backup.js "$DB_FILE" "${BACKUP_PATH}/invoice_bonus.db") || error "資料庫備份失敗"
    else
        error "找不到 sqlite3 或 node，無法產生一致的資料庫備份（不使用直接複製檔案以免備份損毀）"
    fi
    log "✓ 資料庫備份完成並通過完整性檢查"

    DB_SIZE=$(du -h "${BACKUP_PATH}/invoice_bonus.db" | cut -f1)
    log "資料庫備份大小: $DB_SIZE"
    
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
    cp -R "$UPLOADS_DIR"/. "${BACKUP_PATH}/uploads/" 2>/dev/null || warning "部分上傳檔案備份失敗"
    UPLOADS_COUNT=$(find "$UPLOADS_DIR" -type f | wc -l)
    log "上傳檔案備份完成，檔案數: $UPLOADS_COUNT"
else
    info "上傳目錄為空或不存在，跳過備份"
fi

# 備份自訂品牌檔（例如自訂的瀏覽器分頁圖示，存放在 data/branding/，不在資料庫內）
BRANDING_DIR="${PROJECT_DIR}/data/branding"
if [ -d "$BRANDING_DIR" ] && [ "$(ls -A "$BRANDING_DIR" 2>/dev/null)" ]; then
    mkdir -p "${BACKUP_PATH}/data/branding"
    cp -R "$BRANDING_DIR"/. "${BACKUP_PATH}/data/branding/" 2>/dev/null || warning "品牌檔備份失敗"
    log "品牌檔備份完成"
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

# SESSION_SECRET 指紋：雙因素驗證的密鑰是用 SESSION_SECRET 衍生的金鑰加密的，而這把密鑰（只存在 systemd unit，
# 不在資料庫）不放進備份——備份檔可能被下載或同步到 NAS，不能把解密金鑰和密文放在一起。
# 備份只記錄指紋（SHA-256 前 16 碼，無法反推密鑰），還原時 restore.sh 用它確認新主機是否使用同一把密鑰。
# 與 restore.sh 內的同名函式必須一致（有測試比對）。
sha256_text() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -c1-64; else shasum -a 256 | cut -c1-64; fi
}
session_secret_fingerprint() {
    local unit="${PBG_SYSTEMD_DIR:-/etc/systemd/system}/${SERVICE_NAME:-}.service" secret
    [ -n "${SERVICE_NAME:-}" ] && [ -f "$unit" ] || return 0
    secret=$(grep "^Environment=SESSION_SECRET=" "$unit" 2>/dev/null | head -1 | cut -d'=' -f3-)
    [ -n "$secret" ] || return 0
    printf 'pbg-session-secret:%s' "$secret" | sha256_text | cut -c1-16
}
SECRET_FP=$(session_secret_fingerprint)

# 創建備份資訊檔案
log "建立備份資訊..."
BACKUP_INFO="${BACKUP_PATH}/backup_info.txt"
cat > "$BACKUP_INFO" << EOF
備份時間: $(date +'%Y-%m-%d %H:%M:%S')
備份名稱: $BACKUP_NAME
SESSION_SECRET 指紋: ${SECRET_FP:-未知}
（指紋只用來在還原時比對密鑰是否相同，無法反推出 SESSION_SECRET；備份本身不含該密鑰）
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
  - 品牌檔: data/branding/ (如果存在)
  - 設定檔: .env (如果存在)
  - 套件資訊: package.json, package-lock.json
EOF
log "備份資訊已記錄"

# 壓縮備份
log "壓縮備份檔案..."
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME" || error "備份壓縮失敗"
rm -rf "$BACKUP_NAME" || warning "無法刪除臨時備份目錄"
chmod 600 "${BACKUP_NAME}.tar.gz" 2>/dev/null || true
# 服務以專用的非 root 帳號執行時，網頁端需要能讀取（下載）備份檔：給服務帳號所屬群組唯讀權限
# （備份目錄本身不開放服務帳號寫入，刪除備份由特權輔助程式 scripts/pbg-privileged.js 處理）
if [ -n "${SERVICE_USER:-}" ] && [ "${SERVICE_RUN_AS:-dedicated}" != "root" ] && id "$SERVICE_USER" >/dev/null 2>&1; then
    chgrp "$SERVICE_USER" "${BACKUP_NAME}.tar.gz" 2>/dev/null && chmod 640 "${BACKUP_NAME}.tar.gz" 2>/dev/null || true
fi
BACKUP_SIZE=$(du -h "${BACKUP_NAME}.tar.gz" | cut -f1)
log "備份壓縮完成，大小: $BACKUP_SIZE"

# 異地備份：若「備份還原」頁面已啟用 NAS 同步，備份完成後同步一份過去（失敗只警告，不影響本機備份）
if command -v node >/dev/null 2>&1 && [ -f "${PROJECT_DIR}/scripts/nas-sync.js" ]; then
    log "檢查異地備份（NAS）設定..."
    (cd "$PROJECT_DIR" && node scripts/nas-sync.js "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz") || warning "異地備份（NAS）同步失敗，本機備份已完成"
fi

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

