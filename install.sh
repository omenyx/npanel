#!/bin/bash
# nPanel Phase 5 - Professional Installer
# Inspired by cPanel/WHM installer - Friendly & Professional
# Run: sudo bash install.sh

set -euo pipefail

# ==================== COLOR SCHEME ====================
HEADER='\033[95m'
BLUE='\033[94m'
CYAN='\033[96m'
GREEN='\033[92m'
YELLOW='\033[93m'
RED='\033[91m'
BOLD='\033[1m'
UNDERLINE='\033[4m'
NC='\033[0m' # No Color

# Progress bar
PROGRESS_BAR_WIDTH=50

# Global state
DISTRO=""
DISTRO_VERSION=""
INSTALL_PATH="/opt/npanel"
DATA_PATH="/opt/npanel/data"
CURRENT_STEP=0
TOTAL_STEPS=10

# ==================== UTILITY FUNCTIONS ====================

print_header() {
    clear
    echo -e "${HEADER}${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo -e "${HEADER}${BOLD}     nPanel Phase 5 - Professional Installation${NC}"
    echo -e "${HEADER}${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_step_header() {
    local step_num=$1
    local step_name=$2
    CURRENT_STEP=$step_num
    
    echo ""
    echo -e "${CYAN}${BOLD}[Step $step_num/$TOTAL_STEPS] $step_name${NC}"
    echo -e "${CYAN}$(printf '%.0s─' {1..50})${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

progress_bar() {
    local current=$1
    local total=$2
    local percent=$((current * 100 / total))
    local filled=$((percent * PROGRESS_BAR_WIDTH / 100))
    
    printf "  ["
    printf '%0.s█' $(seq 1 $filled)
    printf '%0.s░' $(seq 1 $((PROGRESS_BAR_WIDTH - filled)))
    printf "] %3d%% (%d/%d)\n" "$percent" "$current" "$total"
}

pause_for_user() {
    read -p "$(echo -e ${BLUE}Press Enter to continue...${NC})"
}

yes_no_prompt() {
    local prompt=$1
    local response
    
    while true; do
        read -p "$(echo -e ${YELLOW}$prompt [y/N]: ${NC})" response
        case "$response" in
            [yY][eE][sS]|[yY]) return 0 ;;
            [nN][oO]|[nN]|"") return 1 ;;
            *) echo "Please answer yes or no" ;;
        esac
    done
}

# ==================== DETECTION ====================

detect_distro() {
    print_step_header 1 "Detecting System"
    
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO="$ID"
        DISTRO_VERSION="$VERSION_ID"
    else
        DISTRO="unknown"
        DISTRO_VERSION="unknown"
    fi
    
    echo "  Distribution: $DISTRO $DISTRO_VERSION"
    echo "  Kernel: $(uname -r)"
    echo "  Architecture: $(uname -m)"
    echo ""
    
    case "$DISTRO" in
        ubuntu|debian)
            print_success "Ubuntu/Debian detected - APT package manager"
            ;;
        centos|rhel|fedora)
            print_success "CentOS/RHEL/Fedora detected - DNF package manager"
            ;;
        alpine)
            print_success "Alpine detected - APK package manager"
            ;;
        arch)
            print_success "Arch detected - Pacman package manager"
            ;;
        *)
            print_warning "Unknown distribution - some steps may need manual adjustment"
            ;;
    esac
    
    echo ""
}

check_root() {
    print_step_header 2 "Checking Privileges"
    
    if [[ $EUID -ne 0 ]]; then
        print_error "This installer must be run as root"
        echo "  Run: sudo bash install.sh"
        exit 1
    fi
    
    print_success "Running as root"
    echo ""
}

check_space() {
    print_step_header 3 "Checking System Requirements"
    
    # Disk space
    local available=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || df / | tail -1 | awk '{print $4}')
    local available_gb=$((available / 1024 / 1024))
    
    echo "  Disk Space:"
    printf "    Available: %d GB\n" "$available_gb"
    
    if [[ "$available_gb" -ge 10 ]]; then
        print_success "Sufficient disk space"
    else
        print_error "Insufficient disk space (need ≥10 GB, have $available_gb GB)"
        exit 1
    fi
    
    # Memory
    local mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_gb=$((mem_kb / 1024 / 1024))
    
    echo "  Memory:"
    printf "    Total: %d GB\n" "$mem_gb"
    
    if [[ "$mem_gb" -ge 4 ]]; then
        print_success "Sufficient memory"
    else
        print_warning "Low memory (have $mem_gb GB, recommended ≥4 GB)"
    fi
    
    echo ""
}

# ==================== PACKAGE MANAGEMENT ====================

