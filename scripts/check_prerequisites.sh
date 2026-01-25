#!/bin/bash
# Pre-deployment Validation Script - Phase 5 Week 1
# Checks all required packages and dependencies across Linux distros
# Run BEFORE deploying nPanel to ensure all prerequisites are met

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO="$ID"
        DISTRO_VERSION="$VERSION_ID"
    else
        DISTRO="unknown"
        DISTRO_VERSION="unknown"
    fi
}

# Check if command exists
check_command() {
    local cmd=$1
    local min_version=$2
    local install_cmd=$3
    
    if command -v "$cmd" &> /dev/null; then
        local version=$("$cmd" --version 2>/dev/null | head -n1 || echo "unknown")
        printf "%-30s ${GREEN}✓ INSTALLED${NC}\n" "$cmd:"
        if [[ -n "$version" && "$version" != "unknown" ]]; then
            printf "    Version: %s\n" "$version"
        fi
        ((PASSED++))
        return 0
    else
        printf "%-30s ${RED}✗ MISSING${NC}\n" "$cmd:"
        if [[ -n "$install_cmd" ]]; then
            printf "    Install: %s\n" "$install_cmd"
        fi
        ((FAILED++))
        return 1
    fi
}

# Check Go version (minimum 1.23)
check_go_version() {
    if command -v go &> /dev/null; then
        local version=$(go version | awk '{print $3}' | sed 's/go//')
        local major=$(echo "$version" | cut -d. -f1)
        local minor=$(echo "$version" | cut -d. -f2)
        
        printf "%-30s ${GREEN}✓ INSTALLED${NC}\n" "go:"
        printf "    Version: %s\n" "$version"
        
        # Check minimum version (1.23)
        if [[ "$major" -gt 1 ]] || [[ "$major" -eq 1 && "$minor" -ge 23 ]]; then
            printf "    Status: ${GREEN}✓ Meets minimum (1.23)${NC}\n"
            ((PASSED++))
        else
            printf "    Status: ${RED}✗ Below minimum (requires 1.23+)${NC}\n"
            ((FAILED++))
        fi
    else
        printf "%-30s ${RED}✗ MISSING${NC}\n" "go:"
        case "$DISTRO" in
            ubuntu|debian) printf "    Install: sudo apt-get install -y golang-1.23\n" ;;
            centos|rhel|fedora) printf "    Install: sudo dnf install -y golang\n" ;;
            alpine) printf "    Install: apk add go\n" ;;
            arch) printf "    Install: pacman -S go\n" ;;
            *) printf "    Install: Download from https://go.dev/dl/\n" ;;
        esac
        ((FAILED++))
    fi
}

# Check Node.js version (minimum 18)
check_node_version() {
    if command -v node &> /dev/null; then
        local version=$(node --version | sed 's/v//')
        local major=$(echo "$version" | cut -d. -f1)
        
        printf "%-30s ${GREEN}✓ INSTALLED${NC}\n" "node:"
        printf "    Version: %s\n" "$version"
        
        if [[ "$major" -ge 18 ]]; then
            printf "    Status: ${GREEN}✓ Meets minimum (18+)${NC}\n"
            ((PASSED++))
        else
            printf "    Status: ${RED}✗ Below minimum (requires 18+)${NC}\n"
            ((FAILED++))
        fi
    else
        printf "%-30s ${RED}✗ MISSING${NC}\n" "node:"
        case "$DISTRO" in
            ubuntu|debian) printf "    Install: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs\n" ;;
            centos|rhel|fedora) printf "    Install: sudo dnf install -y nodejs\n" ;;
            alpine) printf "    Install: apk add nodejs npm\n" ;;
            arch) printf "    Install: pacman -S nodejs npm\n" ;;
            *) printf "    Install: Download from https://nodejs.org/\n" ;;
        esac
        ((FAILED++))
    fi
}

# Check if running as root or with sudo
check_privileges() {
    if [[ $EUID -eq 0 ]]; then
        printf "%-30s ${GREEN}✓ Running as root${NC}\n" "Privileges:"
        ((PASSED++))
    else
        printf "%-30s ${YELLOW}⚠ Not running as root${NC}\n" "Privileges:"
        printf "    Note: Some operations (systemd, network config) require sudo\n"
        ((WARNINGS++))
    fi
}

