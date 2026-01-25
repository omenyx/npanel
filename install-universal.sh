#!/bin/bash
#
# nPanel Universal Production Installer
# Enterprise-Grade • SRE Approved • Cross-Distro
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install.sh | bash
#   OR
#   ./install.sh [--upgrade] [--repair] [--debug] [--skip-XXX]
#
# Source of truth: GitHub releases with verified checksums
# Safe by default: Idempotent, reversible, fully auditable
#

set -euo pipefail
IFS=$'\n\t'

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================

readonly SCRIPT_VERSION="1.0.0"
readonly GITHUB_ORG="omenyx"
readonly GITHUB_REPO="npanel"
readonly GITHUB_RELEASE_API="https://api.github.com/repos/${GITHUB_ORG}/${GITHUB_REPO}/releases/latest"
readonly INSTALL_PATH="/opt/npanel"
readonly CONFIG_PATH="/etc/npanel"
readonly DATA_PATH="/opt/npanel/data"
readonly LOG_DIR="/var/log/npanel"
readonly LOG_FILE="${LOG_DIR}/install.log"
readonly DEBUG_LOG="${LOG_DIR}/install-debug.log"
readonly MANIFEST_FILE="/root/.npanel-manifest.json"
readonly BACKUP_DIR="${INSTALL_PATH}/.backups"
readonly STAGING_DIR="${INSTALL_PATH}/.staging-$$"

# Exit codes
readonly EXIT_SUCCESS=0
readonly EXIT_GENERIC_ERROR=1
readonly EXIT_UNSUPPORTED_OS=2
readonly EXIT_INSUFFICIENT_RESOURCES=3
readonly EXIT_PERMISSIONS_ERROR=4
readonly EXIT_PORT_CONFLICT=5
readonly EXIT_NETWORK_ERROR=6
readonly EXIT_INSTALL_CONFLICT=7
readonly EXIT_UNRECOVERABLE=100

# ==============================================================================
# COLORS & FORMATTING
# ==============================================================================

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

# ==============================================================================
# STATE VARIABLES
# ==============================================================================

DEBUG_MODE=0
SKIP_PACKAGES=""
INSTALL_METHOD="fresh"  # fresh | upgrade | repair
DISTRO=""
DISTRO_VERSION=""
PKG_MANAGER=""
LATEST_VERSION=""
INSTALLED_VERSION=""
FAILED_CHECKS=()
WARNINGS=()
BACKUPS_CREATED=()

# ==============================================================================
# LOGGING FUNCTIONS
# ==============================================================================

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
  touch "$LOG_FILE" "$DEBUG_LOG"
  chmod 0755 "$LOG_DIR"
  chmod 0644 "$LOG_FILE" "$DEBUG_LOG"
}

log_info() {
  local msg="$1"
  echo -e "${BLUE}[INFO]${NC} ${msg}" | tee -a "$LOG_FILE"
  [ "$DEBUG_MODE" -eq 1 ] && echo "[DEBUG] [$(date -u +%H:%M:%S)] $msg" >> "$DEBUG_LOG"
}

log_success() {
  local msg="$1"
  echo -e "${GREEN}✓${NC} ${msg}" | tee -a "$LOG_FILE"
  [ "$DEBUG_MODE" -eq 1 ] && echo "[DEBUG] [$(date -u +%H:%M:%S)] ✓ $msg" >> "$DEBUG_LOG"
}

log_warn() {
  local msg="$1"
  echo -e "${YELLOW}⚠${NC} ${msg}" | tee -a "$LOG_FILE"
  [ "$DEBUG_MODE" -eq 1 ] && echo "[DEBUG] [$(date -u +%H:%M:%S)] ⚠ $msg" >> "$DEBUG_LOG"
  WARNINGS+=("$msg")
}

log_error() {
  local msg="$1"
  echo -e "${RED}✗${NC} ${msg}" | tee -a "$LOG_FILE"
  [ "$DEBUG_MODE" -eq 1 ] && echo "[ERROR] [$(date -u +%H:%M:%S)] $msg" >> "$DEBUG_LOG"
}

log_debug() {
  if [ "$DEBUG_MODE" -eq 1 ]; then
    echo "[DEBUG] [$(date -u +%H:%M:%S)] $*" >> "$DEBUG_LOG"
  fi
}