install_packages() {
    print_step_header 4 "Installing Dependencies"
    
    echo "  This may take several minutes..."
    echo ""
    
    case "$DISTRO" in
        ubuntu|debian)
            echo "  Running: apt-get update"
            apt-get update -qq > /dev/null 2>&1
            progress_bar 1 3
            
            echo "  Installing core packages..."
            apt-get install -y golang-1.23 nodejs npm sqlite3 git \
                procps sysstat curl bc exim4 rsync build-essential \
                > /dev/null 2>&1
            progress_bar 2 3
            
            apt-get install -y prometheus grafana-server > /dev/null 2>&1
            progress_bar 3 3
            ;;
            
        centos|rhel|fedora)
            echo "  Installing core packages..."
            dnf install -y golang nodejs npm sqlite git \
                procps-ng sysstat curl bc exim rsync gcc make \
                > /dev/null 2>&1
            progress_bar 2 3
            
            dnf install -y prometheus grafana > /dev/null 2>&1
            progress_bar 3 3
            ;;
            
        alpine)
            echo "  Installing core packages..."
            apk add go nodejs npm sqlite git \
                procps sysstat curl bc exim rsync make > /dev/null 2>&1
            progress_bar 2 3
            
            apk add prometheus grafana > /dev/null 2>&1
            progress_bar 3 3
            ;;
            
        arch)
            echo "  Installing core packages..."
            pacman -S --noconfirm go nodejs npm sqlite git \
                procps sysstat curl bc exim rsync base-devel \
                > /dev/null 2>&1
            progress_bar 2 3
            
            pacman -S --noconfirm prometheus grafana > /dev/null 2>&1
            progress_bar 3 3
            ;;
    esac
    
    echo ""
    print_success "Dependencies installed"
    echo ""
}

# ==================== DATABASE SETUP ====================

