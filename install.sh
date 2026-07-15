#!/bin/bash
# 專案開立發票業績認列獎金計算總表系統 - 一鍵安裝腳本
# 適用於 Ubuntu 24.04

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 專案目錄（安裝到 /opt）
INSTALL_DIR="/opt/invoice-bonus-system"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 檢查是否為 root 用戶（安裝到 /opt 需要 root 權限）
if [ "$EUID" -ne 0 ]; then
    echo -e "\033[0;31m[錯誤]\033[0m 安裝到 /opt 需要 root 權限，請使用 sudo 執行此腳本：sudo ./install.sh"
    exit 1
fi

# 確定當前用戶（用於設定檔案所有權）
CURRENT_USER=${SUDO_USER:-$USER}
if [ -z "$CURRENT_USER" ] || [ "$CURRENT_USER" = "root" ]; then
    CURRENT_USER=$(whoami)
fi

# 先創建安裝目錄（日誌文件需要此目錄）
mkdir -p "${INSTALL_DIR}" || {
    echo -e "\033[0;31m[錯誤]\033[0m 無法創建安裝目錄: ${INSTALL_DIR}"
    exit 1
}
chown -R ${CURRENT_USER}:${CURRENT_USER} "${INSTALL_DIR}" || {
    echo -e "\033[0;31m[錯誤]\033[0m 無法設定安裝目錄權限"
    exit 1
}

# 設定日誌文件
LOG_FILE="${INSTALL_DIR}/install.log"

# 日誌函數
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[錯誤]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}[警告]${NC} $1" | tee -a "$LOG_FILE"
}

# 開始安裝
echo "============================================"
echo "  專案開立發票業績認列獎金計算總表系統"
echo "  一鍵安裝程式"
echo "============================================"
echo ""

log "開始安裝流程..."

# 檢查系統
log "檢查系統環境..."
if [ ! -f /etc/os-release ]; then
    error "無法檢測作業系統版本"
fi

# 檢查 Node.js
log "檢查 Node.js 安裝狀態..."
if ! command -v node &> /dev/null; then
    log "Node.js 未安裝，開始安裝 Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || error "Node.js 安裝失敗"
    sudo apt-get install -y nodejs || error "Node.js 安裝失敗"
    log "Node.js 安裝完成"
else
    NODE_VERSION=$(node -v)
    log "Node.js 已安裝: $NODE_VERSION"
fi

NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
log "Node.js 版本: $NODE_VERSION"
log "npm 版本: $NPM_VERSION"

# 檢查安裝目錄
log "檢查安裝目錄..."
if [ ! -d "${INSTALL_DIR}" ]; then
    error "安裝目錄不存在: ${INSTALL_DIR}"
fi

# 複製專案文件到安裝目錄
log "複製專案文件到安裝目錄..."
if [ "$PROJECT_DIR" != "$INSTALL_DIR" ]; then
    rsync -av --exclude='node_modules' --exclude='.git' --exclude='*.log' \
        "${PROJECT_DIR}/" "${INSTALL_DIR}/" || error "複製專案文件失敗"
    log "專案文件已複製到: ${INSTALL_DIR}"
fi

# 檢查並創建必要的目錄
log "檢查專案目錄結構..."
mkdir -p "${INSTALL_DIR}/data"
mkdir -p "${INSTALL_DIR}/uploads"
# 備份目錄統一使用 /opt/invoice-bonus-backups，不在安裝目錄下創建 backups
mkdir -p "/opt/invoice-bonus-backups" || warning "無法創建備份目錄（可能需要手動創建）"
chmod 755 "/opt/invoice-bonus-backups" 2>/dev/null || true

# 安裝依賴
log "安裝專案依賴套件..."
if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    error "找不到 package.json 檔案"
fi

cd "${INSTALL_DIR}"
npm install || error "依賴套件安裝失敗"
log "依賴套件安裝完成"

# 初始化資料庫
log "初始化資料庫..."
if [ ! -f "${INSTALL_DIR}/migrations/migrate.js" ]; then
    error "找不到資料庫遷移腳本"
fi