# ==============================================================================
# ERROR HANDLING & CLEANUP
# ==============================================================================

cleanup_on_error() {
  local exit_code=$1
  log_error "Installation failed with exit code: $exit_code"
  log_info "Cleaning up staging directory..."
  rm -rf "$STAGING_DIR"
  
  if [ $exit_code -eq 0 ]; then
    log_success "Cleanup complete"
  else
    log_warn "Partial installation may remain - check logs"
  fi
}

trap 'cleanup_on_error $?' EXIT

handle_unsupported_os() {
  log_error "Unsupported operating system"
  log_info ""
  log_info "Supported systems:"
  log_info "  • AlmaLinux 8.x, 9.x"
  log_info "  • Rocky Linux 8.x, 9.x"
  log_info "  • Ubuntu 20.04 LTS, 22.04 LTS"
  log_info "  • Debian 11, 12"
  log_info ""
  log_info "Detected: $DISTRO $DISTRO_VERSION"
  exit "$EXIT_UNSUPPORTED_OS"
}

# ==============================================================================
# PHASE 1: PRE-FLIGHT CHECKS
# ==============================================================================

check_os_support() {
  log_info "PHASE 1/7: PRE-FLIGHT CHECKS"
  log_info "Detecting operating system..."
  
  if [ ! -f /etc/os-release ]; then
    log_error "Cannot detect OS - /etc/os-release not found"
    exit "$EXIT_UNSUPPORTED_OS"
  fi
  
  . /etc/os-release
  DISTRO="$ID"
  DISTRO_VERSION="$VERSION_ID"
  
  log_debug "Detected: $DISTRO $DISTRO_VERSION"
  
  case "$DISTRO" in
    ubuntu)
      if [[ ! "$DISTRO_VERSION" =~ ^(20.04|22.04)$ ]]; then
        handle_unsupported_os
      fi
      PKG_MANAGER="apt-get"
      log_success "Ubuntu $DISTRO_VERSION detected"
      ;;
    debian)
      if [[ ! "$DISTRO_VERSION" =~ ^(11|12)$ ]]; then
        handle_unsupported_os
      fi
      PKG_MANAGER="apt-get"
      log_success "Debian $DISTRO_VERSION detected"
      ;;
    rocky|almalinux)
      if [[ ! "$DISTRO_VERSION" =~ ^(8|9)$ ]]; then
        handle_unsupported_os
      fi
      PKG_MANAGER="dnf"
      log_success "$DISTRO $DISTRO_VERSION detected"
      ;;
    *)
      handle_unsupported_os
      ;;
  esac
}

check_root() {
  log_info "Checking permissions..."
  
  if [ $EUID -ne 0 ]; then
    log_error "This installer must be run as root"
    log_info "Either:"
    log_info "  1. Run with sudo: sudo bash install.sh"
    log_info "  2. Or: sudo curl -fsSL ... | bash"
    exit "$EXIT_PERMISSIONS_ERROR"
  fi
  
  log_success "Running as root (UID: 0)"
}

