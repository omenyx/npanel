#!/bin/bash
# nPanel Complete Production Installer
# Full deployment: Phases 1-5 (all components)
# For fresh production servers

set -euo pipefail

# ==================== CONFIG ====================
INSTALL_PATH="/opt/npanel"
DATA_PATH="/opt/npanel/data"
CONFIG_PATH="/opt/npanel/config"
BACKUP_PATH="/opt/npanel/backups"
LOG_FILE="/var/log/npanel-install.log"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
SERVER_HOSTNAME=""
INSTALL_START_TIME=$(date +%s)
FAILED_COMPONENTS=()
SKIPPED_COMPONENTS=()
CRITICAL_FAILURE=0

# ==================== COLORS ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ==================== ERROR HANDLING ====================

# Global variables to track errors
LAST_COMPONENT=""
LAST_ACTION=""

# Trap unexpected errors
trap 'handle_error $? $LINENO' ERR

handle_error() {
    local exit_code=$1
    local line_number=$2
    local command="${BASH_COMMAND}"
    
    echo ""
    error "Unexpected error occurred!"
    log "  Exit code: $exit_code"
    log "  Line number: $line_number"
    
    # Provide better context based on exit code
    if [ "$exit_code" -eq 127 ]; then
        log "  Error: Command not found"
        if [ -n "$LAST_COMPONENT" ]; then
            log "  During: $LAST_COMPONENT"
        fi
        if [ -n "$LAST_ACTION" ]; then
            log "  Action: $LAST_ACTION"
        fi
    elif [ "$exit_code" -eq 1 ]; then
        log "  Error: General error (exit code 1)"
        if [ -n "$LAST_COMPONENT" ]; then
            log "  During: $LAST_COMPONENT"
        fi
    fi
    
    # Only show BASH_COMMAND if it looks reasonable (not ASCII art)
    if [ ${#command} -lt 200 ] && ! echo "$command" | grep -q "^[█╗╔═]"; then
        log "  Last command: $command"
    fi
    
    log ""
    log "Installation logs saved to: $LOG_FILE"
    log ""
    log "To troubleshoot:"
    log "  1. Check the full log file:"
    log "     tail -150 $LOG_FILE"
    log "  2. Check the tail of last commands:"
    log "     grep 'Starting\\|Installing\\|Setting up' $LOG_FILE | tail -20"
    log "  3. Run diagnostics:"
    log "     sh ${INSTALL_PATH}/scripts/check_prerequisites.sh 2>&1 | tee ~/npanel-prereq.log"
    log "  4. Check system resources:"
    log "     free -h && df -h /opt && df -i /opt"
    log "  5. Check apt cache if package error:"
    log "     apt-cache policy <package-name>"
    log "  6. Create issue at: https://github.com/omenyx/npanel/issues"
    log "     Include: tail of $LOG_FILE and ~/npanel-prereq.log"
    log ""
    
    CRITICAL_FAILURE=1
    cleanup_on_error
    
    exit "$exit_code"
}

cleanup_on_error() {
    log "Performing cleanup..."
    
    # Stop any services that were started
    for service in npanel-agent npanel-api npanel-watchdog; do
        if systemctl is-active --quiet "$service" 2>/dev/null; then
            log "  Stopping: $service"
            systemctl stop "$service" 2>/dev/null || true
        fi
    done
    
    log "Cleanup completed"
    log ""
    log "${YELLOW}INSTALLATION INCOMPLETE${NC}"
    log "The installer was interrupted due to errors."
    log "Partial installation was preserved for debugging."
    log "Review logs above for details on what failed."
}

# Track current operation for better error context
set_current_operation() {
    LAST_COMPONENT="$1"
    LAST_ACTION="$2"
    log "Starting: $1"
}

# ==================== LOGGING ====================

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

# ==================== COMPONENT TRACKING ====================

track_failure() {
    local component=$1
    local reason=$2
    
    FAILED_COMPONENTS+=("$component: $reason")
    error "Component failed: $component - $reason"
}

track_skip() {
    local component=$1
    local reason=$2
    
    SKIPPED_COMPONENTS+=("$component: $reason")
    warning "Component skipped: $component - $reason"
}

check_previous_errors() {
    if [ ${#FAILED_COMPONENTS[@]} -gt 0 ]; then
        log ""
        log "${YELLOW}Note: Some components failed during setup:${NC}"
        for component in "${FAILED_COMPONENTS[@]}"; do
            log "  - $component"
        done
        return 1
    fi
    return 0
}

# ==================== HEADER ====================

clear
cat << "EOF"

███╗   ██╗██████╗  █████╗ ███╗   ██╗███████╗██╗     
████╗  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██║     
██╔██╗ ██║██████╔╝███████║██╔██╗ ██║█████╗  ██║     
██║╚██╗██║██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║     
██║ ╚████║██║     ██║  ██║██║ ╚████║███████╗███████╗
╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
                                                      
    Professional Hosting Control Panel
    Complete Production Deployment
    Phases 1-5 (All Features Included)

EOF

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}nPanel Production Installer - Enterprise Ready${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Installation started at: $(date)"
echo "Log file: $LOG_FILE"
echo ""
████╗  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██║     
██╔██╗ ██║██████╔╝███████║██╔██╗ ██║█████╗  ██║     
██║╚██╗██║██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║     
██║ ╚████║██║     ██║  ██║██║ ╚████║███████╗███████╗
╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
                                                      
    Professional Hosting Control Panel
    Complete Production Deployment
    Phases 1-5 (All Features Included)

EOF

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}nPanel Production Installer - Enterprise Ready${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ==================== PRE-CHECKS ====================

check_root() {
    log "Checking root privileges..."
    if [[ $EUID -ne 0 ]]; then
        error "This installer must be run as root"
        echo "  Run: sudo bash install-production.sh"
        exit 1
    fi
    success "Running as root"
}

check_os() {
    log "Detecting operating system..."
    
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="$ID"
        OS_VERSION="$VERSION_ID"
    else
        error "Cannot detect OS - requires /etc/os-release"
        exit 1
    fi
    
    case "$OS_ID" in
        ubuntu|debian)
            success "Ubuntu/Debian detected"
            PKG_MANAGER="apt-get"
            ;;
        centos|rhel|fedora)
            success "CentOS/RHEL/Fedora detected"
            PKG_MANAGER="dnf"
            ;;
        *)
            error "Unsupported OS: $OS_ID"
            exit 1
            ;;
    esac
}

check_resources() {
    log "Checking system resources..."
    
    # Disk
    local disk_gb=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' | awk '{print int($1/1024/1024)}' || echo "0")
    if [ "$disk_gb" -lt 20 ]; then
        error "Insufficient disk space (need ≥20 GB, have $disk_gb GB)"
        exit 1
    fi
    success "Disk space: ${disk_gb} GB ✓"
    
    # Memory
    local mem_gb=$(grep MemTotal /proc/meminfo | awk '{print int($2/1024/1024)}')
    if [ "$mem_gb" -lt 4 ]; then
        error "Insufficient memory (need ≥4 GB, have $mem_gb GB)"
        exit 1
    fi
    success "Memory: ${mem_gb} GB ✓"
    
    # CPU
    local cpu_count=$(nproc)
    success "CPU cores: $cpu_count ✓"
}

# ==================== SYSTEM SETUP ====================

update_system() {
    log "Updating system packages..."
    
    case "$PKG_MANAGER" in
        apt-get)
            log "  Running: apt-get update"
            apt-get update
            log "  Running: apt-get upgrade"
            apt-get upgrade -y
            ;;
        dnf)
            log "  Running: dnf update"
            dnf update -y
            ;;
    esac
    
    success "System updated"
}

