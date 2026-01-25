# nPanel Universal Installer - Deployment Verification Checklist

## Pre-Deployment Verification

Use this checklist **before** deploying to production servers.

### System Requirements Verification

- [ ] **OS Support:** System runs AlmaLinux/Rocky/Ubuntu/Debian (check `/etc/os-release`)
- [ ] **OS Version:** 
  - [ ] AlmaLinux 8.x or 9.x
  - [ ] Rocky Linux 8.x or 9.x
  - [ ] Ubuntu 20.04 LTS or 22.04 LTS
  - [ ] Debian 11 or 12
- [ ] **CPU:** At least 2 cores (`nproc` returns ≥2)
- [ ] **Memory:** At least 2GB RAM (`free -h` shows ≥2G)
- [ ] **Disk:** At least 10GB free in `/opt` (`df -h /opt`)
- [ ] **Inodes:** Less than 90% used in `/opt` (`df -i /opt`)
- [ ] **Root/Sudo:** Can execute `sudo` or running as root (`id` shows uid=0)

### Network & Connectivity

- [ ] **Internet Access:** Can reach GitHub API
  ```bash
  curl -I https://api.github.com
  ```
- [ ] **No Proxies:** Or proxy credentials available for automation
- [ ] **Port Availability:** Following ports not in use:
  - [ ] Port 80 (HTTP)
  - [ ] Port 443 (HTTPS)
  - [ ] Port 8080 (API)
  - [ ] Port 9090 (Monitoring)
  - [ ] Port 3000 (Frontend dev, if needed)
  ```bash
  sudo netstat -tlnp | grep -E ":80 |:443 |:8080 |:9090 |:3000 "
  ```
- [ ] **DNS Resolved:** Domain/hostname resolves correctly (if using domain)
  ```bash
  nslookup your-domain.com
  ```

### Firewall & Security

- [ ] **Firewall Rules:** Allow inbound:
  - [ ] Port 22 (SSH)
  - [ ] Port 80 (HTTP)
  - [ ] Port 443 (HTTPS)
  - [ ] Port 8080 (API, internal recommended)
- [ ] **SELinux/AppArmor:** Disabled or configured for nPanel (optional: installation can guide)
- [ ] **SSH Key:** Have SSH key for emergency access
- [ ] **Backup Plan:** Know how to restore if installation fails

### Backup & Rollback

- [ ] **Existing Data Backup:** If replacing an installation:
  ```bash
  # Backup existing config/data
  tar -czf npanel-backup-$(date +%s).tar.gz /opt/npanel/ /etc/npanel/
  ```
- [ ] **Previous Version Available:** Can rollback if needed
- [ ] **Backup Destination:** Have external backup storage ready

### Environmental Setup

- [ ] **Package Cache Fresh:** Run `sudo apt-get update` or `sudo dnf makecache` first
- [ ] **System Patched:** Latest security patches installed (`sudo apt-get upgrade`)
- [ ] **Time Synchronized:** NTP configured (`timedatectl` shows synchronized)
- [ ] **Logging Available:** Disk space for logs (`df -h /var/log`)

---

## Installation Execution Checklist

Run the installer and verify each step:

### Pre-Flight Checks (Phase 1)

The installer will verify these automatically. Confirm in log:

```
✓ OS: Ubuntu 22.04 LTS
✓ CPU Cores: 4 (required: 2)
✓ Memory: 8.0 GB (required: 2.0 GB)
✓ Disk /opt: 50 GB free (required: 10 GB)
✓ Inodes /opt: 65% used (required: <90%)
✓ Running as: root (UID 0)
✓ Port 80: Available
✓ Port 443: Available
✓ Port 8080: Available
✓ GitHub API: Reachable (response: 200 OK)
```

**What to do if Phase 1 fails:**
- [ ] Fix the issue identified
- [ ] Re-run installer
- [ ] Repeat Phase 1 verification

### State Detection (Phase 2)

Expected output:

```
Installation Type: FRESH
(or UPGRADE if detected existing 1.0.5, suggesting update to 1.1.0)
(or REPAIR if config/binaries corrupted)
```

