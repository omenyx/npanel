#!/usr/bin/env bash

set -euo pipefail

# Debug mode for verbose output
DEBUG="${DEBUG:-0}"

log() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
err() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }
die() { err "$*"; exit 1; }
debug() { [[ "$DEBUG" -eq 1 ]] && echo -e "\033[1;36m[DEBUG]\033[0m $*" || true; }

NPANEL_DIR="${NPANEL_DIR:-/opt/npanel}"
NPANEL_BRANCH="${NPANEL_BRANCH:-main}"
NPANEL_REF="${NPANEL_REF:-}"
REPO_URL="${REPO_URL:-https://github.com/omenyx/npanel.git}"
INSTALLER_URL="${INSTALLER_URL:-https://raw.githubusercontent.com/omenyx/npanel/main/install_npanel.sh}"

MODE="install"
SKIP_DEPS=0
SKIP_SELF_UPDATE="${NPANEL_SKIP_SELF_UPDATE:-0}"
NO_REBUILD=0
NO_RESTART=0
VERBOSE=0
LOCKFILE="/var/lock/npanel-install.lock"
LOCK_ACQUIRED=0

OS_ID=""
OS_VERSION_ID=""
PKG_MGR=""

CMD_USERADD=""
CMD_USERDEL=""
CMD_NGINX=""
CMD_PHP_FPM=""
CMD_MYSQL=""
CMD_RSYNC=""
CMD_RNDC=""
CMD_EXIM=""
CMD_DOVECOT=""

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root (use sudo)."
  fi
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local name="$1"
  local hint="$2"
  if ! check_cmd "$name"; then
    die "Missing required command: $name. $hint"
  fi
}

validate_url_host() {
  local url="$1"
  [[ "$url" =~ ^https:// ]] || return 1
  local host
  host="$(echo "$url" | awk -F/ '{print $3}')"
  case "$host" in
    raw.githubusercontent.com|github.com) return 0 ;;
    *) return 1 ;;
  esac
}

self_update() {
  if [[ "$SKIP_SELF_UPDATE" == "1" ]]; then
    return
  fi
  if ! validate_url_host "$INSTALLER_URL"; then
    die "INSTALLER_URL must be https://raw.githubusercontent.com/... or https://github.com/..."
  fi
  require_cmd curl "Install curl for your distro and rerun."

  local tmp="/tmp/npanel-installer.$$.sh"
  if ! curl -fsSL "$INSTALLER_URL" -o "$tmp"; then
    log "Unable to self-update from $INSTALLER_URL (continuing with current installer)."
    return
  fi
  chmod +x "$tmp" || true
  if [[ -f "$0" ]] && cmp -s "$tmp" "$0"; then
    rm -f "$tmp" || true
    return
  fi
  log "Updating installer from GitHub and restarting..."
  NPANEL_SKIP_SELF_UPDATE=1 exec "$tmp" "$@"
}

# Acquire exclusive installer lock (prevents concurrent runs)
acquire_lock() {
  # Prefer flock if available; fallback to mkdir-based lock
  if command -v flock >/dev/null 2>&1; then
    exec 9>"${LOCKFILE}"
    if ! flock -n 9; then
      die "Another Npanel install/update is already running (lock: ${LOCKFILE})."
    fi
    LOCK_ACQUIRED=1
  else
    if mkdir "${LOCKFILE}.d" 2>/dev/null; then
      LOCK_ACQUIRED=1
    else
      die "Another Npanel install/update is already running (lock dir: ${LOCKFILE}.d)."
    fi
  fi
}

# Always release lock on exit (success or failure)
release_lock() {
  if [[ "${LOCK_ACQUIRED}" -eq 1 ]]; then
    if command -v flock >/dev/null 2>&1; then
      rm -f "${LOCKFILE}" || true
    else
      rmdir "${LOCKFILE}.d" 2>/dev/null || true
    fi
    LOCK_ACQUIRED=0
  fi
}

trap 'release_lock' EXIT

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    die "Cannot determine OS (missing /etc/os-release)."
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION_ID="${VERSION_ID:-}"

  if check_cmd apt-get; then
    PKG_MGR="apt"
  elif check_cmd dnf; then
    PKG_MGR="dnf"
  elif check_cmd yum; then
    PKG_MGR="yum"
  elif check_cmd pacman; then
    PKG_MGR="pacman"
  elif check_cmd zypper; then
    PKG_MGR="zypper"
  else
    die "Unsupported distro (no known package manager found)."
  fi

  log "Detected OS: ${OS_ID}${OS_VERSION_ID:+ $OS_VERSION_ID} (pkg: $PKG_MGR)"
}

pkg_update() {
  case "$PKG_MGR" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get update -y ;;
    dnf) dnf -y makecache ;;
    yum) yum -y makecache ;;
    pacman) pacman -Sy --noconfirm ;;
    zypper) zypper --non-interactive refresh ;;
    *) return 0 ;;
  esac
}

pkg_install() {
  local -a pkgs=("$@")
  case "$PKG_MGR" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}" ;;
    dnf) dnf -y install "${pkgs[@]}" ;;
    yum) yum -y install "${pkgs[@]}" ;;
    pacman) pacman -S --noconfirm --needed "${pkgs[@]}" ;;
    zypper) zypper --non-interactive install -y "${pkgs[@]}" ;;
    *) die "Unsupported package manager: $PKG_MGR" ;;
  esac
}

ensure_nodesource_20() {
  if check_cmd node; then
    local v; v="$(node -v || true)"
    if [[ "$v" =~ ^v20\. ]]; then
      log "Node.js $v already installed"
      return
    fi
  fi

  case "$PKG_MGR" in
    apt)
      require_cmd curl "Install curl and rerun."
      pkg_install ca-certificates gnupg
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      pkg_install nodejs
      ;;
    dnf|yum)
      require_cmd curl "Install curl and rerun."
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      pkg_install nodejs
      ;;
    pacman)
      pkg_install nodejs npm
      ;;
    zypper)
      if pkg_install nodejs20 npm 2>/dev/null; then
        :
      else
        pkg_install nodejs npm
      fi
      ;;
    *)
      die "Cannot install Node.js on this distro."
      ;;
  esac

  local v2; v2="$(node -v || true)"
  [[ "$v2" =~ ^v20\. ]] || die "Node.js 20 is required, found: ${v2:-missing}"
}

install_dependencies() {
  pkg_update
  case "$PKG_MGR" in
    apt)
      log "Installing dependencies for Debian/Ubuntu system"
      pkg_install curl ca-certificates lsb-release gnupg software-properties-common
      if [[ "$OS_ID" == "ubuntu" ]]; then
        log "Adding Ondrej PHP PPA for Ubuntu"
        LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php || true
        pkg_update
      elif [[ "$OS_ID" == "debian" ]]; then
        log "Using Debian default PHP packages"
      fi
      ensure_nodesource_20
      pkg_install lsof git rsync openssh-client build-essential openssl
      # Debian/Ubuntu uses exim4 and specific package versions
      log "Installing mail services (Exim and Dovecot)"
      pkg_install nginx mysql-server exim4 pure-ftpd bind9 || true
      pkg_install dovecot-core dovecot-imapd || log "Warning: Dovecot installation failed"
      pkg_install php8.2-fpm php8.2-mysql php8.2-mbstring php8.2-xml php8.2-intl php8.2-zip php8.2-gd || true
      pkg_install pdns-server pdns-backend-mysql || true
      ;;
    dnf)
      # RHEL-based systems (AlmaLinux, Rocky, RHEL, CentOS Stream)
      log "Installing dependencies for RHEL 9+ system ($OS_ID)"
      pkg_install curl ca-certificates git rsync openssh-clients lsof openssl gcc g++ make
      # Enable PowerTools/CRB repository for EPEL dependencies
      if [[ "$OS_ID" == "almalinux" ]] || [[ "$OS_ID" == "rocky" ]] || [[ "$OS_ID" == "rhel" ]]; then
        log "Enabling CRB repository for RHEL 9+ compatibility"
        dnf config-manager --set-enabled crb 2>/dev/null || dnf config-manager --set-enabled powertools 2>/dev/null || true
      fi
      # Install EPEL repository
      log "Installing EPEL repository"
      pkg_install epel-release || true
      pkg_update
      # Install web server, database, and mail services
      log "Installing web server and hosting services"
      pkg_install nginx || log "Warning: nginx installation failed"
      pkg_install mariadb-server mariadb || log "Warning: mariadb installation failed"
      pkg_install php-fpm php-mysqlnd php-mbstring php-xml php-intl php-zip php-gd || log "Warning: PHP installation failed"
      # Install mail services separately for better error handling
      # RHEL systems use 'exim' not 'exim4'
      log "Installing Exim mail server"
      pkg_install exim || log "Warning: Exim installation failed"
      log "Installing Dovecot IMAP services"
      pkg_install dovecot || log "Warning: Dovecot installation failed"
      # Install DNS utilities and server
      log "Installing DNS services"
      pkg_install bind-utils bind || log "Warning: BIND installation failed"
      # Install FTP server
      log "Installing FTP server"
      pkg_install pure-ftpd || log "Warning: pure-ftpd installation failed"
      # Install PowerDNS
      log "Installing PowerDNS"
      pkg_install pdns pdns-backend-mysql || log "Warning: PowerDNS installation failed"
      ensure_nodesource_20
      ;;
    yum)
      # Older yum-based systems (CentOS 7, RHEL 7, etc.)
      log "Installing dependencies for older RHEL system ($OS_ID)"
      pkg_install curl ca-certificates git rsync openssh-clients lsof openssl gcc gcc-c++
      # Older systems may have different package names
      pkg_install nginx mariadb-server || log "Warning: nginx/mariadb installation failed"
      pkg_install php-fpm php-mysqlnd php-mbstring php-xml php-intl php-zip php-gd || log "Warning: PHP installation failed"
      log "Installing mail services (Exim and Dovecot)"
      pkg_install exim || log "Warning: Exim installation failed"
      pkg_install dovecot || log "Warning: Dovecot installation failed"
      pkg_install bind-utils bind || log "Warning: BIND installation failed"
      pkg_install pure-ftpd || log "Warning: pure-ftpd installation failed"
      ensure_nodesource_20
      ;;
    pacman)
      log "Installing dependencies for Arch Linux system"
      pkg_install curl ca-certificates git rsync openssh lsof base-devel openssl
      # Arch uses different package names
      pkg_install nginx mariadb php php-fpm php-gd php-intl php-mbstring php-xml php-zip dovecot exim pure-ftpd || true
      ensure_nodesource_20
      ;;
    zypper)
      log "Installing dependencies for SUSE/openSUSE system"
      pkg_install curl ca-certificates git rsync openssh lsof openssl
      # SUSE uses php8 prefix for versioned packages
      pkg_install nginx mariadb mariadb-tools php-fpm php8-mysql php8-mbstring php8-xmlreader php8-intl php8-zip php8-gd exim dovecot pure-ftpd || true
      ensure_nodesource_20
      ;;
    *)
      die "Unsupported package manager: $PKG_MGR"
      ;;
  esac
}