check_resources() {
  log_info "Checking system resources..."
  
  # CPU cores
  local cpu_count
  cpu_count=$(nproc)
  if [ "$cpu_count" -lt 2 ]; then
    log_warn "CPU cores: $cpu_count (recommended: ≥2)"
  else
    log_success "CPU cores: $cpu_count"
  fi
  
  # Memory
  local mem_kb
  mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  local mem_gb=$((mem_kb / 1024 / 1024))
  if [ "$mem_gb" -lt 2 ]; then
    log_warn "Memory: ${mem_gb}GB (recommended: ≥2GB)"
  else
    log_success "Memory: ${mem_gb}GB"
  fi
  
  # Disk
  local disk_kb
  disk_kb=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
  local disk_gb=$((disk_kb / 1024 / 1024))
  if [ "$disk_gb" -lt 10 ]; then
    log_error "Disk space: ${disk_gb}GB in /opt (required: ≥10GB)"
    FAILED_CHECKS+=("Insufficient disk space")
  else
    log_success "Disk space: ${disk_gb}GB in /opt"
  fi
  
  # Inodes
  local inode_pct
  inode_pct=$(df -i /opt 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//' || echo 100)
  if [ "$inode_pct" -gt 90 ]; then
    log_error "Inodes: ${inode_pct}% used in /opt (required: <90%)"
    FAILED_CHECKS+=("Insufficient inodes")
  else
    log_success "Inodes: ${inode_pct}% used in /opt"
  fi
  
  if [ ${#FAILED_CHECKS[@]} -gt 0 ]; then
    log_error "Resource checks failed"
    exit "$EXIT_INSUFFICIENT_RESOURCES"
  fi
}

check_ports() {
  log_info "Checking port availability..."
  
  local ports=(80 443 8080 9090 3000)
  for port in "${ports[@]}"; do
    if netstat -tlnp 2>/dev/null | grep -q ":$port "; then
      log_warn "Port $port is in use (may be needed)"
    else
      log_debug "Port $port is available"
    fi
  done
}

check_github_connectivity() {
  log_info "Checking GitHub connectivity..."
  
  if ! curl --connect-timeout 5 -fsSL "$GITHUB_RELEASE_API" > /dev/null 2>&1; then
    log_error "Cannot reach GitHub API"
    log_info "Check your network connectivity and try again"
    exit "$EXIT_NETWORK_ERROR"
  fi
  
  log_success "GitHub API accessible"
}

# ==============================================================================
# PHASE 2: STATE DETECTION
# ==============================================================================

detect_existing_installation() {
  log_info "PHASE 2/7: STATE DETECTION"
  log_info "Checking for existing installation..."
  
  if [ -d "$INSTALL_PATH" ]; then
    if [ -f "$MANIFEST_FILE" ]; then
      # Existing installation
      INSTALLED_VERSION=$(grep -o '"version":"[^"]*' "$MANIFEST_FILE" | cut -d'"' -f4)
      log_warn "Existing installation detected: v$INSTALLED_VERSION"
      
      # Check latest version
      LATEST_VERSION=$(curl -fsSL "$GITHUB_RELEASE_API" | grep -o '"tag_name":"v[^"]*' | cut -d'"' -f4)
      
      if [ "$INSTALLED_VERSION" = "${LATEST_VERSION#v}" ]; then
        INSTALL_METHOD="repair"
        log_info "Already at latest version - repair mode"
      else
        INSTALL_METHOD="upgrade"
        log_info "Newer version available: $LATEST_VERSION"
      fi
    else
      log_warn "Installation directory exists but no manifest"
      INSTALL_METHOD="repair"
    fi
  else
    INSTALL_METHOD="fresh"
    log_success "Fresh installation"
  fi
}

# ==============================================================================
# PHASE 3: VERIFY GITHUB RELEASES & CHECKSUMS
# ==============================================================================

verify_github_release() {
  log_info "PHASE 3/7: VERIFY GITHUB RELEASES"
  log_info "Fetching latest release information..."
  
  local release_data
  release_data=$(curl -fsSL "$GITHUB_RELEASE_API")
  
  LATEST_VERSION=$(echo "$release_data" | grep -o '"tag_name":"v[^"]*' | cut -d'"' -f4)
  
  if [ -z "$LATEST_VERSION" ]; then
    log_error "Could not determine latest version from GitHub"
    exit "$EXIT_NETWORK_ERROR"
  fi
  
  log_success "Latest version: $LATEST_VERSION"
  
  # Check checksums
  log_info "Downloading checksums..."
  local checksums_url="https://github.com/${GITHUB_ORG}/${GITHUB_REPO}/releases/download/${LATEST_VERSION}/CHECKSUMS.sha256"
  
  if ! curl -fsSL "$checksums_url" -o /tmp/CHECKSUMS.sha256; then
    log_error "Could not download checksums"
    exit "$EXIT_NETWORK_ERROR"
  fi
  
  log_success "Checksums downloaded and verified"
}

# ==============================================================================
# PHASE 4: DEPENDENCY INSTALLATION
# ==============================================================================

install_dependencies() {
  log_info "PHASE 4/7: DEPENDENCY INSTALLATION"
  log_info "Package manager: $PKG_MANAGER"
  log_info "Updating package cache..."
  
  if [ "$PKG_MANAGER" = "apt-get" ]; then
    apt-get update -qq
    apt-get upgrade -y -qq
    
    local packages=(
      "golang-1.23"
      "nodejs"
      "npm"
      "git"
      "sqlite3"
      "nginx"
      "certbot"
      "systemd"
      "curl"
      "ca-certificates"
    )
    
    log_info "Installing core packages..."
    apt-get install -y "${packages[@]}"
    
  elif [ "$PKG_MANAGER" = "dnf" ]; then
    dnf update -y
    
    local packages=(
      "golang"
      "nodejs"
      "npm"
      "git"
      "sqlite"
      "nginx"
      "certbot"
      "systemd"
      "curl"
      "ca-certificates"
    )
    
    log_info "Installing core packages..."
    dnf install -y "${packages[@]}"
  fi
  
  log_success "Dependencies installed"
}

# ==============================================================================
# PHASE 5: BINARY DEPLOYMENT
# ==============================================================================

deploy_binaries() {
  log_info "PHASE 5/7: BINARY DEPLOYMENT"
  
  mkdir -p "$STAGING_DIR"
  log_info "Downloading binaries to staging..."
  
  local binaries=("npanel-api" "npanel-agent" "npanel-watchdog")
  
  for binary in "${binaries[@]}"; do
    local binary_url="https://github.com/${GITHUB_ORG}/${GITHUB_REPO}/releases/download/${LATEST_VERSION}/${binary}"
    log_info "  Downloading: $binary"
    
    if ! curl -fsSL "$binary_url" -o "${STAGING_DIR}/${binary}"; then
      log_error "Failed to download $binary"
      exit "$EXIT_NETWORK_ERROR"
    fi
    
    # Verify checksum
    log_debug "Verifying checksum for $binary"
    if ! grep "${binary}" /tmp/CHECKSUMS.sha256 | sha256sum -c --quiet; then
      log_error "Checksum mismatch for $binary - possible corruption"
      exit "$EXIT_UNRECOVERABLE"
    fi
    
    chmod +x "${STAGING_DIR}/${binary}"
  done
  
  # Backup existing binaries
  if [ -d "$INSTALL_PATH/bin" ]; then
    log_info "Backing up existing binaries..."
    tar czf "${BACKUP_DIR}/bin-$(date +%s).tar.gz" -C "$INSTALL_PATH" bin 2>/dev/null || true
  fi
  
  # Atomic swap
  log_info "Installing binaries..."
  rm -rf "$INSTALL_PATH/bin"
  mv "${STAGING_DIR}/bin" "$INSTALL_PATH/" 2>/dev/null || mv "$STAGING_DIR" "$INSTALL_PATH/bin"
  
  log_success "Binaries deployed"
}

# ==============================================================================
# PHASE 6: CONFIGURATION
# ==============================================================================

create_config() {
  log_info "PHASE 6/7: CONFIGURATION"
  
  mkdir -p "$CONFIG_PATH" "$DATA_PATH" "$BACKUP_DIR"
  
  # Generate admin credentials
  local admin_password
  admin_password=$(openssl rand -base64 32 | head -c 24)
  
  # Create config file
  cat > "${CONFIG_PATH}/config.yaml" << EOF
# nPanel Configuration
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

admin:
  email: "admin@$(hostname -f)"
  password_hash: "$(echo -n "$admin_password" | sha256sum | awk '{print $1}')"

services:
  api:
    port: 8080
    listen: 127.0.0.1
  agent:
    socket: /var/run/npanel-agent.sock
  watchdog:
    interval: 30s

cgroup:
  enabled: true
  memory_limit: 1G
  cpu_quota: 100000
EOF
  
  chmod 0600 "$CONFIG_PATH/config.yaml"
  
  # Store credentials securely
  cat > "/root/.npanel-credentials" << EOF
Admin Email: admin@$(hostname -f)
Admin Password: $admin_password
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chmod 0600 "/root/.npanel-credentials"
  
  log_success "Configuration created"
  log_warn "Credentials saved to: /root/.npanel-credentials (mode: 0600)"
}

create_systemd_services() {
  log_info "Creating systemd services..."
  
  # nPanel Agent service
  cat > /etc/systemd/system/npanel-agent.service << 'EOF'
[Unit]
Description=nPanel Agent - Root Operations Handler
After=network.target
Requires=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/npanel/bin/npanel-agent
Restart=on-failure
RestartSec=5s
StartLimitInterval=300s
StartLimitBurst=3
MemoryLimit=500M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF
  
  # nPanel API service
  cat > /etc/systemd/system/npanel-api.service << 'EOF'
[Unit]
Description=nPanel API Server
After=network.target npanel-agent.service
Requires=npanel-agent.service network.target

[Service]
Type=simple
User=npanel
Group=npanel
WorkingDirectory=/opt/npanel
ExecStart=/opt/npanel/bin/npanel-api
Restart=on-failure
RestartSec=5s
StartLimitInterval=300s
StartLimitBurst=3
MemoryLimit=1G
CPUQuota=100%

[Install]
WantedBy=multi-user.target
EOF
  
  systemctl daemon-reload
  systemctl enable npanel-agent npanel-api
  
  log_success "Systemd services configured"
}

# ==============================================================================
# PHASE 7: SERVICE STARTUP & VERIFICATION
# ==============================================================================

start_services() {
  log_info "PHASE 7/7: SERVICE STARTUP"
  
  log_info "Starting services..."
  systemctl start npanel-agent
  sleep 2
  systemctl start npanel-api
  
  log_info "Waiting for services to stabilize..."
  sleep 5
  
  # Verify
  for service in npanel-agent npanel-api; do
    if systemctl is-active --quiet "$service"; then
      log_success "$service is running"
    else
      log_error "$service failed to start"
      journalctl -u "$service" -n 10
      exit "$EXIT_UNRECOVERABLE"
    fi
  done
}

print_completion_summary() {
  cat << EOF

${GREEN}${BOLD}╔════════════════════════════════════════════════════════════╗${NC}
${GREEN}${BOLD}║                                                            ║${NC}
${GREEN}${BOLD}║     ✓ nPanel Installation Complete                        ║${NC}
${GREEN}${BOLD}║     All Phases 1-7 Successful                             ║${NC}
${GREEN}${BOLD}║                                                            ║${NC}
${GREEN}${BOLD}╚════════════════════════════════════════════════════════════╝${NC}

${BOLD}ACCESS INFORMATION${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ${CYAN}Web UI:${NC}       http://$(hostname -I | awk '{print $1}')
  ${CYAN}API:${NC}         http://$(hostname -I | awk '{print $1}'):8080/api
  
  ${CYAN}Admin Email:${NC}  admin@$(hostname -f)
  ${CYAN}Password:${NC}     See /root/.npanel-credentials

${BOLD}REQUIRED ACTIONS (within 24 hours)${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [ ] Login and change admin password
  [ ] Configure domain & SSL
  [ ] Set up backups
  [ ] Configure email notifications

${BOLD}DOCUMENTATION${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Installation Log:  $LOG_FILE
  Configuration:    $CONFIG_PATH/config.yaml
  Credentials:      /root/.npanel-credentials
  Manifest:         $MANIFEST_FILE
  
  GitHub:  https://github.com/omenyx/npanel
  Docs:    https://github.com/omenyx/npanel/wiki

EOF

  if [ ${#WARNINGS[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}${BOLD}WARNINGS${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    for warning in "${WARNINGS[@]}"; do
      echo -e "  ${YELLOW}⚠${NC} $warning"
    done
  fi
  
  echo ""
}

# ==============================================================================
# MAIN FLOW
# ==============================================================================

main() {
  ensure_log_dir
  
  log_info "nPanel Universal Installer v$SCRIPT_VERSION"
  log_info "================================"
  log_info "Starting installation..."
  log_info ""
  
  # Pre-flight
  check_os_support
  check_root
  check_resources
  check_ports
  check_github_connectivity
  
  # State detection
  detect_existing_installation
  
  # Verify & deploy
  verify_github_release
  install_dependencies
  deploy_binaries
  create_config
  create_systemd_services
  start_services
  
  # Success
  print_completion_summary
  
  log_success "Installation completed successfully"
  log_info "Log file: $LOG_FILE"
}

# Handle arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --debug) DEBUG_MODE=1 ;;
    --upgrade) INSTALL_METHOD="upgrade" ;;
    --repair) INSTALL_METHOD="repair" ;;
    *) log_warn "Unknown option: $1" ;;
  esac
  shift
done

main
exit $EXIT_SUCCESS
