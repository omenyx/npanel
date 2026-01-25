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

readonly SCRIPT_VERSION="1.1.0"
readonly INSTALL_PATH="/opt/npanel"
readonly CONFIG_PATH="/etc/npanel"
readonly DATA_PATH="/opt/npanel/data"
readonly LOG_DIR="/var/log/npanel"
readonly LOG_FILE="${LOG_DIR}/install.log"
readonly MANIFEST_FILE="/root/.npanel-manifest.json"

readonly RELEASE_REPO="omenyx/npanel"
readonly RELEASE_API_BASE="https://api.github.com/repos/${RELEASE_REPO}/releases"
readonly DEFAULT_RELEASE_TAG="latest"

readonly REQUIRED_ARCH="x86_64"
readonly CREDENTIALS_FILE="/root/.npanel/credentials"
readonly LEGACY_CREDENTIALS_FILE="/root/.npanel-credentials"

VERIFY_ONLY=false
DEBUG=false
RELEASE_TAG="${DEFAULT_RELEASE_TAG}"
NPANEL_API_ASSET=""
NPANEL_AGENT_ASSET=""
NPANEL_UI_ASSET=""
NPANEL_FRONTEND_ASSET=""

ROLLBACK_ACTIVE=false
ROLLBACK_BACKUP_DIR=""

PKG_MGR=""
PKG_MGR_CMD=""

TOTAL_STEPS=12

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

# Colors (console only)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

setup_logging() {
  mkdir -p "$LOG_DIR"
  touch "$LOG_FILE"
  chmod 0755 "$LOG_DIR"
  chmod 0644 "$LOG_FILE"
}

log_info() {
  local msg="${CYAN}[INFO]${NC} $*"
  echo -e "$msg"
  echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
}

log_success() {
  local msg="${GREEN}[SUCCESS]${NC} $*"
  echo -e "$msg"
  echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
}

log_error() {
  local msg="${RED}[ERROR]${NC} $*"
  echo -e "$msg" >&2
  echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
}

log_warn() {
  local msg="${YELLOW}[WARN]${NC} $*"
  echo -e "$msg"
  echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
}

log_step() {
  local step="$1"
  local title="$2"
  local msg="${BOLD}${BLUE}Step ${step}/${TOTAL_STEPS}:${NC} ${BOLD}${title}${NC}"
  echo -e "$msg"
  echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
}

log_debug() {
  if [ "$DEBUG" = true ]; then
    local msg="${BLUE}[DEBUG]${NC} $*"
    echo -e "$msg"
    echo -e "$msg" | sed -e "s/\x1b\[[0-9;]*m//g" >> "$LOG_FILE"
  fi
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
# ARGUMENT PARSING & HELPERS
# ==============================================================================

print_usage() {
  cat << EOF
Usage: install-universal.sh [--verify-only] [--debug] [--release <tag>]
                           [--api-asset <name>] [--agent-asset <name>]
                           [--ui-asset <name>] [--frontend-asset <name>]

Options:
  --verify-only         Run all verification checks only (no changes)
  --debug               Enable verbose debug output
  --release <tag>       GitHub release tag to install (default: latest)
  --api-asset <name>    Override API asset name
  --agent-asset <name>  Override Agent asset name
  --ui-asset <name>     Override UI asset name (optional)
  --frontend-asset <n>  Override Frontend build asset name
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --verify-only)
        VERIFY_ONLY=true
        shift
        ;;
      --debug)
        DEBUG=true
        shift
        ;;
      --release)
        RELEASE_TAG="$2"
        shift 2
        ;;
      --api-asset)
        NPANEL_API_ASSET="$2"
        shift 2
        ;;
      --agent-asset)
        NPANEL_AGENT_ASSET="$2"
        shift 2
        ;;
      --ui-asset)
        NPANEL_UI_ASSET="$2"
        shift 2
        ;;
      --frontend-asset)
        NPANEL_FRONTEND_ASSET="$2"
        shift 2
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        log_error "Unknown argument: $1"
        print_usage
        exit "$EXIT_GENERIC_ERROR"
        ;;
    esac
  done
}

fail() {
  local msg="$1"
  shift
  log_error "$msg"
  if [ $# -gt 0 ]; then
    log_info "REMEDIATION:"
    while [ $# -gt 0 ]; do
      log_info "  - $1"
      shift
    done
  fi
  exit "$EXIT_UNRECOVERABLE"
}

require_cmd() {
  local cmd="$1"
  local remediation="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Required command not found: $cmd" "$remediation"
  fi
}

version_normalize() {
  echo "$1" | sed -E 's/[^0-9.].*$//' | sed -E 's/\.$//'
}

version_ge() {
  [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

version_le() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

version_between() {
  local ver="$1"
  local min="$2"
  local max="$3"
  version_ge "$ver" "$min" && version_le "$ver" "$max"
}

detect_pkg_manager() {
  case "$DISTRO" in
    ubuntu|debian)
      if command -v apt-get >/dev/null 2>&1; then
        PKG_MGR="apt"
        PKG_MGR_CMD="apt-get"
      else
        fail "apt-get not found on $DISTRO" "Install apt: sudo apt-get update"
      fi
      ;;
    rocky|almalinux)
      if command -v dnf >/dev/null 2>&1; then
        PKG_MGR="dnf"
        PKG_MGR_CMD="dnf"
      elif command -v yum >/dev/null 2>&1; then
        PKG_MGR="yum"
        PKG_MGR_CMD="yum"
      else
        fail "dnf/yum not found on $DISTRO" "Install dnf/yum from base repositories"
      fi
      ;;
    *)
      fail "Unsupported distro: $DISTRO" "Use AlmaLinux 8/9, Rocky 8/9, Ubuntu 20.04/22.04, Debian 11/12"
      ;;
  esac
  log_success "Package manager detected: $PKG_MGR"
}

check_required_repos() {
  case "$PKG_MGR" in
    apt)
      local sources
      sources=$(grep -R "^deb " /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true)
      if [ -z "$sources" ]; then
        fail "No APT repositories configured" "Add official $DISTRO repositories in /etc/apt/sources.list"
      fi
      local candidate
      candidate=$(apt-cache policy systemd 2>/dev/null | awk '/Candidate:/ {print $2}')
      if [ -z "$candidate" ] || [ "$candidate" = "(none)" ]; then
        fail "APT repositories missing required packages" "Run: sudo apt-get update" "Ensure official $DISTRO repos are enabled"
      fi
      ;;
    dnf|yum)
      local repolist
      repolist=$($PKG_MGR_CMD -q repolist enabled 2>/dev/null || true)
      if ! echo "$repolist" | grep -qiE 'baseos|appstream'; then
        fail "Required repositories missing (BaseOS/AppStream)" "Enable BaseOS and AppStream repos" "Example: sudo dnf config-manager --set-enabled baseos appstream"
      fi
      ;;
  esac
  log_success "Repository configuration verified"
}