# Track failed services
FAILED_SERVICES=()

# Try to start a service without tracking it as a failure if it doesn't exist
svc_optional() {
  local action="$1"
  local name="$2"
  
  # Check if service exists before trying to start it
  if check_cmd systemctl; then
    if systemctl list-unit-files 2>/dev/null | grep -q "^${name}\.service"; then
      systemctl "$action" "$name" 2>/dev/null || true
    fi
  else
    service "$name" "$action" 2>/dev/null || true
  fi
  return 0
}

svc() {
  local action="$1"
  local name="$2"
  local retval=0
  
  # Check if service exists before trying to start it
  if check_cmd systemctl; then
    if ! systemctl list-unit-files 2>/dev/null | grep -q "^${name}\.service"; then
      # Service doesn't exist, don't try to start it
      return 0
    fi
    if ! systemctl "$action" "$name" 2>/dev/null; then
      retval=1
    fi
  else
    # Can't check reliably without systemctl, just try
    if ! service "$name" "$action" 2>/dev/null; then
      retval=1
    fi
  fi
  
  if [[ $retval -ne 0 && "$action" == "start" ]]; then
    FAILED_SERVICES+=("$name")
  fi
  return $retval
}

port_listening() {
  local port="$1"
  if check_cmd netstat; then
    netstat -tln 2>/dev/null | grep -q ":$port " && return 0
  fi
  if check_cmd ss; then
    ss -tln 2>/dev/null | grep -q ":$port " && return 0
  fi
  if check_cmd lsof; then
    lsof -i ":$port" >/dev/null 2>&1 && return 0
  fi
  return 1
}

ensure_services_start() {
  log "Starting services for $OS_ID ($PKG_MGR)..."
  FAILED_SERVICES=()
  
  # Database services - try to start at least one
  log "Starting database services..."
  local db_started=0
  
  # Check which database service is installed and available
  if systemctl list-unit-files 2>/dev/null | grep -q mariadb.service; then
    # MariaDB is available
    if svc start mariadb; then
      log "✓ MariaDB started"
      db_started=1
    else
      log "✗ MariaDB failed to start"
    fi
  elif systemctl list-unit-files 2>/dev/null | grep -q mysql.service; then
    # MySQL is available (but not MariaDB)
    if svc start mysql; then
      log "✓ MySQL started"
      db_started=1
    else
      log "✗ MySQL failed to start"
    fi
  else
    # Try both and see what works
    if svc start mariadb; then
      log "✓ MariaDB started"
      db_started=1
    fi
    if [[ $db_started -eq 0 ]] && svc start mysql; then
      log "✓ MySQL started"
      db_started=1
    fi
  fi
  
  if [[ $db_started -eq 0 ]]; then
    log "⚠ Warning: No database service (MySQL/MariaDB) could be started"
    log "  Try: sudo systemctl start mariadb  OR  sudo systemctl start mysql"
  fi
  
  # Web server
  log "Starting nginx web server..."
  if svc start nginx; then
    log "✓ Nginx started"
  else
    err "✗ Nginx failed to start - checking config"
    if check_cmd nginx; then
      nginx -t 2>&1 | grep -i "error" && err "Nginx config error detected"
    fi
  fi
  
  # PHP-FPM with different version names across distros
  log "Starting PHP-FPM services..."
  case "$PKG_MGR" in
    dnf|yum)
      svc start php-fpm && log "✓ PHP-FPM started"
      svc_optional start php8.2-fpm
      svc_optional start php8.1-fpm
      svc_optional start php8.0-fpm
      ;;
    apt)
      svc start php-fpm && log "✓ PHP-FPM started"
      svc_optional start php8.2-fpm
      svc_optional start php8.1-fpm
      svc_optional start php8.0-fpm
      ;;
    pacman)
      svc start php-fpm && log "✓ PHP-FPM started" || log "Note: PHP-FPM not available"
      ;;
    zypper)
      svc start php-fpm && log "✓ PHP-FPM started" || log "Note: PHP-FPM not available"
      ;;
  esac
  
  # Mail services
  log "Starting mail services (Exim)..."
  case "$PKG_MGR" in
    apt)
      if svc start exim4; then
        log "✓ Exim4 started"
      else
        log "✗ Exim4 failed to start"
      fi
      ;;
    dnf|yum|pacman|zypper)
      if svc start exim; then
        log "✓ Exim started"
      else
        log "✗ Exim failed to start"
      fi
      ;;
  esac
  
  # IMAP services
  log "Starting Dovecot IMAP server..."
  if svc start dovecot; then
    log "✓ Dovecot started"
  else
    log "✗ Dovecot failed to start"
  fi
  
  # FTP services
  log "Starting FTP services..."
  if svc start pure-ftpd; then
    log "✓ Pure-FTPd started"
  else
    log "✗ Pure-FTPd failed to start"
  fi
  svc_optional start pure-ftpd-mysql
  
  # DNS services
  log "Starting DNS services..."
  if check_cmd pdns_server || [[ -x /usr/sbin/pdns_server ]]; then
    svc stop bind9 2>/dev/null || true
    svc stop named 2>/dev/null || true
    if svc start pdns; then
      log "✓ PowerDNS started"
    else
      log "✗ PowerDNS failed to start"
    fi
  else
    if svc start named; then
      log "✓ BIND (named) started"
    elif svc start bind9; then
      log "✓ BIND9 started"
    else
      log "✗ DNS services (BIND/named) failed to start"
    fi
  fi
}

verify_all_services() {
  log "Verifying all services are running..."
  local services_ok=1
  
  # Check nginx
  if port_listening 8080; then
    log "✓ Nginx listening on port 8080"
  else
    err "✗ Nginx NOT listening on port 8080"
    diagnose_nginx
    services_ok=0
  fi
  
  # Check backend
  if port_listening 3000; then
    log "✓ Backend listening on port 3000"
  else
    err "✗ Backend NOT listening on port 3000"
    services_ok=0
  fi
  
  # Check frontend
  if port_listening 3001; then
    log "✓ Frontend listening on port 3001"
  else
    err "✗ Frontend NOT listening on port 3001"
    services_ok=0
  fi
  
  # Check MySQL/MariaDB
  if port_listening 3306; then
    log "✓ MySQL/MariaDB listening on port 3306"
  else
    log "Note: MySQL/MariaDB not listening (may be offline)"
  fi
  
  # Check DNS
  if port_listening 53; then
    log "✓ DNS service listening on port 53"
  else
    log "Note: DNS service not listening (may be offline)"
  fi
  
  if [[ ${#FAILED_SERVICES[@]} -gt 0 ]]; then
    # Filter out non-critical failures
    local critical_failures=()
    for svc in "${FAILED_SERVICES[@]}"; do
      case "$svc" in
        # Services that are optional/version-specific - don't report
        mysql|php8.2-fpm|php8.1-fpm|php8.0-fpm|pure-ftpd-mysql|pdns) ;;
        # Critical services that should be reported if they fail
        *) critical_failures+=("$svc") ;;
      esac
    done
    
    if [[ ${#critical_failures[@]} -gt 0 ]]; then
      err ""
      err "============ SERVICE STARTUP SUMMARY ============"
      err "Failed to start: ${critical_failures[*]}"
      err "================================================"
      err ""
    fi
  fi
  
  if [[ $services_ok -eq 0 ]]; then
    err "Critical services are not running. Troubleshooting:"
    err "  1. Check systemctl status: systemctl status npanel-backend npanel-frontend"
    err "  2. Check logs: journalctl -u npanel-backend -n 50"
    err "  3. Check nginx config: nginx -t"
    err "  4. Manually start services: systemctl restart nginx npanel-backend npanel-frontend"
    return 1
  fi
  
  log "✓ All critical services verified and running!"
  return 0
}

diagnose_nginx() {
  log ""
  log "=== NGINX DIAGNOSTIC REPORT ==="
  
  # Check if nginx is installed
  if ! check_cmd nginx; then
    err "✗ Nginx is NOT installed!"
    log ""
    log "To install nginx:"
    case "${PKG_MGR:-}" in
      apt) log "  sudo apt-get install -y nginx" ;;
      dnf|yum) log "  sudo dnf install -y nginx" ;;
      pacman) log "  sudo pacman -S nginx" ;;
      zypper) log "  sudo zypper install -y nginx" ;;
      *) log "  Use your distro package manager to install: nginx" ;;
    esac
    return 1
  fi
  log "✓ Nginx is installed"
  
  # Check nginx config syntax
  log ""
  log "Checking nginx config syntax..."
  local nginx_test_output
  nginx_test_output=$(nginx -t 2>&1)
  if echo "$nginx_test_output" | grep -q "successful"; then
    log "✓ Nginx config is valid"
  else
    err "✗ Nginx config has errors:"
    echo "$nginx_test_output" | while IFS= read -r line; do
      err "  $line"
    done
    return 1
  fi
  
  # Check if nginx process is running
  log ""
  log "Checking nginx process..."
  if systemctl is-active --quiet nginx 2>/dev/null; then
    log "✓ Nginx service is running (systemd)"
  elif pgrep -x nginx >/dev/null 2>&1; then
    log "✓ Nginx process is running (pgrep)"
  else
    err "✗ Nginx process is NOT running"
    log ""
    log "To start nginx:"
    log "  sudo systemctl start nginx"
    log "  Or: sudo service nginx start"
    log ""
    log "Check why nginx failed to start:"
    log "  sudo systemctl status nginx"
    log "  sudo journalctl -u nginx -n 30"
    return 1
  fi
  
  # Check port 8080
  log ""
  log "Checking port 8080..."
  if port_listening 8080; then
    log "✓ Port 8080 is listening"
  else
    err "✗ Port 8080 is NOT listening"
    
    # Check if port is in use by something else
    if check_cmd netstat; then
      local port_info
      port_info="$(netstat -tln 2>/dev/null | grep ':8080 ' || true)"
      if [[ -n "$port_info" ]]; then
        log "Port 8080 info: $port_info"
      fi
    fi
    if check_cmd lsof; then
      local lsof_info
      lsof_info="$(lsof -i :8080 2>/dev/null || true)"
      if [[ -n "$lsof_info" ]]; then
        log "Processes using port 8080: $lsof_info"
      fi
    fi
  fi
  
  # Check SELinux status
  log ""
  log "Checking SELinux status..."
  if check_cmd getenforce; then
    local selinux_status
    selinux_status="$(getenforce 2>/dev/null || echo 'unknown')"
    log "SELinux status: $selinux_status"
    
    if [[ "$selinux_status" == "Enforcing" ]]; then
      err "⚠ SELinux is ENFORCING - may be blocking nginx"
      log ""
      log "To check SELinux denials for nginx:"
      log "  sudo grep nginx /var/log/audit/audit.log | tail -20"
      log ""
      log "To allow nginx to bind to port 8080:"
      log "  sudo semanage port -a -t http_port_t -p tcp 8080"
      log ""
      log "To temporarily disable SELinux:"
      log "  sudo setenforce 0"
      log ""
    else
      log "✓ SELinux is not enforcing (or not present)"
    fi
  else
    log "✓ SELinux not installed"
  fi
  
  # Check AppArmor (Debian/Ubuntu)
  log ""
  log "Checking AppArmor status..."
  if check_cmd aa-status; then
    if aa-status 2>/dev/null | grep -q nginx; then
      log "⚠ AppArmor is loaded with nginx profile"
      log ""
      log "To check AppArmor denials for nginx:"
      log "  sudo grep nginx /var/log/syslog | grep DENIED | tail -20"
      log ""
    else
      log "✓ AppArmor not restricting nginx"
    fi
  else
    log "✓ AppArmor not installed"
  fi
  
  # Check nginx error logs
  log ""
  log "Recent nginx errors:"
  if [[ -f /var/log/nginx/error.log ]]; then
    tail -n 10 /var/log/nginx/error.log || true
  else
    log "Nginx error log not found at /var/log/nginx/error.log"
  fi
  
  # Check if nginx config exists
  log ""
  log "Checking nginx config file..."
  if [[ -f /etc/nginx/conf.d/npanel.conf ]]; then
    log "✓ Found /etc/nginx/conf.d/npanel.conf"
    log ""
    log "Config content:"
    head -n 20 /etc/nginx/conf.d/npanel.conf || true
  elif [[ -f /etc/nginx/sites-enabled/npanel.conf ]]; then
    log "✓ Found /etc/nginx/sites-enabled/npanel.conf"
    log ""
    log "Config content:"
    head -n 20 /etc/nginx/sites-enabled/npanel.conf || true
  else
    err "✗ No npanel nginx config found!"
    return 1
  fi
  
  # Check firewall
  log ""
  log "Checking firewall (UFW/firewalld)..."
  if check_cmd ufw; then
    if ufw status | grep -q "Status: active"; then
      log "⚠ UFW firewall is active"
      log ""
      log "Firewall rules:"
      ufw status || true
      log ""
      log "To allow port 8080 through UFW:"
      log "  sudo ufw allow 8080/tcp"
      log ""
    else
      log "✓ UFW is not active"
    fi
  fi
  
  if check_cmd firewall-cmd; then
    if firewall-cmd --state 2>/dev/null | grep -q "running"; then
      log "⚠ Firewalld is active"
      log ""
      log "To check firewalld rules:"
      log "  sudo firewall-cmd --list-all"
      log ""
      log "To allow port 8080 through firewalld:"
      log "  sudo firewall-cmd --permanent --add-port=8080/tcp"
      log "  sudo firewall-cmd --reload"
      log ""
    fi
  fi
  
  log "=== END NGINX DIAGNOSTIC REPORT ==="
  log ""
  return 0
}

