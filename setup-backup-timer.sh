#!/bin/bash
# 設定系統自動備份 - 使用 Systemd Timer
# 此腳本會由 deploy.sh 調用，或可單獨執行

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[錯誤]${NC} 需要 root 權限，請使用 sudo 執行"
    exit 1
fi

# 判斷腳本所在目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 嘗試從配置文件讀取（優先使用腳本所在目錄的配置，然後嘗試 /opt 下的標準目錄）
DEPLOY_CONFIG_FILE="${SCRIPT_DIR}/deploy.config.sh"
if [ ! -f "$DEPLOY_CONFIG_FILE" ]; then
    # 如果當前目錄沒有，嘗試從 /opt 下的標準安裝目錄載入
    if [ -d "/opt/invoice-bonus-system" ] && [ -f "/opt/invoice-bonus-system/deploy.config.sh" ]; then
        DEPLOY_CONFIG_FILE="/opt/invoice-bonus-system/deploy.config.sh"
    elif [ -d "/opt/project-system" ] && [ -f "/opt/project-system/deploy.config.sh" ]; then
        DEPLOY_CONFIG_FILE="/opt/project-system/deploy.config.sh"
    fi
fi

if [ -f "$DEPLOY_CONFIG_FILE" ]; then
    source "$DEPLOY_CONFIG_FILE"
    # 如果配置文件中定義了 INSTALL_DIR，使用它；否則根據 INSTALL_DIR_NAME 計算
    if [ -z "$INSTALL_DIR" ] && [ -n "$INSTALL_DIR_NAME" ]; then
        INSTALL_DIR="/opt/${INSTALL_DIR_NAME}"
    fi
    if [ -z "$BACKUP_DIR" ] && [ -n "$BACKUP_DIR_NAME" ]; then
        BACKUP_DIR="/opt/${BACKUP_DIR_NAME}"
    fi
    if [ -z "$SERVICE_NAME" ]; then
        SERVICE_NAME="invoice-bonus-system"
    fi
else
    # 如果配置文件不存在，使用預設值
    INSTALL_DIR="/opt/invoice-bonus-system"
    BACKUP_DIR="/opt/invoice-bonus-backups"
    SERVICE_NAME="invoice-bonus-system"
fi

# 優先使用 INSTALL_DIR 下的備份腳本，如果不存在則使用當前目錄的備份腳本
BACKUP_SCRIPT="${INSTALL_DIR}/backup.sh"
if [ ! -f "$BACKUP_SCRIPT" ]; then
    # 如果 INSTALL_DIR 下沒有備份腳本，使用當前目錄的備份腳本（適用於開發環境或更新部署）
    BACKUP_SCRIPT="${SCRIPT_DIR}/backup.sh"
    if [ ! -f "$BACKUP_SCRIPT" ]; then
        # 如果當前目錄也沒有，嘗試從標準安裝目錄找
        if [ -f "/opt/invoice-bonus-system/backup.sh" ]; then
            BACKUP_SCRIPT="/opt/invoice-bonus-system/backup.sh"
        fi
    fi
fi
BACKUP_SERVICE_NAME="${SERVICE_NAME}-backup"

# 檢查備份腳本是否存在
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo -e "${RED}[錯誤]${NC} 找不到備份腳本: $BACKUP_SCRIPT"
    exit 1
fi

# 確保備份腳本可執行
chmod +x "$BACKUP_SCRIPT"

echo "============================================"
echo "  設定系統自動備份（Systemd Timer）"
echo "============================================"
echo ""