set_version_matrix() {
  case "$DISTRO-$VERSION" in
    ubuntu-20.04)
      SYSTEMD_MIN="245"; SYSTEMD_MAX="245.999"
      KERNEL_MIN="5.4"; KERNEL_MAX="5.4.999"
      GLIBC_MIN="2.31"; GLIBC_MAX="2.31.999"
      OPENSSL_MIN="1.1.1"; OPENSSL_MAX="1.1.1.999"
      CURL_MIN="7.68"; CURL_MAX="7.68.999"
      TAR_MIN="1.30"; TAR_MAX="1.30.999"
      SQLITE_MIN="3.31"; SQLITE_MAX="3.31.999"
      MARIADB_MIN="10.3"; MARIADB_MAX="10.3.999"
      IPROUTE_MIN="5.5"; IPROUTE_MAX="5.5.999"
      NFT_MIN="0.9.3"; NFT_MAX="0.9.3.999"
      IPTABLES_MIN="1.8.4"; IPTABLES_MAX="1.8.4.999"
      ;;
    ubuntu-22.04)
      SYSTEMD_MIN="249"; SYSTEMD_MAX="249.999"
      KERNEL_MIN="5.15"; KERNEL_MAX="5.15.999"
      GLIBC_MIN="2.35"; GLIBC_MAX="2.35.999"
      OPENSSL_MIN="3.0"; OPENSSL_MAX="3.0.999"
      CURL_MIN="7.81"; CURL_MAX="7.81.999"
      TAR_MIN="1.34"; TAR_MAX="1.34.999"
      SQLITE_MIN="3.37"; SQLITE_MAX="3.37.999"
      MARIADB_MIN="10.6"; MARIADB_MAX="10.6.999"
      IPROUTE_MIN="5.15"; IPROUTE_MAX="5.15.999"
      NFT_MIN="1.0"; NFT_MAX="1.0.999"
      IPTABLES_MIN="1.8.7"; IPTABLES_MAX="1.8.7.999"
      ;;
    debian-11)
      SYSTEMD_MIN="247"; SYSTEMD_MAX="247.999"
      KERNEL_MIN="5.10"; KERNEL_MAX="5.10.999"
      GLIBC_MIN="2.31"; GLIBC_MAX="2.31.999"
      OPENSSL_MIN="1.1.1"; OPENSSL_MAX="1.1.1.999"
      CURL_MIN="7.74"; CURL_MAX="7.74.999"
      TAR_MIN="1.34"; TAR_MAX="1.34.999"
      SQLITE_MIN="3.34"; SQLITE_MAX="3.34.999"
      MARIADB_MIN="10.5"; MARIADB_MAX="10.5.999"
      IPROUTE_MIN="5.10"; IPROUTE_MAX="5.10.999"
      NFT_MIN="0.9.8"; NFT_MAX="0.9.8.999"
      IPTABLES_MIN="1.8.7"; IPTABLES_MAX="1.8.7.999"
      ;;
    debian-12)
      SYSTEMD_MIN="252"; SYSTEMD_MAX="252.999"
      KERNEL_MIN="6.1"; KERNEL_MAX="6.1.999"
      GLIBC_MIN="2.36"; GLIBC_MAX="2.36.999"
      OPENSSL_MIN="3.0"; OPENSSL_MAX="3.0.999"
      CURL_MIN="7.88"; CURL_MAX="7.88.999"
      TAR_MIN="1.34"; TAR_MAX="1.34.999"
      SQLITE_MIN="3.40"; SQLITE_MAX="3.40.999"
      MARIADB_MIN="10.11"; MARIADB_MAX="10.11.999"
      IPROUTE_MIN="6.1"; IPROUTE_MAX="6.1.999"
      NFT_MIN="1.0.6"; NFT_MAX="1.0.6.999"
      IPTABLES_MIN="1.8.9"; IPTABLES_MAX="1.8.9.999"
      ;;
    rocky-8|almalinux-8)
      SYSTEMD_MIN="239"; SYSTEMD_MAX="239.999"
      KERNEL_MIN="4.18"; KERNEL_MAX="4.18.999"
      GLIBC_MIN="2.28"; GLIBC_MAX="2.28.999"
      OPENSSL_MIN="1.1.1"; OPENSSL_MAX="1.1.1.999"
      CURL_MIN="7.61"; CURL_MAX="7.61.999"
      TAR_MIN="1.30"; TAR_MAX="1.30.999"
      SQLITE_MIN="3.26"; SQLITE_MAX="3.26.999"
      MARIADB_MIN="10.3"; MARIADB_MAX="10.3.999"
      IPROUTE_MIN="5.1"; IPROUTE_MAX="5.1.999"
      NFT_MIN="0.9.3"; NFT_MAX="0.9.3.999"
      IPTABLES_MIN="1.8.4"; IPTABLES_MAX="1.8.4.999"
      ;;
    rocky-9|almalinux-9)
      SYSTEMD_MIN="252"; SYSTEMD_MAX="252.999"
      KERNEL_MIN="5.14"; KERNEL_MAX="5.14.999"
      GLIBC_MIN="2.34"; GLIBC_MAX="2.34.999"
      OPENSSL_MIN="3.0"; OPENSSL_MAX="3.0.999"
      CURL_MIN="7.76"; CURL_MAX="7.76.999"
      TAR_MIN="1.34"; TAR_MAX="1.34.999"
      SQLITE_MIN="3.34"; SQLITE_MAX="3.34.999"
      MARIADB_MIN="10.5"; MARIADB_MAX="10.5.999"
      IPROUTE_MIN="5.14"; IPROUTE_MAX="5.14.999"
      NFT_MIN="1.0.2"; NFT_MAX="1.0.2.999"
      IPTABLES_MIN="1.8.8"; IPTABLES_MAX="1.8.8.999"
      ;;
    *)
      fail "Unsupported distro/version: $DISTRO $VERSION" "Use AlmaLinux 8/9, Rocky 8/9, Ubuntu 20.04/22.04, Debian 11/12"
      ;;
  esac
}