validate_api_routing() {
  # Comprehensive API routing validation - called at multiple install stages
  # Returns 0 if validation passes, 1 if critical issues found
  
  local test_name="${1:-API Routing}"
  local endpoint="${2:-http://127.0.0.1:8080/v1/health}"
  local skip_if_services_down="${3:-0}"
  
  log "Validating $test_name..."
  
  # Check 1: Verify nginx is running and listening
  if ! check_cmd systemctl && ! check_cmd lsof; then
    warn "Cannot validate - systemctl/lsof not available"
    return 0
  fi
  
  if check_cmd systemctl; then
    if ! systemctl is-active nginx >/dev/null 2>&1; then
      if [[ "$skip_if_services_down" -eq 1 ]]; then
        warn "  ⊘ Nginx not running (services still starting)"
        return 0
      fi
      err "  ✗ Nginx is not running!"
      return 1
    fi
  fi
  
  # Check 2: Verify nginx configuration syntax
  if ! nginx -t >/dev/null 2>&1; then
    err "  ✗ Nginx configuration has syntax errors!"
    nginx -t 2>&1 | sed 's/^/    /'
    return 1
  fi
  log "  ✓ Nginx configuration syntax valid"
  
  # Check 3: Verify /v1 location block exists in nginx config
  if ! grep -r "location /v1" /etc/nginx/conf.d/ >/dev/null 2>&1 && \
     ! grep -r "location /v1" /etc/nginx/sites-enabled/ >/dev/null 2>&1; then
    err "  ✗ Nginx /v1 location block not found!"
    err "    Expected: grep 'location /v1' /etc/nginx/conf.d/npanel.conf"
    err "    Fix: Nginx configuration may be outdated or incorrectly deployed"
    return 1
  fi
  log "  ✓ Nginx /v1 location block found"
  
  # Check 4: Verify backend upstream is defined
  if ! grep -r "upstream npanel_backend" /etc/nginx/conf.d/ >/dev/null 2>&1 && \
     ! grep -r "upstream npanel_backend" /etc/nginx/sites-enabled/ >/dev/null 2>&1; then
    err "  ✗ Nginx backend upstream not configured!"
    return 1
  fi
  log "  ✓ Nginx backend upstream configured"
  
  # Check 5: Test actual API endpoint connectivity
  local response
  response=$(curl -fsS "$endpoint" 2>/dev/null || echo "")
  
  if [[ -n "$response" ]] && echo "$response" | grep -q "status"; then
    log "  ✓ API endpoint responding correctly"
    return 0
  fi
  
  # If we get here, endpoint didn't respond properly
  if [[ "$skip_if_services_down" -eq 1 ]]; then
    warn "  ⊘ API endpoint not responding yet (services still starting)"
    return 0
  fi
  
  err "  ✗ API endpoint not responding!"
  err "    Endpoint: $endpoint"
  err "    Response: $response"
  err "    Diagnostics:"
  err "    1. Check if backend is running: sudo systemctl status npanel-backend"
  err "    2. Check if frontend is running: sudo systemctl status npanel-frontend"
  err "    3. Verify nginx routing: sudo nginx -t && sudo systemctl reload nginx"
  err "    4. Test backend directly: curl http://127.0.0.1:3000/v1/health"
  return 1
}

mysql_exec() {
  if check_cmd mysql; then
    mysql -u root -e "$1"
  else
    die "mysql client not found"
  fi
}

setup_mysql() {
  log "Configuring MySQL/MariaDB"
  ensure_services_start
  
  # Give database service time to fully start
  log "Waiting for database service to be ready..."
  local retries=0
  local max_retries=30
  until mysql -u root -e "SELECT 1" >/dev/null 2>&1; do
    retries=$((retries+1))
    if [[ "$retries" -gt "$max_retries" ]]; then
      err "Database service did not become ready within $((max_retries*2)) seconds"
      err "Try: sudo systemctl restart mariadb"
      return 1
    fi
    sleep 2
  done
  log "✓ Database is ready"

  mysql_exec "CREATE DATABASE IF NOT EXISTS npanel;"
  
  # Generate secure random password for npanel user (32 hex chars = 16 bytes)
  local NPANEL_DB_PASS; NPANEL_DB_PASS="$(openssl rand -hex 16)"
  mysql_exec "CREATE USER IF NOT EXISTS 'npanel'@'localhost' IDENTIFIED BY '$NPANEL_DB_PASS';"
  mysql_exec "GRANT ALL PRIVILEGES ON npanel.* TO 'npanel'@'localhost'; FLUSH PRIVILEGES;"

  # Generate secure random password for root and pdns users (32 hex chars = 16 bytes)
  local DB_ROOT_PASS; DB_ROOT_PASS="$(openssl rand -hex 16)"
  if [[ -f "/root/.my.cnf" ]]; then
    log "MySQL root credentials already configured."
  else
    mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$DB_ROOT_PASS';" 2>/dev/null || true
    mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DB_ROOT_PASS';" 2>/dev/null || true
    cat > /root/.my.cnf <<EOF
[client]
user=root
password=$DB_ROOT_PASS
EOF
  fi

  mysql -e "CREATE DATABASE IF NOT EXISTS pdns;" || true
  # Use separately generated password for pdns user
  local PDNS_DB_PASS; PDNS_DB_PASS="$(openssl rand -hex 16)"
  mysql -e "CREATE USER IF NOT EXISTS 'pdns'@'localhost' IDENTIFIED BY '$PDNS_DB_PASS';" || true
  mysql -e "GRANT ALL PRIVILEGES ON pdns.* TO 'pdns'@'localhost'; FLUSH PRIVILEGES;" || true
  configure_powerdns "$PDNS_DB_PASS"
}

