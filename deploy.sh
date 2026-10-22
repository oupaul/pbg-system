#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 一鍵部署腳本
# 功能：首次安裝 + 更新部署（自動偵測）

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 專案目錄
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    RED='\033[0;31m'
    NC='\033[0m'
    echo -e "${RED}[錯誤]${NC} 需要 root 權限，請使用 sudo 執行：sudo ./deploy.sh"
    exit 1
fi

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

# 交互式輸入配置
input_config() {
    echo ""
    info "請輸入部署配置資訊（直接按 Enter 使用預設值）："
    echo ""
    
    # 瀏覽器分頁顯示名稱
    read -p "$(echo -e ${YELLOW}瀏覽器分頁顯示名稱 [業績獎金系統]:${NC}) " input_title
    PAGE_TITLE_SUFFIX="${input_title:-業績獎金系統}"
    
    # 網站名稱
    read -p "$(echo -e ${YELLOW}網站名稱 [業績獎金系統]:${NC}) " input_site
    SITE_NAME="${input_site:-業績獎金系統}"
    
    # 頁尾顯示文字
    read -p "$(echo -e ${YELLOW}頁尾顯示文字 [專案開立發票業績認列獎金計算總表系統 ©]:${NC}) " input_footer
    FOOTER_TEXT="${input_footer:-專案開立發票業績認列獎金計算總表系統 ©}"
    
    # 服務端口
    while true; do
        read -p "$(echo -e ${YELLOW}服務端口 [3000]:${NC}) " input_port
        PORT="${input_port:-3000}"
        if [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ]; then
            break
        else
            echo -e "${RED}無效的端口號，請輸入 1-65535 之間的數字${NC}"
        fi
    done
    
    # 服務名稱
    read -p "$(echo -e ${YELLOW}服務名稱 [invoice-bonus-system]:${NC}) " input_service
    SERVICE_NAME="${input_service:-invoice-bonus-system}"
    
    # 安裝目錄名稱（/opt 下的資料夾名稱）
    read -p "$(echo -e ${YELLOW}安裝目錄名稱（/opt 下的資料夾名稱）[invoice-bonus-system]:${NC}) " input_install_dir
    INSTALL_DIR_NAME="${input_install_dir:-invoice-bonus-system}"
    INSTALL_DIR="/opt/${INSTALL_DIR_NAME}"
    
    # 備份目錄名稱
    read -p "$(echo -e ${YELLOW}備份目錄名稱（/opt 下的資料夾名稱）[invoice-bonus-backups]:${NC}) " input_backup_dir
    BACKUP_DIR_NAME="${input_backup_dir:-invoice-bonus-backups}"
    BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
    
    echo ""
    info "配置摘要："
    echo "  瀏覽器分頁顯示名稱: $PAGE_TITLE_SUFFIX"
    echo "  網站名稱: $SITE_NAME"
    echo "  頁尾顯示文字: $FOOTER_TEXT"
    echo "  服務端口: $PORT"
    echo "  服務名稱: $SERVICE_NAME"
    echo "  安裝目錄: $INSTALL_DIR"
    echo "  備份目錄: $BACKUP_DIR"
    echo ""
    
    if ! confirm "確認使用以上配置？"; then
        log "部署已取消"
        exit 0
    fi
}

# 執行時以環境變數指定的 SERVICE_RUN_AS（例如緊急退回 root）要優先於設定檔裡記錄的值
SERVICE_RUN_AS_OVERRIDE="${SERVICE_RUN_AS:-}"

# 輸入配置，或從既有設定檔讀取
if [ -f "${PROJECT_DIR}/deploy.config.sh" ]; then
    source "${PROJECT_DIR}/deploy.config.sh"
    info "已從 deploy.config.sh 讀取現有配置（服務：${SERVICE_NAME}，目錄：${INSTALL_DIR}）"
    [ -n "$SERVICE_RUN_AS_OVERRIDE" ] && SERVICE_RUN_AS="$SERVICE_RUN_AS_OVERRIDE"
else
    input_config
fi

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[錯誤]${NC} 需要 root 權限，請使用 sudo 執行：sudo ./deploy.sh"
    exit 1
fi

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

# ========================================
# 服務執行帳號（預設：專用的非 root 帳號）
# ========================================
# SERVICE_RUN_AS=dedicated（預設）：服務以專用的系統帳號執行，只能寫入 data/、uploads/；程式碼由 root 擁有、
#   服務帳號不可修改。需要 root 的動作（備份、還原、刪除備份、測試 NAS 連線）由 sudoers 只允許的
#   scripts/pbg-privileged.js 處理（參數嚴格驗證）。萬一應用程式被入侵，影響範圍僅限於資料庫與附件，
#   不會直接取得整台主機的 root 權限。
# SERVICE_RUN_AS=root：維持舊行為（緊急退回用；可在執行 deploy.sh/update.sh 時以環境變數指定，會記錄到 deploy.config.sh）
SERVICE_RUN_AS="${SERVICE_RUN_AS:-dedicated}"
if [ -z "${SERVICE_USER:-}" ]; then
    SERVICE_USER=$(printf '%s' "$SERVICE_NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9_-' '-' | cut -c1-32)
fi
case "$SERVICE_USER" in
    [a-z_]*) ;;
    *) SERVICE_USER="svc-${SERVICE_USER}"; SERVICE_USER=$(printf '%s' "$SERVICE_USER" | cut -c1-32) ;;
esac
EFFECTIVE_RUN_USER="root"