get_systemd_version() { systemctl --version | head -n1 | awk '{print $2}'; }
get_kernel_version() { uname -r | cut -d- -f1; }
get_glibc_version() { ldd --version 2>/dev/null | head -n1 | awk '{print $NF}'; }
get_openssl_version() { openssl version | awk '{print $2}'; }
get_curl_version() { curl --version | awk '{print $2}'; }
get_tar_version() { tar --version | head -n1 | awk '{print $NF}'; }
get_sqlite_version() { sqlite3 --version | awk '{print $1}'; }
get_mariadb_version() { (mariadb --version 2>/dev/null || mysql --version 2>/dev/null) | sed -E 's/.*Distrib ([0-9.]+).*/\1/'; }
get_iproute_version() { ip -V 2>/dev/null | sed -E 's/.*iproute2-([0-9.]+).*/\1/'; }
get_nft_version() { nft --version 2>/dev/null | awk '{print $2}'; }
get_iptables_version() { iptables --version 2>/dev/null | sed -E 's/.*v([0-9.]+).*/\1/'; }

check_version_range() {
  local name="$1"
  local actual="$2"
  local min="$3"
  local max="$4"
  local normalized
  normalized=$(version_normalize "$actual")
  if [ -z "$normalized" ]; then
    fail "Unable to parse $name version: $actual" "Verify $name is installed and accessible"
  fi
  if ! version_between "$normalized" "$min" "$max"; then
    fail "$name version $normalized is unsupported (expected $min - $max)" \
      "Ensure supported OS and repositories are used" \
      "If upgraded beyond supported range, downgrade to $min series"
  fi
  log_success "$name version OK: $normalized"
}

check_ports_free() {
  local ports=(3000 3001 8080)
  local port
  for port in "${ports[@]}"; do
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -q ":${port}$"; then
      fail "Required port $port is already in use" "Free port $port or change nPanel configuration before installing"
    fi
    log_success "Port $port is available"
  done
}

check_exec_mounts() {
  local opt_opts
  local tmp_opts
  opt_opts=$(findmnt -no OPTIONS /opt 2>/dev/null || true)
  tmp_opts=$(findmnt -no OPTIONS /tmp 2>/dev/null || true)
  if echo "$opt_opts" | grep -qw noexec; then
    fail "/opt is mounted with noexec" "Remount /opt with exec: sudo mount -o remount,exec /opt"
  fi
  if echo "$tmp_opts" | grep -qw noexec; then
    fail "/tmp is mounted with noexec" "Remount /tmp with exec or set TMPDIR to an exec-enabled path"
  fi
  log_success "Filesystem exec permissions verified"
}

check_cgroups_v2() {
  if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    log_success "cgroups v2 available"
  else
    fail "cgroups v2 not available" "Enable unified cgroups v2 in kernel boot parameters" "On systemd: add systemd.unified_cgroup_hierarchy=1"
  fi
}

check_systemd_running() {
  if ! pidof systemd >/dev/null 2>&1; then
    fail "systemd is not running" "Boot with systemd as PID 1"
  fi
  local systemd_state
  systemd_state="$(systemctl is-system-running 2>/dev/null || echo 'unknown')"
  # WSL2 systemd often reports "degraded" but is functional
  if [[ "$systemd_state" == "offline" ]] || [[ "$systemd_state" == "unknown" ]]; then
    fail "systemd is not healthy (state: $systemd_state)" "Check: systemctl status" "Resolve systemd failures before installing"
  fi
  log_success "systemd is running"
}

check_unix_socket_support() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - << 'PY'
import socket
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.bind('/tmp/npanel.sock.test')
s.close()
PY
    rm -f /tmp/npanel.sock.test
    log_success "Unix socket support verified"
    return 0
  fi
  if command -v socat >/dev/null 2>&1; then
    socat UNIX-LISTEN:/tmp/npanel.sock.test,fork EXEC:'/bin/true' &
    local pid=$!
    sleep 1
    kill "$pid" >/dev/null 2>&1 || true
    rm -f /tmp/npanel.sock.test
    log_success "Unix socket support verified"
    return 0
  fi
  fail "Unable to verify Unix socket support (python3 or socat missing)" \
    "Install python3 or socat" \
    "Ubuntu/Debian: sudo apt-get install -y python3" \
    "Rocky/Alma: sudo dnf install -y python3"
}

