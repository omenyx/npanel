# nPanel Universal Installer - Architecture & Design

**Version:** 1.0-enterprise
**Status:** Design Phase
**Target:** Production-grade, SRE-approved

---

## Executive Summary

A **single, idempotent, cross-distro installer** that:
- ✅ Verifies all binaries from GitHub with checksums
- ✅ Fails fast with human-readable errors
- ✅ Can be safely re-run without data loss
- ✅ Works across AlmaLinux, Rocky, Ubuntu, Debian
- ✅ Applies performance guardrails automatically
- ✅ Provides clean uninstall/rollback
- ✅ Suitable for junior SysAdmin to run on live servers

---

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│   ENTRY POINT: install.sh                       │
│   (Handles: piped execution, params, logging)   │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 1: PRE-FLIGHT CHECKS (FAIL FAST)       │
│   - OS detection & version validation           │
│   - Resource checks (CPU/RAM/disk/inode)        │
│   - Root/sudo validation                        │
│   - Port availability                           │
│   - GitHub connectivity                         │
│   - Existing installation detection             │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 2: STATE DETECTION & DECISIONS          │
│   - Check if fresh install vs upgrade/repair    │
│   - Load install manifest (~/.npanel-manifest)  │
│   - Determine safe actions                      │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 3: DEPENDENCY INSTALLATION              │
│   - Fetch latest versions from GitHub releases  │
│   - Verify checksums (sha256)                   │
│   - Install via native package manager          │
│   - Handle distro-specific differences          │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 4: BINARY DEPLOYMENT                    │
│   - Download binaries from GitHub               │
│   - Verify checksums                            │
│   - Deploy to /opt/npanel/bin                   │
│   - Set permissions (0755 / 4755)               │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 5: CONFIGURATION                        │
│   - Create system users/groups                  │
│   - Generate /etc/npanel/config.yaml            │
│   - Initialize database                         │
│   - Create systemd services                     │
│   - Apply cgroup limits                         │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 6: SERVICE STARTUP                      │
│   - Start: agent, api, watchdog                 │
│   - Verify: health checks                       │
│   - Register: systemd enable                    │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│   PHASE 7: FIRST-RUN SETUP                      │
│   - Generate admin credentials                  │
│   - Print access URL & ports                    │
│   - Next steps guide                            │
│   - Save manifest for future upgrades           │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
            ✅ READY FOR USE
```

---

## Phase 1: Pre-Flight Checks

### Exit Codes Strategy

```bash
0   = Success
1   = Generic error (user recoverable)
2   = OS not supported (fail fast)
3   = Insufficient resources (fail fast)
4   = Root/sudo required (fail fast)
5   = Port conflict (fail fast)
6   = GitHub unreachable (network error)
7   = Existing installation conflict (ask user action)
100 = Unrecoverable system error
```

### Checks Required

| Check | Impact | Action | Fix |
|-------|--------|--------|-----|
| OS supported | CRITICAL | Detect; if not supported → EXIT 2 | Show supported list |
| CPU ≥2 cores | WARNING | Warn if <2 | Can continue |
| RAM ≥2GB | WARNING | Warn if <2GB | Can continue |
| Disk ≥10GB | CRITICAL | Check /opt; if <10GB → EXIT 3 | Clean up or expand |
| Inode ≥10% free | CRITICAL | Check inodes; if <10% → EXIT 3 | Manual cleanup |
| Root/sudo | CRITICAL | Verify EUID=0; if not → EXIT 4 | Re-run with sudo |
| Port 80/443/8080 | CRITICAL | Check; if occupied → EXIT 5 | Show conflicts |
| GitHub access | CRITICAL | curl --head to releases; if fail → EXIT 6 | Check network |
| Existing install | WARNING | Check /opt/npanel; if exists → ask user | Upgrade/repair/fresh |

### Example Output

```
✓ Checking OS compatibility...
  Detected: Ubuntu 22.04 LTS
  Architecture: x86_64
  Status: SUPPORTED

✗ Checking disk space...
  Required: 10 GB
  Available: 8.5 GB
  Status: INSUFFICIENT

ERROR: Not enough disk space in /opt
  Suggested fixes:
    1. Clean logs: rm -rf /var/log/npm-cache-*
    2. Extend partition: lvextend -L +5G /dev/vg0/opt
    3. Use alternate path: installer --install-path /home/npanel