# Check if systemd is available
check_systemd() {
    if systemctl --version &> /dev/null; then
        local version=$(systemctl --version | head -n1)
        printf "%-30s ${GREEN}✓ AVAILABLE${NC}\n" "systemd:"
        printf "    Version: %s\n" "$version"
        ((PASSED++))
    else
        printf "%-30s ${RED}✗ NOT FOUND${NC}\n" "systemd:"
        printf "    Note: nPanel requires systemd for service management\n"
        ((FAILED++))
    fi
}

# Check cgroups v2 support (for cgroups_isolation feature)
check_cgroups_v2() {
    if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
        printf "%-30s ${GREEN}✓ SUPPORTED${NC}\n" "cgroups v2:"
        local controllers=$(cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null)
        printf "    Controllers: %s\n" "$controllers"
        ((PASSED++))
    else
        printf "%-30s ${YELLOW}⚠ NOT AVAILABLE${NC}\n" "cgroups v2:"
        printf "    Note: cgroups_isolation feature will be disabled\n"
        ((WARNINGS++))
    fi
}

# Check disk space
check_disk_space() {
    local available=$(df /opt/npanel 2>/dev/null | tail -1 | awk '{print $4}')
    if [[ -z "$available" ]]; then
        available=$(df / | tail -1 | awk '{print $4}')
    fi
    
    # Convert to GB
    local available_gb=$((available / 1024 / 1024))
    
    printf "%-30s Available: %d GB\n" "Disk Space:" "$available_gb"
    
    if [[ "$available_gb" -ge 10 ]]; then
        printf "    Status: ${GREEN}✓ Sufficient (≥10 GB)${NC}\n"
        ((PASSED++))
    else
        printf "    Status: ${YELLOW}⚠ Low (${available_gb} GB < 10 GB)${NC}\n"
        ((WARNINGS++))
    fi
}

# Check memory
check_memory() {
    local mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_gb=$((mem_kb / 1024 / 1024))
    
    printf "%-30s Total: %d GB\n" "Memory:"
    
    if [[ "$mem_gb" -ge 4 ]]; then
        printf "    Status: ${GREEN}✓ Sufficient (≥4 GB)${NC}\n"
        ((PASSED++))
    else
        printf "    Status: ${YELLOW}⚠ Low (${mem_gb} GB < 4 GB)${NC}\n"
        ((WARNINGS++))
    fi
}

# Check network connectivity
check_network() {
    if ping -c 1 -W 2 8.8.8.8 &> /dev/null; then
        printf "%-30s ${GREEN}✓ CONNECTED${NC}\n" "Network:"
        ((PASSED++))
    else
        printf "%-30s ${YELLOW}⚠ NO INTERNET${NC}\n" "Network:"
        printf "    Note: Internet needed for package installation\n"
        ((WARNINGS++))
    fi
}

# ==================== MAIN CHECKS ====================

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}nPanel Phase 5 - Pre-Deployment Validation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

detect_distro

echo -e "${BLUE}System Information:${NC}"
printf "  Distribution: %s %s\n" "$DISTRO" "$DISTRO_VERSION"
printf "  Kernel: %s\n" "$(uname -r)"
echo ""

# ==================== CORE REQUIREMENTS ====================
echo -e "${BLUE}Core Requirements:${NC}"
check_go_version
check_node_version
check_command "git" "" "sudo apt-get install -y git"
check_command "sqlite3" "" "sudo apt-get install -y sqlite3"
echo ""

# ==================== SYSTEM REQUIREMENTS ====================
echo -e "${BLUE}System Requirements:${NC}"
check_systemd
check_privileges
check_cgroups_v2
echo ""

# ==================== RESOURCE CHECKS ====================
echo -e "${BLUE}Resource Checks:${NC}"
check_memory
check_disk_space
check_network
echo ""