check_security_modules() {
  if command -v getenforce >/dev/null 2>&1; then
    local selinux
    selinux=$(getenforce)
    if [ "$selinux" = "Enforcing" ]; then
      if ! command -v semanage >/dev/null 2>&1; then
        fail "SELinux enforcing but semanage is missing" \
          "Install policy tools" \
          "Rocky/Alma: sudo dnf install -y policycoreutils-python-utils"
      fi
      log_warn "SELinux enforcing detected - will apply contexts during install"
    else
      log_info "SELinux mode: $selinux"
    fi
  fi

  if command -v aa-status >/dev/null 2>&1; then
    if aa-status --enabled >/dev/null 2>&1; then
      log_warn "AppArmor enabled - ensure profiles allow /opt/npanel/bin/*"
    else
      log_info "AppArmor not enabled"
    fi
  fi
}

fetch_release_metadata() {
  require_cmd curl "Install curl"
  require_cmd python3 "Install python3"
  local release_url
  if [ "$RELEASE_TAG" = "latest" ]; then
    release_url="$RELEASE_API_BASE/latest"
  else
    release_url="$RELEASE_API_BASE/tags/$RELEASE_TAG"
  fi
  local release_json
  if ! release_json=$(curl -fsSL "$release_url"); then
    fail "Failed to fetch GitHub release metadata" "Check connectivity to api.github.com" "Verify release tag: $RELEASE_TAG"
  fi

  RELEASE_NAME=$(python3 - << PY
import json,sys
data=json.load(sys.stdin)
print(data.get('tag_name','unknown'))
PY
<<<"$release_json")

  RELEASE_DATE=$(python3 - << PY
import json,sys
data=json.load(sys.stdin)
print(data.get('published_at','unknown'))
PY
<<<"$release_json")

  RELEASE_ASSETS_JSON=$(python3 - << PY
import json,sys
data=json.load(sys.stdin)
print(json.dumps(data.get('assets',[])))
PY
<<<"$release_json")
}

resolve_asset_url() {
  local pattern="$1"
  local override="$2"
  python3 - << PY
import json,sys,re
assets=json.loads(sys.stdin.read())
override=sys.argv[1]
pattern=sys.argv[2]
if override:
    for a in assets:
        if a.get('name') == override:
            print(a.get('browser_download_url',''))
            sys.exit(0)
    sys.exit(1)
regex=re.compile(pattern)
for a in assets:
    name=a.get('name','')
    if regex.search(name):
        print(a.get('browser_download_url',''))
        sys.exit(0)
sys.exit(1)
PY
"$override" "$pattern" <<< "$RELEASE_ASSETS_JSON"
}

download_asset() {
  local url="$1"
  local dest="$2"
  if ! curl -fsSL "$url" -o "$dest"; then
    fail "Failed to download asset: $url" "Check connectivity to GitHub releases"
  fi
}

verify_checksum() {
  local checksum_file="$1"
  local file_path="$2"
  local file_name
  file_name=$(basename "$file_path")
  if ! grep -q " $file_name$" "$checksum_file"; then
    fail "Checksum entry missing for $file_name" "Ensure release provides Checksums.sha256 with $file_name"
  fi
  (cd "$(dirname "$checksum_file")" && sha256sum -c --quiet "$checksum_file" --ignore-missing) || {
    fail "Checksum verification failed for $file_name" "Re-download release assets" "Verify GitHub release integrity"
  }
  log_success "Checksum verified: $file_name"
}

check_binary_compat() {
  local bin_path="$1"
  local bin_name
  bin_name=$(basename "$bin_path")
  if ! file "$bin_path" | grep -q "x86-64"; then
    fail "Binary architecture mismatch for $bin_name" "Ensure amd64/x86_64 release artifact is used"
  fi
  local missing
  missing=$(ldd "$bin_path" 2>/dev/null | awk '/not found/ {print $1}' || true)
  if [ -n "$missing" ]; then
    log_error "Missing shared libraries for $bin_name:"
    echo "$missing" | while read -r lib; do
      log_error "  - $lib"
      if [ "$PKG_MGR" = "apt" ]; then
        log_info "  Note: install apt-file if missing: sudo apt-get install -y apt-file && sudo apt-file update"
        log_info "  Remediation: sudo apt-get install -y \$(apt-file search -x '/$lib$' | head -n1 | cut -d: -f1)"
      else
        log_info "  Remediation: sudo $PKG_MGR_CMD install -y \$($PKG_MGR_CMD provides -q '*/$lib' | awk 'NR==1{print $1}')"
      fi
    done
    exit "$EXIT_UNRECOVERABLE"
  fi
  log_success "Binary dependencies OK: $bin_name"
}

apply_selinux_contexts() {
  if command -v getenforce >/dev/null 2>&1; then
    if [ "$(getenforce)" = "Enforcing" ] && command -v semanage >/dev/null 2>&1; then
      semanage fcontext -a -t bin_t "${INSTALL_PATH}/bin(/.*)?" >/dev/null 2>&1 || true
      semanage fcontext -a -t etc_t "${CONFIG_PATH}(/.*)?" >/dev/null 2>&1 || true
      restorecon -RFv "$INSTALL_PATH" "$CONFIG_PATH" >/dev/null 2>&1 || true
      log_info "SELinux contexts applied"
    fi
  fi
}

rollback_on_error() {
  local exit_code=$?
  if [ "$ROLLBACK_ACTIVE" = true ] && [ -n "$ROLLBACK_BACKUP_DIR" ]; then
    log_error "Deployment failed - initiating rollback"
    if [ -f "$ROLLBACK_BACKUP_DIR/bin.tar.gz" ]; then
      rm -rf "$INSTALL_PATH/bin" "$INSTALL_PATH/public" 2>/dev/null || true
      mkdir -p "$INSTALL_PATH"
      tar -xzf "$ROLLBACK_BACKUP_DIR/bin.tar.gz" -C "$INSTALL_PATH" || true
      log_warn "Rollback applied from $ROLLBACK_BACKUP_DIR/bin.tar.gz"
    fi
  fi
  exit $exit_code
}