configure_powerdns() {
  local db_pass="$1"
  if !(check_cmd pdns_server || [[ -x /usr/sbin/pdns_server ]]); then
    return
  fi
  if [[ ! -d /etc/powerdns/pdns.d ]]; then
    return
  fi

  if [[ ! -f /etc/powerdns/pdns.d/local-address.conf ]]; then
    echo "local-address=127.0.0.1" > /etc/powerdns/pdns.d/local-address.conf
  fi

  cat > /etc/powerdns/pdns.d/pdns.local.gmysql.conf <<EOF
launch=gmysql
gmysql-host=127.0.0.1
gmysql-port=3306
gmysql-dbname=pdns
gmysql-user=pdns
gmysql-password=$db_pass
gmysql-dnssec=yes
EOF

  if id -u pdns >/dev/null 2>&1; then
    chown pdns:pdns /etc/powerdns/pdns.d/pdns.local.gmysql.conf || true
    chmod 640 /etc/powerdns/pdns.d/pdns.local.gmysql.conf || true
  fi

  if ! mysql -D pdns -e "DESCRIBE records;" >/dev/null 2>&1; then
    mysql -D pdns <<'EOF'
CREATE TABLE IF NOT EXISTS domains (
  id                    INT AUTO_INCREMENT,
  name                  VARCHAR(255) NOT NULL,
  master                VARCHAR(128) DEFAULT NULL,
  last_check            INT DEFAULT NULL,
  type                  VARCHAR(6) NOT NULL,
  notified_serial       INT DEFAULT NULL,
  account               VARCHAR(40) DEFAULT NULL,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE UNIQUE INDEX name_index ON domains(name);

CREATE TABLE IF NOT EXISTS records (
  id                    BIGINT AUTO_INCREMENT,
  domain_id             INT DEFAULT NULL,
  name                  VARCHAR(255) DEFAULT NULL,
  type                  VARCHAR(10) DEFAULT NULL,
  content               TEXT DEFAULT NULL,
  ttl                   INT DEFAULT NULL,
  prio                  INT DEFAULT NULL,
  change_date           INT DEFAULT NULL,
  disabled              TINYINT(1) DEFAULT 0,
  ordername             VARCHAR(255) BINARY DEFAULT NULL,
  auth                  TINYINT(1) DEFAULT 1,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX nametype_index ON records(name,type);
CREATE INDEX domain_id ON records(domain_id);
CREATE INDEX recordorder ON records (domain_id, ordername);

CREATE TABLE IF NOT EXISTS supermasters (
  ip                    VARCHAR(64) NOT NULL,
  nameserver            VARCHAR(255) NOT NULL,
  account               VARCHAR(40) NOT NULL,
  PRIMARY KEY (ip, nameserver)
) Engine=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  id                    INT AUTO_INCREMENT,
  domain_id             INT NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  type                  VARCHAR(10) NOT NULL,
  modified_at           INT NOT NULL,
  account               VARCHAR(40) DEFAULT NULL,
  comment               TEXT NOT NULL,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX comments_name_type_idx ON comments (name, type);
CREATE INDEX comments_order_idx ON comments (domain_id, modified_at);

CREATE TABLE IF NOT EXISTS domainmetadata (
  id                    INT AUTO_INCREMENT,
  domain_id             INT NOT NULL,
  kind                  VARCHAR(32),
  content               TEXT,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX domainmetadata_idx ON domainmetadata (domain_id, kind);

CREATE TABLE IF NOT EXISTS cryptokeys (
  id                    INT AUTO_INCREMENT,
  domain_id             INT NOT NULL,
  flags                 INT NOT NULL,
  active                TINYINT(1),
  content               TEXT,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX domainidindex ON cryptokeys(domain_id);

CREATE TABLE IF NOT EXISTS tsigkeys (
  id                    INT AUTO_INCREMENT,
  name                  VARCHAR(255),
  algorithm             VARCHAR(50),
  secret                VARCHAR(255),
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE UNIQUE INDEX namealgoindex ON tsigkeys(name, algorithm);
EOF
  fi

  svc restart pdns
}

check_local_changes() {
  local dest="$1"
  
  # Check for uncommitted changes
  if [[ ! -d "$dest/.git" ]]; then
    return
  fi
  
  cd "$dest" || return
  
  # Git status checks
  local unstaged=$(git status --short 2>/dev/null | grep -v "^??" | wc -l)
  local untracked=$(git status --short 2>/dev/null | grep "^??" | wc -l)
  
  if [[ $unstaged -gt 0 ]]; then
    warn "⚠️  WARNING: Uncommitted changes detected in $dest"
    warn ""
    warn "Modified files (would be lost on update):"
    git status --short 2>/dev/null | grep -v "^??" | sed 's/^/  /'
    warn ""
    
    if [[ -z "$FORCE_UPDATE" ]]; then
      warn "To proceed anyway, run with: FORCE_UPDATE=1 $0"
      die "Cannot update with uncommitted changes. Stash or commit changes first."
    else
      warn "FORCE_UPDATE=1 detected - proceeding anyway (changes will be lost)"
      warn "Stashing local changes..."
      git stash push -m "auto-stash-$(date +%s)" || true
    fi
  fi
}

ensure_repo() {
  local dest="$NPANEL_DIR"
  
  # Check for local changes before updating
  if [[ -d "$dest/.git" ]]; then
    check_local_changes "$dest"
  fi

  if [[ -d "$dest/.git" ]]; then
    git config --global --add safe.directory "$dest" || true
    cd "$dest"
    local prev_commit target_commit
    prev_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    log "Current code version: ${prev_commit}"
    log "Fetching origin..."
    git fetch --tags origin
    if [[ -n "$NPANEL_REF" ]]; then
      git checkout -f "$NPANEL_REF"
    else
      git checkout -f "$NPANEL_BRANCH"
      git reset --hard "origin/$NPANEL_BRANCH"
    fi
    git clean -fd
    target_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    log "Target code version:  ${target_commit}"
    export NPANEL_PREV_COMMIT="$prev_commit"
    export NPANEL_TARGET_COMMIT="$target_commit"
    return
  fi

  if [[ -d "$dest" && -n "$(ls -A "$dest" 2>/dev/null || true)" ]]; then
    mv "$dest" "$dest.bak.$(date +%s)"
  fi
  mkdir -p "$(dirname "$dest")"
  git clone --depth=1 --branch "$NPANEL_BRANCH" "$REPO_URL" "$dest"
}

resolve_tool_cmds() {
  CMD_USERADD="$(command -v useradd || true)"
  CMD_USERDEL="$(command -v userdel || true)"
  CMD_NGINX="$(command -v nginx || true)"
  CMD_MYSQL="$(command -v mysql || true)"
  CMD_RSYNC="$(command -v rsync || true)"
  CMD_RNDC="$(command -v rndc || true)"
  CMD_DOVECOT="$(command -v dovecot || true)"
  CMD_NPM="$(command -v npm || true)"

  # Exim command varies by distro
  if check_cmd exim; then
    CMD_EXIM="$(command -v exim)"
  elif check_cmd exim4; then
    CMD_EXIM="$(command -v exim4)"
  else
    CMD_EXIM=""
  fi

  # Find PHP-FPM across different distros and versions
  if check_cmd php-fpm8.2; then
    CMD_PHP_FPM="$(command -v php-fpm8.2)"
  elif check_cmd php-fpm8.3; then
    CMD_PHP_FPM="$(command -v php-fpm8.3)"
  elif check_cmd php-fpm8.1; then
    CMD_PHP_FPM="$(command -v php-fpm8.1)"
  elif check_cmd php-fpm8.0; then
    CMD_PHP_FPM="$(command -v php-fpm8.0)"
  elif check_cmd php-fpm; then
    CMD_PHP_FPM="$(command -v php-fpm)"
  elif [[ -x /usr/sbin/php-fpm ]]; then
    CMD_PHP_FPM="/usr/sbin/php-fpm"
  else
    CMD_PHP_FPM=""
  fi
}

generate_jwt_secret() {
  openssl rand -hex 32
}

write_env() {
  local dest="$NPANEL_DIR/backend/.env"
  if [[ -f "$dest" ]]; then
    return
  fi
  
  # Ensure data directory exists for SQLite database
  mkdir -p "$NPANEL_DIR/data"
  
  resolve_tool_cmds
  local jwt; jwt="$(generate_jwt_secret)"
  local root_pass; root_pass="$(openssl rand -hex 16)" # 32-char random hex string
  
  log "Generated secure root password for this installation"
  
  cat > "$dest" <<EOF
NODE_ENV=production
PORT=3000
JWT_SECRET=$jwt
DATABASE_PATH=$NPANEL_DIR/data/npanel.sqlite
NPANEL_ROOT_PASSWORD=$root_pass
NPANEL_HOSTING_DRY_RUN=0
NPANEL_FIXED_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NPANEL_ALLOWED_RESTART_SERVICES=
NPANEL_USERADD_CMD=${CMD_USERADD:-/usr/sbin/useradd}
NPANEL_USERDEL_CMD=${CMD_USERDEL:-/usr/sbin/userdel}
NPANEL_NGINX_CMD=${CMD_NGINX:-/usr/sbin/nginx}
NPANEL_PHP_FPM_CMD=${CMD_PHP_FPM:-}
NPANEL_MYSQL_CMD=${CMD_MYSQL:-/usr/bin/mysql}
NPANEL_RSYNC_CMD=${CMD_RSYNC:-/usr/bin/rsync}
NPANEL_BIND_RNDC_CMD=${CMD_RNDC:-/usr/sbin/rndc}
NPANEL_EXIM_CMD=${CMD_EXIM:-/usr/sbin/exim}
NPANEL_DOVECOT_CMD=${CMD_DOVECOT:-/usr/sbin/dovecot}
NPANEL_FTP_CMD=/usr/local/bin/npanel-ftp
NPANEL_MAIL_CMD=/usr/local/bin/npanel-mail
EOF
}

ensure_env_defaults() {
  local dest="$NPANEL_DIR/backend/.env"
  if [[ ! -f "$dest" ]]; then
    return
  fi
  
  # Ensure NPANEL_ROOT_PASSWORD is set
  if ! grep -qE '^NPANEL_ROOT_PASSWORD=' "$dest"; then
    local root_pass; root_pass="$(openssl rand -hex 16)"
    echo "NPANEL_ROOT_PASSWORD=$root_pass" >> "$dest"
    log "Added NPANEL_ROOT_PASSWORD to .env"
  fi
  
  # Ensure FTP command is set
  if ! grep -qE '^NPANEL_FTP_CMD=' "$dest"; then
    echo "NPANEL_FTP_CMD=/usr/local/bin/npanel-ftp" >> "$dest"
  else
    sed -i 's|^NPANEL_FTP_CMD=$|NPANEL_FTP_CMD=/usr/local/bin/npanel-ftp|' "$dest" || true
  fi
  
  # Ensure MAIL command is set
  if ! grep -qE '^NPANEL_MAIL_CMD=' "$dest"; then
    echo "NPANEL_MAIL_CMD=/usr/local/bin/npanel-mail" >> "$dest"
  else
    sed -i 's|^NPANEL_MAIL_CMD=$|NPANEL_MAIL_CMD=/usr/local/bin/npanel-mail|' "$dest" || true
  fi
}

install_management_scripts() {
  local src_ftp="$NPANEL_DIR/backend/scripts/npanel-ftp"
  local src_mail="$NPANEL_DIR/backend/scripts/npanel-mail"
  if [[ -f "$src_ftp" ]]; then
    install -m 0755 "$src_ftp" /usr/local/bin/npanel-ftp
  fi
  if [[ -f "$src_mail" ]]; then
    install -m 0755 "$src_mail" /usr/local/bin/npanel-mail
  fi
  
  # Install npanel service management command (distro-agnostic)
  cat > /usr/local/bin/npanel-ctl <<'EOFCTL'
#!/usr/bin/env bash
# Npanel Service Control Script - Works on any Linux distro

NPANEL_DIR="${NPANEL_DIR:-/opt/npanel}"

# Detect init system
detect_init() {
  if command -v systemctl >/dev/null 2>&1; then
    echo "systemd"
  elif command -v service >/dev/null 2>&1; then
    echo "sysvinit"
  elif command -v rc-service >/dev/null 2>&1; then
    echo "openrc"
  else
    echo "manual"
  fi
}

# Service control abstraction
svc_start() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd) systemctl start "$service" 2>/dev/null ;;
    sysvinit) service "$service" start 2>/dev/null ;;
    openrc) rc-service "$service" start 2>/dev/null ;;
    manual) echo "Warning: No init system detected, manual start required" ;;
  esac || return 1
}

svc_stop() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd) systemctl stop "$service" 2>/dev/null ;;
    sysvinit) service "$service" stop 2>/dev/null ;;
    openrc) rc-service "$service" stop 2>/dev/null ;;
    manual) echo "Warning: No init system detected, manual stop required" ;;
  esac || return 1
}