**What to do if state detection fails:**
- [ ] Check manifest: `cat /root/.npanel-manifest.json`
- [ ] If corrupted, run with `--repair` flag
- [ ] Check for leftover processes: `ps aux | grep npanel`

### GitHub Release Verification (Phase 3)

Expected output:

```
Fetching latest release from GitHub...
Latest Version: v1.1.0
Release Date: 2026-01-25
Downloading checksums...
✓ Checksums.sha256 downloaded (size: 512 bytes)
```

**What to do if Phase 3 fails:**
- [ ] Check GitHub connectivity: `curl -I https://api.github.com`
- [ ] Check firewall/proxy settings
- [ ] Try again with `--debug` flag for verbose output

### Dependency Installation (Phase 4)

Expected output (Ubuntu):

```
Installing dependencies...
Setting up golang-1.23 (1.23.x-1) ...
Setting up nodejs (20.x) ...
Setting up npm (10.x) ...
Setting up nginx (1.x) ...
Setting up sqlite3 (3.x) ...
Setting up certbot (2.x) ...
✓ All dependencies installed
```

**What to do if Phase 4 fails:**
- [ ] Check package manager: `apt-get update`
- [ ] Check disk space: `df -h`
- [ ] Try again (installer may retry automatically)

### Binary Deployment (Phase 5)

Expected output:

```
Deploying binaries...
Creating staging directory: /opt/npanel/.staging
Downloading: npanel-api (14.2 MB)
  Verifying checksum...
  ✓ Checksum valid (sha256 match)
Downloading: npanel-agent (8.7 MB)
  Verifying checksum...
  ✓ Checksum valid
Downloading: npanel-watchdog (2.1 MB)
  Verifying checksum...
  ✓ Checksum valid
Backup existing binaries: /opt/npanel/.backups/bin-1674067200.tar.gz
Atomic swap: staging → production
✓ Binary deployment successful
```

**What to do if Phase 5 fails:**
- [ ] Check disk space in `/opt`: `df -h /opt`
- [ ] Check GitHub connection: can download large files?
- [ ] Try again (if network transient issue)
- [ ] Or rollback: `sudo bash npanel-uninstall.sh --rollback`

### Configuration & Services (Phase 6)

Expected output:

```
Creating configuration...
✓ Configuration file created: /etc/npanel/config.yaml
✓ Admin credentials generated and secured
✓ Credentials file: /root/.npanel-credentials (mode: 0600)

Creating systemd services...
✓ npanel-api.service created
  - MemoryLimit: 1G
  - CPUQuota: 100%
✓ npanel-agent.service created
  - MemoryLimit: 500M
  - CPUQuota: 50%
✓ Services enabled: systemctl daemon-reload done
```

**What to do if Phase 6 fails:**
- [ ] Check `/etc/npanel/config.yaml` is valid YAML
- [ ] Check `/root/.npanel-credentials` exists and readable
- [ ] Check systemd version: `systemctl --version`
- [ ] Look at journal: `journalctl -xeu npanel-api`

### Service Startup (Phase 7)

Expected output:

```
Starting services...
▶ Starting npanel-agent...
  ✓ npanel-agent is running (PID: 12345)
▶ Starting npanel-api...
  ✓ npanel-api is running (PID: 12346)

Health checks:
  ✓ npanel-agent: responding to health probes
  ✓ npanel-api: responding at http://127.0.0.1:8080/api/health

╔════════════════════════════════════════════════╗
║   ✓ nPanel Installation Complete               ║
║   All 7 Phases Successful                      ║
╚════════════════════════════════════════════════╝

ACCESS INFORMATION
  Web UI:    http://203.0.113.42
  API:       http://203.0.113.42:8080/api
  Admin:     admin@yourdomain.com
  Password:  [see /root/.npanel-credentials]

REQUIRED ACTIONS (within 24 hours)
  [ ] Login and change admin password
  [ ] Configure domain & SSL
  [ ] Set up backups
  [ ] Test access from external network
```

**What to do if Phase 7 fails:**
- [ ] Check service status: `systemctl status npanel-api`
- [ ] Check logs: `journalctl -u npanel-api -n 50`
- [ ] Check ports: `netstat -tlnp | grep npanel`
- [ ] Try manual start: `/opt/npanel/bin/npanel-api`