trap rollback_on_error ERR

install_recovery_cli() {
  cat > /usr/local/bin/npanel << 'EOF'
#!/bin/bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "ERROR: must run as root" >&2
  exit 1
fi

LOG_FILE="/var/log/npanel/admin-reset.log"
DB_PATH="/opt/npanel/data/npanel.db"
CREDENTIALS_FILE="/root/.npanel/credentials"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$CREDENTIALS_FILE")"
touch "$LOG_FILE"
chmod 0600 "$LOG_FILE"

log_event() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG_FILE"
}

hash_password() {
  htpasswd -bnBC 14 "" "$1" | cut -d: -f2 | sed 's/^\$2y/\$2b/'
}

reset_password() {
  local new_password="$1"
  local hash
  hash=$(hash_password "$new_password")
  sqlite3 "$DB_PATH" "UPDATE users SET password_hash='$hash', updated_at=CURRENT_TIMESTAMP WHERE email='admin@localhost';"
  cat > "$CREDENTIALS_FILE" << CREDS
ADMIN ACCOUNT (SENSITIVE)
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Email: admin@localhost
Password: $new_password

First Login: http://$(hostname -f 2>/dev/null || echo "SERVER_IP"):8080
CREDS
  chmod 0600 "$CREDENTIALS_FILE"
  log_event "admin password reset"
  echo "Admin password reset. Credentials stored at: $CREDENTIALS_FILE"
}

case "${1:-} ${2:-}" in
  "admin reset-password"|"agent create-admin")
    if [ ! -f "$DB_PATH" ]; then
      echo "ERROR: database not found at $DB_PATH" >&2
      exit 1
    fi
    if ! command -v htpasswd >/dev/null 2>&1; then
      echo "ERROR: htpasswd not found" >&2
      exit 1
    fi
    if [ -n "${3:-}" ]; then
      reset_password "$3"
    else
      new_pass=$(openssl rand -base64 32 | head -c 24)
      reset_password "$new_pass"
    fi
    ;;
  *)
    echo "Usage: npanel admin reset-password [new_password]"
    echo "   or: npanel-agent create-admin [new_password]"
    exit 1
    ;;
esac
EOF
  chmod 0700 /usr/local/bin/npanel
}


# ==============================================================================
# PHASE 1: PRE-FLIGHT CHECKS
# ==============================================================================

phase_preflight() {
  log_step 1 "Pre-flight checks"
  
  # OS Detection
  if [ ! -f /etc/os-release ]; then
    log_error "Cannot detect OS - /etc/os-release not found"
    exit "$EXIT_UNSUPPORTED_OS"
  fi
  
  . /etc/os-release
  DISTRO="$ID"
  VERSION="$VERSION_ID"
  
  log_info "Detected: $DISTRO $VERSION"
  
  case "$DISTRO" in
    ubuntu)
      if ! [[ "$VERSION" =~ ^(20\.04|22\.04) ]]; then
        log_error "Ubuntu $VERSION not supported (need 20.04 or 22.04)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    debian)
      if ! [[ "$VERSION" =~ ^(11|12) ]]; then
        log_error "Debian $VERSION not supported (need 11 or 12)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    rocky|almalinux)
      if ! [[ "$VERSION" =~ ^(8|9) ]]; then
        log_error "$DISTRO $VERSION not supported (need 8 or 9)"
        exit "$EXIT_UNSUPPORTED_OS"
      fi
      ;;
    *)
      log_error "Unsupported OS: $DISTRO"
      exit "$EXIT_UNSUPPORTED_OS"
      ;;
  esac
  
  log_success "OS check passed: $DISTRO $VERSION"
  
  # Root check
  if [ $EUID -ne 0 ]; then
    log_error "Must run as root"
    exit "$EXIT_PERMISSIONS_ERROR"
  fi
  log_success "Running as root"

  # Architecture check
  local arch
  arch=$(uname -m)
  if [ "$arch" != "$REQUIRED_ARCH" ]; then
    fail "Unsupported CPU architecture: $arch" "Only amd64/x86_64 is supported"
  fi
  log_success "CPU architecture OK: $arch"
  
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
  log_step 2 "State detection"
  
  if [ -d "$INSTALL_PATH" ]; then
    log_warn "Existing installation detected"
    log_info "Repair mode: will preserve existing data"
  else
    log_success "Fresh installation"
  fi
}

# ==============================================================================
# STEP 3: SYSTEM VERIFICATION
# ==============================================================================

phase_system_verification() {
  log_step 3 "System verification"

  detect_pkg_manager
  check_required_repos

  require_cmd systemctl "Install systemd"
  require_cmd ldd "Install glibc (ldd)"
  require_cmd curl "Install curl"
  require_cmd tar "Install tar"
  require_cmd sha256sum "Install coreutils"
  require_cmd file "Install file"
  require_cmd ss "Install iproute2 (ss)"
  require_cmd htpasswd "Install apache2-utils (Debian/Ubuntu) or httpd-tools (Rocky/Alma)"

  check_systemd_running
  check_cgroups_v2
  check_unix_socket_support
  check_exec_mounts
  check_ports_free
  check_security_modules
}

# ==============================================================================
# STEP 4: PACKAGE VERSION VERIFICATION
# ==============================================================================