Exiting with code 3.
```

---

## Phase 2: State Detection & Decisions

### Manifest File (`~/.npanel-manifest.json`)

```json
{
  "version": "1.0.0",
  "installed_at": "2026-01-25T21:22:42Z",
  "install_path": "/opt/npanel",
  "install_method": "curl-piped",
  "distro": "ubuntu-22.04",
  "previous_version": null,
  "services_installed": ["npanel-agent", "npanel-api", "npanel-watchdog"],
  "checksums": {
    "backend": "sha256:abc123...",
    "frontend": "sha256:def456...",
    "agent": "sha256:ghi789..."
  },
  "backups": [
    {
      "timestamp": "2026-01-25T21:20:00Z",
      "file": "/opt/npanel/.backup.20260125-212000.tar.gz"
    }
  ]
}
```

### Decision Tree

```
IF manifest exists:
  → Check installed version vs latest
  → If same: "Already installed. Repair/reinstall? (R/F/C)"
  → If older: "Upgrade available. Proceed? (Y/N)"
  → IF previous install failed mid-way:
      → "Partial install detected. Resume? (R/F/C)"
ELSE:
  → Fresh install
```

---

## Phase 3: Dependency Installation

### Cross-Distro Handler

```bash
# DETECT distro
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO="$ID"
  VERSION="$VERSION_ID"
fi

# MAP to package manager
case "$DISTRO" in
  ubuntu|debian)
    PKG_MANAGER="apt-get"
    PKG_LIST="golang-1.23 nodejs npm nginx sqlite3 certbot ..."
    ;;
  rocky|almalinux|centos)
    PKG_MANAGER="dnf"
    PKG_LIST="golang nodejs npm nginx sqlite certbot ..."
    ;;
esac

# INSTALL with fallback
for pkg in $PKG_LIST; do
  if ! "$PKG_MANAGER" install -y "$pkg" 2>&1; then
    # Try alternative package name
    # If fails: track_skip and continue (optional pkgs)
  fi
done
```

### Checksum Verification

```bash
# 1. Fetch checksums from GitHub release
checksums=$(curl -fsSL "$GITHUB_RELEASE_URL/CHECKSUMS")

# 2. Download binary
curl -fsSL "$BINARY_URL" -o /tmp/npanel-api

# 3. Verify
echo "$checksums" | grep "npanel-api" | sha256sum -c --quiet || {
  error "Checksum mismatch - possible corruption"
  rm -f /tmp/npanel-api
  exit 1
}
```

---

## Phase 4: Binary Deployment

### Safe Deployment Pattern

```bash
# 1. Create staging directory
STAGING="/opt/npanel/.staging-$(date +%s)"
mkdir -p "$STAGING"

# 2. Download & verify
for binary in api agent watchdog; do
  download_verified "$binary" "$STAGING"
done

# 3. Atomic swap
mv /opt/npanel/bin /opt/npanel/bin.bak-$(date +%s)
mv "$STAGING" /opt/npanel/bin

# 4. Verify new binaries work
test_binaries_start 10s || {
  # Rollback
  rm -rf /opt/npanel/bin
  mv /opt/npanel/bin.bak-* /opt/npanel/bin
  error "Binary validation failed - rolled back"
  exit 1
}
```

---

## Phase 5: Configuration

### Auto-Generated Config

```yaml
# /etc/npanel/config.yaml
version: 1.0.0
admin:
  default_email: "admin@$(hostname -f)"
  # Password: generated at first run, stored securely
install_at: 2026-01-25T21:22:42Z
upgrade_path: /opt/npanel
database:
  path: /opt/npanel/data/npanel.db
  backup_dir: /opt/npanel/data/backups
services:
  api:
    port: 8080
    listen: 127.0.0.1
  agent:
    socket: /var/run/npanel-agent.sock
  watchdog:
    interval: 30s
cgroup:
  enabled: true
  memory_limit: 1G
  cpu_quota: 100000
```

### Systemd Service with cgroups

```ini
# /etc/systemd/system/npanel-api.service
[Unit]
Description=nPanel API Server
After=network.target

[Service]
Type=simple
User=npanel
Group=npanel
WorkingDirectory=/opt/npanel
ExecStart=/opt/npanel/bin/npanel-api

# Performance guardrails
MemoryLimit=1G
CPUQuota=100%
CPUAccounting=yes
MemoryAccounting=yes
TasksMax=512

# Restart policy
Restart=on-failure
RestartSec=5s
StartLimitInterval=300s
StartLimitBurst=3

[Install]
WantedBy=multi-user.target
```

---

## Phase 6: Service Startup

### Health Check Pattern

```bash
start_service() {
  local service=$1
  local timeout=${2:-30}
  
  systemctl start "$service"
  
  # Wait for service to be ready
  for i in $(seq 1 "$timeout"); do
    if systemctl is-active --quiet "$service"; then
      log_success "$service started"
      return 0
    fi
    sleep 1
  done
  
  error "$service failed to start within ${timeout}s"
  journalctl -u "$service" -n 20 | head
  return 1
}

# With automatic rollback
for service in npanel-agent npanel-api npanel-watchdog; do
  if ! start_service "$service" 30; then
    error "Service startup failed - initiating rollback"
    rollback_installation
    exit 1
  fi
done
```

---

## Phase 7: First-Run Setup

### Admin Credentials Generation

```bash
# Generate random password
ADMIN_PASSWORD=$(openssl rand -base64 32 | head -c 24)