svc_restart() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd) systemctl restart "$service" 2>/dev/null ;;
    sysvinit) service "$service" restart 2>/dev/null ;;
    openrc) rc-service "$service" restart 2>/dev/null ;;
    manual) echo "Warning: No init system detected, manual restart required" ;;
  esac || return 1
}

svc_status() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd) systemctl status "$service" 2>/dev/null ;;
    sysvinit) service "$service" status 2>/dev/null ;;
    openrc) rc-service "$service" status 2>/dev/null ;;
    manual) 
      if pgrep -f "npm.*start:prod" >/dev/null 2>&1; then
        echo "$service (running)"
      else
        echo "$service (stopped)"
      fi
      ;;
  esac || return 1
}

# View logs across distros
view_logs() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd)
      if command -v journalctl >/dev/null 2>&1; then
        journalctl -u "$service" -n 50 --no-pager 2>/dev/null || tail -n 50 /var/log/npanel-*.log 2>/dev/null
      else
        tail -n 50 /var/log/npanel-*.log 2>/dev/null
      fi
      ;;
    *)
      tail -n 50 /var/log/npanel-*.log 2>/dev/null
      ;;
  esac
}

# Follow logs live across distros
follow_logs() {
  local service=$1
  local init=$(detect_init)
  case "$init" in
    systemd)
      if command -v journalctl >/dev/null 2>&1; then
        journalctl -u "$service" -f --no-pager 2>/dev/null || tail -f /var/log/npanel-*.log 2>/dev/null
      else
        tail -f /var/log/npanel-*.log 2>/dev/null
      fi
      ;;
    *)
      tail -f /var/log/npanel-*.log 2>/dev/null
      ;;
  esac
}

case "${1:-help}" in
  start)
    echo "[INFO] Starting Npanel services (init: $(detect_init))..."
    svc_start npanel-backend.service || svc_start npanel-backend || true
    svc_start npanel-frontend.service || svc_start npanel-frontend || true
    sleep 2
    echo "[INFO] Services started"
    ;;
  stop)
    echo "[INFO] Stopping Npanel services..."
    svc_stop npanel-backend.service || svc_stop npanel-backend || true
    svc_stop npanel-frontend.service || svc_stop npanel-frontend || true
    sleep 1
    echo "[INFO] Services stopped"
    ;;
  restart)
    echo "[INFO] Restarting Npanel services..."
    svc_restart npanel-backend.service || svc_restart npanel-backend || true
    svc_restart npanel-frontend.service || svc_restart npanel-frontend || true
    sleep 2
    echo "[INFO] Services restarted"
    ;;
  status)
    echo "[INFO] Npanel Backend Status:"
    svc_status npanel-backend.service || svc_status npanel-backend || echo "Status unavailable"
    echo ""
    echo "[INFO] Npanel Frontend Status:"
    svc_status npanel-frontend.service || svc_status npanel-frontend || echo "Status unavailable"
    ;;
  logs)
    echo "[INFO] Npanel Backend Logs:"
    view_logs npanel-backend.service
    echo ""
    echo "[INFO] Npanel Frontend Logs:"
    view_logs npanel-frontend.service
    ;;
  backend-start)
    echo "[INFO] Starting Npanel Backend..."
    svc_start npanel-backend.service || svc_start npanel-backend
    ;;
  backend-stop)
    echo "[INFO] Stopping Npanel Backend..."
    svc_stop npanel-backend.service || svc_stop npanel-backend
    ;;
  backend-restart)
    echo "[INFO] Restarting Npanel Backend..."
    svc_restart npanel-backend.service || svc_restart npanel-backend
    ;;
  backend-status)
    svc_status npanel-backend.service || svc_status npanel-backend
    ;;
  backend-logs)
    follow_logs npanel-backend.service
    ;;
  frontend-start)
    echo "[INFO] Starting Npanel Frontend..."
    svc_start npanel-frontend.service || svc_start npanel-frontend
    ;;
  frontend-stop)
    echo "[INFO] Stopping Npanel Frontend..."
    svc_stop npanel-frontend.service || svc_stop npanel-frontend
    ;;
  frontend-restart)
    echo "[INFO] Restarting Npanel Frontend..."
    svc_restart npanel-frontend.service || svc_restart npanel-frontend
    ;;
  frontend-status)
    svc_status npanel-frontend.service || svc_status npanel-frontend
    ;;
  frontend-logs)
    follow_logs npanel-frontend.service
    ;;
  diagnose|diagnose-nginx|nginx-diagnose)
    require_root
    log "Running nginx diagnostics..."
    diagnose_nginx
    ;;
  *)
    cat <<'EOFHELP'
Npanel Service Control - Works on any Linux distro

Supports: systemd, SysVinit, OpenRC

General Commands:
  npanel-ctl start           Start both backend and frontend
  npanel-ctl stop            Stop both services
  npanel-ctl restart         Restart both services
  npanel-ctl status          Check status of both services
  npanel-ctl logs            Show last 50 lines of logs

Backend Commands:
  npanel-ctl backend-start   Start backend only
  npanel-ctl backend-stop    Stop backend only
  npanel-ctl backend-restart Restart backend only
  npanel-ctl backend-status  Check backend status
  npanel-ctl backend-logs    Follow backend logs live

Frontend Commands:
  npanel-ctl frontend-start   Start frontend only
  npanel-ctl frontend-stop    Stop frontend only
  npanel-ctl frontend-restart Restart frontend only
  npanel-ctl frontend-status  Check frontend status
  npanel-ctl frontend-logs    Follow frontend logs live

Examples:
  sudo npanel-ctl start
  sudo npanel-ctl backend-logs
  sudo npanel-ctl frontend-restart
EOFHELP
    ;;
esac
EOFCTL
  chmod +x /usr/local/bin/npanel-ctl
  log "Installed npanel-ctl command for service management (distro-agnostic)"
}

configure_dovecot_npanel() {
  if [[ ! -d /etc/dovecot ]]; then
    return
  fi
  mkdir -p /etc/npanel
  touch /etc/npanel/dovecot-passwd
  touch /etc/npanel/mail-domains
  chmod 600 /etc/npanel/dovecot-passwd || true
  if ! getent group vmail >/dev/null 2>&1; then
    groupadd -g 5000 vmail >/dev/null 2>&1 || groupadd vmail || true
  fi
  if ! id -u vmail >/dev/null 2>&1; then
    useradd -u 5000 -g vmail -d /var/mail/vhosts -s /usr/sbin/nologin vmail >/dev/null 2>&1 || true
  fi
  mkdir -p /var/mail/vhosts
  chown -R vmail:vmail /var/mail/vhosts || true

  if [[ -d /etc/dovecot/conf.d ]]; then
    cat > /etc/dovecot/conf.d/99-npanel.conf <<'EOF'
disable_plaintext_auth = no
auth_mechanisms = plain login
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/npanel/dovecot-passwd
}
userdb {
  driver = static
  args = uid=vmail gid=vmail home=/var/mail/vhosts/%d/%n
}
mail_location = maildir:~/Maildir
EOF
  fi
  svc restart dovecot
}

configure_exim_npanel() {
  mkdir -p /etc/npanel
  touch /etc/npanel/mail-domains

  if [[ -d /etc/exim4/conf.d ]]; then
    mkdir -p /etc/exim4/conf.d/router /etc/exim4/conf.d/transport
    cat > /etc/exim4/conf.d/router/950_npanel_virtual <<'EOF'
npanel_virtual_router:
  driver = accept
  domains = lsearch;/etc/npanel/mail-domains
  condition = ${if exists{/var/mail/vhosts/${domain}/${local_part}/Maildir}{yes}{no}}
  transport = npanel_virtual_transport
  no_verify
EOF
    cat > /etc/exim4/conf.d/transport/950_npanel_virtual <<'EOF'
npanel_virtual_transport:
  driver = appendfile
  directory = /var/mail/vhosts/${domain}/${local_part}/Maildir
  maildir_format = true
  create_directory = true
  mode = 0600
  directory_mode = 0700
  user = vmail
  group = vmail
EOF
    if check_cmd update-exim4.conf; then
      update-exim4.conf || true
    fi
    svc restart exim4
    return
  fi

  if [[ -f /etc/exim/exim.conf ]]; then
    local conf=/etc/exim/exim.conf
    if ! grep -q 'npanel_virtual_router:' "$conf"; then
      awk '
        BEGIN { inrouters=0; intrans=0 }
        /^begin[[:space:]]+routers/ { print; inrouters=1; next }
        /^begin[[:space:]]+transports/ { 
          if (inrouters==1) {
            print "";
            print "npanel_virtual_router:";
            print "  driver = accept";
            print "  domains = lsearch;/etc/npanel/mail-domains";
            print "  condition = ${if exists{/var/mail/vhosts/${domain}/${local_part}/Maildir}{yes}{no}}";
            print "  transport = npanel_virtual_transport";
            print "  no_verify";
            print "";
            inrouters=0;
          }
          print;
          intrans=1;
          next
        }
        { print }
        END {
          if (intrans==1) {
            print "";
            print "npanel_virtual_transport:";
            print "  driver = appendfile";
            print "  directory = /var/mail/vhosts/${domain}/${local_part}/Maildir";
            print "  maildir_format = true";
            print "  create_directory = true";
            print "  mode = 0600";
            print "  directory_mode = 0700";
            print "  user = vmail";
            print "  group = vmail";
          }
        }
      ' "$conf" > "${conf}.npanel.tmp" && mv "${conf}.npanel.tmp" "$conf"
    fi
    svc restart exim
  fi
}

