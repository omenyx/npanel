#!/usr/bin/env bash

set -euo pipefail

log() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
err() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }
die() { err "$*"; exit 1; }

NPANEL_DIR="${NPANEL_DIR:-/opt/npanel}"
NPANEL_BRANCH="${NPANEL_BRANCH:-main}"
NPANEL_REF="${NPANEL_REF:-}"
REPO_URL="${REPO_URL:-https://github.com/omenyx/npanel.git}"
INSTALLER_URL="${INSTALLER_URL:-https://raw.githubusercontent.com/omenyx/npanel/main/install_npanel.sh}"

MODE="install"
SKIP_DEPS=0
SKIP_SELF_UPDATE="${NPANEL_SKIP_SELF_UPDATE:-0}"

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
      pkg_install curl ca-certificates lsb-release gnupg software-properties-common
      if [[ "$OS_ID" == "ubuntu" ]]; then
        LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php || true
        pkg_update
      fi
      ensure_nodesource_20
      pkg_install lsof git rsync openssh-client build-essential openssl
      pkg_install nginx mysql-server exim4 dovecot-core dovecot-imapd bind9 pure-ftpd || true
      pkg_install php8.2-fpm php8.2-mysql php8.2-mbstring php8.2-xml php8.2-intl php8.2-zip php8.2-gd || true
      pkg_install pdns-server pdns-backend-mysql || true
      ;;
    dnf|yum)
      pkg_install curl ca-certificates git rsync openssh-clients lsof openssl
      pkg_install nginx mariadb-server php-fpm php-mysqlnd php-mbstring php-xml php-intl php-zip php-gd exim dovecot pure-ftpd || true
      pkg_install bind-utils bind || true
      ensure_nodesource_20
      ;;
    pacman)
      pkg_install curl ca-certificates git rsync openssh lsof base-devel openssl
      pkg_install nginx mariadb php php-fpm php-gd php-intl php-mbstring php-xml php-zip dovecot exim pure-ftpd || true
      ensure_nodesource_20
      ;;
    zypper)
      pkg_install curl ca-certificates git rsync openssh lsof openssl
      pkg_install nginx mariadb mariadb-tools php-fpm php8-mysql php8-mbstring php8-xmlreader php8-intl php8-zip php8-gd exim dovecot pure-ftpd || true
      ensure_nodesource_20
      ;;
    *)
      die "Unsupported package manager: $PKG_MGR"
      ;;
  esac
}

svc() {
  local action="$1"
  local name="$2"
  if check_cmd systemctl; then
    systemctl "$action" "$name" 2>/dev/null || true
  else
    service "$name" "$action" 2>/dev/null || true
  fi
}

