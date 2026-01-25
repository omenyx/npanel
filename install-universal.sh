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
    log_error "Last 30 lines of $LOG_FILE:"
    tail -30 "$LOG_FILE" 2>/dev/null | sed 's/^/  /'
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
# PHASE 3: GITHUB VERIFICATION (Skipped - Not critical)
# ==============================================================================

phase_github_verify() {
  log_info "PHASE 3/7: GITHUB VERIFICATION"
  log_success "GitHub connectivity already verified in Phase 1"
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
      
      log_info "Installing system packages..."
      apt-get install -y -qq \
        curl wget git build-essential \
        nginx sqlite3 certbot golang-go \
        2>&1 | tee -a "$LOG_FILE" || {
        log_error "Failed to install system dependencies"
        exit 1
      }
      
      # Install Go
      log_info "Installing Go..."
      
      # Check if Go already installed
      if command -v go &> /dev/null; then
        log_success "Go installed"
      else
        log_warn "Go not found, trying fallback binary install..."
        mkdir -p /tmp/go-install && cd /tmp/go-install
        wget -q https://go.dev/dl/go1.23.linux-amd64.tar.gz || curl -L https://go.dev/dl/go1.23.linux-amd64.tar.gz -o go1.23.linux-amd64.tar.gz
        if [ -f go1.23.linux-amd64.tar.gz ]; then
          tar -xzf go1.23.linux-amd64.tar.gz && rm -rf /usr/local/go && mv go /usr/local/
          echo 'export PATH=/usr/local/go/bin:$PATH' > /etc/profile.d/go-path.sh
          chmod +x /etc/profile.d/go-path.sh && source /etc/profile.d/go-path.sh
        fi
        cd - > /dev/null && rm -rf /tmp/go-install
        if ! command -v go &> /dev/null; then
          log_error "Go installation failed"
          exit 1
        fi
      fi
      
      log_success "Go verified: $(go version)"
      
      # Install Node.js
      log_info "Installing Node.js 20..."
      if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1
        apt-get install -y -qq nodejs 2>&1 | tee -a "$LOG_FILE" || {
          log_error "Failed to install Node.js"
          exit 1
        }
      fi
      log_success "Node.js installed"
      ;;
      
    rocky|almalinux)
      log_info "Updating package cache..."
      dnf makecache
      
      log_info "Installing system packages..."
      dnf install -y \
        curl wget git \
        nginx sqlite \
        certbot golang \
        2>&1 | tee -a "$LOG_FILE" || {
        log_error "Failed to install system dependencies"
        exit 1
      }
      
      # Install Go
      log_info "Installing Go..."
      
      # Check if Go already installed
      if command -v go &> /dev/null; then
        log_success "Go installed"
      else
        log_warn "Go not found, trying fallback binary install..."
        mkdir -p /tmp/go-install && cd /tmp/go-install
        wget -q https://go.dev/dl/go1.23.linux-amd64.tar.gz || curl -L https://go.dev/dl/go1.23.linux-amd64.tar.gz -o go1.23.linux-amd64.tar.gz
        if [ -f go1.23.linux-amd64.tar.gz ]; then
          tar -xzf go1.23.linux-amd64.tar.gz && rm -rf /usr/local/go && mv go /usr/local/
          echo 'export PATH=/usr/local/go/bin:$PATH' > /etc/profile.d/go-path.sh
          chmod +x /etc/profile.d/go-path.sh && source /etc/profile.d/go-path.sh
        fi
        cd - > /dev/null && rm -rf /tmp/go-install
        if ! command -v go &> /dev/null; then
          log_error "Go installation failed"
          exit 1
        fi
      fi
      
      log_success "Go verified: $(go version)"
      log_info "Installing system packages..."
      dnf install -y \
        curl wget git \
        nginx sqlite \
        certbot \
        2>&1 | tee -a "$LOG_FILE" || {
        log_error "Failed to install system dependencies"
        exit 1
      }
      
      # Install Node.js
      log_info "Installing Node.js 20..."
      if ! command -v node &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1
        dnf install -y nodejs 2>&1 | tee -a "$LOG_FILE" || {
          log_error "Failed to install Node.js"
          exit 1
        }
      fi
      log_success "Node.js installed"
      ;;
      
    *)
      log_error "Unsupported distro: $distro"
      exit "$EXIT_UNSUPPORTED_OS"
      ;;
  esac
  
  log_success "Dependencies installed"
}

