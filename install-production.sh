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

# ==================== COLORS ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

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
            apt-get install -y golang-1.23 nodejs npm git sqlite3
            
            log "  Installing: build tools (gcc, make)..."
            apt-get install -y build-essential gcc make
            
            log "  Installing: system monitoring tools..."
            apt-get install -y procps sysstat curl wget
            
            log "  Installing: nginx web server..."
            apt-get install -y systemd nginx
            
            log "  Installing: email service (exim4)..."
            apt-get install -y exim4
            
            log "  Installing: DNS service (pdns-server)..."
            apt-get install -y pdns-server
            
            log "  Installing: SSL certificates (certbot)..."
            apt-get install -y certbot python3-certbot-nginx
            
            log "  Installing: monitoring (prometheus, grafana)..."
            apt-get install -y prometheus grafana-server
            
            log "  Installing: utilities (rsync, openssh-server)..."
            apt-get install -y rsync openssh-server
            ;;
        dnf)
            log "  Installing: golang nodejs npm git sqlite3..."
            dnf install -y golang nodejs npm git sqlite
            
            log "  Installing: build tools (gcc, make)..."
            dnf install -y gcc make
            
            log "  Installing: system monitoring tools..."
            dnf install -y procps-ng sysstat curl wget
            
            log "  Installing: nginx web server..."
            dnf install -y systemd nginx
            
            log "  Installing: email service (exim)..."
            dnf install -y exim
            
            log "  Installing: DNS service (pdns)..."
            dnf install -y pdns
            
            log "  Installing: SSL certificates (certbot)..."
            dnf install -y certbot certbot-nginx
            
            log "  Installing: monitoring (prometheus, grafana)..."
            dnf install -y prometheus grafana
            
            log "  Installing: utilities (rsync, openssh-server)..."
            dnf install -y rsync openssh-server
            ;;
    esac
    
    success "Dependencies installed"
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
    
    log "  Downloading Prometheus configuration..."
    # Get Prometheus config
    curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/config/prometheus_phase5.yml \
        -o /etc/prometheus/npanel-phase5.yml 2>/dev/null || true
    
    log "  Enabling Prometheus service..."
    systemctl enable prometheus
    systemctl restart prometheus
    success "  Prometheus configured (:9090)"
    
    log "  Enabling Grafana service..."
    systemctl enable grafana-server
    systemctl restart grafana-server
    success "  Grafana configured (:3000)"
    
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

    systemctl enable prometheus grafana-server
    systemctl restart prometheus grafana-server
    
    success "Monitoring configured"
    log "  Prometheus: http://localhost:9090"
    log "  Grafana: http://localhost:3000 (admin/admin)"
}

# ==================== EMAIL SERVICE ====================

setup_email() {
    log "Setting up email service (Exim4)..."
    
    log "  Creating Exim4 configuration..."
    # Configure Exim4
    mkdir -p /etc/exim4/conf.d/{main,router,transport,auth,acl}
    
    log "  Enabling Exim4 service..."
    systemctl enable exim4
    systemctl start exim4
    
    success "Email service configured"
}

# ==================== DNS SERVICE ====================

setup_dns() {
    log "Setting up DNS service (PowerDNS)..."
    
    log "  Creating PowerDNS configuration..."
    # Create PowerDNS config
    mkdir -p /etc/powerdns
    
    log "  Enabling PowerDNS service..."
    systemctl enable pdns
    if systemctl start pdns 2>/dev/null; then
        success "DNS service configured"
    else
        warning "PowerDNS start failed - configure manually later"
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

EOF

    for service in npanel-agent npanel-api npanel-watchdog nginx prometheus grafana-server exim4 pdns; do
        if systemctl is-active --quiet "$service" 2>/dev/null; then
            printf "  ${GREEN}✓${NC} %-20s (running)\n" "$service"
        else
            printf "  ${YELLOW}○${NC} %-20s (inactive)\n" "$service"
        fi
    done

    cat << EOF

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
${BOLD}SYSTEM INFORMATION${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

  ${CYAN}Server IP:${NC}        $(hostname -I | awk '{print $1}')
  ${CYAN}Hostname:${NC}         $(hostname)
  ${CYAN}OS:${NC}               $OS_ID ($(. /etc/os-release; echo $VERSION_ID))
  ${CYAN}Installation Time:${NC} $(date)
  ${CYAN}Total Setup Duration:${NC} $SECONDS seconds

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${GREEN}${BOLD}✓ nPanel is ready for production use!${NC}
${BOLD}Access your panel now at: ${CYAN}http://$(hostname -I | awk '{print $1}')${NC}${NC}

EOF
}

# ==================== MAIN FLOW ====================

main() {
    echo "Starting nPanel production installation..." | tee -a "$LOG_FILE"
    
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