verify_tools() {
  resolve_tool_cmds
  log "Verifying core tools installation..."
  
  local missing=0
  local missing_list=""
  
  # Check for absolutely required tools (core system tools)
  # Note: Check for actual binaries, not package names
  local -a core_tools=(
    "rsync" "git" "ssh" "ssh-keyscan"
  )
  
  # Check for hosting-related tools (may not all be present initially)
  local -a optional_tools=(
    "useradd" "userdel" "nginx" "mysql" "mariadb" "php-fpm" "exim" "dovecot" "pure-ftpd" "pdns_server" "rndc"
  )
  
  # Verify core tools with detailed output
  for tool in "${core_tools[@]}"; do
    if check_cmd "$tool"; then
      log "✓ Found core tool: $tool"
    else
      err "✗ Missing core tool: $tool"
      missing=$((missing+1))
      missing_list="${missing_list}${tool}, "
    fi
  done
  
  # Check optional hosting tools - just warn if missing, don't fail
  local optional_missing=""
  for tool in "${optional_tools[@]}"; do
    if ! check_cmd "$tool" && [[ ! -x "/usr/sbin/$tool" ]] && [[ ! -x "/usr/bin/$tool" ]]; then
      optional_missing="${optional_missing}${tool}, "
    else
      log "✓ Found optional tool: $tool"
    fi
  done
  
  if [[ -n "$optional_missing" ]]; then
    log "Note: Some optional hosting tools are not yet available: ${optional_missing%, }"
    log "These services can be installed later as needed."
  fi
  
  if [[ "$missing" -gt 0 ]]; then
    die "Required core tools missing: ${missing_list%, }. Please install these tools and retry."
  fi
  
  log "All core tools verified successfully!"
}

install_npanel_dependencies() {
  log "Installing backend dependencies"
  pushd "$NPANEL_DIR/backend" >/dev/null
  npm ci || npm install || die "Backend npm install failed!"
  log "Building backend for production..."
  npm run build || die "Backend build failed!"
  if [[ ! -f "dist/main.js" ]]; then
    die "Backend build completed but dist/main.js not found!"
  fi
  log "Backend build successful: dist/main.js verified"
  popd >/dev/null

  log "Installing frontend dependencies"
  pushd "$NPANEL_DIR/frontend" >/dev/null
  npm ci || npm install || die "Frontend npm install failed!"
  log "Building frontend for production..."
  # Ensure frontend uses correct API base URL (/v1 not /api)
  export NEXT_PUBLIC_API_BASE_URL="/v1"
  npm run build || die "Frontend build failed!"
  if [[ ! -d ".next" ]]; then
    die "Frontend build completed but .next directory not found!"
  fi
  log "Frontend build successful: .next directory verified"
  popd >/dev/null
}

stop_npanel_services() {
  log "Stopping Npanel services before rebuild..."
  if check_cmd systemctl; then
    systemctl stop npanel-backend.service npanel-frontend.service 2>/dev/null || true
  fi
  if check_cmd lsof; then
    local pids
    pids="$(lsof -ti :3000 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
    pids="$(lsof -ti :3001 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  fi
  pkill -f "npanel-backend" 2>/dev/null || true
  pkill -f "npanel-frontend" 2>/dev/null || true
  pkill -f "npm run start:prod" 2>/dev/null || true
  pkill -f "npm start -- -p 3001" 2>/dev/null || true
}

setup_ssl_certificates() {
  local crt_path="/etc/ssl/certs/npanel.crt"
  local key_path="/etc/ssl/private/npanel.key"
  
  # Check if certificates already exist
  if [[ -f "$crt_path" && -f "$key_path" ]]; then
    log "✓ SSL certificates already exist"
    return 0
  fi
  
  log "Generating self-signed SSL certificates..."
  mkdir -p /etc/ssl/certs /etc/ssl/private
  
  # Generate self-signed certificate valid for 365 days
  openssl req -x509 -newkey rsa:2048 -keyout "$key_path" -out "$crt_path" \
    -days 365 -nodes \
    -subj "/C=US/ST=State/L=City/O=Npanel/CN=localhost" 2>/dev/null || \
    die "Failed to generate SSL certificates"
  
  # Ensure proper permissions
  chmod 644 "$crt_path"
  chmod 600 "$key_path"
  
  log "✓ SSL certificates generated at $crt_path"
}