# Store in secure location (permissions 0600)
cat > /root/.npanel-credentials << EOF
Admin User: admin
Password: $ADMIN_PASSWORD
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
First Login URL: https://$(hostname -f)
EOF
chmod 0600 /root/.npanel-credentials

# Print to console (once)
log_info "=== FIRST-RUN CREDENTIALS ==="
log_info "Admin user: admin"
log_info "Password: $ADMIN_PASSWORD"
log_info "Saved to: /root/.npanel-credentials"
```

### Output Example

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     ✓ nPanel Installation Complete                        ║
║     All Phases 1-5 Deployed Successfully                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

ACCESS INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Web UI:        https://203.0.113.42
API:           https://203.0.113.42:8080/api

Admin User:    admin
Password:      (see /root/.npanel-credentials)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED ACTIONS (within 24 hours)
  [ ] Login and change admin password
  [ ] Configure domain & SSL certificate
  [ ] Set up backup retention
  [ ] Configure administrator email

Documentation: https://github.com/omenyx/npanel
Support:       https://github.com/omenyx/npanel/issues

Installation Log: /var/log/npanel-install.log
Manifest:         /root/.npanel-manifest.json
```

---

## Uninstall / Rollback

### Uninstall Command

```bash
npanel-uninstall --full  # Full uninstall, remove user data
npanel-uninstall --config  # Remove config only
npanel-uninstall --backup  # Create backup before uninstall
```

### Rollback to Previous Version

```bash
# Automatic rollback (if install fails mid-way)
if ! verify_installation; then
  log "Installation verification failed"
  log "Initiating rollback to previous version..."
  
  if [ -f /opt/npanel/.backup.* ]; then
    tar xzf /opt/npanel/.backup.* -C /opt/npanel
    systemctl restart npanel-*
    log "Rollback successful"
  fi
fi
```

---

## Error Handling Strategy

### Error Context Capture

```bash
# Every function capture context
function_with_context() {
  {
    log "START: function_name"
    log "Context: parameter=$1"
    
    # Actual work
    command || {
      local exit_code=$?
      log "ERROR: command failed with exit code $exit_code"
      log "Working directory: $(pwd)"
      log "User: $(id -un)"
      return "$exit_code"
    }
    
    log "END: function_name"
  } 2>&1 | tee -a "$LOG_FILE"
}
```

### User-Friendly Error Messages

```bash
# BAD (stack trace)
Error: line 1234: command not found

# GOOD
✗ Package installation failed
  Package: grafana-server
  Reason: Not available in repository for Ubuntu 20.04
  
  Fix:
  1. Add Grafana repository:
     add-apt-repository ppa:grafana/grafana
  2. Update package cache:
     apt-get update
  3. Retry installation:
     apt-get install grafana-server
  
  Or skip (optional):
     installer --skip-grafana
```

---

## Logging Strategy

### Log Levels

```
INFO  - Installation progress
WARN  - Non-critical issues, can continue
ERROR - Critical, requires user action
DEBUG - Internal details (--debug flag)
```

### Log Files

```
/var/log/npanel-install.log    # Main install log
/var/log/npanel-install-debug.log  # Debug output (--debug)
/root/.npanel-manifest.json    # Installation state
```

### Security: No Secrets in Logs

```bash
# GOOD: Redact sensitive data
log "Connecting to database at $DB_HOST"
# ❌ DON'T log: log "Password: $DB_PASSWORD"

log "Admin credentials stored in /root/.npanel-credentials (perms: 0600)"
# ❌ DON'T log password directly
```

---

## Safety Checklist

- [ ] Never overwrite configs without backup
- [ ] Never remove files outside /opt/npanel, /etc/npanel, /var/log/npanel
- [ ] Always verify checksums from GitHub
- [ ] Always create rollback points
- [ ] Never run unvalidated code from stdin
- [ ] Always ask user before destructive operations
- [ ] Keep full audit trail in logs
- [ ] Test on supported distros before release
- [ ] Junior SysAdmin should safely run this on live servers

---

## Implementation Checklist

- [ ] Create main installer script (install.sh)
- [ ] Implement pre-flight checks module
- [ ] Build state detection (manifest handling)
- [ ] Create distro-specific handlers
- [ ] Implement checksum verification
- [ ] Build service startup with health checks
- [ ] Create admin credential generation
- [ ] Implement rollback logic
- [ ] Create uninstall script
- [ ] Add comprehensive logging
- [ ] Create error recovery guide
- [ ] Test on all supported distros
- [ ] Document for end users

---

## Performance Guarantees

- Installation time: <5 minutes (excluding package downloads)
- Agent CPU (idle): ≤0.5%
- Agent memory: ≤100MB
- API memory: ≤500MB
- Watchdog CPU: ≤0.1%

These are enforced via:
- cgroup memory limits
- No polling loops (event-driven)
- Efficient database queries
- Connection pooling