phase_package_verification() {
  log_step 4 "Package version verification"

  set_version_matrix

  check_version_range "systemd" "$(get_systemd_version)" "$SYSTEMD_MIN" "$SYSTEMD_MAX"
  check_version_range "kernel" "$(get_kernel_version)" "$KERNEL_MIN" "$KERNEL_MAX"
  check_version_range "glibc" "$(get_glibc_version)" "$GLIBC_MIN" "$GLIBC_MAX"
  check_version_range "openssl" "$(get_openssl_version)" "$OPENSSL_MIN" "$OPENSSL_MAX"
  check_version_range "curl" "$(get_curl_version)" "$CURL_MIN" "$CURL_MAX"
  check_version_range "tar" "$(get_tar_version)" "$TAR_MIN" "$TAR_MAX"
  check_version_range "sqlite3" "$(get_sqlite_version)" "$SQLITE_MIN" "$SQLITE_MAX"
  check_version_range "iproute2" "$(get_iproute_version)" "$IPROUTE_MIN" "$IPROUTE_MAX"

  if command -v mariadb >/dev/null 2>&1 || command -v mysql >/dev/null 2>&1; then
    check_version_range "mariadb-client" "$(get_mariadb_version)" "$MARIADB_MIN" "$MARIADB_MAX"
  else
    if [ "$PKG_MGR" = "apt" ]; then
      fail "MariaDB/MySQL client not found" "Install: sudo apt-get install -y mariadb-client"
    else
      fail "MariaDB/MySQL client not found" "Install: sudo $PKG_MGR_CMD install -y mariadb"
    fi
  fi

  if command -v nft >/dev/null 2>&1; then
    check_version_range "nftables" "$(get_nft_version)" "$NFT_MIN" "$NFT_MAX"
  elif command -v iptables >/dev/null 2>&1; then
    check_version_range "iptables" "$(get_iptables_version)" "$IPTABLES_MIN" "$IPTABLES_MAX"
  else
    if [ "$PKG_MGR" = "apt" ]; then
      fail "Neither nftables nor iptables found" "Install: sudo apt-get install -y nftables"
    else
      fail "Neither nftables nor iptables found" "Install: sudo $PKG_MGR_CMD install -y nftables"
    fi
  fi
}

# ==============================================================================
# STEP 5: RELEASE & CHECKSUM VERIFICATION
# ==============================================================================

phase_release_verification() {
  log_step 5 "GitHub release verification"

  fetch_release_metadata
  log_success "Release: $RELEASE_NAME ($RELEASE_DATE)"

  CHECKSUMS_URL=$(resolve_asset_url '(?i)checksums(\\.sha256)?$' "") || true
  if [ -z "$CHECKSUMS_URL" ]; then
    fail "Checksums.sha256 not found in release assets" "Add Checksums.sha256 to GitHub release"
  fi

  API_URL=$(resolve_asset_url '(?i)npanel-api.*(linux|$).*(amd64|x86_64|$)' "$NPANEL_API_ASSET") || true
  AGENT_URL=$(resolve_asset_url '(?i)npanel-agent.*(linux|$).*(amd64|x86_64|$)' "$NPANEL_AGENT_ASSET") || true
  UI_URL=$(resolve_asset_url '(?i)npanel-ui.*(linux|$).*(amd64|x86_64|$)' "$NPANEL_UI_ASSET") || true
  FRONTEND_URL=$(resolve_asset_url '(?i)(npanel-frontend|frontend).*\.(tar\.gz|zip)$' "$NPANEL_FRONTEND_ASSET") || true

  if [ -z "$API_URL" ]; then
    fail "npanel-api artifact not found" "Ensure release includes API binary for linux/amd64"
  fi
  if [ -z "$AGENT_URL" ]; then
    fail "npanel-agent artifact not found" "Ensure release includes Agent binary for linux/amd64"
  fi
  if [ -z "$FRONTEND_URL" ]; then
    fail "frontend build artifact not found" "Ensure release includes frontend build archive (.tar.gz or .zip)"
  fi

  if [ -z "$UI_URL" ]; then
    fail "npanel-ui artifact not found" "Ensure release includes UI binary for linux/amd64"
  fi

  API_NAME=$(basename "$API_URL")
  AGENT_NAME=$(basename "$AGENT_URL")
  UI_NAME=$(basename "$UI_URL")
  FRONTEND_NAME=$(basename "$FRONTEND_URL")
}

# ==============================================================================
# STEP 6: ARTIFACT DOWNLOAD & COMPATIBILITY
# ==============================================================================

phase_artifact_verification() {
  log_step 6 "Artifact download & compatibility"

  ARTIFACT_DIR="/tmp/npanel-artifacts-$$"
  mkdir -p "$ARTIFACT_DIR"

  download_asset "$CHECKSUMS_URL" "$ARTIFACT_DIR/Checksums.sha256"
  log_success "Checksums downloaded"

  download_asset "$API_URL" "$ARTIFACT_DIR/$API_NAME"
  verify_checksum "$ARTIFACT_DIR/Checksums.sha256" "$ARTIFACT_DIR/$API_NAME"
  chmod +x "$ARTIFACT_DIR/$API_NAME"
  check_binary_compat "$ARTIFACT_DIR/$API_NAME"
  cp "$ARTIFACT_DIR/$API_NAME" "$ARTIFACT_DIR/npanel-api"

  download_asset "$AGENT_URL" "$ARTIFACT_DIR/$AGENT_NAME"
  verify_checksum "$ARTIFACT_DIR/Checksums.sha256" "$ARTIFACT_DIR/$AGENT_NAME"
  chmod +x "$ARTIFACT_DIR/$AGENT_NAME"
  check_binary_compat "$ARTIFACT_DIR/$AGENT_NAME"
  cp "$ARTIFACT_DIR/$AGENT_NAME" "$ARTIFACT_DIR/npanel-agent"

  download_asset "$UI_URL" "$ARTIFACT_DIR/$UI_NAME"
  verify_checksum "$ARTIFACT_DIR/Checksums.sha256" "$ARTIFACT_DIR/$UI_NAME"
  chmod +x "$ARTIFACT_DIR/$UI_NAME"
  check_binary_compat "$ARTIFACT_DIR/$UI_NAME"
  cp "$ARTIFACT_DIR/$UI_NAME" "$ARTIFACT_DIR/npanel-ui"

  download_asset "$FRONTEND_URL" "$ARTIFACT_DIR/$FRONTEND_NAME"
  verify_checksum "$ARTIFACT_DIR/Checksums.sha256" "$ARTIFACT_DIR/$FRONTEND_NAME"

  log_success "All artifacts verified"
}