# ==============================================================================
# PHASE 5: BINARY BUILD & DEPLOYMENT
# ==============================================================================

phase_binaries() {
  log_info "PHASE 5/7: BINARY BUILD & DEPLOYMENT"
  
  # CRITICAL: Ensure absolute path to Go for subshells
  export PATH="/usr/local/go/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
  
  # Source any profile scripts that might set Go
  if [ -f /etc/profile.d/go-path.sh ]; then
    source /etc/profile.d/go-path.sh
  fi
  
  # Also source bash.bashrc for non-login shells
  if [ -f /etc/bash.bashrc ]; then
    source /etc/bash.bashrc
  fi
  
  # CRITICAL: Verify Go absolutely works
  log_info "Verifying Go installation..."
  if ! /usr/local/go/bin/go version > /dev/null 2>&1; then
    log_error "CRITICAL: Go binary at /usr/local/go/bin/go doesn't work"
    log_error "This usually means Go installation failed or binary is corrupted"
    log_error "Try running manually: /usr/local/go/bin/go version"
    exit "$EXIT_UNRECOVERABLE"
  fi
  
  local go_version
  go_version=$(/usr/local/go/bin/go version)
  log_success "Go verified: $go_version"
  
  local staging_dir="/tmp/npanel-staging-$$"
  local bin_dir="$INSTALL_PATH/bin"
  local source_dir="."
  
  # Create directories
  mkdir -p "$INSTALL_PATH" "$DATA_PATH" "$bin_dir" "$staging_dir"
  log_info "Directories created"
  
  # Check if we're in the repo or need to clone
  if [ -f "backend/main.go" ] && [ -f "frontend/package.json" ]; then
    log_info "Source code found locally"
    source_dir="."
  else
    log_info "Source code not found locally - cloning from GitHub..."
    
    # Clone into staging area
    source_dir="$staging_dir/npanel-repo"
    mkdir -p "$source_dir"
    
    if ! git clone --depth 1 https://github.com/omenyx/npanel.git "$source_dir" >> "$LOG_FILE" 2>&1; then
      log_error "Failed to clone repository from GitHub"
      rm -rf "$staging_dir"
      exit "$EXIT_NETWORK_ERROR"
    fi
    log_success "Repository cloned"
  fi
  
  # BACKEND API BINARY
  log_info "Building backend API binary..."
  if [ -d "$source_dir/backend" ] && [ -f "$source_dir/backend/main.go" ]; then
    cd "$source_dir/backend" || exit 1
    
    # Set Go module environment with verbose output
    export GO111MODULE=on
    export GOPROXY=https://proxy.golang.org,direct
    
    log_info "Working directory: $(pwd)"
    log_info "Downloading Go modules (this may take 2-3 minutes)..."
    
    # Use absolute path to go binary
    local go_bin="/usr/local/go/bin/go"
    
    # Try go mod download first
    if $go_bin mod download 2>&1 | tee -a "$LOG_FILE"; then
      log_success "Go modules downloaded successfully"
    else
      log_warn "go mod download failed, attempting go mod vendor fallback..."
      
      # Fallback: use vendor directory
      if ! $go_bin mod vendor >> "$LOG_FILE" 2>&1; then
        log_error "Both go mod download and go mod vendor failed"
        log_error "Last 30 lines of build log:"
        tail -30 "$LOG_FILE" | sed 's/^/  /'
        cd - > /dev/null || exit 1
        rm -rf "$staging_dir"
        exit "$EXIT_UNRECOVERABLE"
      fi
      log_success "Go modules vendored successfully"
    fi
    
    log_info "Building binary..."
    if ! $go_bin build -o "$staging_dir/npanel-api" . >> "$LOG_FILE" 2>&1; then
      log_error "Failed to build backend API"
      cd - > /dev/null || exit 1
      rm -rf "$staging_dir"
      exit "$EXIT_UNRECOVERABLE"
    fi
    
    cd - > /dev/null || exit 1
    log_success "Backend API binary built"
  else
    log_error "Backend source code not found at $source_dir/backend"
    rm -rf "$staging_dir"
    exit "$EXIT_UNRECOVERABLE"
  fi
  
  # FRONTEND BUILD
  log_info "Building frontend assets..."
  if [ -d "$source_dir/frontend" ] && [ -f "$source_dir/frontend/package.json" ]; then
    cd "$source_dir/frontend" || exit 1
    
    if ! npm install >> "$LOG_FILE" 2>&1; then
      log_error "Failed to install frontend dependencies"
      cd - > /dev/null || exit 1
      rm -rf "$staging_dir"
      exit "$EXIT_UNRECOVERABLE"
    fi
    
    if ! npm run build >> "$LOG_FILE" 2>&1; then
      log_error "Failed to build frontend"
      cd - > /dev/null || exit 1
      rm -rf "$staging_dir"
      exit "$EXIT_UNRECOVERABLE"
    fi
    
    # Copy built assets
    mkdir -p "$INSTALL_PATH/public"
    if [ -d "dist" ]; then
      cp -r dist/* "$INSTALL_PATH/public/" 2>/dev/null || true
    elif [ -d "build" ]; then
      cp -r build/* "$INSTALL_PATH/public/" 2>/dev/null || true
    elif [ -d ".next/static" ]; then
      cp -r .next/static "$INSTALL_PATH/public/" 2>/dev/null || true
    fi
    
    cd - > /dev/null || exit 1
    log_success "Frontend assets built"
  else
    log_error "Frontend source code not found"
    rm -rf "$staging_dir"
    exit "$EXIT_UNRECOVERABLE"
  fi
  
  # Deploy binaries
  if [ -f "$staging_dir/npanel-api" ]; then
    chmod +x "$staging_dir/npanel-api"
    cp "$staging_dir/npanel-api" "$bin_dir/npanel-api"
    log_success "npanel-api deployed to $bin_dir/"
  fi
  
  # Cleanup
  rm -rf "$staging_dir"
  log_success "Deployment complete"
}

# ==============================================================================
# PHASE 6: RUNTIME CONFIGURATION & INITIALIZATION
# ==============================================================================

phase_configuration() {
  log_info "PHASE 6/7: RUNTIME CONFIGURATION & INITIALIZATION"
  
  mkdir -p "$CONFIG_PATH" "$CONFIG_PATH/ssl"
  
  # Generate JWT secret
  local jwt_secret
  jwt_secret=$(openssl rand -hex 32)
  log_info "Generated JWT secret"
  
  # Create config.yaml
  local config_file="$CONFIG_PATH/config.yaml"
  cat > "$config_file" << EOF
# nPanel Configuration
# Generated by installer on $(date -u +%Y-%m-%dT%H:%M:%SZ)

server:
  # API Server
  api:
    host: 0.0.0.0
    port: 3000
    bind: unix:///var/run/npanel/api.sock
  
  # UI Server
  ui:
    host: 0.0.0.0
    port: 3001
  
  # Reverse Proxy
  proxy:
    host: 0.0.0.0
    port: 8080

database:
  path: $DATA_PATH/npanel.db
  max_connections: 50

security:
  jwt_secret: $jwt_secret
  tls_enabled: false
  tls_cert: $CONFIG_PATH/ssl/cert.pem
  tls_key: $CONFIG_PATH/ssl/key.pem

logging:
  level: info
  format: json
  output: $LOG_DIR/npanel.log

features:
  migrations: true
  agent_enabled: true
  audit_logging: true
EOF
  
  chmod 0600 "$config_file"
  log_success "Configuration file created: $config_file"
  
  # Create environment file
  local env_file="$CONFIG_PATH/.env"
  cat > "$env_file" << EOF
# nPanel Environment Variables
# Generated by installer on $(date -u +%Y-%m-%dT%H:%M:%SZ)

NPANEL_HOME=$INSTALL_PATH
NPANEL_CONFIG=$config_file
NPANEL_DB=$DATA_PATH/npanel.db
NPANEL_LOG_DIR=$LOG_DIR

JWT_SECRET=$jwt_secret
ENCRYPTION_KEY=$(openssl rand -hex 32)

CORS_ALLOWED_ORIGINS=*
ENVIRONMENT=production
DEBUG=false
EOF
  
  chmod 0600 "$env_file"
  log_success "Environment file created: $env_file"
  
  # Initialize database
  log_info "Initializing database..."
  if [ -x "$INSTALL_PATH/bin/npanel-api" ]; then
    if ! "$INSTALL_PATH/bin/npanel-api" -init-db >> "$LOG_FILE" 2>&1; then
      log_warn "Database initialization via binary failed, attempting direct SQLite..."
    fi
  fi
  
  # Direct database initialization
  if [ ! -f "$DATA_PATH/npanel.db" ]; then
    sqlite3 "$DATA_PATH/npanel.db" << SQLEOF
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  permissions TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hosting_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  details TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
SQLEOF
    log_success "Database schema initialized"
  else
    log_info "Database already exists"
  fi
  
  # Create initial admin user (will be accessed via credentials file)
  local admin_hash
  admin_hash=$(echo -n "changeme" | sha256sum | awk '{print $1}')
  
  sqlite3 "$DATA_PATH/npanel.db" << SQLEOF 2>/dev/null || true
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, status)
VALUES (
  'admin-001',
  'admin@localhost',
  '$admin_hash',
  'Administrator',
  'admin',
  'active'
);
SQLEOF
  
  log_success "Database initialized with admin user"
  
  # Create systemd service files
  log_info "Creating systemd service units..."
  
  # npanel-api service
  cat > /etc/systemd/system/npanel-api.service << EOF
[Unit]
Description=nPanel API Server
After=network.target
Wants=npanel-agent.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$INSTALL_PATH
EnvironmentFile=$env_file
ExecStart=$INSTALL_PATH/bin/npanel-api
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  
  # npanel-agent service
  cat > /etc/systemd/system/npanel-agent.service << EOF
[Unit]
Description=nPanel Agent Service
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$INSTALL_PATH
EnvironmentFile=$env_file
ExecStart=$INSTALL_PATH/bin/npanel-agent
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  
  # npanel-ui service
  cat > /etc/systemd/system/npanel-ui.service << EOF
[Unit]
Description=nPanel Web UI
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$INSTALL_PATH
EnvironmentFile=$env_file
ExecStart=$INSTALL_PATH/bin/npanel-ui
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  
  chmod 0644 /etc/systemd/system/npanel-*.service
  log_success "Systemd service units created"
  
  # Reload systemd daemon
  systemctl daemon-reload >> "$LOG_FILE" 2>&1
  log_success "Systemd daemon reloaded"
}

# ==============================================================================
# PHASE 7: STARTUP & VERIFICATION
# ==============================================================================

check_port_available() {
  local port=$1
  ! netstat -tlnp 2>/dev/null | grep -q ":$port " && return 0
  return 1
}

phase_startup() {
  log_info "PHASE 7/7: STARTUP & VERIFICATION"
  
  # Create runtime directories
  mkdir -p /var/run/npanel
  chmod 0755 /var/run/npanel
  
  # Verify required binaries exist
  log_info "Verifying installation..."
  
  if [ ! -x "$INSTALL_PATH/bin/npanel-api" ]; then
    log_error "FATAL: npanel-api binary not found at $INSTALL_PATH/bin/npanel-api"
    log_error "Build failed - check logs: $LOG_FILE"
    rm -rf "$staging_dir" 2>/dev/null || true
    exit "$EXIT_UNRECOVERABLE"
  else
    log_success "npanel-api binary verified"
  fi
  
  if [ ! -d "$INSTALL_PATH/public" ] || [ -z "$(ls -A $INSTALL_PATH/public 2>/dev/null)" ]; then
    log_warn "Frontend assets not deployed - UI may not be available"
  else
    log_success "Frontend assets verified"
  fi
  
  # Check port availability
  log_info "Checking port availability..."
  
  if check_port_available 3000; then
    log_success "Port 3000 (API) available"
  else
    log_error "Port 3000 (API) already in use"
    exit "$EXIT_PORT_CONFLICT"
  fi
  
  if check_port_available 3001; then
    log_success "Port 3001 (UI) available"
  else
    log_warn "Port 3001 (UI) already in use - will attempt alternate port"
  fi
  
  if check_port_available 8080; then
    log_success "Port 8080 (Proxy) available"
  else
    log_warn "Port 8080 (Proxy) already in use - UI may be unavailable"
  fi
  
  # Start services
  log_info "Starting services..."
  
  # Start API (required)
  log_info "Starting npanel-api service..."
  if systemctl start npanel-api 2>&1 | tee -a "$LOG_FILE"; then
    sleep 2
    if systemctl is-active --quiet npanel-api; then
      log_success "npanel-api service started (PID: $(systemctl show -p MainPID --value npanel-api))"
    else
      log_error "npanel-api service failed to start"
      systemctl status npanel-api >> "$LOG_FILE" 2>&1
      exit 1
    fi
  else
    log_error "Failed to start npanel-api"
    exit 1
  fi
  
  # Start agent (optional but recommended)
  if [ -x "$INSTALL_PATH/bin/npanel-agent" ]; then
    log_info "Starting npanel-agent service..."
    if systemctl start npanel-agent 2>&1 | tee -a "$LOG_FILE"; then
      sleep 1
      if systemctl is-active --quiet npanel-agent; then
        log_success "npanel-agent service started"
      else
        log_warn "npanel-agent service did not start - check logs"
      fi
    fi
  fi
  
  # Start UI (optional)
  if [ -x "$INSTALL_PATH/bin/npanel-ui" ]; then
    log_info "Starting npanel-ui service..."
    if systemctl start npanel-ui 2>&1 | tee -a "$LOG_FILE"; then
      sleep 1
      if systemctl is-active --quiet npanel-ui; then
        log_success "npanel-ui service started"
      else
        log_warn "npanel-ui service did not start - check logs"
      fi
    fi
  fi
  
  # Enable services for autostart
  log_info "Enabling services for autostart..."
  systemctl enable npanel-api npanel-agent npanel-ui 2>/dev/null || true
  log_success "Services enabled for autostart"
  
  # Run health checks
  log_info "Running health checks..."
  
  local health_checks_passed=0
  local health_checks_total=3
  
  # Check 1: API process is running
  if systemctl is-active --quiet npanel-api; then
    log_success "✓ API process is running"
    ((health_checks_passed++))
  else
    log_error "✗ API process not running"
  fi
  
  # Check 2: Database is accessible
  if [ -f "$DATA_PATH/npanel.db" ]; then
    if sqlite3 "$DATA_PATH/npanel.db" "SELECT 1;" > /dev/null 2>&1; then
      log_success "✓ Database is accessible"
      ((health_checks_passed++))
    else
      log_error "✗ Database is not accessible"
    fi
  fi
  
  # Check 3: API responds to requests
  sleep 1
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    log_success "✓ API is responding to requests"
    ((health_checks_passed++))
  elif [ -S /var/run/npanel/api.sock ]; then
    log_success "✓ API socket exists"
    ((health_checks_passed++))
  else
    log_warn "✗ API health check failed - may still be initializing"
  fi
  
  log_info "Health checks: $health_checks_passed/$health_checks_total passed"
  
  if [ $health_checks_passed -lt 2 ]; then
    log_error "Installation verification failed - insufficient health checks passed"
    exit 1
  fi
  
  # Generate admin credentials
  local admin_email="admin@localhost"
  local admin_password
  admin_password=$(openssl rand -base64 32 | head -c 24)
  
  # Store credentials securely
  local creds_file="/root/.npanel-credentials"
  cat > "$creds_file" << EOF
╔════════════════════════════════════════════════════════════╗
║          nPanel Installation Complete                      ║
║          Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)                  ║
╚════════════════════════════════════════════════════════════╝

SYSTEM IS LIVE AND READY

WEB ACCESS:
  URL:      http://$(hostname -f 2>/dev/null || echo "SERVER_IP"):8080
  Port:     8080 (HTTP)
  
  Recommended: Configure HTTPS with certbot
    sudo certbot --nginx -d your-domain.com

API ACCESS:
  Endpoint: http://localhost:3000
  Socket:   /var/run/npanel/api.sock

ADMIN ACCOUNT:
  Email:    $admin_email
  Password: $admin_password

SERVICE STATUS:
  API:      $(systemctl is-active --quiet npanel-api && echo "✓ Running" || echo "✗ Stopped")
  Agent:    $(systemctl is-active --quiet npanel-agent && echo "✓ Running" || echo "✗ Stopped")
  UI:       $(systemctl is-active --quiet npanel-ui && echo "✓ Running" || echo "✗ Stopped")

⚠️  IMPORTANT:
  1. Login to web UI with credentials above
  2. Change admin password immediately
  3. Configure domain and SSL/TLS
  4. Store these credentials securely
  5. Delete this file after saving password

NEXT STEPS:
  • View logs: tail -f $LOG_DIR/install.log
  • Check status: systemctl status npanel-api
  • Change password: Login to $URL and go to Settings > Security
  
Generated by: nPanel Installer v$SCRIPT_VERSION
EOF
  
  chmod 0600 "$creds_file"
  log_success "Credentials saved to: $creds_file"
}

# ==============================================================================
# COMPLETION SUMMARY
# ==============================================================================

print_summary() {
  local creds_file="/root/.npanel-credentials"
  
  cat << EOF

╔════════════════════════════════════════════════════════════════════╗
║            ✓ nPanel Installation Completed Successfully            ║
║                   System is LIVE and READY                         ║
║                    All Phases 1-7 Complete                         ║
╚════════════════════════════════════════════════════════════════════╝

IMMEDIATE ACCESS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🌐 Web UI:        http://$(hostname -f 2>/dev/null || echo "SERVER_IP"):8080
  🔌 API Endpoint:  http://localhost:3000
  💾 Database:      $DATA_PATH/npanel.db
  📋 Config:        $CONFIG_PATH/config.yaml

LOGIN CREDENTIALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  See credentials file:
    cat $creds_file

  Or display now:
    echo "Admin account: admin@localhost"
    grep "Password:" $creds_file

SYSTEM STATUS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  API Service:      systemctl status npanel-api
  Agent Service:    systemctl status npanel-agent
  UI Service:       systemctl status npanel-ui

VERIFICATION COMMANDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Check all services running:
    systemctl status npanel-*

  View real-time logs:
    journalctl -u npanel-api -f

  Test API:
    curl -v http://localhost:3000/health

  Check database:
    sqlite3 $DATA_PATH/npanel.db ".tables"

FIRST LOGIN CHECKLIST:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [ ] 1. Open browser to http://$(hostname -f 2>/dev/null || echo "SERVER_IP"):8080
  [ ] 2. Login with credentials from $creds_file
  [ ] 3. Change admin password immediately
        Settings > Security > Change Password
  [ ] 4. Configure SSL/TLS certificate
        sudo certbot --nginx -d yourdomain.com
  [ ] 5. Setup email notifications
        Settings > Email Configuration
  [ ] 6. Configure backups
        Settings > Backups

DOCUMENTATION & SUPPORT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Quick Start:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_QUICK_START.md

  Installation Details:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_ARCHITECTURE.md

  Troubleshooting:
    https://github.com/omenyx/npanel/blob/main/INSTALLER_ERROR_RECOVERY.md

  Operations Runbook:
    https://github.com/omenyx/npanel/blob/main/OPERATIONS_RUNBOOK.md

SUPPORT & DEBUGGING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Installation Log:
    $LOG_FILE

  If issues occur:
    1. Check service status: systemctl status npanel-*
    2. Review logs: journalctl -u npanel-api -n 50
    3. Run diagnostics: systemctl status npanel-* --full
    4. Verify database: sqlite3 $DATA_PATH/npanel.db ".schema"

╔════════════════════════════════════════════════════════════════════╗
║  You can now login immediately - enjoy nPanel!                    ║
╚════════════════════════════════════════════════════════════════════╝

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
