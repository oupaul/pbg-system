#!/bin/bash
# PBG 系統 - 全新主機一鍵安裝（從 GitHub）
#
# 用法：
#   公開 Repo:
#     bash <(curl -fsSL https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)
#
#   私有 Repo（使用 GitHub Personal Access Token）:
#     export GH_TOKEN=ghp_xxxxxxxxxxxx
#     bash <(curl -fsSL https://raw.githubusercontent.com/oupaul/pbg-system/develop/setup.sh)
#
#   指定 branch:
#     DEPLOY_BRANCH=main bash <(curl -fsSL ...)

set -e

GITHUB_USER="oupaul"
GITHUB_REPO="pbg-system"
BRANCH="${DEPLOY_BRANCH:-develop}"
CLONE_DIR="/tmp/pbg-setup-$$"

# 顏色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()     { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
error()   { echo -e "${RED}[錯誤]${NC} $1"; exit 1; }
warning() { echo -e "${YELLOW}[警告]${NC} $1"; }

echo ""
echo "============================================"
echo "  PBG 系統 - 從 GitHub 全新安裝"
echo "  Repo : https://github.com/${GITHUB_USER}/${GITHUB_REPO}"
echo "  Branch: ${BRANCH}"
echo "============================================"
echo ""

# 需要 root
if [ "$EUID" -ne 0 ]; then
    error "請使用 sudo 執行：\n  sudo bash <(curl -fsSL ...)"
fi

# 安裝 git（若尚未安裝）
if ! command -v git &>/dev/null; then
    log "安裝 git..."
    apt-get update -qq && apt-get install -y -qq git || error "git 安裝失敗，請手動執行：apt-get install -y git"
fi
log "✓ git $(git --version | awk '{print $3}')"

# 組合 git clone URL（支援 PAT）
if [ -n "$GH_TOKEN" ]; then
    GIT_URL="https://${GH_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
    log "使用 GH_TOKEN 進行認證"
else
    GIT_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
fi

# 從 GitHub 下載
log "正在從 GitHub 下載（branch: ${BRANCH}）..."
if ! git clone --depth=1 -b "$BRANCH" "$GIT_URL" "$CLONE_DIR" 2>&1; then
    echo ""
    error "下載失敗。可能原因：
  1. Repo 為私有 → 請設定 GH_TOKEN：
       export GH_TOKEN=ghp_xxxxxxxxxxxx
       bash <(curl -fsSL ...)
  2. Branch '${BRANCH}' 不存在 → 請確認 branch 名稱
  3. 網路問題 → 請確認伺服器可存取 github.com"
fi
log "✓ 下載完成：${CLONE_DIR}"

# 賦予執行權限
chmod +x "${CLONE_DIR}/deploy.sh"

# 移交給 deploy.sh 處理
log "啟動部署腳本..."
echo ""
exec sudo bash "${CLONE_DIR}/deploy.sh"