cd "${INSTALL_DIR}"
npm run migrate || error "資料庫遷移失敗"
npm run migrate:project-code || warning "專案編號唯一約束遷移失敗（可能已存在）"
npm run migrate:project-customer || warning "專案編號+客戶唯一約束遷移失敗（可能已存在）"
npm run migrate:project-name || warning "專案編號+客戶+專案名稱唯一約束遷移失敗（可能已存在）"
npm run migrate:user-roles || warning "使用者角色遷移失敗（可能已存在）"
npm run migrate:roles || warning "角色管理表遷移失敗（可能已存在）"
npm run migrate:remove-user-role-check || warning "移除使用者角色 CHECK 約束遷移失敗（可能已存在）"
npm run migrate:system-settings || warning "系統設定表遷移失敗（可能已存在）"
npm run migrate:project-types || warning "專案類型表遷移失敗（可能已存在）"
npm run migrate:remove-project-type-check 2>/dev/null || node migrations/migrate_remove_project_type_check.js || warning "移除專案類型 CHECK 約束遷移失敗（可能已存在）"
npm run migrate:sales-discount 2>/dev/null || node migrations/migrate_sales_discount.js || warning "銷貨折讓欄位遷移失敗（可能已存在）"
npm run migrate:costs 2>/dev/null || node migrations/migrate_costs.js || warning "成本明細表遷移失敗（可能已存在）"
npm run migrate:update-total-received 2>/dev/null || node migrations/migrate_update_total_received_with_fee.js || warning "更新收款總額計算遷移失敗（可能已存在）"
npm run migrate:invoice-expected-payment-date 2>/dev/null || node migrations/migrate_invoice_expected_payment_date.js || warning "發票預計收款日欄位遷移失敗（可能已存在）"
npm run migrate:invoice-status 2>/dev/null || node migrations/migrate_invoice_status.js || warning "發票作廢/折讓功能遷移失敗（可能已存在）"
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
npm run seed || error "種子資料插入失敗"
log "資料庫初始化完成"

# 設定檔案權限
log "設定檔案權限..."
chmod +x "${INSTALL_DIR}/install.sh" 2>/dev/null || true
chmod +x "${INSTALL_DIR}/deploy.sh" 2>/dev/null || true
chmod +x "${INSTALL_DIR}/backup.sh" 2>/dev/null || true
chmod +x "${INSTALL_DIR}/restore.sh" 2>/dev/null || true
chmod +x "${INSTALL_DIR}/uninstall.sh" 2>/dev/null || true

# 檢查資料庫檔案
if [ -f "${INSTALL_DIR}/data/invoice_bonus.db" ]; then
    DB_SIZE=$(du -h "${INSTALL_DIR}/data/invoice_bonus.db" | cut -f1)
    log "資料庫檔案已建立，大小: $DB_SIZE"
else
    warning "資料庫檔案未找到，請檢查遷移過程"
fi

# 配置 systemd 服務（開機自動啟動）
log "配置 systemd 服務..."

# 獲取 Node.js 完整路徑
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    error "找不到 Node.js 執行檔"
fi

# 創建 systemd service 文件
SERVICE_NAME="invoice-bonus-system"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# 檢查並清理端口 3000
log "檢查端口 3000 佔用情況..."
PORT_PID=$(sudo lsof -t -i :3000 2>/dev/null || echo "")
if [ -n "$PORT_PID" ]; then
    warning "檢測到端口 3000 被佔用 (PID: $PORT_PID)，正在清理..."
    # 先嘗試停止 systemd 服務
    sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    sleep 2
    # 再次檢查端口
    PORT_PID=$(sudo lsof -t -i :3000 2>/dev/null || echo "")
    if [ -n "$PORT_PID" ]; then
        warning "仍有程序佔用端口，正在終止 PID: $PORT_PID..."
        sudo kill -9 $PORT_PID 2>/dev/null || true
        sleep 1
    fi
    log "端口清理完成"
fi

# 檢查是否已經存在服務
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    log "systemd 服務已存在，先停止並移除舊服務..."
    sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    sudo systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    sleep 2
    sudo rm -f "$SERVICE_FILE"
fi

# 創建服務文件
log "創建 systemd 服務文件..."
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
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment="PATH=${PATH}"
ExecStart=${NODE_PATH} ${INSTALL_DIR}/src/app.js
Restart=always
RestartSec=10
StartLimitInterval=0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=invoice-bonus-system