ensure_services_start() {
  log "Starting services..."
  svc start mysql
  svc start mariadb
  svc start nginx
  svc start php8.2-fpm
  svc start php-fpm
  svc start exim4
  svc start exim
  svc start dovecot
  svc start pure-ftpd
  svc start pure-ftpd-mysql
  if check_cmd pdns_server || [[ -x /usr/sbin/pdns_server ]]; then
    svc stop bind9
    svc stop named
    svc start pdns
  else
    svc start named
    svc start bind9
  fi
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

  mysql_exec "CREATE DATABASE IF NOT EXISTS npanel;"
  mysql_exec "CREATE USER IF NOT EXISTS 'npanel'@'localhost' IDENTIFIED BY 'npanel_dev_password';"
  mysql_exec "GRANT ALL PRIVILEGES ON npanel.* TO 'npanel'@'localhost'; FLUSH PRIVILEGES;"

  local DB_ROOT_PASS="npanel_dev_password"
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
  mysql -e "CREATE USER IF NOT EXISTS 'pdns'@'localhost' IDENTIFIED BY '$DB_ROOT_PASS';" || true
  mysql -e "GRANT ALL PRIVILEGES ON pdns.* TO 'pdns'@'localhost'; FLUSH PRIVILEGES;" || true
  configure_powerdns "$DB_ROOT_PASS"
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

ensure_repo() {
  local dest="$NPANEL_DIR"

  if [[ -d "$dest/.git" ]]; then
    git config --global --add safe.directory "$dest" || true
    log "Fetching latest repo in $dest"
    cd "$dest"
    git fetch --tags origin
    if [[ -n "$NPANEL_REF" ]]; then
      git checkout -f "$NPANEL_REF"
      git clean -fd
    else
      git checkout -f "$NPANEL_BRANCH"
      git reset --hard "origin/$NPANEL_BRANCH"
      git clean -fd
    fi
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
  CMD_EXIM="$(command -v exim || true)"
  CMD_DOVECOT="$(command -v dovecot || true)"

  if check_cmd php-fpm8.2; then
    CMD_PHP_FPM="$(command -v php-fpm8.2)"
  elif check_cmd php-fpm8.3; then
    CMD_PHP_FPM="$(command -v php-fpm8.3)"
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
  resolve_tool_cmds
  local jwt; jwt="$(generate_jwt_secret)"
  cat > "$dest" <<EOF
NODE_ENV=production
PORT=3000
JWT_SECRET=$jwt
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
  if ! grep -qE '^NPANEL_FTP_CMD=' "$dest"; then
    echo "NPANEL_FTP_CMD=/usr/local/bin/npanel-ftp" >> "$dest"
  else
    sed -i 's|^NPANEL_FTP_CMD=$|NPANEL_FTP_CMD=/usr/local/bin/npanel-ftp|' "$dest" || true
  fi
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
  local missing=0
  local -a required=(
    "${CMD_USERADD:-}" "useradd"
    "${CMD_USERDEL:-}" "userdel"
    "${CMD_NGINX:-}" "nginx"
    "${CMD_MYSQL:-}" "mysql"
    "${CMD_RSYNC:-}" "rsync"
  )
  for ((i=0; i<${#required[@]}; i+=2)); do
    local path="${required[i]}" name="${required[i+1]}"
    if [[ -n "$path" && -x "$path" ]]; then
      :
    elif check_cmd "$name"; then
      :
    else
      missing=$((missing+1))
    fi
  done
  [[ "$missing" -eq 0 ]] || die "One or more required tools are missing."
}

install_npanel_dependencies() {
  log "Installing backend dependencies"
  pushd "$NPANEL_DIR/backend" >/dev/null
  npm ci || npm install
  npm run build
  popd >/dev/null

  log "Installing frontend dependencies"
  pushd "$NPANEL_DIR/frontend" >/dev/null
  npm ci || npm install
  npm run build
  popd >/dev/null
}

stop_npanel_services() {
  log "Stopping Npanel services before rebuild..."
  if check_cmd systemctl; then
    systemctl stop npanel-backend.service npanel-frontend.service 2>/dev/null || true
    return
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

configure_nginx() {
  local conf=""
  local enable_link=""
  if [[ "$PKG_MGR" == "apt" && -d /etc/nginx/sites-available ]]; then
    conf="/etc/nginx/sites-available/npanel.conf"
    enable_link="/etc/nginx/sites-enabled/npanel.conf"
  else
    conf="/etc/nginx/conf.d/npanel.conf"
  fi
  if [[ -f "$conf" ]]; then
    return
  fi
  mkdir -p "$(dirname "$conf")"
  cat > "$conf" <<'NGCONF'
server {
    listen 8080;
    server_name localhost;

    location /api {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGCONF
  if [[ -n "$enable_link" ]]; then
    mkdir -p "$(dirname "$enable_link")"
    ln -sf "$conf" "$enable_link"
  fi
  nginx -t
  svc restart nginx
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

  cat > /etc/systemd/system/npanel-backend.service <<'UNIT'
[Unit]
Description=Npanel Backend
After=network.target mysql.service mariadb.service

[Service]
Type=simple
WorkingDirectory=/opt/npanel/backend
EnvironmentFile=/opt/npanel/backend/.env
ExecStart=/usr/bin/npm run start:prod
Restart=always
User=root
StandardOutput=append:/var/log/npanel-backend.log
StandardError=append:/var/log/npanel-backend.log

[Install]
WantedBy=multi-user.target
UNIT

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
StandardOutput=append:/var/log/npanel-frontend.log
StandardError=append:/var/log/npanel-frontend.log

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable npanel-backend.service npanel-frontend.service || true
  systemctl restart npanel-backend.service npanel-frontend.service
}

verify_deployment() {
  local retries=0
  local max_retries=10
  until curl -fsS http://127.0.0.1:3000/system/tools/status >/dev/null 2>&1; do
    retries=$((retries+1))
    [[ "$retries" -le "$max_retries" ]] || die "Backend failed to start on port 3000."
    sleep 3
  done
  retries=0
  until curl -fsS http://127.0.0.1:8080/admin >/dev/null 2>&1; do
    retries=$((retries+1))
    [[ "$retries" -le "$max_retries" ]] || die "Frontend failed to start behind nginx (port 8080)."
    sleep 3
  done
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --update) MODE="update"; shift ;;
      --install) MODE="install"; shift ;;
      --repo) REPO_URL="$2"; shift 2 ;;
      --branch) NPANEL_BRANCH="$2"; shift 2 ;;
      --ref) NPANEL_REF="$2"; shift 2 ;;
      --dir) NPANEL_DIR="$2"; shift 2 ;;
      --skip-deps) SKIP_DEPS=1; shift ;;
      --skip-self-update) SKIP_SELF_UPDATE=1; shift ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  self_update "$@"

  require_root
  detect_os

  require_cmd git "Install git for your distro and rerun."
  if [[ "$SKIP_DEPS" -eq 0 && "$MODE" != "update" ]]; then
    install_dependencies
  fi
  if [[ "$SKIP_DEPS" -eq 0 && "$MODE" == "update" ]]; then
    install_dependencies
  fi

  ensure_repo
  install_management_scripts
  write_env
  ensure_env_defaults
  verify_tools
  ensure_services_start
  setup_mysql
  configure_dovecot_npanel
  configure_exim_npanel
  configure_nginx
  stop_npanel_services
  install_npanel_dependencies
  setup_services
  verify_deployment

  log "Npanel is running:"
  echo "  API:     http://localhost:3000"
  echo "  Panel:   http://localhost:8080/admin"
}

main "$@"