configure_nginx() {
  local conf=""
  local enable_link=""
  if [[ "$PKG_MGR" == "apt" && -d /etc/nginx/sites-available ]]; then
    conf="/etc/nginx/sites-available/npanel.conf"
    enable_link="/etc/nginx/sites-enabled/npanel.conf"
  else
    conf="/etc/nginx/conf.d/npanel.conf"
  fi
  
  # Check if config exists and has the required port definitions
  if [[ -f "$conf" ]]; then
    if grep -q "listen 2086" "$conf" 2>/dev/null; then
      return  # Config is complete and up-to-date
    fi
    # Config exists but is outdated - back it up and recreate
    log "Updating nginx configuration with missing port definitions..."
    cp "$conf" "${conf}.backup.$(date +%s)"
  fi
  
  mkdir -p "$(dirname "$conf")"
  log "Writing nginx configuration with /v1 API routing support..."
  cat > "$conf" <<'NGCONF'
# Upstream backend
upstream npanel_backend {
    server 127.0.0.1:3000;
}

# Upstream frontend
upstream npanel_frontend {
    server 127.0.0.1:3001;
}

# Shared proxy configuration
map $request_uri $admin_redirect {
    ~*^/$ /admin;
    default $request_uri;
}

# ============================================
# Main Port 8080 (HTTP) - Mixed routing
# ============================================
server {
    listen 8080;
    server_name localhost;

    # API endpoints - route to backend
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin panel
    location /admin {
        proxy_pass http://npanel_frontend/admin;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Customer panel
    location /customer {
        proxy_pass http://npanel_frontend/customer;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Login page
    location /login {
        proxy_pass http://npanel_frontend/login;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Root - redirect to admin by default
    location = / {
        return 301 /admin;
    }

    # Static files and other frontend routes
    location / {
        proxy_pass http://npanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ============================================
# Port 2082 (HTTP) - Customer Only
# ============================================
server {
    listen 2082;
    server_name localhost;

    # Redirect root to customer
    location = / {
        return 301 /customer;
    }

    # API endpoints - route to backend
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Customer panel - everything goes here
    location / {
        proxy_pass http://npanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ============================================
# Port 2083 (HTTPS) - Customer Only
# ============================================
server {
    listen 2083 ssl http2;
    server_name localhost;

    # SSL certificates (generate if needed)
    ssl_certificate /etc/ssl/certs/npanel.crt;
    ssl_certificate_key /etc/ssl/private/npanel.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Redirect root to customer
    location = / {
        return 301 /customer;
    }

    # API endpoints - route to backend
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Customer panel - everything goes here
    location / {
        proxy_pass http://npanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ============================================
# Port 2086 (HTTP) - Admin Only
# ============================================
server {
    listen 2086;
    server_name localhost;

    # Redirect root to admin
    location = / {
        return 301 /admin;
    }

    # API endpoints - route to backend
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin panel - everything else goes to frontend (let middleware route)
    location / {
        proxy_pass http://npanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ============================================
# Port 2087 (HTTPS) - Admin Only
# ============================================
server {
    listen 2087 ssl http2;
    server_name localhost;

    # SSL certificates (generate if needed)
    ssl_certificate /etc/ssl/certs/npanel.crt;
    ssl_certificate_key /etc/ssl/private/npanel.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Redirect root to admin
    location = / {
        return 301 /admin;
    }

    # API endpoints - route to backend
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://npanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin panel - everything goes here
    location / {
        proxy_pass http://npanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGCONF
  if [[ -n "$enable_link" ]]; then
    mkdir -p "$(dirname "$enable_link")"
    ln -sf "$conf" "$enable_link"
  fi
  
  # Generate SSL certificates before testing nginx config
  setup_ssl_certificates
  
  nginx -t || die "Nginx configuration syntax error!"
  
  # Restart nginx using the most reliable method available
  if check_cmd systemctl; then
    systemctl restart nginx || die "Failed to restart nginx service"
  elif check_cmd service; then
    service nginx restart || die "Failed to restart nginx service"
  else
    die "No service management tool available"
  fi
  
  # Validate nginx routing configuration using comprehensive validator
  log "Validating nginx routing configuration..."
  if ! grep -q "location /v1" "$conf" 2>/dev/null; then
    die "ERROR: Nginx config missing /v1 location block - API routing will fail!"
  fi
  if ! grep -q "upstream npanel_backend" "$conf" 2>/dev/null; then
    die "ERROR: Nginx config missing backend upstream definition!"
  fi
  
  # Run full validation (services may not be up yet, so skip endpoint test)
  validate_api_routing "nginx configuration" "http://127.0.0.1:8080/v1/health" 1 || warn "Initial nginx validation inconclusive (services may not be running)"
  log "✓ Nginx configuration validated successfully"
}

setup_services() {
  if ! check_cmd systemctl; then
    log "systemd not available; starting processes via nohup"
    if check_cmd lsof; then
      local pids
      pids="$(lsof -ti :3000 2>/dev/null || true)"
      [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
      pids="$(lsof -ti :3001 2>/dev/null || true)"
      [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
    fi
    nohup bash -lc "cd $NPANEL_DIR/backend && export \$(grep -v '^#' .env | xargs -d'\n') && npm run start:prod" >/var/log/npanel-backend.log 2>&1 &
    nohup bash -lc "cd $NPANEL_DIR/frontend && npm start -- -p 3001" >/var/log/npanel-frontend.log 2>&1 &
    return
  fi

  resolve_tool_cmds
  cat > /etc/systemd/system/npanel-backend.service <<UNIT
[Unit]
Description=Npanel Backend
After=network.target mysql.service mariadb.service

[Service]
Type=simple
WorkingDirectory=$NPANEL_DIR/backend
EnvironmentFile=$NPANEL_DIR/backend/.env
ExecStart=${CMD_NPM:-/usr/bin/npm} run start:prod
Restart=always
User=root
StandardOutput=append:/var/log/npanel-backend.log
StandardError=append:/var/log/npanel-backend.log

[Install]
WantedBy=multi-user.target
UNIT

  cat > /etc/systemd/system/npanel-frontend.service <<UNIT
[Unit]
Description=Npanel Frontend
After=network.target npanel-backend.service

[Service]
Type=simple
WorkingDirectory=$NPANEL_DIR/frontend
Environment="NODE_ENV=production"
ExecStart=${CMD_NPM:-/usr/bin/npm} run start -- -p 3001
Restart=always
User=root
StandardOutput=append:/var/log/npanel-frontend.log
StandardError=append:/var/log/npanel-frontend.log

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable npanel-backend.service npanel-frontend.service || true
  
  # Configure nginx before restarting services
  configure_nginx
  
  # Ensure all system services (nginx, mail, FTP, DNS, etc.) are started
  ensure_services_start
  
  if [[ "$NO_RESTART" -eq 0 ]]; then
    systemctl restart npanel-backend.service npanel-frontend.service
  else
    log "--no-restart specified: services not restarted"
  fi
}

dump_npanel_debug() {
  log "Npanel debug info (backend not reachable)"
  if check_cmd systemctl; then
    systemctl status npanel-backend.service -l --no-pager 2>/dev/null || true
    systemctl status npanel-frontend.service -l --no-pager 2>/dev/null || true
    if check_cmd journalctl; then
      journalctl -u npanel-backend.service -n 200 --no-pager 2>/dev/null || true
      journalctl -u npanel-frontend.service -n 200 --no-pager 2>/dev/null || true
    fi
  fi
  if [[ -f /var/log/npanel-backend.log ]]; then
    tail -n 200 /var/log/npanel-backend.log 2>/dev/null || true
  fi
  if [[ -f /var/log/npanel-frontend.log ]]; then
    tail -n 200 /var/log/npanel-frontend.log 2>/dev/null || true
  fi
  if check_cmd lsof; then
    lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true
    lsof -nP -iTCP:3001 -sTCP:LISTEN 2>/dev/null || true
  fi
}

verify_deployment() {
  local retries=0
  local max_retries=30
  if [[ "$NO_RESTART" -eq 1 ]]; then
    log "Skipping deployment verification due to --no-restart"
    return
  fi
  
  # Verify all services are listening first
  sleep 2
  verify_all_services || true
  
  # Use public health endpoint for backend readiness (no auth required)
  until curl -fsS http://127.0.0.1:3000/v1/health >/dev/null 2>&1; do
    retries=$((retries+1))
    if [[ "$retries" -gt "$max_retries" ]]; then
      dump_npanel_debug
      die "Backend health probe failed on port 3000."
    fi
    sleep 3
  done
  
  # Verify complete API routing using comprehensive validator
  if ! validate_api_routing "API routing and connectivity" "http://127.0.0.1:8080/v1/health" 0; then
    dump_npanel_debug
    die "API routing validation failed - frontend will not be able to reach backend"
  fi
  
  retries=0
  until curl -fsS http://127.0.0.1:8080/admin >/dev/null 2>&1; do
    retries=$((retries+1))
    [[ "$retries" -le "$max_retries" ]] || die "Frontend failed to start behind nginx (port 8080)."
    sleep 3
  done
}

check_deployment_status() {
  require_root
  
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "🔍 NPANEL DEPLOYMENT STATUS CHECK"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
  
  # 1. Directory Status
  log "📂 INSTALLATION"
  if [[ -d "$NPANEL_DIR" ]]; then
    log "   ✓ Directory: $NPANEL_DIR (exists)"
    if [[ -d "$NPANEL_DIR/.git" ]]; then
      local current_commit=$(cd "$NPANEL_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
      local branch=$(cd "$NPANEL_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
      log "   ✓ Git: branch=$branch, commit=$current_commit"
    else
      log "   ⚠ Git: not a git repository"
    fi
  else
    log "   ✗ Directory: $NPANEL_DIR (NOT FOUND)"
  fi
  log ""
  
  # 2. Service Status
  log "🔧 SERVICES"
  for svc in npanel-backend npanel-frontend nginx; do
    local status=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    if [[ "$status" == "active" ]]; then
      log "   ✓ $svc: RUNNING"
    else
      log "   ✗ $svc: $status"
    fi
  done
  log ""
  
  # 3. Port Connectivity
  log "🔌 PORTS"
  local ports=(3000 3001 8080 2082 2083 2086 2087)
  for port in "${ports[@]}"; do
    if timeout 1 bash -c "echo >/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
      log "   ✓ Port $port: LISTENING"
    else
      log "   ✗ Port $port: NOT LISTENING"
    fi
  done
  log ""
  
  # 4. Health Checks
  log "❤️  HEALTH CHECKS"
  if curl -fsS http://127.0.0.1:3000/v1/health >/dev/null 2>&1; then
    log "   ✓ Backend (/v1/health): HEALTHY"
  else
    log "   ✗ Backend (/v1/health): FAILED or UNREACHABLE"
  fi
  
  if curl -fsS http://127.0.0.1:8080/admin >/dev/null 2>&1; then
    log "   ✓ Frontend (/admin): HEALTHY"
  else
    log "   ✗ Frontend (/admin): FAILED or UNREACHABLE"
  fi
  
  if curl -fsS http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
    log "   ✓ Nginx Proxy (/v1/health): HEALTHY"
  else
    log "   ✗ Nginx Proxy (/v1/health): FAILED or UNREACHABLE"
  fi
  log ""
  
  # 5. Configuration Files
  log "📝 CONFIGURATION"
  if [[ -f "$NPANEL_DIR/backend/.env" ]]; then
    local jwt_set=$(grep -q "^JWT_SECRET=" "$NPANEL_DIR/backend/.env" && echo "yes" || echo "no")
    log "   ✓ backend/.env: EXISTS (JWT_SECRET: $jwt_set)"
  else
    log "   ✗ backend/.env: MISSING"
  fi
  
  if [[ -f "$NPANEL_DIR/frontend/.env.local" ]]; then
    log "   ✓ frontend/.env.local: EXISTS"
  else
    log "   ⚠ frontend/.env.local: MISSING"
  fi
  
  if [[ -f /etc/logrotate.d/npanel ]]; then
    log "   ✓ /etc/logrotate.d/npanel: CONFIGURED"
  else
    log "   ⚠ /etc/logrotate.d/npanel: NOT CONFIGURED"
  fi
  log ""
  
  # 6. Log Files
  log "📋 RECENT LOGS"
  if [[ -f /var/log/npanel-backend.log ]]; then
    local log_size=$(du -h /var/log/npanel-backend.log | cut -f1)
    local log_lines=$(wc -l < /var/log/npanel-backend.log)
    log "   ✓ Backend log: $log_size ($log_lines lines)"
    log "     Last error (if any):"
    grep -i error /var/log/npanel-backend.log | tail -1 | sed 's/^/     /' || log "     (none)"
  else
    log "   ⚠ Backend log: NOT FOUND"
  fi
  log ""
  
  # 7. Disk Usage
  log "💾 DISK USAGE"
  if [[ -d /opt/npanel ]]; then
    local npanel_size=$(du -sh /opt/npanel 2>/dev/null | cut -f1)
    log "   /opt/npanel: $npanel_size"
  fi
  if [[ -d /var/log ]]; then
    local logs_size=$(du -sh /var/log 2>/dev/null | cut -f1)
    local root_usage=$(df -h / | awk 'NR==2 {print $5}')
    log "   /var/log: $logs_size"
    log "   /: $root_usage used"
  fi
  log ""
  
  # 8. Summary
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Count healthy services
  local healthy=0
  systemctl is-active npanel-backend >/dev/null 2>&1 && healthy=$((healthy+1))
  systemctl is-active npanel-frontend >/dev/null 2>&1 && healthy=$((healthy+1))
  systemctl is-active nginx >/dev/null 2>&1 && healthy=$((healthy+1))
  
  if [[ $healthy -eq 3 ]]; then
    log "✅ DEPLOYMENT STATUS: 🟢 GREEN - All systems operational"
  elif [[ $healthy -ge 1 ]]; then
    log "⚠️  DEPLOYMENT STATUS: 🟡 YELLOW - Partial service availability ($healthy/3 services running)"
  else
    log "❌ DEPLOYMENT STATUS: 🔴 RED - Services not running"
  fi
  
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --update) MODE="update"; shift ;;
      --install) MODE="install"; shift ;;
      --diagnose|diagnose|--nginx-diagnose) MODE="diagnose"; shift ;;
      --status|status) MODE="status"; shift ;;
      logs|--logs) MODE="logs"; shift ;;
      restart|--restart) MODE="restart"; shift ;;
      backend-logs|--backend-logs) MODE="backend-logs"; shift ;;
      backend-restart|--backend-restart) MODE="backend-restart"; shift ;;
      frontend-logs|--frontend-logs) MODE="frontend-logs"; shift ;;
      frontend-restart|--frontend-restart) MODE="frontend-restart"; shift ;;
      --rebuild-nginx) MODE="rebuild-nginx"; shift ;;
      --repo) REPO_URL="$2"; shift 2 ;;
      --branch) NPANEL_BRANCH="$2"; shift 2 ;;
      --ref) NPANEL_REF="$2"; shift 2 ;;
      --dir) NPANEL_DIR="$2"; shift 2 ;;
      --skip-deps) SKIP_DEPS=1; shift ;;
      --skip-self-update) SKIP_SELF_UPDATE=1; shift ;;
      --no-rebuild) NO_REBUILD=1; shift ;;
      --no-restart) NO_RESTART=1; shift ;;
      --verbose) VERBOSE=1; DEBUG=1; shift ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

