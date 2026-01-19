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
  local svcs=(mysql nginx php8.2-fpm exim4 dovecot bind9)
  for s in "${svcs[@]}"; do
    if command -v systemctl >/dev/null 2>&1; then
      systemctl enable "$s" || true
      systemctl restart "$s" || systemctl start "$s" || true
    else
      service "$s" start || true
    fi
  done
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
}

ensure_repo() {
  local dest="/opt/npanel"
  if [[ -d "$dest" && -f "$dest/backend/package.json" ]]; then
    log "Repo already present at $dest"
    return
  fi
  # Default to omenyx/npanel if REPO_URL is not set
  if [[ -z "${REPO_URL:-}" ]]; then
    REPO_URL="https://github.com/omenyx/npanel.git"
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
  log "Configuring Nginx reverse proxy (listening on 8080 → backend 3000)"
  local conf="/etc/nginx/sites-available/npanel.conf"
  cat > "$conf" <<'NGCONF'
server {
    listen 8080;
    server_name localhost;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3000;
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

install_dependencies() {
  log "Installing system dependencies"
  
  # Clean up potential conflicting packages from previous failed runs (common in Ubuntu 24.04)
  DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev npm nodejs-doc || true
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
  DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server nginx php8.2-fpm exim4 dovecot-core dovecot-imapd bind9 rsync openssh-client git build-essential || log "Some packages failed to install/start (likely bind9/mysql in WSL), continuing..."
  
  # Fix any broken installs
  DEBIAN_FRONTEND=noninteractive apt-get install -f -y
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
}

setup_systemd_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemd not available; starting backend in background via nohup"
    nohup bash -lc 'cd /opt/npanel/backend && export $(grep -v "^#" .env | xargs -d"\n") && npm run start:dev' >/var/log/npanel.log 2>&1 &
    return
  fi
  log "Creating systemd service for Npanel dev"
  cat > /etc/systemd/system/npanel.service <<'UNIT'
[Unit]
Description=Npanel Backend (dev)
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
  systemctl daemon-reload
  systemctl enable npanel.service || true
  systemctl restart npanel.service || systemctl start npanel.service
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
  require_root
  install_dependencies
  ensure_services_start
  setup_mysql
  ensure_repo
  install_npanel_dependencies
  write_env
  verify_tools
  configure_nginx
  setup_systemd_service
  final_message
}

main "$@"

