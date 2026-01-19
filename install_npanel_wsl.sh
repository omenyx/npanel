#!/usr/bin/env bash

# Npanel V1 Automated Installer for Ubuntu 22.04 (WSL)
# Usage:
#   chmod +x install_npanel_wsl.sh
#   sudo ./install_npanel_wsl.sh
#   # OR
#   sudo bash install_npanel_wsl.sh
#
# Notes:
# - Run as root in WSL (Ubuntu 22.04)
# - Local testing only (no SSL, no firewall hardening)
# - If /opt/npanel does not exist, set REPO_URL to your Git repo before running:
#     export REPO_URL="https://your.git.repo/npanel.git"
#
set -euo pipefail

log() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
err() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }
die() { err "$*"; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "This script must be run as root (use sudo)."
  fi
}

apt_install() {
  local pkgs=("$@")
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}"
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_nodesource_20() {
  if check_cmd node; then
    local v; v=$(node -v || true)
    if [[ "$v" =~ ^v20\. ]]; then
      log "Node.js $v already installed"
      return
    fi
  fi
  log "Installing Node.js 20 LTS via Nodesource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt_install nodejs
}

ensure_services_start() {
  log "Starting services..."
  service mysql start
  service nginx start
  service php8.2-fpm start
  service exim4 start
  service dovecot start
  
  # Handle DNS Service: Prefer PowerDNS if installed, fallback to Bind9, or warn.
  if [[ -x /usr/sbin/pdns_server ]]; then
      log "Starting PowerDNS (and disabling bind9 to avoid conflict)..."
      systemctl disable bind9 --now 2>/dev/null || service bind9 stop 2>/dev/null || true
      systemctl disable named --now 2>/dev/null || service named stop 2>/dev/null || true
      
      # Ensure config file permissions are correct for pdns user
      if [[ -f /etc/powerdns/pdns.d/pdns.local.gmysql.conf ]]; then
          chown pdns:pdns /etc/powerdns/pdns.d/pdns.local.gmysql.conf
          chmod 640 /etc/powerdns/pdns.d/pdns.local.gmysql.conf
      fi
      
      service pdns start || log "Failed to start PowerDNS"
  else
      # Attempt to start bind9 only if pdns is not present
      # The error 'Refusing to operate on alias name' typically means 'bind9' is an alias for 'named'
      # Try starting 'named' directly if bind9 fails
      log "Starting Bind9..."
      service named start || service bind9 start || log "Failed to start DNS service (bind9/named)"
  fi
}

mysql_exec() {
  mysql -u root -e "$1"
}