# ==============================================================================
# STEP 7: ATOMIC DEPLOYMENT
# ==============================================================================

phase_deploy() {
  log_step 7 "Atomic deployment"

  if [ "$VERIFY_ONLY" = true ]; then
    log_success "Verify-only mode: skipping deployment"
    return
  fi

  local ts
  ts=$(date +%s)
  local staging_dir="$INSTALL_PATH/.staging-$ts"
  local backup_dir="$INSTALL_PATH/.backups/$ts"

  mkdir -p "$staging_dir/bin" "$staging_dir/public" "$INSTALL_PATH/.backups" "$backup_dir"

  cp "$ARTIFACT_DIR/npanel-api" "$staging_dir/bin/npanel-api"
  cp "$ARTIFACT_DIR/npanel-agent" "$staging_dir/bin/npanel-agent"
  if [ -f "$ARTIFACT_DIR/npanel-ui" ]; then
    cp "$ARTIFACT_DIR/npanel-ui" "$staging_dir/bin/npanel-ui"
  fi
  chmod +x "$staging_dir/bin/npanel-"*

  if file "$ARTIFACT_DIR/$FRONTEND_NAME" | grep -qi "Zip archive"; then
    require_cmd unzip "Install unzip"
    unzip -q "$ARTIFACT_DIR/$FRONTEND_NAME" -d "$staging_dir/public"
  else
    tar -xzf "$ARTIFACT_DIR/$FRONTEND_NAME" -C "$staging_dir/public"
  fi

  if [ -z "$(ls -A "$staging_dir/public" 2>/dev/null)" ]; then
    fail "Frontend build extraction resulted in empty public directory" "Verify frontend build archive contents"
  fi

  if [ -d "$INSTALL_PATH/bin" ] || [ -d "$INSTALL_PATH/public" ]; then
    tar -czf "$backup_dir/bin.tar.gz" -C "$INSTALL_PATH" bin public 2>/dev/null || true
  fi

  ROLLBACK_ACTIVE=true
  ROLLBACK_BACKUP_DIR="$backup_dir"

  rm -rf "$INSTALL_PATH/bin" "$INSTALL_PATH/public" 2>/dev/null || true
  mkdir -p "$INSTALL_PATH"
  mv "$staging_dir/bin" "$INSTALL_PATH/bin"
  mv "$staging_dir/public" "$INSTALL_PATH/public"

  rm -rf "$staging_dir"

  apply_selinux_contexts
  log_success "Deployment complete"
}

# ==============================================================================
# LEGACY SOURCE BUILD (DEPRECATED)
# ==============================================================================

phase_binaries() {
  fail "Legacy source build path is disabled" \
    "This installer only deploys verified release artifacts" \
    "Use --verify-only to validate compatibility"
}

# ==============================================================================
# PHASE 6: RUNTIME CONFIGURATION & INITIALIZATION
# ==============================================================================

phase_configuration() {
  log_step 8 "Runtime configuration & initialization"
  
  mkdir -p "$CONFIG_PATH" "$CONFIG_PATH/ssl" "$(dirname "$CREDENTIALS_FILE")"
  
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
  
  # Create initial admin user with secure password
  require_cmd htpasswd "Install apache2-utils/httpd-tools for bcrypt hashing"
  local admin_email="admin@localhost"
  local admin_password
  admin_password=$(openssl rand -base64 32 | head -c 24)
  local admin_hash
  admin_hash=$(htpasswd -bnBC 14 "" "$admin_password" | cut -d: -f2 | sed 's/^\$2y/\$2b/')

  sqlite3 "$DATA_PATH/npanel.db" << SQLEOF
INSERT INTO users (id, email, password_hash, full_name, role, status)
VALUES (
  'admin-001',
  '$admin_email',
  '$admin_hash',
  'Administrator',
  'admin',
  'active'
)
ON CONFLICT(email) DO UPDATE SET
  password_hash=excluded.password_hash,
  role='admin',
  status='active',
  updated_at=CURRENT_TIMESTAMP;
SQLEOF

  sqlite3 "$DATA_PATH/npanel.db" << SQLEOF 2>/dev/null || true
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_change_required', 'true');
SQLEOF

  log_success "Admin account initialized"

  # Store credentials securely (root-only)
  cat > "$CREDENTIALS_FILE" << EOF
ADMIN ACCOUNT (SENSITIVE)
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Email: $admin_email
Password: $admin_password

First Login: http://$(hostname -f 2>/dev/null || echo "SERVER_IP"):8080
EOF
  chmod 0600 "$CREDENTIALS_FILE"
  log_success "Credentials saved to: $CREDENTIALS_FILE"

  # Legacy location for compatibility
  cp "$CREDENTIALS_FILE" "$LEGACY_CREDENTIALS_FILE" 2>/dev/null || true
  chmod 0600 "$LEGACY_CREDENTIALS_FILE" 2>/dev/null || true

  install_recovery_cli
  log_success "Recovery CLI installed: /usr/local/bin/npanel"
  
  # Create systemd service files
  log_step 9 "Systemd service registration"
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
  
  if [ -x "$INSTALL_PATH/bin/npanel-ui" ]; then
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
  fi
  
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
  ! ss -tln 2>/dev/null | awk '{print $4}' | grep -q ":$port$" && return 0
  return 1
}