# 資源限制（可選，根據需要調整）
# LimitNOFILE=65536
# LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

# 重新載入 systemd
log "重新載入 systemd daemon..."
sudo systemctl daemon-reload

# 啟用服務（開機自動啟動）
log "啟用服務（開機自動啟動）..."
if sudo systemctl enable "${SERVICE_NAME}" 2>/dev/null; then
    log "服務已設定為開機自動啟動"
else
    error "無法啟用服務，請檢查 sudo 權限或手動執行：sudo systemctl enable ${SERVICE_NAME}"
fi

# 啟動服務（自動啟動，不詢問）
log "啟動服務..."
if sudo systemctl start "${SERVICE_NAME}" 2>/dev/null; then
    log "服務啟動命令已執行"
    sleep 3
    
    # 檢查服務狀態
    if sudo systemctl is-active --quiet "${SERVICE_NAME}"; then
        log "✓ 服務已成功啟動並運行中"
        SERVICE_STATUS="已啟動並運行"
        
        # 顯示服務狀態摘要
        SERVICE_INFO=$(sudo systemctl status "${SERVICE_NAME}" --no-pager -l | head -n 10)
        log "服務狀態摘要："
        echo "$SERVICE_INFO" | sed 's/^/  /'
    else
        warning "服務可能未正常啟動，正在檢查原因..."
        sleep 2
        
        # 檢查服務日誌
        JOURNAL_LOG=$(sudo journalctl -u "${SERVICE_NAME}" -n 20 --no-pager 2>/dev/null || echo "")
        if [ -n "$JOURNAL_LOG" ]; then
            warning "最近的服務日誌："
            echo "$JOURNAL_LOG" | sed 's/^/  /'
        fi
        
        SERVICE_STATUS="啟動異常，請檢查日誌"
        warning "請執行以下命令檢查詳細狀態："
        warning "  sudo systemctl status ${SERVICE_NAME}"
        warning "  sudo journalctl -u ${SERVICE_NAME} -f"
    fi
else
    error "服務啟動失敗，請檢查日誌：sudo journalctl -u ${SERVICE_NAME}"
fi

echo ""
echo "============================================"
echo -e "${GREEN}  安裝完成！${NC}"
echo "============================================"
echo ""
log "安裝流程完成"

echo "系統資訊："
echo "  - 安裝目錄: $INSTALL_DIR"
echo "  - 資料庫位置: ${INSTALL_DIR}/data/invoice_bonus.db"
echo "  - 上傳目錄: ${INSTALL_DIR}/uploads"
echo "  - 備份目錄: /opt/invoice-bonus-backups"
echo ""
echo "systemd 服務："
echo "  - 服務名稱: ${SERVICE_NAME}"
echo "  - 服務狀態: ${SERVICE_STATUS:-已配置}"
echo "  - 開機自動啟動: 已啟用"
echo ""
echo "服務管理："
echo "  啟動服務: sudo systemctl start invoice-bonus-system"
echo "  停止服務: sudo systemctl stop invoice-bonus-system"
echo "  重啟服務: sudo systemctl restart invoice-bonus-system"
echo "  查看狀態: sudo systemctl status invoice-bonus-system"
echo "  查看日誌: sudo journalctl -u invoice-bonus-system -f"
echo ""
echo "手動啟動（不推薦，系統已配置為自動啟動）："
echo "  npm start     # 生產模式"
echo "  npm run dev   # 開發模式（自動重啟）"
echo ""
echo "系統將運行於 http://localhost:3000"
echo "服務已配置為開機自動啟動"
echo ""
echo "管理腳本："
echo "  cd ${INSTALL_DIR}"
echo "  sudo ./deploy.sh      # 一鍵部署（更新代碼後使用）"
echo "  sudo ./backup.sh      # 備份系統"
echo "  sudo ./restore.sh     # 還原備份"
echo "  sudo ./uninstall.sh   # 移除系統（含備份）"
echo ""
echo "預設功能："
echo "  - 專案管理（新增/編輯/刪除專案）"
echo "  - 發票管理（開立/收款追蹤）"
echo "  - 獎金管理（自動計算/發放追蹤）"
echo "  - 業務管理（業績統計）"
echo "  - 客戶管理"
echo "  - Excel匯入/匯出"
echo ""
