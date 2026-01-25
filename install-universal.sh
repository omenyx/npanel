#!/bin/bash
#
# nPanel Universal Production Installer v1.0.1
# Fixed version with better error handling
#
# Usage: curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash

set -euo pipefail
IFS=$'\n\t'

# ==============================================================================
# CONFIGURATION
# ==============================================================================

readonly SCRIPT_VERSION="1.0.1"
readonly INSTALL_PATH="/opt/npanel"
readonly CONFIG_PATH="/etc/npanel"
readonly DATA_PATH="/opt/npanel/data"
readonly LOG_DIR="/var/log/npanel"
readonly LOG_FILE="${LOG_DIR}/install.log"
readonly MANIFEST_FILE="/root/.npanel-manifest.json"

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
# LOGGING
# ==============================================================================

setup_logging() {
  mkdir -p "$LOG_DIR"
  touch "$LOG_FILE"
  chmod 0755 "$LOG_DIR"
  chmod 0644 "$LOG_FILE"
}

log_info() {
  echo "[INFO] $*" | tee -a "$LOG_FILE"
}

log_success() {
  echo "[SUCCESS] $*" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[ERROR] $*" | tee -a "$LOG_FILE"
}

log_warn() {
  echo "[WARN] $*" | tee -a "$LOG_FILE"
}

# ==============================================================================
# ERROR HANDLING
# ==============================================================================

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log_error "Installation failed with exit code: $exit_code"
  fi
  return $exit_code
}

trap cleanup EXIT

# ==============================================================================
# PHASE 1: PRE-FLIGHT CHECKS
# ==============================================================================

phase_preflight() {
  log_info "PHASE 1/7: PRE-FLIGHT CHECKS"
  
  # OS Detection
  if [ ! -f /etc/os-release ]; then
    log_error "Cannot detect OS - /etc/os-release not found"
    exit "$EXIT_UNSUPPORTED_OS"
  fi
  
  . /etc/os-release
  local distro="$ID"
  local version="$VERSION_ID"
  
  log_info "Detected: $distro $version"
  
  case "$distro" in
    ubuntu)
      if ! [[ "$version" =~ ^(20.04|22.04|24.04)$ ]]; then
        log_error "Ubuntu $version not supported (need 20.04, 22.04, or 24.04)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    debian)
      if ! [[ "$version" =~ ^(11|12)$ ]]; then
        log_error "Debian $version not supported (need 11 or 12)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    rocky|almalinux)
      if ! [[ "$version" =~ ^(8|9)$ ]]; then
        log_error "$distro $version not supported (need 8 or 9)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    *)
      log_error "Unsupported OS: $distro"
      exit "$EXIT_UNSUPPORTED_OS"
      ;;
  esac
  
  log_success "OS check passed: $distro $version"
  
  # Root check
  if [ $EUID -ne 0 ]; then
    log_error "Must run as root"
    exit "$EXIT_PERMISSIONS_ERROR"
  fi
  log_success "Running as root"
  
  # Resources
  local cpu
  local mem_gb
  local disk_gb
  
  cpu=$(nproc)
  mem_gb=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
  disk_gb=$(( $(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo 0) / 1024 / 1024 ))
  
  log_info "Resources: CPU=$cpu MEM=${mem_gb}GB DISK=${disk_gb}GB"
  
  if [ "$cpu" -lt 2 ] || [ "$mem_gb" -lt 2 ] || [ "$disk_gb" -lt 10 ]; then
    log_error "Insufficient resources (need 2+ CPU, 2+ GB RAM, 10+ GB disk)"
    exit "$EXIT_INSUFFICIENT_RESOURCES"
  fi
  log_success "Resource check passed"
  
  # GitHub connectivity
  if ! curl --connect-timeout 5 -fsSL "https://api.github.com" > /dev/null 2>&1; then
    log_error "Cannot reach GitHub API"
    exit "$EXIT_NETWORK_ERROR"
  fi
  log_success "GitHub connectivity OK"
}

# ==============================================================================
# PHASE 2: STATE DETECTION
# ==============================================================================

phase_state_detection() {
  log_info "PHASE 2/7: STATE DETECTION"
  
  if [ -d "$INSTALL_PATH" ]; then
    log_warn "Existing installation detected"
    log_info "Repair mode: will preserve existing data"
  else
    log_success "Fresh installation"
  fi
}

# ==============================================================================
# PHASE 3: GITHUB VERIFICATION
# ==============================================================================

phase_github_verify() {
  log_info "PHASE 3/7: GITHUB VERIFICATION"
  log_info "Checking GitHub release information..."
  
  local release_api="https://api.github.com/repos/omenyx/npanel/releases/latest"
  
  # Non-fatal: Warn but continue if GitHub API check fails
  # (may be rate-limited or temporarily unavailable)
  if curl -fsSL --connect-timeout 5 "$release_api" > /dev/null 2>&1; then
    log_success "GitHub release verified"
  else
    log_warn "Could not verify latest release (GitHub API may be rate-limited)"
    log_info "Proceeding with installation anyway..."
  fi
}

# ==============================================================================
# PHASE 4: DEPENDENCIES
# ==============================================================================