phase_startup() {
  log_step 10 "Service startup"
  
  # Create runtime directories
  mkdir -p /var/run/npanel
  chmod 0755 /var/run/npanel
  
  # Verify required binaries exist
  log_info "Verifying installation..."
  
  if [ ! -x "$INSTALL_PATH/bin/npanel-api" ]; then
    log_error "FATAL: npanel-api binary not found at $INSTALL_PATH/bin/npanel-api"
    log_error "Build failed - check logs: $LOG_FILE"
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
  
  # Start services in strict order: agent -> API -> UI
  log_info "Starting services..."

  if [ -x "$INSTALL_PATH/bin/npanel-agent" ]; then
    log_info "Starting npanel-agent service..."
    if systemctl start npanel-agent 2>&1 | tee -a "$LOG_FILE"; then
      sleep 1
      if systemctl is-active --quiet npanel-agent; then
        log_success "npanel-agent service started"
      else
        log_error "npanel-agent service failed to start"
        systemctl status npanel-agent >> "$LOG_FILE" 2>&1
        exit 1
      fi
    else
      log_error "Failed to start npanel-agent"
      exit 1
    fi
  else
    log_warn "npanel-agent binary not found - skipping"
  fi

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

  if [ -x "$INSTALL_PATH/bin/npanel-ui" ]; then
    log_info "Starting npanel-ui service..."
    if systemctl start npanel-ui 2>&1 | tee -a "$LOG_FILE"; then
      sleep 1
      if systemctl is-active --quiet npanel-ui; then
        log_success "npanel-ui service started"
      else
        log_error "npanel-ui service failed to start"
        systemctl status npanel-ui >> "$LOG_FILE" 2>&1
        exit 1
      fi
    else
      log_error "Failed to start npanel-ui"
      exit 1
    fi
  else
    fail "npanel-ui binary not found" "Ensure UI artifact was deployed correctly"
  fi
  
  # Enable services for autostart
  log_info "Enabling services for autostart..."
  if [ -x "$INSTALL_PATH/bin/npanel-ui" ]; then
    systemctl enable npanel-api npanel-agent npanel-ui 2>/dev/null || true
  else
    systemctl enable npanel-api npanel-agent 2>/dev/null || true
  fi
  log_success "Services enabled for autostart"
  
  log_success "Services started"
}

print_sensitive_credentials() {
  if [ -f "$CREDENTIALS_FILE" ]; then
    echo -e "${BOLD}${RED}SENSITIVE: INITIAL ADMIN CREDENTIALS${NC}"
    cat "$CREDENTIALS_FILE"
    echo ""
  else
    log_warn "Credentials file not found at $CREDENTIALS_FILE"
  fi
}

phase_postinstall_verification() {
  log_step 11 "Post-install verification"

  # Admin account exists
  local admin_exists
  admin_exists=$(sqlite3 "$DATA_PATH/npanel.db" "SELECT COUNT(*) FROM users WHERE email='admin@localhost' AND role='admin';" 2>/dev/null || echo 0)
  if [ "$admin_exists" -lt 1 ]; then
    fail "Admin account missing in database" "Re-run installer" "Or use: sudo npanel admin reset-password"
  fi
  log_success "Admin account exists"

  # API health
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    log_success "API health check passed"
  else
    fail "API health endpoint not responding" "Check: systemctl status npanel-api" "Review logs: journalctl -u npanel-api -n 50"
  fi

  # Agent connectivity (service level)
  if systemctl is-active --quiet npanel-agent; then
    log_success "Agent service is active"
  else
    fail "Agent service not active" "Check: systemctl status npanel-agent" "Review logs: journalctl -u npanel-agent -n 50"
  fi

  # UI reachability
  if curl -sf http://localhost:8080 >/dev/null 2>&1; then
    log_success "UI reachable on port 8080"
  elif curl -sf http://localhost:3001 >/dev/null 2>&1; then
    log_success "UI reachable on port 3001"
  else
    fail "UI not reachable on ports 8080/3001" "Check: systemctl status npanel-ui" "Verify frontend assets in $INSTALL_PATH/public"
  fi

  # API login verification
  local admin_password
  admin_password=$(awk -F': ' '/^Password:/ {print $2}' "$CREDENTIALS_FILE" 2>/dev/null || true)
  if [ -z "$admin_password" ]; then
    fail "Unable to read admin password from $CREDENTIALS_FILE" "Ensure credentials file exists and is readable by root"
  fi
  local login_payload
  login_payload=$(printf '{"email":"admin@localhost","password":"%s"}' "$admin_password")
  local login_resp
  login_resp=$(curl -sf http://localhost:3000/v1/auth/login -H "Content-Type: application/json" -d "$login_payload" || true)
  if echo "$login_resp" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    log_success "Admin login verified"
  else
    fail "Admin login failed" "Ensure credentials are correct" "Use: sudo npanel admin reset-password"
  fi
}

# ==============================================================================
# COMPLETION SUMMARY
# ==============================================================================

print_summary() {
  local creds_file="$CREDENTIALS_FILE"
  
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
    sudo cat $creds_file

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

RECOVERY (ROOT ONLY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Reset admin password:
    sudo npanel admin reset-password

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
  phase_system_verification
  phase_package_verification
  phase_release_verification
  phase_artifact_verification

  if [ "$VERIFY_ONLY" = true ]; then
    log_step 12 "Verification summary"
    log_success "VERIFY-ONLY PASS: system and artifacts are compatible"
    rm -rf "$ARTIFACT_DIR" 2>/dev/null || true
    return
  fi

  phase_deploy
  rm -rf "$ARTIFACT_DIR" 2>/dev/null || true

  phase_configuration
  phase_startup
  phase_postinstall_verification

  log_step 12 "Completion summary"
  print_sensitive_credentials
  log_success "All steps completed successfully"
  print_summary
}

# Setup logging and run
setup_logging
parse_args "$@"
main

exit $EXIT_SUCCESS
