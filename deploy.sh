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

# 輸入配置
input_config

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

echo ""
log "開始部署流程..."

# ========================================
# 首次安裝特有步驟
# ========================================
if [ "$IS_FIRST_INSTALL" = true ]; then
    log "=== 首次安裝流程 ==="
    
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
        
        # 檢查是否還有進程佔用端口 3000
        PORT_PID=$(sudo lsof -ti:3000 2>/dev/null || echo "")
        if [ -n "$PORT_PID" ]; then
            warning "檢測到端口 3000 仍被佔用 (PID: $PORT_PID)，正在終止..."
            sudo kill -9 "$PORT_PID" 2>/dev/null || warning "無法終止進程，可能需要手動處理"
            sleep 1
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
    PORT_PID=$(sudo lsof -ti:${PORT} 2>/dev/null || echo "")
    if [ -n "$PORT_PID" ]; then
        warning "檢測到端口 ${PORT} 被佔用 (PID: $PORT_PID)，正在清理..."
        sudo kill -9 "$PORT_PID" 2>/dev/null || true
        sleep 1
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
        cp "${PROJECT_DIR}/data/invoice_bonus.db" "$BACKUP_PATH"
        log "資料庫已備份: $BACKUP_PATH"
        
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
       [ ! -d "${PROJECT_DIR}/node_modules" ]; then
        log "檢測到 package.json 更新，重新安裝依賴..."
        cd "${PROJECT_DIR}"
        npm install || error "依賴套件安裝失敗"
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
    log "步驟 5/7: 檢查資料庫遷移..."
    if [ ! -f "${PROJECT_DIR}/data/invoice_bonus.db" ]; then
        log "資料庫不存在，執行完整遷移..."
        cd "${PROJECT_DIR}"
        npm run migrate || error "基礎資料庫遷移失敗"
        npm run migrate:project-code || warning "專案編號唯一約束遷移失敗（可能已存在）"
        npm run migrate:project-customer || warning "專案編號+客戶唯一約束遷移失敗（可能已存在）"
        npm run migrate:project-name || warning "專案編號+客戶+專案名稱唯一約束遷移失敗（可能已存在）"
        npm run migrate:user-roles || warning "使用者角色遷移失敗（可能已存在）"
        npm run migrate:roles || warning "角色管理表遷移失敗（可能已存在）"
        npm run migrate:remove-user-role-check || warning "移除使用者角色 CHECK 約束遷移失敗（可能已存在）"
        npm run migrate:system-settings || warning "系統設定表遷移失敗（可能已存在）"
              npm run migrate:project-types || warning "專案類型表遷移失敗（可能已存在）"
              npm run migrate:sales-discount || warning "銷貨折讓欄位遷移失敗（可能已存在）"
              npm run migrate:costs || warning "成本明細表遷移失敗（可能已存在）"
              npm run migrate:update-total-received || warning "更新收款總額計算遷移失敗（可能已存在）"
              npm run migrate:invoice-expected-payment-date || warning "發票預計收款日欄位遷移失敗（可能已存在）"
        (npm run migrate:invoice-status 2>/dev/null || node migrations/migrate_invoice_status.js) || warning "發票作廢/折讓功能遷移失敗（可能已存在）"
        npm run migrate:soft-delete 2>/dev/null || node migrations/migrate_soft_delete_invoices_payments.js || warning "發票/收款軟刪除遷移失敗（可能已存在）"
        npm run migrate:partial-allowance 2>/dev/null || node migrations/migrate_invoice_partial_allowance.js || warning "發票部分折讓遷移失敗（可能已存在）"
        npm run migrate:fix-v-project-summary 2>/dev/null || node migrations/migrate_fix_v_project_summary_invoice_filters.js || warning "v_project_summary 視圖修正失敗（可能已存在）"
        npm run migrate:project-templates 2>/dev/null || node migrations/migrate_project_templates.js || warning "專案範本遷移失敗（可能已存在）"
        npm run migrate:project-types-alert 2>/dev/null || node migrations/migrate_project_types_alert_threshold.js || warning "專案類型毛利警示閾值遷移失敗（可能已存在）"
        npm run migrate:project-types-show-in-dashboard 2>/dev/null || node migrations/migrate_project_types_show_in_dashboard.js || warning "專案類型儀表板顯示遷移失敗（可能已存在）"
        npm run migrate:project-types-separate-dashboard 2>/dev/null || node migrations/migrate_project_types_show_separate_dashboard.js || warning "專案類型儀表板獨立加總欄位遷移失敗（可能已存在）"
        npm run migrate:project-attachments 2>/dev/null || node migrations/migrate_project_attachments.js || warning "專案附件表遷移失敗（可能已存在）"
        npm run migrate:project-attachments-soft-delete 2>/dev/null || node migrations/migrate_project_attachments_soft_delete.js || warning "專案附件軟刪除欄位遷移失敗（可能已存在）"
        npm run migrate:attachment-cleanup-setting 2>/dev/null || node migrations/migrate_attachment_cleanup_setting.js || warning "附件清理設定遷移失敗（可能已存在）"
        npm run migrate:report-groups 2>/dev/null || node migrations/migrate_report_groups.js || warning "報表群組遷移失敗（可能已存在）"
        npm run migrate:dashboard-view-mode 2>/dev/null || node migrations/migrate_dashboard_view_mode.js || warning "儀表板檢視模式遷移失敗（可能已存在）"
        npm run migrate:remove-project-type-check 2>/dev/null || node migrations/migrate_remove_project_type_check.js || warning "移除專案類型 CHECK 約束遷移失敗（可能已存在）"
        npm run migrate:permission-scope 2>/dev/null || node migrations/migrate_permission_scope.js || warning "RBAC 權限範圍遷移失敗（可能已存在）"
        npm run migrate:invoice-summary 2>/dev/null || node migrations/migrate_v_invoice_summary.js || warning "發票彙總視圖遷移失敗（可能已存在）"
        npm run migrate:rename-user-role 2>/dev/null || node migrations/migrate_rename_user_role.js || warning "角色名稱更新失敗（可能已存在）"

        # 首次安裝時插入種子資料
        if [ "$IS_FIRST_INSTALL" = true ]; then
            log "插入種子資料..."
            npm run seed || warning "種子資料插入失敗（可能已存在）"
        fi
        
        log "✓ 資料庫初始化完成"
    else
        log "資料庫已存在，執行增量遷移..."
        cd "${PROJECT_DIR}"
        # 執行增量遷移（這些 migration 會檢查是否已存在，安全執行）
        npm run migrate:project-code || warning "專案編號唯一約束遷移失敗（可能已存在）"
        npm run migrate:project-customer || warning "專案編號+客戶唯一約束遷移失敗（可能已存在）"
        npm run migrate:project-name || warning "專案編號+客戶+專案名稱唯一約束遷移失敗（可能已存在）"
        npm run migrate:user-roles || warning "使用者角色遷移失敗（可能已存在）"
        npm run migrate:roles || warning "角色管理表遷移失敗（可能已存在）"
        npm run migrate:remove-user-role-check || warning "移除使用者角色 CHECK 約束遷移失敗（可能已存在）"
        npm run migrate:system-settings || warning "系統設定表遷移失敗（可能已存在）"
        npm run migrate:project-types || warning "專案類型表遷移失敗（可能已存在）"
              npm run migrate:remove-project-type-check || warning "移除專案類型 CHECK 約束遷移失敗（可能已存在）"
              npm run migrate:sales-discount || warning "銷貨折讓欄位遷移失敗（可能已存在）"
              npm run migrate:costs || warning "成本明細表遷移失敗（可能已存在）"
              npm run migrate:update-total-received || warning "更新收款總額計算遷移失敗（可能已存在）"
              npm run migrate:invoice-expected-payment-date || warning "發票預計收款日欄位遷移失敗（可能已存在）"
        (npm run migrate:invoice-status 2>/dev/null || node migrations/migrate_invoice_status.js) || warning "發票作廢/折讓功能遷移失敗（可能已存在）"
        npm run migrate:soft-delete 2>/dev/null || node migrations/migrate_soft_delete_invoices_payments.js || warning "發票/收款軟刪除遷移失敗（可能已存在）"
        npm run migrate:partial-allowance 2>/dev/null || node migrations/migrate_invoice_partial_allowance.js || warning "發票部分折讓遷移失敗（可能已存在）"
        npm run migrate:fix-v-project-summary 2>/dev/null || node migrations/migrate_fix_v_project_summary_invoice_filters.js || warning "v_project_summary 視圖修正失敗（可能已存在）"
        npm run migrate:project-templates 2>/dev/null || node migrations/migrate_project_templates.js || warning "專案範本遷移失敗（可能已存在）"
        npm run migrate:project-types-alert 2>/dev/null || node migrations/migrate_project_types_alert_threshold.js || warning "專案類型毛利警示閾值遷移失敗（可能已存在）"
        npm run migrate:project-types-show-in-dashboard 2>/dev/null || node migrations/migrate_project_types_show_in_dashboard.js || warning "專案類型儀表板顯示遷移失敗（可能已存在）"
        npm run migrate:project-types-separate-dashboard 2>/dev/null || node migrations/migrate_project_types_show_separate_dashboard.js || warning "專案類型儀表板獨立加總欄位遷移失敗（可能已存在）"
        npm run migrate:project-attachments 2>/dev/null || node migrations/migrate_project_attachments.js || warning "專案附件表遷移失敗（可能已存在）"
        npm run migrate:project-attachments-soft-delete 2>/dev/null || node migrations/migrate_project_attachments_soft_delete.js || warning "專案附件軟刪除欄位遷移失敗（可能已存在）"
        npm run migrate:attachment-cleanup-setting 2>/dev/null || node migrations/migrate_attachment_cleanup_setting.js || warning "附件清理設定遷移失敗（可能已存在）"
        npm run migrate:report-groups 2>/dev/null || node migrations/migrate_report_groups.js || warning "報表群組遷移失敗（可能已存在）"
        npm run migrate:dashboard-view-mode 2>/dev/null || node migrations/migrate_dashboard_view_mode.js || warning "儀表板檢視模式遷移失敗（可能已存在）"
        npm run migrate:permission-scope 2>/dev/null || node migrations/migrate_permission_scope.js || warning "RBAC 權限範圍遷移失敗（可能已存在）"
        npm run migrate:invoice-summary 2>/dev/null || node migrations/migrate_v_invoice_summary.js || warning "發票彙總視圖遷移失敗（可能已存在）"
        npm run migrate:rename-user-role 2>/dev/null || node migrations/migrate_rename_user_role.js || warning "角色名稱更新失敗（可能已存在）"
        log "✓ 增量遷移完成"
    fi
else
    log "步驟 4/6: 跳過資料庫遷移（找不到 migrations 目錄）"
fi

# 步驟 5: 檢查並更新 systemd 服務配置
log "步驟 5/6: 檢查 systemd 服務配置..."
CURRENT_USER=${SUDO_USER:-$USER}
if [ -z "$CURRENT_USER" ]; then
    CURRENT_USER=$(whoami)
fi

NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    error "找不到 Node.js 執行檔"
fi

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
fi

if [ "$NEED_UPDATE" = true ]; then
    log "更新 systemd 服務文件..."
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=專案開立發票業績認列獎金計算總表系統
Documentation=https://github.com/your-repo/invoice-bonus-system
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
Group=${CURRENT_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment="PATH=${PATH}"
ExecStart=${NODE_PATH} ${PROJECT_DIR}/src/app.js
Restart=always
RestartSec=10
StartLimitInterval=0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

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
    echo ""
    info "系統尚未設定自動備份"
    echo ""
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
                info "詳細檢查方式請參閱：自動備份排程檢查與修正指南.md"
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
        echo "或手動執行備份："
        echo "  sudo ${PROJECT_DIR}/backup.sh"
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