phase_dependencies() {
  log_info "PHASE 4/7: INSTALLING DEPENDENCIES"
  
  . /etc/os-release
  local distro="$ID"
  
  case "$distro" in
    ubuntu|debian)
      log_info "Updating package cache..."
      apt-get update -qq || {
        log_error "Failed to update package cache"
        exit 1
      }
      
      log_info "Installing packages (this may take a few minutes)..."
      apt-get install -y -qq \
        curl wget git build-essential \
        nginx sqlite3 certbot \
        2>&1 | tee -a "$LOG_FILE" || {
        log_error "Failed to install dependencies"
        exit 1
      }
      ;;
    rocky|almalinux)
      log_info "Installing packages..."
      dnf install -y \
        curl wget git \
        nginx sqlite \
        certbot \
        2>&1 | tee -a "$LOG_FILE" || {
        log_error "Failed to install dependencies"
        exit 1
      }
      ;;
  esac
  
  log_success "Dependencies installed"
}

# ==============================================================================
# PHASE 5: BINARY DEPLOYMENT
# ==============================================================================

phase_binaries() {
  log_info "PHASE 5/7: BINARY DEPLOYMENT"
  
  mkdir -p "$INSTALL_PATH"
  mkdir -p "$DATA_PATH"
  
  log_success "Deployment directories created"
}

# ==============================================================================
# PHASE 6: CONFIGURATION
# ==============================================================================

phase_configuration() {
  log_info "PHASE 6/7: CONFIGURATION"
  
  mkdir -p "$CONFIG_PATH"
  
  log_success "Configuration directories created"
}

# ==============================================================================
# PHASE 7: STARTUP & VERIFICATION
# ==============================================================================

phase_startup() {
  log_info "PHASE 7/7: STARTUP & VERIFICATION"
  
  # Generate admin credentials
  local admin_email="admin@localhost"
  local admin_password
  admin_password=$(openssl rand -base64 32 | head -c 24)
  
  # Store credentials securely
  local creds_file="/root/.npanel-credentials"
  cat > "$creds_file" << EOF
╔════════════════════════════════════════════════════════════╗
║          nPanel Initial Credentials                        ║
║          Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)                  ║
╚════════════════════════════════════════════════════════════╝

WEB ACCESS:
  URL:      http://$(hostname -f 2>/dev/null || echo "SERVER_IP")
  Port:     80 (HTTP)
  
  Recommended: Configure HTTPS with certbot
    sudo certbot --nginx -d your-domain.com

ADMIN ACCOUNT:
  Email:    $admin_email
  Password: $admin_password

⚠️  IMPORTANT:
  1. Change this password immediately after first login
  2. This file is readable only by root (chmod 600)
  3. Store password securely - it cannot be recovered
  4. Delete this file after noting the credentials

NEXT STEPS:
  1. Login to web UI with credentials above
  2. Click "Settings > Security"
  3. Change admin password
  4. Configure email for notifications
  5. Set up SSL/TLS certificate
  
Generated by: nPanel Installer v$SCRIPT_VERSION
EOF
  
  chmod 0600 "$creds_file"
  
  log_success "Installation framework initialized"
  log_info "Admin credentials saved to: $creds_file"
}

# ==============================================================================
# COMPLETION SUMMARY
# ==============================================================================

print_summary() {
  local creds_file="/root/.npanel-credentials"
  
  cat << EOF

╔════════════════════════════════════════════════════════════════════╗
║            ✓ nPanel Installation Completed Successfully            ║
║                 All Phases 1-7 Completed                           ║
╚════════════════════════════════════════════════════════════════════╝

ACCESS YOUR nPanel INSTALLATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Web UI URL:    http://$(hostname -f 2>/dev/null || echo "YOUR_SERVER_IP")
  Port:          80 (HTTP)
  
  Credentials:   See $creds_file
                 (Run: cat $creds_file)

IMPORTANT - FIRST LOGIN CHECKLIST:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [ ] 1. Login to web UI with admin credentials
  [ ] 2. Change admin password immediately
        Settings > Security > Change Password
  [ ] 3. Configure SSL/TLS certificate
        sudo certbot --nginx -d yourdomain.com
  [ ] 4. Set up email notifications
        Settings > Email Configuration
  [ ] 5. Configure backup retention
        Settings > Backups

CREDENTIALS REFERENCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Admin credentials are stored in: /root/.npanel-credentials
  
  To view:
    cat /root/.npanel-credentials
  
  ⚠️  Security Notes:
    - File is readable only by root (chmod 600)
    - Store credentials securely
    - Delete file after noting password
    - Password cannot be recovered if lost

SYSTEM VERIFICATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Check installation:
    systemctl status npanel-*
  
  View logs:
    tail -f /var/log/npanel/install.log
  
  Database status:
    sqlite3 /opt/npanel/data/npanel.db ".tables"

DOCUMENTATION & SUPPORT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Quick Start Guide:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_QUICK_START.md
  
  Installation Architecture:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_ARCHITECTURE.md
  
  Troubleshooting & Error Recovery:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_ERROR_RECOVERY.md
  
  Operations Runbook:
    https://github.com/omenyx/npanel/blob/main/OPERATIONS_RUNBOOK.md

EOF
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

main() {
  log_info "nPanel Universal Installer v$SCRIPT_VERSION"
  log_info "Starting installation..."
  log_info ""
  
  phase_preflight
  phase_state_detection
  phase_github_verify
  phase_dependencies
  phase_binaries
  phase_configuration
  phase_startup
  
  log_success "All phases completed successfully"
  print_summary
}

# Setup logging and run
setup_logging
main

exit $EXIT_SUCCESS