---

## Post-Installation Verification

After installation completes successfully:

### Verify Binaries

```bash
# Check binaries exist and are executable
ls -lh /opt/npanel/bin/
```

Expected output:
```
-rwxr-xr-x npanel-api      (14.2 MB)
-rwxr-xr-x npanel-agent    (8.7 MB)
-rwxr-xr-x npanel-watchdog (2.1 MB)
```

- [ ] All 3 binaries present
- [ ] All have execute permissions (x)

### Verify Services

```bash
# Check services are running
sudo systemctl status npanel-api
sudo systemctl status npanel-agent

# Check they're enabled (auto-start on reboot)
sudo systemctl is-enabled npanel-api
sudo systemctl is-enabled npanel-agent
```

Expected output:
```
● npanel-api.service - nPanel API
     Loaded: loaded (/etc/systemd/system/npanel-api.service; enabled; vendor preset: enabled)
     Active: active (running) since Sat 2026-01-25 14:23:45 UTC; 2min ago
     Main PID: 12346 (npanel-api)
     ...

● npanel-agent.service - nPanel Agent
     Loaded: loaded (/etc/systemd/system/npanel-agent.service; enabled; vendor preset: enabled)
     Active: active (running) since Sat 2026-01-25 14:23:40 UTC; 2min 5s ago
     Main PID: 12345 (npanel-agent)
     ...
```

- [ ] Both services showing "Active: active (running)"
- [ ] Both services showing "Enabled"
- [ ] No errors in status output

### Verify Configuration

```bash
# Check config file
cat /etc/npanel/config.yaml | head -20

# Check permissions
ls -l /etc/npanel/
ls -l /root/.npanel-credentials
```

Expected output for credentials:
```
-rw------- 1 root root ... /root/.npanel-credentials
```

- [ ] Config file exists and is readable
- [ ] Credentials file has 0600 permissions (owner-only readable)

### Verify Database

```bash
# Check database exists
ls -lh /opt/npanel/data/npanel.db

# Test database connectivity
sqlite3 /opt/npanel/data/npanel.db "SELECT count(*) FROM sqlite_master;"
```

Expected: Database file exists, is readable, queries work

- [ ] Database file exists and has reasonable size (>1MB after initialization)
- [ ] Can query database
- [ ] No database corruption errors

### Verify Logs

```bash
# Check installation log
tail -50 /var/log/npanel/install.log

# Check API is logging
tail -20 /var/log/npanel/api.log

# Or use journalctl
journalctl -u npanel-api -n 20
```

Expected: Clean logs, no ERROR or FATAL messages

- [ ] Install log shows successful completion
- [ ] API log shows startup messages
- [ ] No critical errors in logs

### Test API Connectivity

```bash
# Test API health endpoint
curl http://127.0.0.1:8080/api/health

# Or with credentials
curl -u admin@yourdomain.com:$(cat /root/.npanel-credentials | grep password | cut -d: -f2) \
  http://127.0.0.1:8080/api/v1/system/status
```

Expected: HTTP 200 with JSON response

- [ ] API responds to health check
- [ ] HTTP status is 200 or 401 (not 502/503)

### Test Web UI

```bash
# From outside the server:
curl -I http://$(hostname -I | awk '{print $1}')
# Or open in browser:
# http://<server-ip>
```

Expected: HTTP 200, can load HTML

- [ ] Web interface loads
- [ ] Can login with admin credentials
- [ ] Can access dashboard

### Test Manifest Tracking

```bash
# Check manifest (idempotency record)
cat /root/.npanel-manifest.json | jq .

# Expected structure:
{
  "version": "1.1.0",
  "installed_at": "2026-01-25T14:23:45Z",
  "installer_version": "1.0.0",
  "system": {
    "os": "Ubuntu",
    "os_version": "22.04",
    "architecture": "x86_64"
  },
  "binaries": {
    "api": "sha256:abc123...",
    "agent": "sha256:def456...",
    "watchdog": "sha256:ghi789..."
  }
}
```

- [ ] Manifest file exists
- [ ] Contains version information
- [ ] Contains SHA256 checksums for binaries

### Test Upgrade Detection