# 判斷能否使用專用帳號；不行就退回 root 並說明原因（不中止部署）
decide_run_user() {
    EFFECTIVE_RUN_USER="root"
    if [ "$SERVICE_RUN_AS" = "root" ]; then
        warning "已指定以 root 執行服務（SERVICE_RUN_AS=root）。建議改用專用帳號：移除該設定後重新執行 deploy.sh/update.sh"
        return 0
    fi
    if [ "$PROJECT_DIR" != "$INSTALL_DIR" ]; then
        warning "目前不是在安裝目錄（${INSTALL_DIR}）內執行，維持以 root 執行服務"
        return 0
    fi
    case "$PROJECT_DIR" in
        /opt/*) ;;
        *) warning "安裝目錄不在 /opt 之下（${PROJECT_DIR}），為避免變更非預期目錄的擁有者，維持以 root 執行服務"; return 0 ;;
    esac
    if ! command -v visudo >/dev/null 2>&1 || ! command -v useradd >/dev/null 2>&1; then
        warning "找不到 visudo 或 useradd，無法設定專用帳號，維持以 root 執行服務"
        return 0
    fi
    if ! grep -rqsE '^[#@]includedir[[:space:]]+/etc/sudoers\.d' /etc/sudoers; then
        warning "/etc/sudoers 未啟用 /etc/sudoers.d，無法安全地授權特權輔助程式，維持以 root 執行服務"
        return 0
    fi
    EFFECTIVE_RUN_USER="$SERVICE_USER"
}

# 建立服務帳號、設定檔案擁有者與權限、安裝 sudoers（必須在服務停止後、啟動前執行）
apply_service_permissions() {
    local sudoers_file="/etc/sudoers.d/$(printf '%s' "$SERVICE_NAME" | tr -c 'A-Za-z0-9_-' '_')"

    if [ "$EFFECTIVE_RUN_USER" = "root" ]; then
        # 以 root 執行：不需要 sudoers 規則，移除先前可能留下的
        if [ -f "$sudoers_file" ]; then
            rm -f "$sudoers_file" && log "已移除不再需要的 sudoers 規則: $sudoers_file"
        fi
        return 0
    fi

    log "設定服務帳號與檔案權限（服務以 ${SERVICE_USER} 執行）..."

    if ! id "$SERVICE_USER" >/dev/null 2>&1; then
        useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER" \
            || error "無法建立服務帳號 ${SERVICE_USER}"
        log "✓ 已建立服務帳號 ${SERVICE_USER}"
    fi

    # 程式碼：root 擁有、其他人不可寫（服務帳號無法修改自己的程式碼，也無法竄改要以 root 執行的腳本）
    chown -R root:root "$PROJECT_DIR"
    chmod -R go-w "$PROJECT_DIR"
    chmod 755 "$PROJECT_DIR"

    # 資料與附件：服務帳號專用
    mkdir -p "${PROJECT_DIR}/data" "${PROJECT_DIR}/uploads"
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "${PROJECT_DIR}/data" "${PROJECT_DIR}/uploads"
    chmod 700 "${PROJECT_DIR}/data" "${PROJECT_DIR}/uploads"

    # NAS 設定檔由網頁儲存，需預先建立並歸服務帳號（安裝目錄本身不開放服務帳號寫入）
    if [ ! -f "${PROJECT_DIR}/nas_config.json" ]; then
        echo '{"enabled": false}' > "${PROJECT_DIR}/nas_config.json"
    fi
    chown "${SERVICE_USER}:${SERVICE_USER}" "${PROJECT_DIR}/nas_config.json"
    chmod 600 "${PROJECT_DIR}/nas_config.json"

    # 備份目錄：root 擁有；服務帳號所屬群組可讀取（網頁下載備份），但不可寫入（避免被拿來植入備份檔）
    mkdir -p "$BACKUP_DIR"
    chown root:"$SERVICE_USER" "$BACKUP_DIR"
    chmod 750 "$BACKUP_DIR"
    find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.tar.gz' -exec chgrp "$SERVICE_USER" {} + -exec chmod 640 {} + 2>/dev/null || true

    # sudoers：只允許服務帳號以 root 執行特權輔助程式（參數由輔助程式驗證），先用 visudo 驗證語法再安裝
    local node_real tmp
    node_real=$(readlink -f "$NODE_PATH" 2>/dev/null || echo "$NODE_PATH")
    tmp=$(mktemp)
    {
        echo "# 由 deploy.sh 產生（${SERVICE_NAME}），請勿手動修改；重新執行 deploy.sh/update.sh 會覆寫"
        echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${node_real} ${PROJECT_DIR}/scripts/pbg-privileged.js *"
        if [ "$node_real" != "$NODE_PATH" ]; then
            echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${NODE_PATH} ${PROJECT_DIR}/scripts/pbg-privileged.js *"
        fi
    } > "$tmp"
    if visudo -cf "$tmp" >/dev/null 2>&1; then
        install -m 0440 -o root -g root "$tmp" "$sudoers_file"
        rm -f "$tmp"
        log "✓ 已安裝 sudoers 規則: $sudoers_file"
    else
        rm -f "$tmp"
        error "產生的 sudoers 規則語法驗證失敗，已中止（未變更 sudoers）。可暫時以 SERVICE_RUN_AS=root 執行部署"
    fi
}

# 開始部署
echo "============================================"
echo "  專案開立發票業績認列獎金計算總表系統"
echo "  一鍵部署程式"
echo "============================================"
echo ""

# 偵測是首次安裝還是更新
IS_FIRST_INSTALL=false
if ! systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    IS_FIRST_INSTALL=true
    info "偵測到首次安裝，將執行完整安裝流程..."
else
    info "偵測到已安裝系統，將執行更新部署..."
fi

# 首次安裝時設定主機時區：系統所有時間（建立時間、修改記錄、作廢時間、備份排程）都跟著主機時區走，
# 全新的 VM 映像檔通常是 UTC，畫面上的時間會和台灣差 8 小時。
#   - 預設 Asia/Taipei；以環境變數 DEPLOY_TIMEZONE 指定其他時區，DEPLOY_TIMEZONE=skip 完全不處理
#   - 只在主機目前是 UTC 時才改：管理員已經刻意設成其他時區的主機不會被動到
#   - 失敗只警告，不中斷部署；更新部署（非首次安裝）完全不會碰時區
set_default_timezone() {
    local target="${DEPLOY_TIMEZONE:-Asia/Taipei}"
    if [ "$target" = "skip" ]; then
        info "DEPLOY_TIMEZONE=skip，略過時區設定"
        return 0
    fi
    if ! command -v timedatectl &> /dev/null; then
        warning "找不到 timedatectl，略過時區設定（請自行確認主機時區）"
        return 0
    fi
    # 時區名稱只允許 Area/Location 這類字元，並且必須是系統認得的時區
    if ! printf '%s' "$target" | grep -Eq '^[A-Za-z0-9_+/-]+$' || [ ! -f "/usr/share/zoneinfo/${target}" ]; then
        warning "時區「${target}」不存在，略過時區設定"
        return 0
    fi
    local current
    current=$(timedatectl show --property=Timezone --value 2>/dev/null || true)
    if [ "$current" = "$target" ]; then
        log "✓ 主機時區已是 ${target}"
        return 0
    fi
    case "$current" in
        UTC|Etc/UTC|Etc/UCT|Etc/Universal|Etc/Zulu|"")
            if timedatectl set-timezone "$target" 2>/dev/null; then
                log "✓ 主機時區已由 ${current:-未設定} 改為 ${target}（可用 DEPLOY_TIMEZONE=skip 略過）"
            else
                warning "設定時區失敗，請手動執行：sudo timedatectl set-timezone ${target}"
            fi
            ;;
        *)
            info "主機時區為 ${current}，保留不變（要改成 ${target} 請手動執行：sudo timedatectl set-timezone ${target}）"
            ;;
    esac
}

echo ""
log "開始部署流程..."

# ========================================
# 首次安裝特有步驟
# ========================================
if [ "$IS_FIRST_INSTALL" = true ]; then
    log "=== 首次安裝流程 ==="
    
    # 設定主機時區（預設台北；只在主機目前是 UTC 時才改）
    set_default_timezone

    # 檢查並安裝 Node.js
    log "檢查 Node.js..."
    if ! command -v node &> /dev/null; then
        log "Node.js 未安裝，開始安裝 Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || error "Node.js 安裝失敗"
        sudo apt-get install -y nodejs || error "Node.js 安裝失敗"
        log "✓ Node.js 安裝完成"
    else
        NODE_VERSION=$(node -v)
        log "✓ Node.js 已安裝: $NODE_VERSION"
    fi
    
    # 檢查 npm
    NPM_VERSION=$(npm -v)
    log "✓ npm 版本: $NPM_VERSION"
    
    # 如果腳本不在 /opt 目錄，複製到 /opt
    if [ "$PROJECT_DIR" != "$INSTALL_DIR" ]; then
        log "複製專案文件到 ${INSTALL_DIR}..."
        mkdir -p "$INSTALL_DIR" || error "無法創建安裝目錄"
        
        # 使用 rsync 複製（排除不需要的文件）
        if command -v rsync &> /dev/null; then
            rsync -av --exclude='node_modules' --exclude='.git' --exclude='*.log' \
                --exclude='data/*.db' --exclude='uploads/*' \
                "${PROJECT_DIR}/" "${INSTALL_DIR}/" || error "複製專案文件失敗"
        else
            cp -r "${PROJECT_DIR}/." "${INSTALL_DIR}/" || error "複製專案文件失敗"
            rm -rf "${INSTALL_DIR}/node_modules" 2>/dev/null || true
            rm -rf "${INSTALL_DIR}/.git" 2>/dev/null || true
        fi
        
        log "✓ 專案文件已複製"
        
        # 切換到安裝目錄
        PROJECT_DIR="$INSTALL_DIR"
        cd "$PROJECT_DIR"
    fi
    
    # 創建必要目錄
    log "創建必要目錄..."
    mkdir -p "${PROJECT_DIR}/data"
    mkdir -p "${PROJECT_DIR}/uploads"
    mkdir -p "${BACKUP_DIR}"
    chmod 755 "${BACKUP_DIR}" 2>/dev/null || true
    log "✓ 目錄創建完成"
    
    # 設定腳本權限
    log "設定腳本權限..."
    chmod +x "${PROJECT_DIR}/deploy.sh" 2>/dev/null || true
    chmod +x "${PROJECT_DIR}/backup.sh" 2>/dev/null || true
    chmod +x "${PROJECT_DIR}/restore.sh" 2>/dev/null || true
    chmod +x "${PROJECT_DIR}/uninstall.sh" 2>/dev/null || true
    chmod +x "${PROJECT_DIR}/setup-backup-timer.sh" 2>/dev/null || true
    log "✓ 腳本權限設定完成"
fi

# ========================================
# 共同步驟（首次安裝 + 更新都執行）
# ========================================

# 步驟 1: 停止服務（僅更新時需要）
if [ "$IS_FIRST_INSTALL" = false ]; then
    log "步驟 1/6: 停止服務..."
    if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        log "正在停止服務..."
        sudo systemctl stop "${SERVICE_NAME}" || warning "服務停止失敗，繼續執行..."
        
        # 等待服務完全停止
        sleep 2
        
        # 檢查是否還有進程佔用服務的端口
        PORT_PID=$(sudo lsof -ti TCP:${PORT} -sTCP:LISTEN 2>/dev/null || echo "")
        if [ -n "$PORT_PID" ]; then
            PORT_PROC_CMD=$(ps -p "$PORT_PID" -o args= 2>/dev/null || echo "")
            if echo "$PORT_PROC_CMD" | grep -q "app\.js"; then
                warning "檢測到端口 ${PORT} 仍被本專案的程序佔用 (PID: $PORT_PID)，正在終止..."
                sudo kill -9 "$PORT_PID" 2>/dev/null || warning "無法終止進程，可能需要手動處理"
                sleep 1
            else
                error "端口 ${PORT} 被非本專案的程序佔用 (PID: $PORT_PID，指令: ${PORT_PROC_CMD:-未知})。為避免誤殺無關程序，部署已停止，請手動確認並釋放該端口後重新執行。"
            fi
        fi
        
        # 再次確認服務狀態
        if sudo systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
            error "服務無法停止，請手動檢查：sudo systemctl status ${SERVICE_NAME}"
        else
            log "✓ 服務已成功停止"
        fi
    else
        log "服務未運行"
    fi
else
    log "步驟 1/6: 跳過（首次安裝無需停止服務）"
    # 即使是首次安裝，也檢查端口
    PORT_PID=$(sudo lsof -ti TCP:${PORT} -sTCP:LISTEN 2>/dev/null || echo "")
    if [ -n "$PORT_PID" ]; then
        PORT_PROC_CMD=$(ps -p "$PORT_PID" -o args= 2>/dev/null || echo "")
        if echo "$PORT_PROC_CMD" | grep -q "app\.js"; then
            warning "檢測到端口 ${PORT} 被本專案的舊程序佔用 (PID: $PORT_PID)，正在清理..."
            sudo kill -9 "$PORT_PID" 2>/dev/null || true
            sleep 1
        else
            error "端口 ${PORT} 被非本專案的程序佔用 (PID: $PORT_PID，指令: ${PORT_PROC_CMD:-未知})。為避免誤殺無關程序，部署已停止，請手動確認並釋放該端口後重新執行。"
        fi
    fi
fi

# 步驟 2: 檢查並更新資料庫結構（必須在服務停止後執行）
log "步驟 2/6: 檢查並更新資料庫結構..."
if [ -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
    # 先檢查 projects 表是否存在
    TABLE_EXISTS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "SELECT name FROM sqlite_master WHERE type='table' AND name='projects';" 2>/dev/null || echo "")
    
    if [ -n "$TABLE_EXISTS" ]; then
        # 備份資料庫（無論是否需要更新，都先備份）
        BACKUP_PATH="${PROJECT_DIR}/data/invoice_bonus.db.backup-$(date +%Y%m%d_%H%M%S)"
        # 使用 SQLite 線上備份（一致、含 WAL 內容）；不能直接 cp 運作中的 WAL 資料庫
        if sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" ".timeout 10000" ".backup '${BACKUP_PATH}'" 2>/dev/null \
           && [ "$(sqlite3 "$BACKUP_PATH" 'PRAGMA integrity_check;' 2>/dev/null | head -1)" = "ok" ]; then
            chmod 600 "$BACKUP_PATH" 2>/dev/null || true
            log "資料庫已備份（通過完整性檢查）: $BACKUP_PATH"
        else
            rm -f "$BACKUP_PATH" 2>/dev/null || true
            error "部署前的資料庫備份失敗或未通過完整性檢查，為避免在沒有可用備份的情況下變更資料庫，已中止部署"
        fi
        
        # 檢查 expected_invoice_year_month 欄位是否存在
        FIELD_EXISTS=$(sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "PRAGMA table_info(projects);" 2>/dev/null | grep "expected_invoice_year_month" || echo "")
        
        if [ -z "$FIELD_EXISTS" ]; then
            log "檢測到缺少 expected_invoice_year_month 欄位，正在添加..."
            sqlite3 "${PROJECT_DIR}/data/invoice_bonus.db" "ALTER TABLE projects ADD COLUMN expected_invoice_year_month TEXT;" 2>/dev/null || warning "欄位添加失敗（可能已存在）"
            
            if [ $? -eq 0 ]; then
                log "✓ expected_invoice_year_month 欄位添加成功"
            fi
        else
            log "✓ expected_invoice_year_month 欄位已存在"
        fi
        
        # 視圖將由 migrate:invoice-status 在步驟 5 更新（含 sales_discount、匯費、有效發票篩選）
        # 此處僅確保 expected_invoice_year_month 欄位存在，視圖由 migration 統一處理
        log "✓ 資料庫結構檢查完成（v_project_summary 將於步驟 5 由 migration 更新）"
    else
        log "projects 表不存在，將在步驟 5 中創建"
    fi
else
    log "資料庫不存在，將在步驟 5 中創建"
fi

# 步驟 3: 檢查是否需要遷移到 better-sqlite3
NEED_MIGRATION=false
if [ -f "${PROJECT_DIR}/package.json" ]; then
    if grep -q '"sql.js"' "${PROJECT_DIR}/package.json" 2>/dev/null; then
        warning "偵測到系統仍在使用 sql.js"
        info "將自動遷移到 better-sqlite3（解決資料儲存問題）"
        NEED_MIGRATION=true
    fi
fi

# 步驟 4: 更新依賴（如果需要）
if [ -f "${PROJECT_DIR}/package.json" ]; then
    log "步驟 4/7: 檢查並更新依賴套件..."
    if [ "${PROJECT_DIR}/package.json" -nt "${PROJECT_DIR}/node_modules/.package-lock.json" ] 2>/dev/null || \
       [ "${PROJECT_DIR}/package-lock.json" -nt "${PROJECT_DIR}/node_modules/.package-lock.json" ] 2>/dev/null || \
       [ ! -d "${PROJECT_DIR}/node_modules" ]; then
        log "檢測到 package.json 更新，重新安裝依賴..."
        cd "${PROJECT_DIR}"
        if [ -f "${PROJECT_DIR}/package-lock.json" ]; then
            # 依鎖定檔安裝完全相同的版本：每家公司的 VM 都會得到同一份依賴（npm install 可能解析出不同版本）
            npm ci || error "依賴套件安裝失敗（npm ci）。若 package-lock.json 與 package.json 不一致，請在開發環境執行 npm install 後重新提交鎖定檔"
            if [ -z "${RUN_AUDIT_FIX:-}" ]; then
                info "已依鎖定檔安裝（不在伺服器上自動修改依賴版本）。安全性漏洞請在開發環境執行 npm audit fix、測試後提交更新後的 package-lock.json；若要在此主機強制執行，設定 RUN_AUDIT_FIX=1"
                npm audit --omit=dev 2>&1 | tail -8 || true
            fi
        else
            warning "找不到 package-lock.json，改用 npm install（各主機的依賴版本可能不一致，建議提交鎖定檔）"
            npm install || error "依賴套件安裝失敗"
        fi
        if [ -f "${PROJECT_DIR}/package-lock.json" ] && [ -z "${RUN_AUDIT_FIX:-}" ]; then
            :
        elif [ -z "${SKIP_AUDIT_FIX:-}" ]; then
            log "修復已知安全性漏洞（僅套用不需要 --force 的修復，不含破壞性變更）..."
            npm audit fix 2>&1 | tail -10 || true
            info "若上方仍列出需要 --force 才能修的項目，代表該修復含破壞性變更（例如降版某個依賴），不會自動套用，需手動評估後執行 npm audit fix --force"
        else
            info "SKIP_AUDIT_FIX=1，略過自動修復已知安全性漏洞"
        fi
        log "✓ 依賴套件更新完成"
    else
        log "✓ 依賴套件無需更新"
    fi
else
    log "步驟 4/7: 跳過依賴更新（找不到 package.json）"
fi

# 步驟 4.5: 執行 better-sqlite3 遷移（如果需要）
if [ "$NEED_MIGRATION" = true ]; then
    log "步驟 4.5/7: 執行 better-sqlite3 遷移..."
    
    # 備份舊的 db.js
    if [ -f "${PROJECT_DIR}/src/models/db.js" ]; then
        cp "${PROJECT_DIR}/src/models/db.js" "${PROJECT_DIR}/src/models/db_old.js.backup"
        log "✓ 已備份舊的 db.js"
    fi
    
    # 替換為新的 db.js
    if [ -f "${PROJECT_DIR}/src/models/db_new.js" ]; then
        mv "${PROJECT_DIR}/src/models/db_new.js" "${PROJECT_DIR}/src/models/db.js"
        log "✓ 已啟用 better-sqlite3 驅動"
    else
        warning "找不到 db_new.js，跳過遷移"
    fi
    
    log "✓ better-sqlite3 遷移完成"
fi

# 步驟 5: 執行資料庫遷移
if [ -d "${PROJECT_DIR}/migrations" ]; then
    log "步驟 5/7: 執行資料庫遷移..."
    cd "${PROJECT_DIR}"
    if [ ! -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        log "資料庫不存在，建立初始結構..."
        npm run migrate || error "基礎資料庫遷移失敗"

        # 全新安裝：把 migrate.js 建立的預設 admin/admin123 換成一次性亂數密碼，
        # 只印在這次部署的 terminal 畫面上、不寫進任何檔案。比照 SESSION_SECRET
        # 只在首次安裝產生的做法（見下方步驟 5/6），既有安裝升級不會執行到這裡，
        # 不會覆蓋管理者事後已經改過的密碼。
        log "產生一次性管理員初始密碼..."
        ADMIN_INITIAL_PASSWORD=$(openssl rand -base64 12 2>/dev/null | tr -dc 'A-Za-z0-9' | head -c 16)
        if [ -z "$ADMIN_INITIAL_PASSWORD" ]; then
            ADMIN_INITIAL_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)
        fi

        RESET_PW_SCRIPT="${PROJECT_DIR}/.deploy-reset-admin-pw.js"
        cat > "$RESET_PW_SCRIPT" <<'NODE_SCRIPT_END'
const Database = require('better-sqlite3');
const argon2 = require('argon2');
const path = require('path');

(async () => {
  const dbPath = path.join(__dirname, 'data', 'invoice_bonus.db');
  const db = new Database(dbPath);
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!admin) {
    console.error('[警告] 找不到 admin 帳號，略過初始密碼重設');
    db.close();
    return;
  }
  const hash = await argon2.hash(process.env.ADMIN_INITIAL_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
  db.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(hash);
  db.close();
})().catch(err => {
  console.error('[警告] 重設 admin 初始密碼失敗:', err.message);
  process.exit(1);
});
NODE_SCRIPT_END

        if ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" node "$RESET_PW_SCRIPT"; then
            echo ""
            echo -e "${GREEN}========================================${NC}"
            echo -e "${GREEN}  初始管理員帳號${NC}"
            echo -e "${GREEN}========================================${NC}"
            echo -e "  帳號：${YELLOW}admin${NC}"
            echo -e "  密碼：${YELLOW}${ADMIN_INITIAL_PASSWORD}${NC}"
            echo -e "${RED}  此密碼只會顯示這一次，不會寫入任何檔案或日誌，請立即記下並妥善保存${NC}"
            echo -e "${GREEN}========================================${NC}"
            echo ""
        else
            warning "重設 admin 初始密碼失敗，帳號密碼維持 migrate.js 產生的預設值 admin123，請部署完成後手動更改"
        fi
        rm -f "$RESET_PW_SCRIPT"
    fi
    if ! node migrations/runner.js; then
        error "Migration 執行失敗，部署已停止（不會啟動服務，避免帶著不完整的 schema 上線）。
  請檢查上方 migration 錯誤輸出並修正；已成功的 migration 已被記錄，
  修正後重新執行本腳本時只會重跑尚未成功的項目。
  資料庫備份（若步驟 2 有建立）：${PROJECT_DIR}/data/invoice_bonus.db.backup-*"
    fi
    if [ "$IS_FIRST_INSTALL" = true ] && [ ! -f "${PROJECT_DIR}/data/.seeded" ]; then
        log "插入種子資料..."
        npm run seed && touch "${PROJECT_DIR}/data/.seeded" || warning "種子資料插入失敗（可能已存在）"
    fi
    log "✓ 資料庫遷移完成"
else
    log "步驟 5/7: 跳過資料庫遷移（找不到 migrations 目錄）"
fi

# 步驟 5: 檢查並更新 systemd 服務配置
log "步驟 5/6: 檢查 systemd 服務配置..."
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    error "找不到 Node.js 執行檔"
fi

# 決定服務的執行帳號（專用的非 root 帳號，或因條件不足/明確指定而使用 root）
decide_run_user
RUN_AS_MARKER="# pbg-run-as: ${EFFECTIVE_RUN_USER} v1"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# 檢查服務文件是否需要更新
NEED_UPDATE=false
if [ ! -f "$SERVICE_FILE" ]; then
    NEED_UPDATE=true
    log "服務文件不存在，將創建新文件"
else
    # 檢查關鍵配置是否正確
    if ! grep -q "WorkingDirectory=${PROJECT_DIR}" "$SERVICE_FILE" 2>/dev/null; then
        NEED_UPDATE=true
        log "檢測到專案目錄變更，需要更新服務文件"
    fi
    # 執行帳號或防護設定改變（含舊安裝以 root 執行、升級為專用帳號）
    if ! grep -qxF "$RUN_AS_MARKER" "$SERVICE_FILE" 2>/dev/null; then
        NEED_UPDATE=true
        log "服務執行帳號/防護設定需要更新（改為以 ${EFFECTIVE_RUN_USER} 執行）"
    fi
fi

if [ "$NEED_UPDATE" = true ]; then
    log "更新 systemd 服務文件..."
    # 保留現有 SESSION_SECRET；首次安裝時產生隨機值
    EXISTING_SECRET=$(grep "^Environment=SESSION_SECRET=" "$SERVICE_FILE" 2>/dev/null | cut -d'=' -f3-)
    if [ -z "$EXISTING_SECRET" ]; then
        EXISTING_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1)
        log "已產生新的 SESSION_SECRET"
    fi

    # 專用帳號時加上基本的 systemd 防護。刻意不啟用 NoNewPrivileges：服務需要透過 sudo 呼叫特權輔助程式；
    # 也不啟用 PrivateTmp（還原程序的日誌寫在 /tmp，要與服務共用）、ProtectSystem=strict（備份腳本需要寫入備份目錄）
    SERVICE_HARDENING=""
    if [ "$EFFECTIVE_RUN_USER" != "root" ]; then
        SERVICE_HARDENING="UMask=0077
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
LockPersonality=true"
    fi

    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
${RUN_AS_MARKER}
[Unit]
Description=專案開立發票業績認列獎金計算總表系統
Documentation=https://github.com/your-repo/invoice-bonus-system
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${EFFECTIVE_RUN_USER}
Group=${EFFECTIVE_RUN_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment="PATH=${PATH}"
Environment=SESSION_SECRET=${EXISTING_SECRET}
ExecStart=${NODE_PATH} ${PROJECT_DIR}/src/app.js
Restart=always
RestartSec=10
StartLimitInterval=0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
${SERVICE_HARDENING}

[Install]
WantedBy=multi-user.target
EOF
    log "服務文件已更新"
    
    # 重新載入 systemd
    log "重新載入 systemd daemon..."
    sudo systemctl daemon-reload
    
    # 確保服務已啟用（開機自動啟動）
    if ! sudo systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
        log "啟用服務（開機自動啟動）..."
        sudo systemctl enable "${SERVICE_NAME}" || warning "無法啟用服務"
    fi
else
    log "服務配置無需更新"
fi

# 步驟 5: 保存配置到 deploy.config.json 供應用讀取（必須在啟動服務之前）
log "步驟 5/6: 保存配置到 deploy.config.json..."
DEPLOY_CONFIG_JSON="${PROJECT_DIR}/deploy.config.json"

# 使用 node 生成 JSON（處理特殊字符轉義）
TEMP_JSON_SCRIPT=$(mktemp)
cat > "$TEMP_JSON_SCRIPT" <<'NODE_SCRIPT_END'
const config = {
  pageTitleSuffix: process.env.PAGE_TITLE_SUFFIX || '',
  siteName: process.env.SITE_NAME || '',
  footerText: process.env.FOOTER_TEXT || '',
  port: parseInt(process.env.PORT || '3000'),
  serviceName: process.env.SERVICE_NAME || '',
  installDirName: process.env.INSTALL_DIR_NAME || '',
  backupDirName: process.env.BACKUP_DIR_NAME || ''
};
console.log(JSON.stringify(config, null, 2));
NODE_SCRIPT_END
PAGE_TITLE_SUFFIX="${PAGE_TITLE_SUFFIX}" \
SITE_NAME="${SITE_NAME}" \
FOOTER_TEXT="${FOOTER_TEXT}" \
PORT=${PORT} \
SERVICE_NAME="${SERVICE_NAME}" \
INSTALL_DIR_NAME="${INSTALL_DIR_NAME}" \
BACKUP_DIR_NAME="${BACKUP_DIR_NAME}" \
node "$TEMP_JSON_SCRIPT" > "$DEPLOY_CONFIG_JSON"
rm -f "$TEMP_JSON_SCRIPT"
chmod 644 "$DEPLOY_CONFIG_JSON" 2>/dev/null || true
log "✓ 配置已保存到 ${DEPLOY_CONFIG_JSON}"

# 同時保存 deploy.config.sh 供其他腳本使用（backup.sh, restore.sh, uninstall.sh）
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/deploy.config.sh"
cat > "$DEPLOY_CONFIG_FILE" <<EOF
#!/bin/bash
# 部署配置文件（由 deploy.sh 自動生成，供腳本使用）

# 網站設定
PAGE_TITLE_SUFFIX="${PAGE_TITLE_SUFFIX}"
SITE_NAME="${SITE_NAME}"
FOOTER_TEXT="${FOOTER_TEXT}"

# 服務設定
PORT=${PORT}
SERVICE_NAME="${SERVICE_NAME}"
# 服務執行帳號：dedicated（專用非 root 帳號，預設）或 root；備份/還原腳本依此調整檔案權限
SERVICE_RUN_AS="${SERVICE_RUN_AS}"
SERVICE_USER="${SERVICE_USER}"

# 目錄設定
INSTALL_DIR_NAME="${INSTALL_DIR_NAME}"
BACKUP_DIR_NAME="${BACKUP_DIR_NAME}"

# 計算的完整路徑
INSTALL_DIR="${INSTALL_DIR}"
BACKUP_DIR="${BACKUP_DIR}"
EOF
chmod 755 "$DEPLOY_CONFIG_FILE" 2>/dev/null || true

# 確保備份相關腳本可執行（供後續 setup-backup-timer 與 systemd 排程使用）
chmod +x "${PROJECT_DIR}/backup.sh" 2>/dev/null || true
chmod +x "${PROJECT_DIR}/setup-backup-timer.sh" 2>/dev/null || true

# 套用服務帳號與檔案權限（migration 等步驟都是以 root 執行，資料庫與快照可能是 root 擁有，必須在啟動前修正）
apply_service_permissions

# 步驟 6: 啟動服務
log "步驟 6/6: 啟動服務..."
if sudo systemctl start "${SERVICE_NAME}" 2>/dev/null; then
    log "服務啟動命令已執行"
    sleep 3
    
    # 檢查服務狀態
    if sudo systemctl is-active --quiet "${SERVICE_NAME}"; then
        log "✓ 服務已成功啟動並運行中"
        
        # 顯示服務狀態
        info "服務狀態："
        sudo systemctl status "${SERVICE_NAME}" --no-pager -l | head -n 15 | sed 's/^/  /'
        
        SERVICE_STATUS="✓ 已啟動並運行"
    else
        warning "服務可能未正常啟動，正在檢查原因..."
        
        # 檢查服務日誌
        JOURNAL_LOG=$(sudo journalctl -u "${SERVICE_NAME}" -n 20 --no-pager 2>/dev/null || echo "")
        if [ -n "$JOURNAL_LOG" ]; then
            warning "最近的服務日誌："
            echo "$JOURNAL_LOG" | sed 's/^/  /'
        fi
        
        SERVICE_STATUS="✗ 啟動異常"
        warning "請執行以下命令檢查詳細狀態："
        warning "  sudo systemctl status ${SERVICE_NAME}"
        warning "  sudo journalctl -u ${SERVICE_NAME} -f"
    fi
else
    error "服務啟動失敗，請檢查日誌：sudo journalctl -u ${SERVICE_NAME}"
fi

echo ""
echo "============================================"
echo -e "${GREEN}  部署完成！${NC}"
echo "============================================"
echo ""

# 顯示遷移結果
if [ "$NEED_MIGRATION" = true ]; then
    echo ""
    info "✅ 已自動遷移到 better-sqlite3"
    echo "  • 資料即時寫入磁碟（無需手動儲存）"
    echo "  • 大幅提升效能（10倍啟動速度）"
    echo "  • 更穩定可靠"
    echo ""
fi

log "部署流程完成"

if [ "$IS_FIRST_INSTALL" = true ]; then
    echo "安裝資訊："
    echo "  - 安裝目錄: $PROJECT_DIR"
    echo "  - 資料庫位置: ${PROJECT_DIR}/data/invoice_bonus.db"
    echo "  - 備份目錄: ${BACKUP_DIR}"
    echo "  - 服務狀態: ${SERVICE_STATUS:-未知}"
    echo "  - 開機自動啟動: 已啟用"
    echo ""
    echo "預設登入資訊："
    echo "  - 帳號: admin"
    echo "  - 密碼: admin123"
    echo "  - 首次登入後請立即修改密碼！"
else
    echo "系統資訊："
    echo "  - 專案目錄: $PROJECT_DIR"
    echo "  - 服務狀態: ${SERVICE_STATUS:-未知}"
    echo "  - 開機自動啟動: $(sudo systemctl is-enabled ${SERVICE_NAME} 2>/dev/null && echo '已啟用' || echo '未啟用')"
fi

echo ""
echo "服務管理："
echo "  啟動服務: sudo systemctl start ${SERVICE_NAME}"
echo "  停止服務: sudo systemctl stop ${SERVICE_NAME}"
echo "  重啟服務: sudo systemctl restart ${SERVICE_NAME}"
echo "  查看狀態: sudo systemctl status ${SERVICE_NAME}"
echo "  查看日誌: sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "系統網址: http://localhost:${PORT}"
echo ""

# 檢查是否已設定自動備份
BACKUP_SERVICE_NAME="${SERVICE_NAME}-backup"
BACKUP_TIMER_EXISTS=0
if systemctl list-unit-files | grep -q "^${BACKUP_SERVICE_NAME}.timer"; then
    BACKUP_TIMER_EXISTS=1
fi

if [ $BACKUP_TIMER_EXISTS -eq 1 ]; then
    info "自動備份已設定"
    echo ""
    echo "自動備份資訊："
    NEXT_RUN=$(systemctl list-timers ${BACKUP_SERVICE_NAME}.timer --no-pager 2>/dev/null | grep ${BACKUP_SERVICE_NAME} | awk '{print $1, $2, $3, $4, $5}' | head -n 1 || echo "")
    if [ -n "$NEXT_RUN" ]; then
        systemctl list-timers ${BACKUP_SERVICE_NAME}.timer --no-pager 2>/dev/null | grep -A 1 "NEXT" | sed 's/^/  /' || echo "  查看狀態: sudo systemctl status ${BACKUP_SERVICE_NAME}.timer"
    else
        echo "  查看狀態: sudo systemctl status ${BACKUP_SERVICE_NAME}.timer"
    fi
    echo ""
    if [ -z "$SKIP_BACKUP_PROMPT" ]; then
        read -p "是否要修改自動備份設定？(y/N): " MODIFY_BACKUP
        if [[ "$MODIFY_BACKUP" =~ ^[Yy]$ ]]; then
            if [ -f "${PROJECT_DIR}/setup-backup-timer.sh" ]; then
                chmod +x "${PROJECT_DIR}/setup-backup-timer.sh"
                bash "${PROJECT_DIR}/setup-backup-timer.sh"
            else
                warning "找不到備份設定腳本: ${PROJECT_DIR}/setup-backup-timer.sh"
            fi
        fi
    else
        info "如需修改備份設定，請手動執行: sudo ${PROJECT_DIR}/setup-backup-timer.sh"
    fi
else
    echo ""
    info "系統尚未設定自動備份"
    echo ""
    if [ -z "$SKIP_BACKUP_PROMPT" ]; then
        read -p "是否要設定自動備份？(Y/n): " SETUP_BACKUP
        if [[ ! "$SETUP_BACKUP" =~ ^[Nn]$ ]]; then
            if [ -f "${PROJECT_DIR}/setup-backup-timer.sh" ]; then
                chmod +x "${PROJECT_DIR}/setup-backup-timer.sh"
                # 傳入 "1" 為預設每日備份，避免非互動或直接 Enter 導致未建立 timer
                log "設定自動備份（預設：每日凌晨 2:00）..."
                bash "${PROJECT_DIR}/setup-backup-timer.sh" "1"
                if systemctl list-unit-files | grep -q "^${BACKUP_SERVICE_NAME}.timer"; then
                    # 重新載入並啟動 timer，確保 NEXT 正確顯示（避免 Trigger: n/a）
                    systemctl daemon-reload
                    systemctl restart "${BACKUP_SERVICE_NAME}.timer"
                    log "✓ 自動備份已設定完成"
                else
                    warning "自動備份設定可能未完成，請手動執行: sudo ${PROJECT_DIR}/setup-backup-timer.sh"
                fi
            else
                warning "找不到備份設定腳本: ${PROJECT_DIR}/setup-backup-timer.sh"
                info "您可以稍後手動執行: sudo ${PROJECT_DIR}/setup-backup-timer.sh"
            fi
        else
            info "跳過自動備份設定"
            echo ""
            echo "您可以稍後執行以下命令設定自動備份："
            echo "  sudo ${PROJECT_DIR}/setup-backup-timer.sh"
            echo ""
        fi
    else
        info "如需設定自動備份，請手動執行: sudo ${PROJECT_DIR}/setup-backup-timer.sh"
    fi
fi

echo ""
echo "============================================"
echo ""
echo "備份管理："
echo "  手動備份:     sudo ${PROJECT_DIR}/backup.sh"
echo "  設定自動備份:  sudo ${PROJECT_DIR}/setup-backup-timer.sh  # 可自訂時間（選項 6 輸入 時:分）"
if [ $BACKUP_TIMER_EXISTS -eq 1 ]; then
    echo "  查看備份計畫:  sudo systemctl list-timers ${BACKUP_SERVICE_NAME}.timer"
    echo "  立即執行備份:  sudo systemctl start ${BACKUP_SERVICE_NAME}.service"
    echo "  查看備份日誌:  sudo journalctl -u ${BACKUP_SERVICE_NAME}.service -n 50"
fi
echo ""