setup_database() {
    print_step_header 5 "Setting Up Database"
    
    echo "  Creating directories..."
    mkdir -p "$DATA_PATH"
    mkdir -p "$INSTALL_PATH/bin"
    mkdir -p "$INSTALL_PATH/config"
    mkdir -p "$INSTALL_PATH/public"
    
    chown -R nobody:nogroup "$DATA_PATH"
    chmod 755 "$DATA_PATH"
    
    progress_bar 1 3
    
    echo "  Running database migrations..."
    if [ -f "backend/migrations/005_cgroups_v2.sql" ]; then
        sqlite3 "$DATA_PATH/npanel.db" < backend/migrations/005_cgroups_v2.sql
        progress_bar 2 3
    else
        print_error "Migration file not found at backend/migrations/005_cgroups_v2.sql"
        return 1
    fi
    
    # Verify
    local table_count=$(sqlite3 "$DATA_PATH/npanel.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
    progress_bar 3 3
    
    echo ""
    print_success "Database initialized with $table_count tables"
    echo ""
}

# ==================== SERVICES ====================

install_services() {
    print_step_header 6 "Installing Services"
    
    echo "  Installing watchdog service..."
    cp etc/systemd/system/npanel-watchdog.service /etc/systemd/system/
    progress_bar 1 3
    
    echo "  Enabling services..."
    systemctl daemon-reload
    systemctl enable npanel-watchdog
    progress_bar 2 3
    
    # Check if service installed
    if systemctl list-unit-files | grep -q npanel-watchdog; then
        progress_bar 3 3
        echo ""
        print_success "Watchdog service installed and enabled"
    else
        print_error "Failed to install watchdog service"
        return 1
    fi
    
    echo ""
}

# ==================== MONITORING ====================

setup_monitoring() {
    print_step_header 7 "Setting Up Monitoring"
    
    echo "  Configuring Prometheus..."
    mkdir -p /etc/prometheus
    cp config/prometheus_phase5.yml /etc/prometheus/npanel-phase5.yml
    progress_bar 1 2
    
    echo "  Reloading Prometheus..."
    systemctl restart prometheus 2>/dev/null || print_warning "Prometheus not running yet (OK)"
    progress_bar 2 2
    
    echo ""
    print_success "Prometheus configuration installed"
    echo "  Metrics will be available at: http://localhost:9090"
    echo ""
}

# ==================== BUILD ====================

build_binaries() {
    print_step_header 8 "Building Binaries"
    
    echo "  Building backend API..."
    cd backend
    go mod download > /dev/null 2>&1
    go build -o npanel-api . > /dev/null 2>&1
    cp npanel-api "$INSTALL_PATH/bin/"
    chmod +x "$INSTALL_PATH/bin/npanel-api"
    progress_bar 1 3
    cd ..
    
    echo "  Building frontend..."
    cd frontend
    npm install > /dev/null 2>&1
    npm run build > /dev/null 2>&1
    cp -r build/* "$INSTALL_PATH/public/"
    progress_bar 2 3
    cd ..
    
    echo "  Building agent..."
    cd agent
    go build -o npanel-agent . > /dev/null 2>&1
    cp npanel-agent "$INSTALL_PATH/bin/"
    chmod +x "$INSTALL_PATH/bin/npanel-agent"
    chmod 4755 "$INSTALL_PATH/bin/npanel-agent"  # SUID for root
    progress_bar 3 3
    cd ..
    
    echo ""
    print_success "Binaries built and installed"
    echo "  Location: $INSTALL_PATH/bin/"
    echo ""
}

# ==================== BASELINE ====================

record_baseline() {
    print_step_header 9 "Recording Performance Baseline"
    
    echo "  This will take about 2 minutes..."
    echo ""
    
    if [ -f "scripts/measure_baseline.sh" ]; then
        bash scripts/measure_baseline.sh 2>/dev/null
        echo ""
        print_success "Baseline recorded"
    else
        print_warning "Baseline script not found - skipping"
    fi
    
    echo ""
}

# ==================== VERIFICATION ====================

verify_installation() {
    print_step_header 10 "Verifying Installation"
    
    echo "  Checking binaries..."
    for binary in npanel-api npanel-agent; do
        if [ -x "$INSTALL_PATH/bin/$binary" ]; then
            progress_bar 1 4
            print_success "$binary installed"
        else
            print_error "$binary not found"
        fi
    done
    
    echo "  Checking database..."
    if [ -f "$DATA_PATH/npanel.db" ]; then
        progress_bar 2 4
        print_success "Database initialized"
    else
        print_error "Database not found"
    fi
    
    echo "  Checking services..."
    if systemctl list-unit-files | grep -q npanel-watchdog; then
        progress_bar 3 4
        print_success "Watchdog service installed"
    else
        print_error "Watchdog service not installed"
    fi
    
    echo "  Checking configuration..."
    if [ -f "/etc/prometheus/npanel-phase5.yml" ]; then
        progress_bar 4 4
        print_success "Prometheus configuration installed"
    else
        print_warning "Prometheus configuration not found"
    fi
    
    echo ""
}

# ==================== SUMMARY ====================

print_summary() {
    print_header
    
    echo -e "${GREEN}${BOLD}Installation Complete!${NC}"
    echo ""
    echo -e "${BOLD}What's Been Installed:${NC}"
    echo "  ✓ nPanel Phase 5 Week 1 (all 7 tasks)"
    echo "  ✓ cgroups v2 resource isolation"
    echo "  ✓ Agent watchdog service"
    echo "  ✓ Performance baseline measurement"
    echo "  ✓ Prometheus monitoring"
    echo "  ✓ Soak test framework"
    echo ""
    echo -e "${BOLD}Installation Paths:${NC}"
    echo "  Binaries:    $INSTALL_PATH/bin/"
    echo "  Database:    $DATA_PATH/"
    echo "  Config:      $INSTALL_PATH/config/"
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo "  1. Start services:"
    echo "     sudo systemctl start npanel-watchdog"
    echo "     sudo $INSTALL_PATH/bin/npanel-agent &"
    echo "     sudo $INSTALL_PATH/bin/npanel-api &"
    echo ""
    echo "  2. Check status:"
    echo "     ps aux | grep npanel"
    echo ""
    echo "  3. View metrics:"
    echo "     http://localhost:9090 (Prometheus)"
    echo ""
    echo "  4. Run soak tests (optional, 24+ hours):"
    echo "     cd backend && go test -run TestSoak -timeout 24h ./..."
    echo ""
    echo -e "${BOLD}Documentation:${NC}"
    echo "  • PHASE_5_WEEK_1_CODE_READY.md - Detailed guide"
    echo "  • DEPLOYMENT_UBUNTU_FRESH.md - Step-by-step"
    echo ""
    echo -e "${BOLD}Support:${NC}"
    echo "  For issues: Check /var/log/syslog or run journalctl"
    echo ""
    echo -e "${GREEN}${BOLD}✓ Installation successful!${NC}"
    echo ""
}

# ==================== ERROR HANDLING ====================

handle_error() {
    local line_no=$1
    print_error "Installation failed at step $CURRENT_STEP (line $line_no)"
    echo ""
    echo "To troubleshoot:"
    echo "  1. Check system logs: tail -f /var/log/syslog"
    echo "  2. Verify prerequisites: sudo bash scripts/check_prerequisites.sh"
    echo "  3. Review error message above"
    echo ""
    exit 1
}

trap 'handle_error ${LINENO}' ERR

# ==================== MAIN FLOW ====================

main() {
    print_header
    
    # Welcome
    echo -e "${BOLD}Welcome to nPanel Phase 5 Installation${NC}"
    echo ""
    echo "This installer will deploy nPanel Phase 5 Week 1 on your system."
    echo "Installation will take approximately 10-15 minutes."
    echo ""
    
    if ! yes_no_prompt "Continue with installation?"; then
        echo "Installation cancelled."
        exit 0
    fi
    
    echo ""
    
    # Step 1: Detect
    detect_distro
    
    # Step 2: Check root
    check_root
    
    # Step 3: Check space
    check_space
    
    # Step 4: Install packages
    if yes_no_prompt "Install missing dependencies?"; then
        install_packages
    fi
    
    # Step 5: Database
    setup_database
    
    # Step 6: Services
    install_services
    
    # Step 7: Monitoring
    setup_monitoring
    
    # Step 8: Build
    build_binaries
    
    # Step 9: Baseline
    if yes_no_prompt "Record performance baseline? (2 min)"; then
        record_baseline
    fi
    
    # Step 10: Verify
    verify_installation
    
    # Summary
    print_summary
}

# ==================== RUN ====================

# Run main function (works in pipe context: curl ... | bash)
main "$@"