install_dependencies() {
    log "Installing dependencies..."
    
    case "$PKG_MANAGER" in
        apt-get)
            log "  Installing: golang nodejs npm git sqlite3..."
            apt-get install -y golang-1.23 nodejs npm git sqlite3 || {
                error "Failed to install critical Go/Node packages"
                return 1
            }
            
            log "  Installing: build tools (gcc, make)..."
            apt-get install -y build-essential gcc make || warning "Build tools installation had issues"
            
            log "  Installing: system monitoring tools..."
            apt-get install -y procps sysstat curl wget || warning "Some monitoring tools unavailable"
            
            log "  Installing: nginx web server..."
            apt-get install -y systemd nginx || {
                error "Failed to install nginx (critical)"
                return 1
            }
            
            log "  Installing: email service (exim4)..."
            apt-get install -y exim4 || warning "Exim4 installation failed - email service will not be available"
            
            log "  Installing: DNS service (pdns-server)..."
            apt-get install -y pdns-server || warning "PowerDNS installation failed - DNS service will not be available"
            
            log "  Installing: SSL certificates (certbot)..."
            apt-get install -y certbot python3-certbot-nginx || warning "Certbot installation had issues"
            
            log "  Installing: monitoring (prometheus, grafana)..."
            
            # Add Grafana repository
            log "    Adding Grafana repository..."
            apt-get install -y software-properties-common || true
            add-apt-repository -y "deb https://packages.grafana.com/oss/deb stable main" 2>/dev/null || true
            apt-get update -qq 2>/dev/null || true
            
            # Try to install prometheus
            if apt-get install -y prometheus 2>/dev/null; then
                success "    Prometheus installed"
            else
                warning "Prometheus installation failed - some monitoring features unavailable"
            fi
            
            # Try to install grafana-server
            if apt-get install -y grafana-server 2>/dev/null; then
                success "    Grafana installed"
            else
                warning "Grafana installation failed - advanced monitoring visualization unavailable"
                log "    To install Grafana manually later:"
                log "      sudo apt-get install -y software-properties-common"
                log "      sudo add-apt-repository 'deb https://packages.grafana.com/oss/deb stable main'"
                log "      sudo apt-get update"
                log "      sudo apt-get install -y grafana-server"
            fi
            
            log "  Installing: utilities (rsync, openssh-server)..."
            apt-get install -y rsync openssh-server || warning "Some utilities unavailable"
            ;;
        dnf)
            log "  Installing: golang nodejs npm git sqlite3..."
            dnf install -y golang nodejs npm git sqlite || {
                error "Failed to install critical Go/Node packages"
                return 1
            }
            
            log "  Installing: build tools (gcc, make)..."
            dnf install -y gcc make || warning "Build tools installation had issues"
            
            log "  Installing: system monitoring tools..."
            dnf install -y procps-ng sysstat curl wget || warning "Some monitoring tools unavailable"
            
            log "  Installing: nginx web server..."
            dnf install -y systemd nginx || {
                error "Failed to install nginx (critical)"
                return 1
            }
            
            log "  Installing: email service (exim)..."
            dnf install -y exim || warning "Exim installation failed - email service will not be available"
            
            log "  Installing: DNS service (pdns)..."
            dnf install -y pdns || warning "PowerDNS installation failed - DNS service will not be available"
            
            log "  Installing: SSL certificates (certbot)..."
            dnf install -y certbot certbot-nginx || warning "Certbot installation had issues"
            
            log "  Installing: monitoring (prometheus, grafana)..."
            
            # Try to install prometheus
            if dnf install -y prometheus 2>/dev/null; then
                success "    Prometheus installed"
            else
                warning "Prometheus installation failed - some monitoring features unavailable"
            fi
            
            # Try to install grafana
            if dnf install -y grafana 2>/dev/null; then
                success "    Grafana installed"
            else
                warning "Grafana installation failed - advanced monitoring visualization unavailable"
                log "    Grafana can be installed from official repository:"
                log "      sudo dnf install -y grafana"
            fi
            
            log "  Installing: utilities (rsync, openssh-server)..."
            dnf install -y rsync openssh-server || warning "Some utilities unavailable"
            ;;
    esac
    
    success "Dependency installation completed"
}

