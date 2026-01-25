#!/bin/bash
#
# nPanel Uninstaller & Rollback Manager
# Safe removal with optional backup restoration
#
# Usage:
#   npanel-uninstall --help
#   npanel-uninstall --full           # Complete uninstall
#   npanel-uninstall --config-only    # Keep data
#   npanel-uninstall --rollback       # Restore previous version
#

set -euo pipefail

readonly INSTALL_PATH="/opt/npanel"
readonly CONFIG_PATH="/etc/npanel"
readonly MANIFEST_FILE="/root/.npanel-manifest.json"
readonly BACKUP_DIR="${INSTALL_PATH}/.backups"

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

log_info() { echo -e "${CYAN}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }

confirm() {
  local prompt="$1"
  local response
  echo -ne "${BOLD}$prompt${NC} (yes/no): "
  read -r response
  [[ "$response" =~ ^[Yy][Ee][Ss]$ ]]
}

uninstall_full() {
  log_warn "FULL UNINSTALL - This will remove all nPanel files and data"
  confirm "Continue?" || { log_info "Cancelled"; exit 0; }
  
  log_info "Stopping services..."
  systemctl stop npanel-* 2>/dev/null || true
  systemctl disable npanel-* 2>/dev/null || true
  
  log_info "Removing systemd services..."
  rm -f /etc/systemd/system/npanel-*.service
  systemctl daemon-reload
  
  log_info "Removing installation files..."
  rm -rf "$INSTALL_PATH"
  rm -rf "$CONFIG_PATH"
  
  log_info "Removing manifest..."
  rm -f "$MANIFEST_FILE"
  
  log_success "Full uninstall complete"
}

uninstall_config_only() {
  log_warn "CONFIG-ONLY UNINSTALL - Data will be preserved"
  confirm "Continue?" || { log_info "Cancelled"; exit 0; }
  
  log_info "Stopping services..."
  systemctl stop npanel-* 2>/dev/null || true
  systemctl disable npanel-* 2>/dev/null || true
  
  log_info "Removing systemd services..."
  rm -f /etc/systemd/system/npanel-*.service
  systemctl daemon-reload
  
  log_info "Removing binaries (keeping /opt/npanel/data)..."
  rm -rf "$INSTALL_PATH"/bin
  rm -rf "$INSTALL_PATH"/config
  
  log_success "Config uninstall complete - data preserved"
}

rollback_to_previous() {
  if [ ! -d "$BACKUP_DIR" ]; then
    log_error "No backups found"
    exit 1
  fi
  
  local latest_backup
  latest_backup=$(ls -t "$BACKUP_DIR"/bin-*.tar.gz 2>/dev/null | head -1)
  
  if [ -z "$latest_backup" ]; then
    log_error "No binary backups found"
    exit 1
  fi
  
  log_info "Latest backup: $latest_backup"
  confirm "Restore?" || { log_info "Cancelled"; exit 0; }
  
  log_info "Stopping services..."
  systemctl stop npanel-* 2>/dev/null || true
  
  log_info "Restoring binaries..."
  rm -rf "$INSTALL_PATH/bin"
  tar xzf "$latest_backup" -C "$INSTALL_PATH"
  
  log_info "Restarting services..."
  systemctl start npanel-* 2>/dev/null || true
  
  log_success "Rollback complete"
}

show_help() {
  cat << EOF
${BOLD}nPanel Uninstaller & Rollback Manager${NC}

${BOLD}Usage:${NC}
  npanel-uninstall [COMMAND]

${BOLD}Commands:${NC}
  --full              Complete uninstall (remove everything)
  --config-only       Remove config but preserve data
  --rollback          Restore from latest backup
  --status            Show installation status
  --list-backups      List available backups
  --help              Show this help

${BOLD}Examples:${NC}
  npanel-uninstall --full
  npanel-uninstall --rollback
  npanel-uninstall --list-backups

EOF
}

show_status() {
  log_info "nPanel Installation Status"
  log_info "=========================="
  
  if [ -f "$MANIFEST_FILE" ]; then
    log_success "Installation detected"
    cat "$MANIFEST_FILE" | jq . 2>/dev/null || cat "$MANIFEST_FILE"
  else
    log_warn "No installation manifest found"
  fi
  
  echo ""
  log_info "Services:"
  systemctl status npanel-* 2>/dev/null || log_warn "No services running"
}

list_backups() {
  if [ ! -d "$BACKUP_DIR" ]; then
    log_warn "No backup directory found"
    exit 0
  fi
  
  log_info "Available backups:"
  ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null || log_warn "No backups found"
}

main() {
  if [ $EUID -ne 0 ]; then
    log_error "Must be run as root"
    exit 1
  fi
  
  case "${1:-}" in
    --full) uninstall_full ;;
    --config-only) uninstall_config_only ;;
    --rollback) rollback_to_previous ;;
    --status) show_status ;;
    --list-backups) list_backups ;;
    --help|-h) show_help ;;
    *) show_help; exit 1 ;;
  esac
}

main "$@"