# 如果已經有參數傳入（非互動模式）
if [ $# -ge 1 ]; then
    SCHEDULE_OPTION="$1"
    CUSTOM_TIME="${2:-}"
else
    # 互動模式
    echo "請選擇自動備份頻率："
    echo ""
    echo "  1) 每日備份 - 每天凌晨 2:00"
    echo "  2) 每週備份 - 每週日凌晨 2:00"
    echo "  3) 每日兩次 - 每天 2:00 和 14:00"
    echo "  4) 進階自訂 - 使用 systemd OnCalendar 格式"
    echo "  5) 停用自動備份"
    echo "  6) 每日自訂時間 - 輸入 時:分（如 03:30 表示每天 3:30）"
    echo ""
    read -p "請輸入選項 [1-6]: " SCHEDULE_OPTION
fi

# 設定 systemd timer 的 OnCalendar 值
case "$SCHEDULE_OPTION" in
    1)
        ON_CALENDAR="daily"
        ON_CALENDAR_TIME="*-*-* 02:00:00"
        DESCRIPTION="每日凌晨 2:00 自動備份"
        ;;
    2)
        ON_CALENDAR="weekly"
        ON_CALENDAR_TIME="Sun *-*-* 02:00:00"
        DESCRIPTION="每週日凌晨 2:00 自動備份"
        ;;
    3)
        ON_CALENDAR="twice-daily"
        ON_CALENDAR_TIME="*-*-* 02,14:00:00"
        DESCRIPTION="每日 2:00 和 14:00 自動備份"
        ;;
    4)
        if [ -z "$CUSTOM_TIME" ]; then
            echo ""
            echo "自訂時間格式範例："
            echo "  *-*-* 03:00:00          # 每天凌晨 3:00"
            echo "  Mon,Wed,Fri 02:00:00    # 每週一、三、五凌晨 2:00"
            echo "  *-*-01 02:00:00         # 每月 1 號凌晨 2:00"
            echo "  *-*-* 00/6:00:00        # 每 6 小時（0:00, 6:00, 12:00, 18:00）"
            echo ""
            read -p "請輸入時間格式: " CUSTOM_TIME
        fi
        ON_CALENDAR="custom"
        ON_CALENDAR_TIME="$CUSTOM_TIME"
        DESCRIPTION="自訂時間自動備份: $CUSTOM_TIME"
        ;;
    6)
        # 每日自訂時間：輸入 時:分，轉換為 OnCalendar 格式
        if [ -z "$CUSTOM_TIME" ]; then
            echo ""
            echo "請輸入每日備份時間（格式：時:分，24小時制）"
            echo "  範例：03:30 表示每天凌晨 3:30"
            echo "  範例：14:00 表示每天下午 2:00"
            echo ""
            read -p "請輸入時間 [02:00]: " CUSTOM_TIME
            CUSTOM_TIME="${CUSTOM_TIME:-02:00}"
        fi
        # 轉換 HH:MM 為 HH:MM:00，並驗證格式
        if [[ "$CUSTOM_TIME" =~ ^([0-9]{1,2}):([0-5][0-9])$ ]]; then
            HOUR=$((10#${BASH_REMATCH[1]}))
            MIN=$((10#${BASH_REMATCH[2]}))
            if [ "$HOUR" -ge 0 ] 2>/dev/null && [ "$HOUR" -le 23 ] 2>/dev/null; then
                HOUR=$(printf "%02d" "$HOUR")
                MIN=$(printf "%02d" "$MIN")
                ON_CALENDAR="daily-custom"
                ON_CALENDAR_TIME="*-*-* ${HOUR}:${MIN}:00"
                DESCRIPTION="每日 ${HOUR}:${MIN} 自動備份"
            else
                echo -e "${RED}[錯誤]${NC} 小時需為 0-23"
                exit 1
            fi
        else
            echo -e "${RED}[錯誤]${NC} 時間格式錯誤，請使用 時:分（如 03:30）"
            exit 1
        fi
        ;;
    5)
        echo ""
        echo -e "${YELLOW}停用自動備份...${NC}"
        
        # 停止並停用 timer
        systemctl stop ${BACKUP_SERVICE_NAME}.timer 2>/dev/null || true
        systemctl disable ${BACKUP_SERVICE_NAME}.timer 2>/dev/null || true
        
        # 移除服務檔案
        rm -f /etc/systemd/system/${BACKUP_SERVICE_NAME}.service
        rm -f /etc/systemd/system/${BACKUP_SERVICE_NAME}.timer
        
        # 重新載入
        systemctl daemon-reload
        
        echo -e "${GREEN}✓ 自動備份已停用${NC}"
        echo ""
        echo "您仍可手動執行備份："
        echo "  cd ${INSTALL_DIR}"
        echo "  sudo ./backup.sh"
        exit 0
        ;;
    *)
        echo -e "${RED}[錯誤]${NC} 無效的選項"
        exit 1
        ;;
esac

echo ""
echo "設定內容："
echo "  - 備份頻率: $DESCRIPTION"
echo "  - 備份腳本: $BACKUP_SCRIPT"
echo "  - 備份目錄: ${BACKUP_DIR}"
echo ""

# 創建 systemd service 文件
echo "創建 systemd service..."
cat > /etc/systemd/system/${BACKUP_SERVICE_NAME}.service <<EOF
[Unit]
Description=${SERVICE_NAME} Backup Service
Documentation=https://github.com/your-repo/invoice-bonus-system
After=network.target ${SERVICE_NAME}.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=${INSTALL_DIR}
# 必須設定 NON_INTERACTIVE，否則 backup.sh 會進入互動模式等待選擇，導致排程備份失敗
# 使用 /bin/bash -c 內聯設定，確保變數必定傳遞（部分環境 Environment= 可能未生效）
ExecStart=/bin/bash -c 'NON_INTERACTIVE=1 exec '"${BACKUP_SCRIPT}"
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${BACKUP_SERVICE_NAME}

# 資源限制
Nice=10
IOSchedulingClass=idle
EOF

echo -e "${GREEN}✓ Service 文件已創建${NC}"

# 創建 systemd timer 文件
echo "創建 systemd timer..."
cat > /etc/systemd/system/${BACKUP_SERVICE_NAME}.timer <<EOF
[Unit]
Description=${SERVICE_NAME} Backup Timer
Documentation=https://github.com/your-repo/invoice-bonus-system

[Timer]
# 備份時間設定
OnCalendar=${ON_CALENDAR_TIME}

# 如果錯過了執行時間，立即執行一次
Persistent=true

# 隨機延遲 0-300 秒（避免多個系統同時備份造成網路擁塞）
RandomizedDelaySec=300

# 準確性（允許的時間誤差）
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

echo -e "${GREEN}✓ Timer 文件已創建${NC}"

# 重新載入 systemd
echo "重新載入 systemd..."
systemctl daemon-reload

# 啟用並啟動 timer（restart 可強制 systemd 正確計算 NEXT 時間，避免顯示 n/a）
echo "啟用 timer..."
systemctl enable ${BACKUP_SERVICE_NAME}.timer
systemctl restart ${BACKUP_SERVICE_NAME}.timer

echo ""
echo "============================================"
echo -e "${GREEN}  自動備份設定完成！${NC}"
echo "============================================"
echo ""
echo "設定資訊："
echo "  - 服務名稱: ${BACKUP_SERVICE_NAME}.service"
echo "  - Timer 名稱: ${BACKUP_SERVICE_NAME}.timer"
echo "  - 備份頻率: $DESCRIPTION"
echo ""

# 顯示 timer 狀態
echo "Timer 狀態："
systemctl status ${BACKUP_SERVICE_NAME}.timer --no-pager -l | head -n 15 | sed 's/^/  /'
echo ""

# 顯示下次執行時間
NEXT_RUN=$(systemctl list-timers ${BACKUP_SERVICE_NAME}.timer --no-pager | grep ${BACKUP_SERVICE_NAME} | awk '{print $1, $2, $3, $4, $5}' | head -n 1)
if [ -n "$NEXT_RUN" ]; then
    echo "下次執行時間："
    systemctl list-timers ${BACKUP_SERVICE_NAME}.timer --no-pager | grep -A 1 "NEXT" | sed 's/^/  /'
fi

echo ""
echo "管理命令："
echo "  查看 timer 狀態:    sudo systemctl status ${BACKUP_SERVICE_NAME}.timer"
echo "  查看所有 timers:    sudo systemctl list-timers"
echo "  立即執行備份:       sudo systemctl start ${BACKUP_SERVICE_NAME}.service"
echo "  查看備份日誌:       sudo journalctl -u ${BACKUP_SERVICE_NAME}.service -n 50"
echo "  停用自動備份:       sudo systemctl disable ${BACKUP_SERVICE_NAME}.timer"
echo "  重新啟用:          sudo systemctl enable ${BACKUP_SERVICE_NAME}.timer"
echo "  修改設定:          sudo ${INSTALL_DIR}/setup-backup-timer.sh"
echo ""
echo "測試建議："
echo "  # 立即執行一次備份測試"
echo "  sudo systemctl start ${BACKUP_SERVICE_NAME}.service"
echo ""
echo "  # 查看備份執行結果"
echo "  sudo journalctl -u ${BACKUP_SERVICE_NAME}.service -n 50 --no-pager"
echo ""