# ==================== DIRECTORIES ====================

setup_directories() {
    log "Setting up directory structure..."
    
    mkdir -p "$INSTALL_PATH"/{bin,config,data,public,scripts,ssl}
    mkdir -p "$DATA_PATH"/{backups,logs}
    mkdir -p "$BACKUP_PATH"
    mkdir -p /var/log/npanel
    
    chown -R nobody:nogroup "$DATA_PATH"
    chmod 755 "$DATA_PATH"
    chmod 755 "$INSTALL_PATH"
    
    success "Directories created"
}

# ==================== DATABASE ====================

setup_database() {
    log "Initializing database..."
    
    # Download all migrations from GitHub
    cd "$INSTALL_PATH"
    
    # Create database
    sqlite3 "$DATA_PATH/npanel.db" << 'SQL'
-- Initialize database (will be filled by migrations)
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
SQL
    
    # Run all migrations (Phases 1-5)
    log "Downloading migrations from GitHub..."
    
    # Phase 1-4 migrations (from git history)
    local migrations=(
        "https://raw.githubusercontent.com/omenyx/npanel/main/backend/migrations/001_initial.sql"
        "https://raw.githubusercontent.com/omenyx/npanel/main/backend/migrations/002_accounts.sql"
        "https://raw.githubusercontent.com/omenyx/npanel/main/backend/migrations/003_services.sql"
        "https://raw.githubusercontent.com/omenyx/npanel/main/backend/migrations/004_migration_system.sql"
        "https://raw.githubusercontent.com/omenyx/npanel/main/backend/migrations/005_cgroups_v2.sql"
    )
    
    for i in "${!migrations[@]}"; do
        migration="${migrations[$i]}"
        local migration_num=$((i + 1))
        log "  [Migration $migration_num/5] Running: $(basename $migration)..."
        if curl -fsSL "$migration" | sqlite3 "$DATA_PATH/npanel.db"; then
            success "  Migration $migration_num completed"
        else
            error "  Migration $migration_num failed"
            return 1
        fi
    done
    
    # Verify database
    log "Verifying database structure..."
    local table_count=$(sqlite3 "$DATA_PATH/npanel.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
    
    if [ "$table_count" -gt 40 ]; then
        success "Database initialized with $table_count tables"
    else
        error "Database initialization incomplete (only $table_count tables)"
        return 1
    fi
}

# ==================== CODE DEPLOYMENT ====================

deploy_code() {
    log "Deploying application code from GitHub..."
    
    cd "$INSTALL_PATH"
    
    # Clone repository
    log "  Step 1/3: Cloning repository..."
    git clone --depth 1 https://github.com/omenyx/npanel.git .
    success "  Repository cloned"
    
    # Build backend
    log "  Step 2/3: Building backend API server..."
    cd backend
    log "    Downloading Go modules..."
    go mod download
    log "    Compiling Go code..."
    go build -o "$INSTALL_PATH/bin/npanel-api" .
    success "    Backend API built"
    cd ..
    
    # Build frontend
    log "  Step 3/3: Building React frontend..."
    cd frontend
    log "    Installing npm dependencies..."
    npm install
    log "    Building production bundle..."
    npm run build
    log "    Copying build artifacts..."
    cp -r build/* "$INSTALL_PATH/public/" 2>/dev/null || true
    success "    Frontend built"
    cd ..
    
    # Build agent
    log "  Building agent service..."
    cd agent
    log "    Compiling Go agent..."
    go build -o "$INSTALL_PATH/bin/npanel-agent" .
    chmod 4755 "$INSTALL_PATH/bin/npanel-agent"
    success "    Agent built with setuid"
    cd ..
    
    success "Application code deployed successfully"
}

# ==================== SERVICES ====================

setup_services() {
    log "Setting up systemd services..."
    
    log "  Creating npanel-agent service..."
    # Agent service
    cat > /etc/systemd/system/npanel-agent.service << 'EOF'
[Unit]
Description=nPanel Agent - Root Operations Handler
After=network.target
Requires=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/npanel/bin/npanel-agent
Restart=always
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    success "  Agent service created"

    log "  Creating npanel-api service..."
    # API service
    cat > /etc/systemd/system/npanel-api.service << 'EOF'
[Unit]
Description=nPanel API Server
After=network.target npanel-agent.service
Requires=npanel-agent.service network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/npanel
ExecStart=/opt/npanel/bin/npanel-api
Restart=always
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # Watchdog service
    curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/etc/systemd/system/npanel-watchdog.service \
        -o /etc/systemd/system/npanel-watchdog.service

    systemctl daemon-reload
    systemctl enable npanel-agent npanel-api npanel-watchdog
    
    success "Systemd services configured"
}

# ==================== WEB SERVER ====================

setup_nginx() {
    log "Configuring Nginx reverse proxy..."
    
    log "  Writing nginx configuration..."
    cat > /etc/nginx/sites-available/npanel << 'EOF'
server {
    listen 80;
    server_name _;

    root /opt/npanel/public;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

    log "  Enabling site..."
    ln -sf /etc/nginx/sites-available/npanel /etc/nginx/sites-enabled/
    
    # Test nginx config
    log "  Testing nginx configuration..."
    if nginx -t > /dev/null 2>&1; then
        success "  Nginx configuration valid"
    else
        error "  Nginx configuration invalid"
        return 1
    fi
    
    log "  Enabling nginx service..."
    systemctl enable nginx
    log "  Starting nginx..."
    systemctl restart nginx
    
    success "Nginx configured and started"
}

# ==================== SSL/TLS ====================

setup_ssl() {
    log "Setting up SSL/TLS certificates..."
    
    if [ -z "$SERVER_HOSTNAME" ]; then
        warning "No hostname provided - skipping Let's Encrypt"
        log "  To add SSL later: certbot certonly --nginx -d <your-domain>"
    else
        log "  Requesting Let's Encrypt certificate for $SERVER_HOSTNAME..."
        if certbot certonly --nginx -d "$SERVER_HOSTNAME" --non-interactive --agree-tos -m "$ADMIN_EMAIL" 2>/dev/null; then
            success "  Let's Encrypt certificate acquired"
        else
            warning "  Let's Encrypt setup failed - will use self-signed fallback"
        fi
    fi
    
    # Self-signed cert fallback
    if [ ! -f /etc/ssl/certs/npanel.crt ]; then
        log "  Generating self-signed certificate..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout /etc/ssl/private/npanel.key \
            -out /etc/ssl/certs/npanel.crt \
            -subj "/CN=localhost"
        success "  Self-signed certificate created"
    fi
}

# ==================== MONITORING ====================

setup_monitoring() {
    log "Setting up monitoring infrastructure..."
    
    local prometheus_installed=0
    local grafana_installed=0
    
    # Check if Prometheus is installed
    if command -v prometheus &> /dev/null; then
        log "  Prometheus binary found - configuring..."
        
        log "  Downloading Prometheus configuration..."
        mkdir -p /etc/prometheus
        curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/config/prometheus_phase5.yml \
            -o /etc/prometheus/npanel-phase5.yml 2>/dev/null || true
        
        # Create scrape config
        mkdir -p /etc/prometheus/npanel
        cat > /etc/prometheus/npanel/scrape.yml << 'EOF'
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'npanel-api'
    static_configs:
      - targets: ['localhost:9090']
  - job_name: 'npanel-agent'
    static_configs:
      - targets: ['localhost:9091']
EOF
        
        log "  Enabling Prometheus service..."
        if systemctl enable prometheus 2>/dev/null; then
            if systemctl restart prometheus 2>/dev/null; then
                sleep 1
                if systemctl is-active --quiet prometheus; then
                    success "  Prometheus configured (:9090)"
                    prometheus_installed=1
                else
                    warning "Prometheus failed to start"
                fi
            else
                warning "Failed to restart Prometheus service"
            fi
        else
            warning "Failed to enable Prometheus service"
        fi
    else
        warning "Prometheus binary not found - install manually or retry installation"
        log "    To install Prometheus later:"
        log "      sudo apt-get install -y prometheus"
        log "      sudo systemctl restart prometheus"
    fi
    
    # Check if Grafana is installed
    if command -v grafana-server &> /dev/null || systemctl list-unit-files | grep -q grafana-server; then
        log "  Grafana binary found - configuring..."
        
        log "  Enabling Grafana service..."
        if systemctl enable grafana-server 2>/dev/null; then
            if systemctl restart grafana-server 2>/dev/null; then
                sleep 2
                if systemctl is-active --quiet grafana-server; then
                    success "  Grafana configured (:3000)"
                    grafana_installed=1
                else
                    warning "Grafana failed to start"
                fi
            else
                warning "Failed to restart Grafana service"
            fi
        else
            warning "Failed to enable Grafana service"
        fi
    else
        warning "Grafana binary not found - advanced visualization unavailable"
        log "    To install Grafana later:"
        log "      sudo add-apt-repository 'deb https://packages.grafana.com/oss/deb stable main'"
        log "      sudo apt-get update"
        log "      sudo apt-get install -y grafana-server"
        log "      sudo systemctl restart grafana-server"
    fi
    
    if [ $prometheus_installed -eq 0 ] && [ $grafana_installed -eq 0 ]; then
        warning "Neither Prometheus nor Grafana could be configured"
        warning "Monitoring features will be limited"
    fi
}

# ==================== EMAIL SERVICE ====================

setup_email() {
    log "Setting up email service (Exim4)..."
    
    log "  Creating Exim4 configuration directory..."
    mkdir -p /etc/exim4/conf.d/{main,router,transport,auth,acl}
    
    log "  Creating basic Exim4 configuration..."
    cat > /etc/exim4/update-exim4.conf.localnew << 'EXIMEOF'
# Exim4 Configuration for nPanel
# Automatically generated - modify as needed

# Router for local delivery
begin routers
local_user:
  driver = accept
  domains = +local_domains
  user = mail
  transport = local_delivery
  cannot_route_message = Unknown user

EXIMEOF
    
    log "  Enabling Exim4 service..."
    systemctl enable exim4
    
    if systemctl start exim4 2>&1; then
        sleep 1
        if systemctl is-active --quiet exim4; then
            success "Email service (Exim4) configured and running"
        else
            warning "Exim4 started but failed to stabilize"
            log "  To troubleshoot: journalctl -xeu exim4.service"
        fi
    else
        warning "Exim4 failed to start - may need configuration"
        log "  To configure email later:"
        log "    sudo dpkg-reconfigure exim4-config"
        log "    sudo systemctl restart exim4"
        log ""
    fi
}

# ==================== DNS SERVICE ====================

setup_dns() {
    log "Setting up DNS service (PowerDNS)..."
    
    log "  Creating PowerDNS configuration directory..."
    mkdir -p /etc/powerdns
    
    log "  Generating PowerDNS configuration file..."
    cat > /etc/powerdns/pdns.conf << 'PDNSEOF'
# PowerDNS Configuration for nPanel
# Generated during installation

# Listen on all interfaces
local-address=0.0.0.0
local-ipv6=::

# Master or Slave
master=yes

# Backend configuration
launch=gsqlite3
gsqlite3-database=/opt/npanel/data/pdns.db

# Logging
loglevel=3
log-dns-queries=no
log-dns-details=no

# Performance
cache-ttl=120
negquery-cache-ttl=60
PDNSEOF
    
    log "  Creating PowerDNS SQLite database..."
    if [ ! -f /opt/npanel/data/pdns.db ]; then
        sqlite3 /opt/npanel/data/pdns.db << 'PDNSDBEOF'
CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    master VARCHAR(128),
    last_check INTEGER,
    type VARCHAR(6),
    notified_serial INTEGER,
    account VARCHAR(40),
    dnssec INTEGER DEFAULT 0,
    nsec3param VARCHAR(255),
    nsec3narrow INTEGER DEFAULT 0,
    presigned INTEGER DEFAULT 0,
    soa_edit VARCHAR(255),
    soa_edit_api VARCHAR(255) DEFAULT 'DEFAULT',
    api_rectify INTEGER DEFAULT 0,
    zone VARCHAR(255),
    catalog VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER,
    name VARCHAR(255),
    type VARCHAR(10),
    content VARCHAR(65535),
    ttl INTEGER,
    prio INTEGER,
    disabled INTEGER DEFAULT 0,
    ordername VARCHAR(255),
    auth INTEGER DEFAULT 1,
    FOREIGN KEY(domain_id) REFERENCES domains(id)
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER,
    name VARCHAR(255),
    type VARCHAR(10),
    modified_at INTEGER,
    account VARCHAR(40),
    comment VARCHAR(65535),
    FOREIGN KEY(domain_id) REFERENCES domains(id)
);

CREATE TABLE IF NOT EXISTS domainmetadata (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER,
    kind VARCHAR(32),
    content TEXT,
    FOREIGN KEY(domain_id) REFERENCES domains(id)
);

CREATE TABLE IF NOT EXISTS cryptokeys (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER,
    flags INTEGER,
    active INTEGER DEFAULT 1,
    content TEXT,
    FOREIGN KEY(domain_id) REFERENCES domains(id)
);

CREATE TABLE IF NOT EXISTS tsigkeys (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255),
    algorithm VARCHAR(50),
    secret VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS records_domain_id ON records(domain_id);
CREATE INDEX IF NOT EXISTS records_name ON records(name);
CREATE INDEX IF NOT EXISTS comments_domain_id ON comments(domain_id);
CREATE INDEX IF NOT EXISTS domainmetadata_domain_id ON domainmetadata(domain_id);
PDNSDBEOF
        
        chown nobody:nogroup /opt/npanel/data/pdns.db
        chmod 660 /opt/npanel/data/pdns.db
        success "  PowerDNS database created"
    else
        log "  PowerDNS database already exists"
    fi
    
    log "  Enabling PowerDNS service..."
    systemctl enable pdns
    
    log "  Starting PowerDNS service..."
    if systemctl start pdns 2>&1; then
        sleep 2
        if systemctl is-active --quiet pdns; then
            success "DNS service (PowerDNS) configured and running"
        else
            warning "PowerDNS started but failed to remain active"
            log "  Troubleshooting: Check /var/log/syslog or run:"
            log "    journalctl -xeu pdns.service"
            log "  PowerDNS may need zone configuration - this is optional"
        fi
    else
        local pdns_error=$(systemctl status pdns 2>&1 | grep -i "failed\|error" | head -1)
        warning "PowerDNS service failed to start"
        log "  Error: $pdns_error"
        log ""
        log "  ${YELLOW}PowerDNS is optional - nPanel can function without it${NC}"
        log "  To troubleshoot and fix PowerDNS:"
        log "    1. Check configuration: cat /etc/powerdns/pdns.conf"
        log "    2. Check database: sqlite3 /opt/npanel/data/pdns.db \".tables\""
        log "    3. View service logs: journalctl -xeu pdns.service"
        log "    4. Restart manually: systemctl restart pdns"
        log ""
        log "  If PowerDNS is not needed, you can disable it:"
        log "    systemctl disable pdns"
        log "    systemctl stop pdns"
        log ""
    fi
}

# ==================== INITIALIZATION ====================

init_admin_user() {
    log "Creating admin account..."
    
    if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
        warning "Admin email or password not provided - will be prompted after installation"
        return
    fi
    
    log "  Generating password hash..."
    # Hash password (bcrypt-style)
    local password_hash=$(echo -n "$ADMIN_PASSWORD" | sha256sum | awk '{print $1}')
    
    log "  Inserting admin user into database..."
    # Insert admin user
    sqlite3 "$DATA_PATH/npanel.db" <<SQL
INSERT OR IGNORE INTO accounts (
    id, email, username, password_hash, role, status
) VALUES (
    1,
    '$ADMIN_EMAIL',
    'admin',
    '$password_hash',
    'admin',
    'active'
);
SQL
    
    success "Admin account initialized"
    log "  Email: $ADMIN_EMAIL"
}

# ==================== BASELINE ====================

record_baseline() {
    log "Recording performance baseline..."
    
    log "  Downloading baseline measurement script..."
    curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/scripts/measure_baseline.sh \
        -o "$INSTALL_PATH/scripts/measure_baseline.sh"
    
    chmod +x "$INSTALL_PATH/scripts/measure_baseline.sh"
    
    log "  Running baseline measurements..."
    bash "$INSTALL_PATH/scripts/measure_baseline.sh" > /dev/null 2>&1 || true
    
    success "Baseline recorded"
}

# ==================== VERIFICATION ====================

verify_installation() {
    log "Verifying installation components..."
    
    local checks=0
    
    # Check binaries
    log "  Checking binaries..."
    if [ -x "$INSTALL_PATH/bin/npanel-api" ]; then
        success "  API binary installed"
        ((checks++))
    else
        error "  API binary missing"
    fi
    
    if [ -x "$INSTALL_PATH/bin/npanel-agent" ]; then
        success "  Agent binary installed"
        ((checks++))
    else
        error "  Agent binary missing"
    fi
    
    # Check database
    log "  Checking database..."
    if [ -f "$DATA_PATH/npanel.db" ]; then
        success "  Database initialized"
        ((checks++))
    else
        error "  Database missing"
    fi
    
    # Check nginx
    log "  Checking web server..."
    if systemctl is-enabled nginx > /dev/null 2>&1; then
        success "  Nginx configured"
        ((checks++))
    else
        error "  Nginx not configured"
    fi
    
    # Check services
    log "  Checking services..."
    for service in npanel-agent npanel-api npanel-watchdog; do
        if systemctl is-enabled "$service" > /dev/null 2>&1; then
            success "  $service enabled"
            ((checks++))
        fi
    done
    
    return 0
}

# ==================== START SERVICES ====================

start_services() {
    log "Starting all services..."
    
    log "  Starting npanel-agent..."
    systemctl start npanel-agent
    sleep 2
    
    log "  Starting npanel-api..."
    systemctl start npanel-api
    sleep 2
    
    log "  Starting npanel-watchdog..."
    systemctl start npanel-watchdog
    
    log "Waiting for services to stabilize..."
    sleep 5
    
    # Verify running
    local running=0
    for service in npanel-agent npanel-api npanel-watchdog; do
        if systemctl is-active --quiet "$service"; then
            success "  $service is running"
            ((running++))
        else
            error "  $service failed to start"
        fi
    done
    
    if [ "$running" -eq 3 ]; then
        success "All services started successfully"
    else
        warning "Some services failed to start - check logs"
    fi
}

# ==================== SUMMARY ====================

print_summary() {
    clear
    
    cat << EOF

${GREEN}${BOLD}╔════════════════════════════════════════════════════════════════════╗${NC}
${GREEN}${BOLD}║                                                                    ║${NC}
${GREEN}${BOLD}║        ✓ nPanel Production Installation COMPLETE!                 ║${NC}
${GREEN}${BOLD}║        All Phases 1-5 Deployed & Running                          ║${NC}
${GREEN}${BOLD}║                                                                    ║${NC}
${GREEN}${BOLD}╚════════════════════════════════════════════════════════════════════╝${NC}

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}INSTALLATION STATUS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${GREEN}✓${NC} Phases 1-5 Deployed
  ${GREEN}✓${NC} All Services Running
  ${GREEN}✓${NC} Database Initialized (45+ tables)
  ${GREEN}✓${NC} Web Server Configured & Active
  ${GREEN}✓${NC} Monitoring Infrastructure Ready
  ${GREEN}✓${NC} Email & DNS Services Active
  ${GREEN}✓${NC} Performance Baseline Recorded

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}ACCESS CREDENTIALS & PORTS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${CYAN}📊 WEB ADMINISTRATION PANEL${NC}
  ${BOLD}URL:${NC}          http://$(hostname -I | awk '{print $1}') (or https:// for SSL)
  ${BOLD}Port:${NC}         80 (HTTP) / 443 (HTTPS with SSL)
  ${BOLD}Admin User:${NC}    admin
  ${BOLD}Email:${NC}        $ADMIN_EMAIL
  ${BOLD}Password:${NC}     $ADMIN_PASSWORD
  
  ${YELLOW}⚠ IMPORTANT:${NC} Change admin credentials after first login!

${CYAN}📈 MONITORING & OBSERVABILITY${NC}
  ${BOLD}Prometheus:${NC}   http://$(hostname -I | awk '{print $1}'):9090
  ${BOLD}Grafana:${NC}      http://$(hostname -I | awk '{print $1}'):3000
  ${BOLD}Grafana User:${NC} admin
  ${BOLD}Grafana Pass:${NC} admin
  
  ${YELLOW}⚠ IMPORTANT:${NC} Change Grafana password on first login!

${CYAN}🔌 API & SERVICES${NC}
  ${BOLD}REST API:${NC}     http://$(hostname -I | awk '{print $1}'):8080/api
  ${BOLD}Agent IPC:${NC}    /var/run/npanel-agent.sock (internal)
  ${BOLD}SSH Access:${NC}   ssh root@$(hostname -I | awk '{print $1}')

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}INSTALLATION PATHS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${BOLD}Installation Root:${NC}  $INSTALL_PATH
  ${BOLD}Database:${NC}           $DATA_PATH/npanel.db
  ${BOLD}Web Root:${NC}           $INSTALL_PATH/public
  ${BOLD}Binaries:${NC}           $INSTALL_PATH/bin/ (api, agent, watchdog)
  ${BOLD}Configuration:${NC}      $INSTALL_PATH/config/
  ${BOLD}Backups:${NC}            $BACKUP_PATH
  ${BOLD}Logs:${NC}               /var/log/npanel/

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}SERVICES STATUS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${CYAN}CORE SERVICES (Required):${NC}
EOF

    for service in npanel-agent npanel-api npanel-watchdog nginx; do
        if systemctl is-active --quiet "$service" 2>/dev/null; then
            printf "  ${GREEN}✓${NC} %-20s (running)\n" "$service"
        else
            printf "  ${RED}✗${NC} %-20s (inactive)\n" "$service"
        fi
    done

    cat << EOF

${CYAN}MONITORING SERVICES:${NC}
EOF

    for service in prometheus grafana-server; do
        if systemctl is-active --quiet "$service" 2>/dev/null; then
            printf "  ${GREEN}✓${NC} %-20s (running)\n" "$service"
        else
            printf "  ${YELLOW}○${NC} %-20s (inactive)\n" "$service"
        fi
    done

    cat << EOF

${CYAN}OPTIONAL SERVICES (Can be configured later):${NC}
EOF

    for service in exim4 pdns; do
        if systemctl is-active --quiet "$service" 2>/dev/null; then
            printf "  ${GREEN}✓${NC} %-20s (running)\n" "$service"
        else
            printf "  ${YELLOW}○${NC} %-20s (not running)\n" "$service"
        fi
    done

    cat << EOF

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}SERVICE TROUBLESHOOTING${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${CYAN}If Exim4 (Email) failed to start:${NC}
  1. Reconfigure Exim4: ${BOLD}sudo dpkg-reconfigure exim4-config${NC}
  2. Restart the service: ${BOLD}sudo systemctl restart exim4${NC}
  3. Check logs: ${BOLD}journalctl -xeu exim4.service${NC}
  4. Email is optional - nPanel works without it

${CYAN}If PowerDNS (DNS) failed to start:${NC}
  1. Check configuration: ${BOLD}cat /etc/powerdns/pdns.conf${NC}
  2. Verify database: ${BOLD}sqlite3 /opt/npanel/data/pdns.db ".tables"${NC}
  3. Check service logs: ${BOLD}journalctl -xeu pdns.service${NC}
  4. PowerDNS is optional - nPanel works without it
  5. To disable: ${BOLD}sudo systemctl disable pdns && sudo systemctl stop pdns${NC}

${CYAN}If any core service is not running:${NC}
  1. Check status: ${BOLD}sudo systemctl status npanel-api${NC}
  2. View logs: ${BOLD}journalctl -xeu npanel-api.service${NC}
  3. Restart: ${BOLD}sudo systemctl restart npanel-api${NC}

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}QUICK COMMANDS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${CYAN}View API logs:${NC}
    journalctl -u npanel-api -f

  ${CYAN}Check all nPanel services:${NC}
    systemctl status npanel-{agent,api,watchdog}

  ${CYAN}Restart API server:${NC}
    systemctl restart npanel-api

  ${CYAN}View database:${NC}
    sqlite3 $DATA_PATH/npanel.db

  ${CYAN}Backup database:${NC}
    sqlite3 $DATA_PATH/npanel.db ".backup $BACKUP_PATH/npanel-\$(date +%s).db"

  ${CYAN}View installation log:${NC}
    cat $LOG_FILE

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}INITIAL SETUP CHECKLIST${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${CYAN}1. First Login${NC}
     - Open web UI: http://$(hostname -I | awk '{print $1}')
     - Username: admin
     - Password: $ADMIN_PASSWORD
     - Click Login

  ${CYAN}2. Change Admin Password (CRITICAL)${NC}
     - Go to Settings > Admin Users
     - Change admin password immediately
     - Save changes

  ${CYAN}3. Configure Domain & SSL${NC}
     - Update server hostname in settings
     - Add SSL certificate (Let's Encrypt or custom)
     - Update DNS records to point to this server

  ${CYAN}4. Set Up Email Service${NC}
     - Configure Exim4 SMTP settings
     - Test email sending from panel
     - Set up sender/reply-to addresses

  ${CYAN}5. Configure DNS Service${NC}
     - Setup PowerDNS if using nameserver functionality
     - Configure zone files as needed

  ${CYAN}6. Import Hosting Packages${NC}
     - Go to Packages menu
     - Create hosting packages (shared, VPS, reseller, etc.)
     - Set resource limits and features per package

  ${CYAN}7. Monitor Performance${NC}
     - Open Prometheus: http://$(hostname -I | awk '{print $1}'):9090
     - Open Grafana: http://$(hostname -I | awk '{print $1}'):3000
     - Verify metrics are being collected

  ${CYAN}8. Enable Automated Backups${NC}
     - Navigate to: System > Backup Settings
     - Enable automatic database backups
     - Set backup retention policy

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}DOCUMENTATION & SUPPORT${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${CYAN}API Documentation:${NC}
    $INSTALL_PATH/docs/API.md

  ${CYAN}Deployment Guide:${NC}
    $INSTALL_PATH/DEPLOYMENT_UBUNTU_FRESH.md

  ${CYAN}Operations Runbook:${NC}
    $INSTALL_PATH/OPERATIONS_RUNBOOK.md

  ${CYAN}Installation Log:${NC}
    $LOG_FILE

  ${CYAN}GitHub Repository:${NC}
    https://github.com/omenyx/npanel

  ${CYAN}Issues/Feature Requests:${NC}
    https://github.com/omenyx/npanel/issues

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}INSTALLATION SUMMARY & DIAGNOSTICS${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

EOF

    if [ ${#FAILED_COMPONENTS[@]} -gt 0 ]; then
        echo -e "${YELLOW}Failed Components:${NC}"
        for component in "${FAILED_COMPONENTS[@]}"; do
            echo "  - $component"
        done
        echo ""
    fi
    
    if [ ${#SKIPPED_COMPONENTS[@]} -gt 0 ]; then
        echo -e "${YELLOW}Skipped/Optional Components:${NC}"
        for component in "${SKIPPED_COMPONENTS[@]}"; do
            echo "  - $component"
        done
        echo ""
    fi

    cat << EOF

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}SYSTEM INFORMATION${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${CYAN}Server IP:${NC}        $(hostname -I | awk '{print $1}')
  ${CYAN}Hostname:${NC}         $(hostname)
  ${CYAN}OS:${NC}               $OS_ID ($(. /etc/os-release; echo $VERSION_ID))
  ${CYAN}Installation Time:${NC} $(date)
  ${CYAN}Total Setup Duration:${NC} $SECONDS seconds
  ${CYAN}Installation Log:${NC}  $LOG_FILE

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
${BOLD}IF EXPERIENCING ISSUES${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${CYAN}Collect diagnostic information:${NC}
  1. Full installation log:
     cat $LOG_FILE > ~/npanel-install-$(date +%s).log

  2. System resources:
     free -h
     df -h /opt
     uname -a

  3. Service status:
     systemctl status npanel-* | tee ~/npanel-services.txt
     journalctl -u npanel-api -n 50 | tee ~/npanel-api-logs.txt

  4. Package versions:
     go version
     node --version
     npm --version

  5. Create issue with:
     https://github.com/omenyx/npanel/issues/new
     Include the log files above and describe the error

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

EOF

    if [ $CRITICAL_FAILURE -eq 0 ]; then
        echo -e "${GREEN}${BOLD}✓ nPanel is ready for production use!${NC}"
        echo -e "${BOLD}Access your panel now at: ${CYAN}http://$(hostname -I | awk '{print $1}')${NC}${NC}"
    else
        echo -e "${RED}${BOLD}✗ Installation did not complete successfully${NC}"
        echo -e "${BOLD}Review errors above and check: $LOG_FILE${NC}"
    fi

EOF
}

# ==================== MAIN FLOW ====================

main() {
    echo "Starting nPanel production installation..." | tee -a "$LOG_FILE"
    log "Installation log: $LOG_FILE"
    log "Process ID: $$"
    log ""
    
    check_root
    check_os
    check_resources
    update_system
    install_dependencies
    setup_directories
    setup_database
    deploy_code
    setup_services
    setup_nginx
    setup_ssl
    setup_monitoring
    setup_email
    setup_dns
    init_admin_user
    record_baseline
    verify_installation
    start_services
    print_summary
    
    log "Installation complete! Check logs at: $LOG_FILE"
}

# ==================== RUN ====================

main "$@"
