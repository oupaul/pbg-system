#!/bin/bash
# PBG 系統 - 從 GitHub 更新現有安裝
#
# 用法（在伺服器上）：
#   sudo /opt/your-install-dir/update.sh          # 預設 branch (develop)
#   sudo /opt/your-install-dir/update.sh main      # 指定 branch
#
# 或遠端一行指令（公開 Repo）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/oupaul/pbg-system/develop/update.sh)
#
# 私有 Repo（curl 本身也需帶 token，支援 ghp_ 與 github_pat_ 格式）：
#   export GH_TOKEN=github_pat_xxxxxxxxxxxx   # 或 ghp_xxxxxxxxxxxx
#   bash <(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
#     https://raw.githubusercontent.com/oupaul/pbg-system/develop/update.sh)

set -e

GITHUB_USER="oupaul"
GITHUB_REPO="pbg-system"
BRANCH="${1:-${DEPLOY_BRANCH:-develop}}"

# 顏色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
error()   { echo -e "${RED}[錯誤]${NC} $1"; exit 1; }
warning() { echo -e "${YELLOW}[警告]${NC} $1"; }
info()    { echo -e "${BLUE}[資訊]${NC} $1"; }

echo ""
echo "============================================"
echo "  PBG 系統 - 從 GitHub 更新"
echo "  Repo  : https://github.com/${GITHUB_USER}/${GITHUB_REPO}"
echo "  Branch: ${BRANCH}"
echo "============================================"
echo ""

# 需要 root
if [ "$EUID" -ne 0 ]; then
    error "請使用 sudo 執行：sudo ./update.sh"
fi

# ── 偵測安裝目錄 ──────────────────────────────────────────────
detect_install_dir() {
    # 方法1：從 systemd service unit 偵測（最可靠）
    local unit
    unit=$(find /etc/systemd/system -maxdepth 1 -name "*.service" 2>/dev/null \
           | xargs grep -l "app.js" 2>/dev/null \
           | grep -v backup | head -1)
    if [ -n "$unit" ]; then
        local app_path
        app_path=$(grep "ExecStart" "$unit" | grep -oP '(?<= )/[^ ]+/src/app\.js' | head -1)
        if [ -n "$app_path" ]; then
            dirname "$(dirname "$app_path")"
            return 0
        fi
    fi

    # 方法2：從 deploy.config.sh 搜尋
    local config
    config=$(find /opt -maxdepth 2 -name "deploy.config.sh" 2>/dev/null | head -1)
    if [ -n "$config" ]; then
        local dir
        dir=$(grep "^INSTALL_DIR=" "$config" 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"')
        if [ -n "$dir" ] && [ -d "$dir" ]; then
            echo "$dir"
            return 0
        fi
    fi

    # 方法3：預設路徑
    echo "/opt/invoice-bonus-system"
}

INSTALL_DIR=$(detect_install_dir)

# 如果 update.sh 是從安裝目錄本身執行，優先用那個路徑
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/package.json" ] && [ -f "${SCRIPT_DIR}/deploy.sh" ]; then
    INSTALL_DIR="$SCRIPT_DIR"
fi

log "安裝目錄：${INSTALL_DIR}"

# 驗證安裝目錄
if [ ! -d "$INSTALL_DIR" ]; then
    error "安裝目錄不存在：${INSTALL_DIR}\n若尚未安裝，請先執行全新安裝：\n  bash <(curl -fsSL https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/setup.sh)"
fi
if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    error "${INSTALL_DIR} 不是有效的安裝目錄（找不到 package.json）"
fi

# 安裝 git（若尚未安裝）
if ! command -v git &>/dev/null; then
    log "安裝 git..."
    apt-get update -qq && apt-get install -y -qq git || error "git 安裝失敗"
fi

# 組合 git clone URL（支援 PAT）
if [ -n "$GH_TOKEN" ]; then
    GIT_URL="https://${GH_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
    log "使用 GH_TOKEN 進行認證"
else
    GIT_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
fi

# 下載最新版本到暫存目錄
TMP="/tmp/pbg-update-$$"
log "從 GitHub 下載最新版本（branch: ${BRANCH}）..."
if ! git clone --depth=1 -b "$BRANCH" "$GIT_URL" "$TMP" 2>&1; then
    error "下載失敗。請確認：
  - 網路可存取 github.com
  - 若為私有 Repo，請設定 GH_TOKEN：export GH_TOKEN=ghp_xxxxxxxxxxxx"
fi
log "✓ 下載完成"

# 顯示版本資訊
NEW_VERSION=$(grep '"version"' "$TMP/package.json" 2>/dev/null | head -1 | grep -oP '[\d.]+' | head -1 || echo "未知")
OLD_VERSION=$(grep '"version"' "$INSTALL_DIR/package.json" 2>/dev/null | head -1 | grep -oP '[\d.]+' | head -1 || echo "未知")
info "目前版本：v${OLD_VERSION}  →  最新版本：v${NEW_VERSION}"
echo ""

# ── 同步程式碼（保留資料、上傳檔案、設定）─────────────────────
log "同步程式碼到 ${INSTALL_DIR}..."

RSYNC_EXCLUDES=(
    'node_modules/'
    '.git/'
    'data/'
    'uploads/'
    'backups/'
    'deploy.config.sh'
    '*.log'
    '*.db'
    '*.db-wal'
    '*.db-shm'
)

EXCLUDE_ARGS=()
for ex in "${RSYNC_EXCLUDES[@]}"; do
    EXCLUDE_ARGS+=("--exclude=${ex}")
done

if command -v rsync &>/dev/null; then
    rsync -a --delete "${EXCLUDE_ARGS[@]}" "${TMP}/" "${INSTALL_DIR}/" \
        || error "rsync 同步失敗"
else
    warning "rsync 未安裝，使用 cp 備援..."
    for d in src migrations public fonts scripts; do
        [ -d "${TMP}/$d" ] && cp -r "${TMP}/$d" "${INSTALL_DIR}/"
    done
    for f in package.json package-lock.json \
              deploy.sh restore.sh backup.sh install.sh update.sh setup.sh \
              uninstall.sh setup-backup-timer.sh; do
        [ -f "${TMP}/$f" ] && cp "${TMP}/$f" "${INSTALL_DIR}/$f"
    done
fi

log "✓ 程式碼同步完成"

# 清理暫存
rm -rf "$TMP"
log "✓ 暫存目錄已清理"

# ── 執行增量部署（更新模式）─────────────────────────────────────
log "啟動部署腳本（增量更新模式）..."
echo ""
cd "${INSTALL_DIR}"
chmod +x deploy.sh
exec sudo SKIP_BACKUP_PROMPT=1 bash deploy.sh