# ==================== BASELINE MEASUREMENT DEPENDENCIES ====================
echo -e "${BLUE}Baseline Measurement (measure_baseline.sh):${NC}"
check_command "top" "" "sudo apt-get install -y procps"
check_command "free" "" "sudo apt-get install -y procps"
check_command "iostat" "" "sudo apt-get install -y sysstat"
check_command "ps" "" "sudo apt-get install -y procps"
check_command "curl" "" "sudo apt-get install -y curl"
check_command "bc" "" "sudo apt-get install -y bc"
echo ""

# ==================== SERVICE DEPENDENCIES ====================
echo -e "${BLUE}Optional Service Dependencies:${NC}"
check_command "exim4" "" "sudo apt-get install -y exim4"
check_command "pdns_server" "" "sudo apt-get install -y pdns-server"
check_command "systemctl" "" "systemd (built-in)"
check_command "prometheus" "" "sudo apt-get install -y prometheus"
check_command "rsync" "" "sudo apt-get install -y rsync"
echo ""

# ==================== DATABASE TOOLS ====================
echo -e "${BLUE}Database Tools:${NC}"
check_command "sqlite3" "" "sudo apt-get install -y sqlite3"
echo ""

# ==================== BUILD TOOLS ====================
echo -e "${BLUE}Build Tools:${NC}"
check_command "gcc" "" "sudo apt-get install -y build-essential"
check_command "make" "" "sudo apt-get install -y make"
check_command "npm" "" "sudo apt-get install -y npm"
echo ""

# ==================== SUMMARY ====================
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Pre-Deployment Validation Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

printf "%-20s %d\n" "${GREEN}✓ Passed:${NC}" "$PASSED"
printf "%-20s %d\n" "${RED}✗ Failed:${NC}" "$FAILED"
printf "%-20s %d\n" "${YELLOW}⚠ Warnings:${NC}" "$WARNINGS"
echo ""

# ==================== FINAL DECISION ====================
if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All critical requirements met!${NC}"
    echo ""
    echo -e "${BLUE}You can proceed with deployment:${NC}"
    echo "  1. Run: git pull origin main"
    echo "  2. Run: sqlite3 /opt/npanel/data/npanel.db < backend/migrations/005_cgroups_v2.sql"
    echo "  3. Continue with normal nPanel deployment"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Missing critical requirements!${NC}"
    echo ""
    echo -e "${BLUE}Installation commands by distribution:${NC}"
    echo ""
    
    case "$DISTRO" in
        ubuntu|debian)
            echo -e "${YELLOW}Ubuntu/Debian:${NC}"
            echo "  sudo apt-get update"
            echo "  sudo apt-get install -y golang-1.23 nodejs sqlite3 git"
            echo "  sudo apt-get install -y procps sysstat curl bc"
            echo "  sudo apt-get install -y exim4 rsync"
            ;;
        centos|rhel)
            echo -e "${YELLOW}CentOS/RHEL:${NC}"
            echo "  sudo dnf install -y golang nodejs sqlite git"
            echo "  sudo dnf install -y procps-ng sysstat curl bc"
            echo "  sudo dnf install -y exim rsync"
            ;;
        fedora)
            echo -e "${YELLOW}Fedora:${NC}"
            echo "  sudo dnf install -y golang nodejs sqlite git"
            echo "  sudo dnf install -y procps-ng sysstat curl bc"
            echo "  sudo dnf install -y exim rsync"
            ;;
        alpine)
            echo -e "${YELLOW}Alpine Linux:${NC}"
            echo "  apk add go nodejs sqlite git"
            echo "  apk add procps sysstat curl bc"
            echo "  apk add exim rsync"
            ;;
        arch)
            echo -e "${YELLOW}Arch Linux:${NC}"
            echo "  pacman -S go nodejs sqlite git"
            echo "  pacman -S procps sysstat curl bc"
            echo "  pacman -S exim rsync"
            ;;
        *)
            echo -e "${YELLOW}Unknown Distribution${NC}"
            echo "  Please install packages manually"
            ;;
    esac
    
    echo ""
    echo "After installing missing packages, run this script again."
    echo ""
    exit 1
fi