main() {
  # Parse arguments first to set MODE and other variables
  parse_args "$@"
  
  # Handle special commands before normal install flow
  case "${MODE}" in
    diagnose)
      require_root
      log "Npanel Nginx Diagnostics"
      diagnose_nginx
      exit $?
      ;;
    status)
      check_deployment_status
      exit $?
      ;;
    logs)
      require_root
      log "Displaying combined Npanel logs (last 50 lines)..."
      echo "=== Backend Service Logs ==="
      journalctl -u npanel-backend -n 50 --no-pager || echo "No backend logs available"
      echo ""
      echo "=== Frontend Service Logs ==="
      journalctl -u npanel-frontend -n 50 --no-pager || echo "No frontend logs available"
      exit 0
      ;;
    backend-logs)
      require_root
      log "Displaying Npanel backend logs (last 100 lines)..."
      journalctl -u npanel-backend -n 100 --no-pager || echo "No backend logs available"
      exit $?
      ;;
    restart)
      require_root
      log "Restarting Npanel services..."
      systemctl restart npanel-backend npanel-frontend nginx || die "Failed to restart services"
      log "Services restarted. Checking status..."
      sleep 2
      check_deployment_status
      exit $?
      ;;
    backend-restart)
      require_root
      log "Restarting backend service..."
      systemctl restart npanel-backend || die "Failed to restart backend"
      log "Backend restarted. Waiting 2 seconds..."
      sleep 2
      check_deployment_status
      exit $?
      ;;
    frontend-restart)
      require_root
      log "Restarting frontend service..."
      systemctl restart npanel-frontend || die "Failed to restart frontend"
      log "Frontend restarted. Waiting 2 seconds..."
      sleep 2
      check_deployment_status
      exit $?
      ;;
    frontend-logs)
      require_root
      log "Displaying Npanel frontend logs (last 100 lines)..."
      journalctl -u npanel-frontend -n 100 --no-pager || echo "No frontend logs available"
      exit $?
      ;;
    rebuild-nginx)
      require_root
      log "Rebuilding nginx configuration..."
      # Remove existing config to force regeneration
      rm -f /etc/nginx/conf.d/npanel.conf /etc/nginx/sites-available/npanel.conf /etc/nginx/sites-enabled/npanel.conf
      configure_nginx
      log "✓ Nginx configuration rebuilt successfully"
      check_deployment_status
      exit $?
      ;;
  esac

  self_update "$@"

  require_root
  acquire_lock
  detect_os

  require_cmd git "Install git for your distro and rerun."
  if [[ "$SKIP_DEPS" -eq 0 && "$MODE" != "update" ]]; then
    install_dependencies
  fi
  if [[ "$SKIP_DEPS" -eq 0 && "$MODE" == "update" ]]; then
    install_dependencies
  fi

  # For UPDATE mode: validate current environment before making changes
  if [[ "$MODE" == "update" ]]; then
    log "Running pre-update environment validation..."
    log "Checking API routing configuration..."
    validate_api_routing "Current environment" "http://127.0.0.1:8080/v1/health" 0 || warn "Current environment has routing issues - update may fix them"
    log ""
  fi

  # Always stop services before any code changes or builds (no compile against live services)
  stop_npanel_services

  # Converge repository to deterministic known-good origin state (no merges/pulls)
  ensure_repo

  install_management_scripts
  write_env
  ensure_env_defaults
  verify_tools

  # Optional: skip rebuild if already at target commit
  if [[ "$NO_REBUILD" -eq 1 ]]; then
    log "--no-rebuild specified: skipping backend/frontend builds"
  else
    if [[ -n "${NPANEL_PREV_COMMIT:-}" && -n "${NPANEL_TARGET_COMMIT:-}" && "$NPANEL_PREV_COMMIT" == "$NPANEL_TARGET_COMMIT" ]]; then
      log "Already at target commit (${NPANEL_TARGET_COMMIT}); skipping rebuild"
    else
      # Build backend and frontend; on failure, revert to previous commit and abort
      if ! install_npanel_dependencies; then
        err "Build failed; reverting to previous commit: ${NPANEL_PREV_COMMIT:-unknown}"
        if [[ -d "$NPANEL_DIR/.git" && -n "${NPANEL_PREV_COMMIT:-}" && "$NPANEL_PREV_COMMIT" != "unknown" ]]; then
          (cd "$NPANEL_DIR" && git reset --hard "$NPANEL_PREV_COMMIT" && git clean -fd) || true
        fi
        die "Aborting update due to build failure"
      fi
    fi
  fi

  # Only configure and start services after a successful update/build
  setup_services
  verify_deployment

  # Print detailed access instructions
  log ""
  log "╔════════════════════════════════════════════════════════════════════╗"
  log "║         ✓ NPANEL INSTALLATION COMPLETED SUCCESSFULLY              ║"
  log "╚════════════════════════════════════════════════════════════════════╝"
  log ""
  
  log "📍 HOW TO ACCESS NPANEL"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
  
  log "👨‍💼 ADMINISTRATOR ACCESS"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  HTTP (Insecure - Development Only)                     │"
  log "   │  URL: http://localhost:2086                             │"
  log "   │  or:  http://YOUR_SERVER_IP:2086                        │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  HTTPS (Secure - Production)                            │"
  log "   │  URL: https://localhost:2087                            │"
  log "   │  or:  https://YOUR_SERVER_IP:2087                       │"
  log "   │  Note: Accept self-signed certificate warning           │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "👥 CUSTOMER ACCESS"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  HTTP (Insecure - Development Only)                     │"
  log "   │  URL: http://localhost:2082                             │"
  log "   │  or:  http://YOUR_SERVER_IP:2082                        │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  HTTPS (Secure - Production)                            │"
  log "   │  URL: https://localhost:2083                            │"
  log "   │  or:  https://YOUR_SERVER_IP:2083                       │"
  log "   │  Note: Accept self-signed certificate warning           │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "🔀 MIXED INTERFACE (All Users)"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  HTTP (Development)                                     │"
  log "   │  URL: http://localhost:8080                             │"
  log "   │  or:  http://YOUR_SERVER_IP:8080                        │"
  log "   │                                                         │"
  log "   │  Access both admin and customer from one port:          │"
  log "   │  • Admin:    http://localhost:8080/admin                │"
  log "   │  • Customer: http://localhost:8080/customer             │"
  log "   │  • Login:    http://localhost:8080/login                │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "🔑 INITIAL LOGIN"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  1. Go to any portal URL above                          │"
  log "   │  2. You will be redirected to login page                │"
  log "   │  3. Email: admin@npanel.local (default)                 │"
  log "   │  4. Password: Check console output or .env file         │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "🔌 API ENDPOINTS (Backend)"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  Base URL: http://localhost:3000                        │"
  log "   │  or:       http://YOUR_SERVER_IP:3000                   │"
  log "   │                                                         │"
  log "   │  Health Check:                                          │"
  log "   │  curl http://localhost:3000/v1/health                   │"
  log "   │                                                         │"
  log "   │  Through Nginx Proxy:                                   │"
  log "   │  curl http://localhost:8080/api/v1/health               │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "📋 PORT REFERENCE"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  Port 2082  → Customer HTTP                             │"
  log "   │  Port 2083  → Customer HTTPS                            │"
  log "   │  Port 2086  → Admin HTTP                                │"
  log "   │  Port 2087  → Admin HTTPS                               │"
  log "   │  Port 8080  → Mixed Interface (Admin & Customer)        │"
  log "   │  Port 3000  → Backend API (internal)                    │"
  log "   │  Port 3001  → Frontend (internal)                       │"
  log "   │  Port 3306  → MySQL/MariaDB (internal)                  │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "📚 USEFUL COMMANDS"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  Check service status:                                  │"
  log "   │  sudo ./install_npanel.sh status                        │"
  log "   │                                                         │"
  log "   │  View service logs:                                     │"
  log "   │  sudo ./install_npanel.sh logs                          │"
  log "   │                                                         │"
  log "   │  Restart services:                                      │"
  log "   │  sudo ./install_npanel.sh restart                       │"
  log "   │                                                         │"
  log "   │  Restart specific service:                              │"
  log "   │  sudo ./install_npanel.sh backend-restart               │"
  log "   │  sudo ./install_npanel.sh frontend-restart              │"
  log "   │                                                         │"
  log "   │  View service logs:                                     │"
  log "   │  sudo ./install_npanel.sh backend-logs                  │"
  log "   │  sudo ./install_npanel.sh frontend-logs                 │"
  log "   │                                                         │"
  log "   │  Fix missing admin/customer ports (2082-2087):          │"
  log "   │  sudo ./install_npanel.sh --rebuild-nginx               │"
  log "   │                                                         │"
  log "   │  Run nginx diagnostics:                                 │"
  log "   │  sudo ./install_npanel.sh --diagnose                    │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
    log "🔐 SSL CERTIFICATE SETUP (Production)"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  Using Let's Encrypt:                                   │"
  log "   │                                                         │"
  log "   │  1. Install Certbot:                                    │"
  log "   │     sudo apt install certbot                            │"
  log "   │                                                         │"
  log "   │  2. Get certificate:                                    │"
  log "   │     sudo certbot certonly --standalone \\               │"
  log "   │       -d yourdomain.com                                 │"
  log "   │                                                         │"
  log "   │  3. Update nginx config:                                │"
  log "   │     Edit /etc/nginx/conf.d/npanel.conf                  │"
  log "   │     ssl_certificate /etc/letsencrypt/live/...           │"
  log "   │     ssl_certificate_key /etc/letsencrypt/live/...       │"
  log "   │                                                         │"
  log "   │  4. Reload nginx:                                       │"
  log "   │     sudo systemctl reload nginx                         │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "⚙️  TROUBLESHOOTING"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  Cannot access the panel?                               │"
  log "   │  1. Check firewall allows the port: sudo ufw allow 2086 │"
  log "   │  2. Check service running: sudo systemctl status nginx  │"
  log "   │  3. Check logs: journalctl -u npanel-backend -n 50      │"
  log "   │  4. Run diagnostics: sudo ./install_npanel.sh --diagnose│"
  log "   │                                                         │"
  log "   │  Frontend shows \"Unable to reach backend API\"?          │"
  log "   │  This means nginx is not routing /v1 requests correctly │"
  log "   │  Check:                                                 │"
  log "   │  - sudo grep 'location /v1' /etc/nginx/conf.d/*.conf    │"
  log "   │  - sudo nginx -t                                        │"
  log "   │  - sudo systemctl reload nginx                          │"
  log "   │  - curl http://localhost:8080/v1/health                 │"
  log "   │                                                         │"
  log "   │  Nginx not listening?                                   │"
  log "   │  sudo nginx -t                                          │"
  log "   │  sudo systemctl restart nginx                           │"
  log "   │                                                         │"
  log "   │  Backend not responding?                                │"
  log "   │  sudo ./install_npanel.sh backend-restart               │"
  log "   │  sudo ./install_npanel.sh backend-logs                  │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "✅ NEXT STEPS"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  1. Open your browser and navigate to:                  │"
  log "   │     https://YOUR_SERVER_IP:2087  (Admin - Recommended)  │"
  log "   │     or                                                  │"
  log "   │     http://YOUR_SERVER_IP:2086   (Admin - HTTP only)    │"
  log "   │                                                         │"
  log "   │  2. Accept the SSL certificate warning (if using HTTPS) │"
  log "   │                                                         │"
  log "   │  3. Log in with your admin credentials                  │"
  log "   │                                                         │"
  log "   │  4. Complete the setup wizard in the dashboard          │"
  log "   │                                                         │"
  log "   │  5. Create customer accounts and hosting packages       │"
  log "   │                                                         │"
  log "   │  6. Share customer portal URL with users:               │"
  log "   │     https://YOUR_SERVER_IP:2083  (Production)          │"
  log "   │     or http://YOUR_SERVER_IP:2082 (Development)        │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "📞 SUPPORT & DOCUMENTATION"
  log "   ┌─────────────────────────────────────────────────────────┐"
  log "   │  GitHub: https://github.com/omenyx/npanel              │"
  log "   │  Docs:   See MAIN_PAGES_GUIDE.md in project root        │"
  log "   │  API:    See backend/README.md for API documentation    │"
  log "   └─────────────────────────────────────────────────────────┘"
  log ""
  
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "✓ Installation complete! Your Npanel panel is ready to use."
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
}

main "$@"