setup_mysql() {
  log "Configuring MySQL"
  ensure_services_start
  mysql_exec "CREATE DATABASE IF NOT EXISTS npanel;"
  mysql_exec "CREATE USER IF NOT EXISTS 'npanel'@'localhost' IDENTIFIED BY 'npanel_dev_password';"
  mysql_exec "GRANT ALL PRIVILEGES ON npanel.* TO 'npanel'@'localhost'; FLUSH PRIVILEGES;"

  local DB_ROOT_PASS="npanel_dev_password"
  if [[ -f "/root/.my.cnf" ]]; then
    log "MySQL root password already set."
  else
    log "Securing MySQL..."
    mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$DB_ROOT_PASS';" || mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DB_ROOT_PASS';"
    
    cat > /root/.my.cnf <<EOF
[client]
user=root
password=$DB_ROOT_PASS
EOF
  fi

  # Create PowerDNS Database and User
  log "Configuring PowerDNS Database..."
  mysql -e "CREATE DATABASE IF NOT EXISTS pdns;"
  mysql -e "CREATE USER IF NOT EXISTS 'pdns'@'localhost' IDENTIFIED BY '$DB_ROOT_PASS';"
  mysql -e "GRANT ALL PRIVILEGES ON pdns.* TO 'pdns'@'localhost';"
  mysql -e "FLUSH PRIVILEGES;"
  
  # Import PowerDNS Schema if table doesn't exist
  if ! mysql -D pdns -e "DESCRIBE domains;" >/dev/null 2>&1; then
      log "Importing PowerDNS Schema..."
      # Standard schema for PowerDNS 4.x
      mysql -D pdns <<EOF
CREATE TABLE domains (
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

CREATE TABLE records (
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

CREATE TABLE supermasters (
  ip                    VARCHAR(64) NOT NULL,
  nameserver            VARCHAR(255) NOT NULL,
  account               VARCHAR(40) NOT NULL,
  PRIMARY KEY (ip, nameserver)
) Engine=InnoDB;

CREATE TABLE comments (
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

CREATE TABLE domainmetadata (
  id                    INT AUTO_INCREMENT,
  domain_id             INT NOT NULL,
  kind                  VARCHAR(32),
  content               TEXT,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX domainmetadata_idx ON domainmetadata (domain_id, kind);

CREATE TABLE cryptokeys (
  id                    INT AUTO_INCREMENT,
  domain_id             INT NOT NULL,
  flags                 INT NOT NULL,
  active                TINYINT(1),
  content               TEXT,
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE INDEX domainidindex ON cryptokeys(domain_id);

CREATE TABLE tsigkeys (
  id                    INT AUTO_INCREMENT,
  name                  VARCHAR(255),
  algorithm             VARCHAR(50),
  secret                VARCHAR(255),
  PRIMARY KEY (id)
) Engine=InnoDB;

CREATE UNIQUE INDEX namealgoindex ON tsigkeys(name, algorithm);
EOF
  fi

  # Configure PowerDNS to use MySQL
  cat > /etc/powerdns/pdns.d/pdns.local.gmysql.conf <<EOF
launch=gmysql
gmysql-host=127.0.0.1
gmysql-port=3306
gmysql-dbname=pdns
gmysql-user=pdns
gmysql-password=$DB_ROOT_PASS
gmysql-dnssec=yes
EOF
  
  # Ensure permissions
  chown pdns:pdns /etc/powerdns/pdns.d/pdns.local.gmysql.conf
  chmod 640 /etc/powerdns/pdns.d/pdns.local.gmysql.conf
}

ensure_repo() {
  local dest="/opt/npanel"
  
  # Default to omenyx/npanel if REPO_URL is not set
  if [[ -z "${REPO_URL:-}" ]]; then
    REPO_URL="https://github.com/omenyx/npanel.git"
  fi

  if [[ -d "$dest/.git" ]]; then
    # Fix git dubious ownership issue if running as root
    git config --global --add safe.directory "$dest"

    if [[ "$1" == "--update" ]]; then
        log "Update flag set. Pulling latest changes..."
        cd "$dest" || return
        git reset --hard origin/main || true
        git pull || log "Git pull failed, continuing..."
        return
    else
        log "Repo exists at $dest. Use --update to force pull."
        return
    fi
  fi

  if [[ -d "$dest" && -n "$(ls -A "$dest")" ]]; then
     log "Warning: $dest exists and is not empty. Backing up to $dest.bak.$(date +%s)"
     mv "$dest" "$dest.bak.$(date +%s)"
  fi
  
  log "Cloning repo from $REPO_URL to $dest"
  mkdir -p /opt
  git clone --depth=1 "$REPO_URL" "$dest"
}

generate_jwt_secret() {
  openssl rand -hex 32
}

write_env() {
  local dest="/opt/npanel/backend/.env"
  log "Writing .env to $dest"
  local jwt; jwt=$(generate_jwt_secret)
  cat > "$dest" <<EOF
NODE_ENV=development
PORT=3000

DATABASE_TYPE=mysql
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_NAME=npanel
DATABASE_USER=npanel
DATABASE_PASSWORD=npanel_dev_password

JWT_SECRET=$jwt

NPANEL_HOSTING_DRY_RUN=0
NPANEL_FIXED_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Tool commands (REAL OS BINARIES ONLY)
NPANEL_USERADD_CMD=/usr/sbin/useradd
NPANEL_USERDEL_CMD=/usr/sbin/userdel
NPANEL_NGINX_CMD=/usr/sbin/nginx
NPANEL_PHP_FPM_CMD=/usr/sbin/php-fpm8.2
NPANEL_MYSQL_CMD=/usr/bin/mysql
NPANEL_RSYNC_CMD=/usr/bin/rsync
NPANEL_BIND_RNDC_CMD=/usr/sbin/rndc
NPANEL_EXIM_CMD=/usr/sbin/exim
NPANEL_DOVECOT_CMD=/usr/sbin/dovecot
NPANEL_FTP_CMD=/usr/sbin/useradd
EOF
}

verify_tools() {
  log "Verifying required tool commands"
  local -a tools=(
    "useradd" "/usr/sbin/useradd"
    "userdel" "/usr/sbin/userdel"
    "nginx" "/usr/sbin/nginx"
    "php-fpm8.2" "/usr/sbin/php-fpm8.2"
    "mysql" "/usr/bin/mysql"
    "rsync" "/usr/bin/rsync"
    "rndc" "/usr/sbin/rndc"
    "exim" "/usr/sbin/exim"
    "dovecot" "/usr/sbin/dovecot"
  )
  printf "\n%-15s %-35s %-10s\n" "Tool" "Path" "Status"
  printf "%-15s %-35s %-10s\n" "-----" "---------------------------------" "------"
  local missing=0
  for ((i=0; i<${#tools[@]}; i+=2)); do
    local name=${tools[i]} path=${tools[i+1]}
    if [[ -x "$path" ]] || command -v "$name" >/dev/null 2>&1; then
      printf "%-15s %-35s %-10s\n" "$name" "$path" "OK"
    else
      printf "%-15s %-35s %-10s\n" "$name" "$path" "MISSING"
      missing=$((missing+1))
    fi
  done
  if [[ $missing -gt 0 ]]; then
    die "One or more required tools are missing. Install and re-run."
  fi
}

configure_nginx() {
  log "Configuring Nginx reverse proxy (listening on 8080)"
  local conf="/etc/nginx/sites-available/npanel.conf"
  cat > "$conf" <<'NGCONF'
server {
    listen 8080;
    server_name localhost;

    # Backend API
    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Frontend (Next.js)
    # Assuming Next.js is running on 3001 or built statically?
    # V1 Installer assumes we are running a dev/production build via 'npm start' on a different port OR
    # simply serving static files if exported.
    # Current installer does 'npm run build' in frontend but doesn't start it.
    # We need to serve the frontend via Nginx or start it as a service.
    
    # FIX: Serve the built static files directly for now, OR proxy to Next.js start
    # Let's assume we want to serve the static export if 'output: export' is set, 
    # but standard Next.js requires a running server for SSR.
    
    # Update: We will start the frontend on port 3001 in the systemd service or a separate one.
    # For this fix, let's proxy root to 3000 assuming backend serves frontend? 
    # NO, backend is NestJS (API). Frontend is Next.js.
    # We need to start the frontend!
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGCONF
  ln -sf "$conf" /etc/nginx/sites-enabled/npanel.conf
  nginx -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart nginx
  else
    service nginx restart || true
  fi
}

check_compatibility() {
  log "Checking OS compatibility..."
  if [[ ! -f /etc/os-release ]]; then
    die "Cannot determine OS. Only Ubuntu 20.04/22.04/24.04 are supported."
  fi
  
  source /etc/os-release
  if [[ "$ID" != "ubuntu" ]]; then
    die "Detected OS: $ID. Only Ubuntu is supported."
  fi
  
  # Check for WSL
  if grep -qEi "(Microsoft|WSL)" /proc/version; then
    log "WSL environment detected."
  else
    log "Note: Not running in WSL. This script is optimized for WSL but should work on standard Ubuntu."
  fi
}

check_ports() {
  log "Checking for port conflicts..."
  local conflict=0
  
  # Check port 80 (Nginx)
  if lsof -Pi :80 -sTCP:LISTEN -t >/dev/null ; then
    log "Warning: Port 80 is in use. Nginx might fail to start."
    conflict=1
  fi
  
  # Check port 3306 (MySQL)
  if lsof -Pi :3306 -sTCP:LISTEN -t >/dev/null ; then
     # It might be our own mysql, which is fine
     if ! pgrep mysqld >/dev/null; then
        log "Warning: Port 3306 is in use but mysqld is not running (docker?). MySQL might fail."
        conflict=1
     fi
  fi
  
  if [[ $conflict -eq 1 ]]; then
     log "Attempting to stop conflicting services..."
     service apache2 stop 2>/dev/null || true
     service nginx stop 2>/dev/null || true
     service mysql stop 2>/dev/null || true
  fi
  
  # Ensure no DNS conflicts (stop both bind9 and pdns before starting the right one)
  log "Stopping existing DNS services to prevent conflicts..."
  service bind9 stop 2>/dev/null || true
  service named stop 2>/dev/null || true
  service pdns stop 2>/dev/null || true
}

disable_selinux() {
  # SELinux is typically not found on standard Ubuntu, but might be present on some custom images or other distros.
  # We check for the 'sestatus' command or /etc/selinux/config
  
  if command -v sestatus >/dev/null 2>&1; then
      log "Checking SELinux status..."
      local status; status=$(sestatus | grep "SELinux status" | awk '{print $3}')
      if [[ "$status" == "enabled" ]]; then
          log "SELinux is enabled. Disabling it permanently..."
          
          # Set permissive mode immediately
          setenforce 0 || true
          
          # Update config file to be permanent across reboots
          if [[ -f /etc/selinux/config ]]; then
             sed -i 's/^SELINUX=enforcing/SELINUX=disabled/g' /etc/selinux/config
             sed -i 's/^SELINUX=permissive/SELINUX=disabled/g' /etc/selinux/config
             log "SELinux has been disabled in /etc/selinux/config."
          else
             log "Warning: SELinux is active but /etc/selinux/config not found. Could not disable permanently."
          fi
      else
          log "SELinux is already disabled or permissive."
      fi
  else
      log "SELinux tools not found (typical for Ubuntu). Skipping."
  fi
}

install_dependencies() {
  log "Installing system dependencies"
  
  # Clean up potential conflicting packages from previous failed runs (common in Ubuntu 24.04)
  # Only remove if they exist to avoid errors
  if dpkg -l | grep -q libnode-dev; then DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev || true; fi
  if dpkg -l | grep -q npm; then DEBIAN_FRONTEND=noninteractive apt-get remove -y npm || true; fi
  if dpkg -l | grep -q nodejs-doc; then DEBIAN_FRONTEND=noninteractive apt-get remove -y nodejs-doc || true; fi
  DEBIAN_FRONTEND=noninteractive apt-get autoremove -y || true
  
  apt_install curl ca-certificates lsb-release gnupg software-properties-common
  
  # Add PPA for PHP 8.2 (since Ubuntu 24.04 'noble' might not have 8.2 default or uses different naming)
  log "Adding Ondrej PHP PPA"
  LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php
  
  # Update apt cache again after adding PPA
  DEBIAN_FRONTEND=noninteractive apt-get update -y

  ensure_nodesource_20
  
  # Note: bind9 might fail to start in WSL2 due to systemd issues, ignoring failure
  # Remove 'npm' from apt install because NodeSource nodejs package already includes npm
  # Add Roundcube dependencies (php-mysql, php-mbstring, php-xml, php-intl, php-zip, php-gd)
  # Added lsof for port checking
  DEBIAN_FRONTEND=noninteractive apt-get install -y lsof mysql-server nginx php8.2-fpm php8.2-mysql php8.2-mbstring php8.2-xml php8.2-intl php8.2-zip php8.2-gd exim4 dovecot-core dovecot-imapd bind9 rsync openssh-client git build-essential || log "Some packages failed to install/start (likely bind9/mysql in WSL), continuing..."
  
  # Fix any broken installs
  DEBIAN_FRONTEND=noninteractive apt-get install -f -y

  # Install PowerDNS (pdns-server and pdns-backend-mysql) explicitly
  # Note: PowerDNS replaces bind9 for DNS services in standard Npanel deployments,
  # but we keep bind9-utils/dnsutils if needed. If 'bind9' service is conflicting, disable it.
  log "Installing PowerDNS"
  DEBIAN_FRONTEND=noninteractive apt-get install -y pdns-server pdns-backend-mysql || log "PowerDNS install failed, continuing..."
}

install_npanel_dependencies() {
  log "Installing Npanel backend/frontend dependencies"
  pushd /opt/npanel/backend >/dev/null
  npm ci || npm install
  popd >/dev/null
  pushd /opt/npanel/frontend >/dev/null || true
  npm ci || npm install || true
  npm run build || true
  popd >/dev/null || true

  # Fix permissions for Npanel
  # Use SUDO_USER if available, otherwise fallback to current user (likely root) or find the first regular user
  local owner="${SUDO_USER:-$USER}"
  if [[ "$owner" == "root" ]]; then
     # Try to find the first non-root user in /home
     owner=$(ls /home | head -n 1)
     if [[ -z "$owner" ]]; then owner="root"; fi
  fi
  
  log "Setting ownership of /opt/npanel to $owner"
  chown -R "$owner":"$owner" /opt/npanel
  
  # Install Roundcube (Download only, manual config required in V1)
  if [[ ! -d "/var/www/roundcube" ]]; then
    log "Downloading Roundcube Webmail..."
    mkdir -p /var/www/roundcube
    # Using Roundcube 1.6.6 (Stable)
    wget -q https://github.com/roundcube/roundcubemail/releases/download/1.6.6/roundcubemail-1.6.6-complete.tar.gz -O /tmp/roundcube.tar.gz
    tar -xzf /tmp/roundcube.tar.gz -C /var/www/roundcube --strip-components=1
    rm /tmp/roundcube.tar.gz
    chown -R www-data:www-data /var/www/roundcube
    log "Roundcube installed to /var/www/roundcube"
  fi
}

setup_systemd_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemd not available; starting services via nohup"
    # Start Backend
    nohup bash -lc 'cd /opt/npanel/backend && export $(grep -v "^#" .env | xargs -d"\n") && npm run start:dev' >/var/log/npanel-backend.log 2>&1 &
    # Start Frontend
    nohup bash -lc 'cd /opt/npanel/frontend && npm start -- -p 3001' >/var/log/npanel-frontend.log 2>&1 &
    return
  fi

  log "Creating systemd services for Npanel"
  
  # Backend Service
  cat > /etc/systemd/system/npanel-backend.service <<'UNIT'
[Unit]
Description=Npanel Backend
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/npanel/backend
EnvironmentFile=/opt/npanel/backend/.env
ExecStart=/usr/bin/npm run start:dev
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT

  # Frontend Service
  cat > /etc/systemd/system/npanel-frontend.service <<'UNIT'
[Unit]
Description=Npanel Frontend
After=network.target npanel-backend.service

[Service]
Type=simple
WorkingDirectory=/opt/npanel/frontend
ExecStart=/usr/bin/npm start -- -p 3001
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable npanel-backend.service || true
  systemctl enable npanel-frontend.service || true
  systemctl restart npanel-backend.service
  systemctl restart npanel-frontend.service
}

verify_deployment() {
  log "Verifying deployment..."
  local retries=0
  local max_retries=10
  
  log "Waiting for Backend (port 3000)..."
  until curl -s http://127.0.0.1:3000/system/tools/status >/dev/null; do
    retries=$((retries+1))
    if [[ $retries -gt $max_retries ]]; then
       err "Backend failed to start on port 3000."
       log "Checking logs..."
       if [[ -f /var/log/npanel.log ]]; then tail -n 50 /var/log/npanel.log; fi
       if command -v journalctl >/dev/null; then journalctl -u npanel -n 50 --no-pager; fi
       return 1
    fi
    sleep 3
    echo -n "."
  done
  echo " OK"

  log "Waiting for Nginx/Frontend (port 8080)..."
  if curl -s http://127.0.0.1:8080/admin > /tmp/frontend_check.html; then
     # Check for Next.js app specific content
     if grep -q "NPanel" /tmp/frontend_check.html || grep -q "Login" /tmp/frontend_check.html || grep -q "next" /tmp/frontend_check.html; then
        log "Frontend is reachable via Nginx."
     else
        # It might be returning a JSON 404 from backend if Nginx routing is wrong
        if grep -q "Cannot GET" /tmp/frontend_check.html; then
             err "Frontend verification failed: Received Backend 404 instead of Frontend app. Check Nginx routing."
        else
             err "Frontend reachable but content mismatch. Check /tmp/frontend_check.html"
        fi
        return 1
     fi
  else
     err "Frontend verification failed (http://localhost:8080/admin). Nginx or Frontend build might be broken."
     if [[ -f /var/log/nginx/error.log ]]; then
        log "Nginx Error Log:"
        tail -n 20 /var/log/nginx/error.log
     fi
     return 1
  fi
}

final_message() {
  echo
  log "Npanel is running at:"
  echo "  http://localhost:3000/admin"
  echo
  log "Tool status endpoint:"
  echo "  http://localhost:3000/system/tools/status"
  echo
  log "If using Nginx proxy, it listens on 8080 (proxied to 3000)"
  echo "  http://localhost:8080/admin"
}

main() {
  log "Starting Npanel WSL Installer..."
  check_compatibility
  require_root
  disable_selinux
  check_ports
  install_dependencies
  ensure_services_start
  setup_mysql
  ensure_repo "${1:-}"
  install_npanel_dependencies
  write_env
  verify_tools
  configure_nginx
  setup_systemd_service
  verify_deployment
  final_message
}

main "$@"