```bash
# Run installer again (should detect existing installation)
sudo bash install-universal.sh --debug 2>&1 | grep -i "installation type"

# Expected output:
# Installation Type: UPGRADE (if newer version available)
# OR
# Installation Type: FRESH (if already latest version)
```

- [ ] Installer correctly detects existing installation
- [ ] Doesn't crash or overwrite unexpectedly
- [ ] Offers to upgrade if newer available

### Test Uninstall/Rollback

```bash
# List available backups
sudo bash npanel-uninstall.sh --list-backups

# Expected: Shows timestamped backups of binaries
# (Don't actually uninstall in this test, just verify script works)

# Check status
sudo bash npanel-uninstall.sh --status

# Expected: Shows current installation details
```

- [ ] Can list backups
- [ ] Can check status without errors
- [ ] Uninstall script is ready if needed

---

## Production Readiness Sign-Off

After all verifications pass:

### Security Checklist

- [ ] Admin password changed from default
- [ ] TLS/SSL certificate installed
- [ ] Firewall configured (only needed ports open)
- [ ] SSH key-based authentication enabled
- [ ] sudo authentication configured
- [ ] SELinux/AppArmor policy updated (if using)
- [ ] Log rotation configured

### Operational Readiness

- [ ] Monitoring/alerting configured
- [ ] Backups configured and tested
- [ ] Runbook/documentation accessible to team
- [ ] On-call rotation aware of deployment
- [ ] Incident response plan reviewed
- [ ] Rollback procedure tested (non-destructive test)

### Documentation

- [ ] Installation log preserved: `/var/log/npanel/install.log`
- [ ] Credentials securely stored: `/root/.npanel-credentials`
- [ ] Configuration documented: `/etc/npanel/config.yaml`
- [ ] Access information recorded (IP, domain, ports)
- [ ] Support contacts documented

### Sign-Off

- [ ] **Installer Verification:** PASSED
- [ ] **Service Health:** PASSED
- [ ] **Security Review:** PASSED
- [ ] **Operations Review:** PASSED
- [ ] **Team Sign-Off:** PASSED

**Deployment Date:** ________________
**Deployed By:** ________________
**Approver:** ________________

---

## Quick Troubleshooting

### If Installation Fails

1. **Check Phase 1:** Did pre-flight checks pass?
   - If no: Fix system (CPU/RAM/disk/ports) and retry
   
2. **Check GitHub Connectivity:** Can reach https://api.github.com?
   - If no: Check network, proxy, firewall
   
3. **Check Disk Space:** Is `/opt` full?
   - If yes: Free up space and retry
   
4. **Check Logs:** What does `/var/log/npanel/install.log` say?
   - Review error message
   - Search GitHub issues for similar error
   - Create new issue if needed

5. **Retry with Debug:** Get more details
   ```bash
   sudo bash install-universal.sh --debug
   tail -f /var/log/npanel/install-debug.log
   ```

### If Installation is Stuck

1. **Check Running Processes:**
   ```bash
   ps aux | grep npanel
   ```

2. **Check for Network Timeout:**
   ```bash
   # Is GitHub reachable?
   curl -I --max-time 10 https://api.github.com
   ```

3. **Check Disk Activity:**
   ```bash
   # Is installer downloading?
   iotop -p $(pgrep -f install-universal)
   ```

4. **Wait or Kill:** If stuck >10 minutes, kill and retry

### If Services Won't Start

1. **Check Service Status:**
   ```bash
   sudo systemctl status npanel-api
   sudo journalctl -u npanel-api -n 50
   ```

2. **Check Configuration:**
   ```bash
   cat /etc/npanel/config.yaml
   ```

3. **Check Logs:**
   ```bash
   tail -100 /var/log/npanel/api.log
   ```

4. **Try Manual Start:**
   ```bash
   /opt/npanel/bin/npanel-api
   ```

5. **Try Repair:**
   ```bash
   sudo bash install-universal.sh --repair
   ```

---

**For detailed troubleshooting:** See `INSTALLER_ERROR_RECOVERY.md`

**For architecture details:** See `INSTALLER_ARCHITECTURE.md`

**For quick reference:** See `INSTALLER_QUICK_START.md`
