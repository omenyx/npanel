# nPanel Installer - Error Recovery Guide

When the production installer fails, follow this guide to diagnose and recover.

## Common Error Codes

### Exit Code 127: Command Not Found
**Meaning:** A command was called that doesn't exist on the system.

**During Package Installation:**
```
[21:22:42]   Exit code: 127
[21:22:42]   During: Installing monitoring packages
```

**Recovery Steps:**

1. **Check the full installation log:**
   ```bash
   tail -200 /var/log/npanel-install.log
   ```

2. **Identify which package failed:**
   ```bash
   grep -A 5 "Exit code: 127" /var/log/npanel-install.log
   ```

3. **Check if package exists in repositories:**
   ```bash
   # For Ubuntu/Debian
   apt-cache search prometheus
   apt-cache search grafana
   
   # For CentOS/RHEL
   dnf search prometheus
   dnf search grafana
   ```

4. **Try updating package cache:**
   ```bash
   # Ubuntu/Debian
   apt-get update
   apt-get install -y prometheus grafana-server
   
   # CentOS/RHEL
   dnf update
   dnf install -y prometheus grafana
   ```

5. **If specific package not found:**
   - Try the manual installation documented in installer output
   - Check system requirements (need Ubuntu 20.04+ or CentOS 8+)
   - See "Alternative Package Installation" section below

### Exit Code 1: General Error
**Meaning:** Package installation failed (usually missing dependencies or repository issues).

**Recovery:**

1. **Check which package failed:**
   ```bash
   grep "✗\|error\|Error" /var/log/npanel-install.log | tail -20
   ```

2. **Attempt manual installation:**
   ```bash
   # Update and retry
   apt-get update
   apt-get upgrade
   apt-get install -y <failed-package-name>
   ```

3. **Check for conflicts:**
   ```bash
   apt-get check
   apt-get -f install  # Fix broken packages
   ```

4. **If still failing, check system resources:**
   ```bash
   free -h
   df -h /opt
   df -i /opt  # Check inodes
   ```

## Dependency Installation Failures

### Missing Go (golang-1.23)

**Error:**
```
E: Unable to locate package golang-1.23
```

**Solution:**
```bash
# Ubuntu/Debian - Add Go repository
add-apt-repository ppa:longsleep/golang-backports
apt-get update
apt-get install -y golang-1.23

# CentOS/RHEL
dnf install -y golang
```

### Missing Node.js (nodejs/npm)

**Error:**
```
E: Unable to locate package nodejs
```

**Solution:**
```bash
# Ubuntu/Debian - Add NodeSource repository
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# CentOS/RHEL
dnf install -y nodejs npm
```

### Missing Prometheus

**Error:**
```
E: Unable to locate package prometheus
```

**Solution:**
```bash
# Ubuntu/Debian
curl https://keybase.io/prometheus/pgp_keys.asc | sudo apt-key add -
add-apt-repository "deb https://packages.prometheus.io/apt/ $(lsb_release -sc) main"
apt-get update
apt-get install -y prometheus

# CentOS/RHEL - Install from source
wget https://github.com/prometheus/prometheus/releases/download/v2.40.5/prometheus-2.40.5.linux-amd64.tar.gz
tar xvfz prometheus-2.40.5.linux-amd64.tar.gz
mv prometheus-2.40.5.linux-amd64/prometheus /usr/local/bin/
mkdir -p /etc/prometheus
cp prometheus-2.40.5.linux-amd64/prometheus.yml /etc/prometheus/
```

### Missing Grafana

**Error:**
```
E: Unable to locate package grafana-server
```

**Solution:**
```bash
# Ubuntu/Debian
add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
apt-get update
apt-get install -y grafana-server

# CentOS/RHEL
dnf install -y https://dl.grafana.com/oss/release/grafana-9.3.0-1.x86_64.rpm
```

## Continuing Installation After Failure

### Option 1: Fix and Retry Installer

```bash
# Fix the issue manually (see sections above)
# Re-run installer
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-production.sh | sudo bash
```

### Option 2: Skip Failed Component and Continue

If a component is optional (Prometheus, Grafana, Email, DNS):

1. **Unset `set -e` behavior** (installer normally stops on error):
   ```bash
   # Download installer
   curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-production.sh -o /tmp/install-prod.sh
   
   # Edit to comment out `set -e` if needed
   vim /tmp/install-prod.sh
   
   # Run without stopping on errors
   bash /tmp/install-prod.sh
   ```

### Option 3: Complete Manual Installation

If installer repeatedly fails, install components manually:

```bash
# 1. Verify prerequisites
sudo bash /opt/npanel/scripts/check_prerequisites.sh

# 2. Install dependencies manually
sudo apt-get install -y golang-1.23 nodejs npm nginx sqlite3

# 3. Create directories
sudo mkdir -p /opt/npanel/{bin,config,data,public,scripts,ssl}

# 4. Deploy code
cd /opt/npanel
sudo git clone https://github.com/omenyx/npanel.git .
cd backend && go build -o /opt/npanel/bin/npanel-api .
cd ../frontend && npm install && npm run build

# 5. Initialize database
sqlite3 /opt/npanel/data/npanel.db < migrations.sql

# 6. Start services
sudo systemctl restart npanel-api
sudo systemctl restart nginx
```

## Diagnostic Collection

When creating a GitHub issue, collect this information:

```bash
# Create diagnostic bundle
mkdir -p ~/npanel-diagnostics

# System information
uname -a > ~/npanel-diagnostics/system.txt
lsb_release -a >> ~/npanel-diagnostics/system.txt

# Installation log
cp /var/log/npanel-install.log ~/npanel-diagnostics/

# Package versions
go version > ~/npanel-diagnostics/versions.txt
node --version >> ~/npanel-diagnostics/versions.txt
npm --version >> ~/npanel-diagnostics/versions.txt
apt-get --version >> ~/npanel-diagnostics/versions.txt || dnf --version >> ~/npanel-diagnostics/versions.txt

# Repository information
apt-cache policy >> ~/npanel-diagnostics/repos.txt || dnf repolist >> ~/npanel-diagnostics/repos.txt

# Available packages
apt-cache search prometheus grafana >> ~/npanel-diagnostics/packages.txt || dnf search prometheus grafana >> ~/npanel-diagnostics/packages.txt

# Disk/Memory
free -h > ~/npanel-diagnostics/resources.txt
df -h >> ~/npanel-diagnostics/resources.txt
df -i >> ~/npanel-diagnostics/resources.txt

# Pack and upload
tar czf ~/npanel-diagnostics.tar.gz ~/npanel-diagnostics/
echo "Upload ~/npanel-diagnostics.tar.gz to GitHub issue"
```

## Resuming Installation

If installer was interrupted, you can resume from where it left off:

1. **Check what was completed:**
   ```bash
   grep "✓\|success" /var/log/npanel-install.log | tail -20
   ```

2. **Check what failed:**
   ```bash
   grep "✗\|error\|Error" /var/log/npanel-install.log | tail -20
   ```

3. **Verify existing services:**
   ```bash
   systemctl status npanel-api npanel-agent npanel-watchdog
   ```

4. **If core services are running, you can:**
   - Access the panel: `http://<server-ip>`
   - Install missing optional components later
   - Continue configuration

## Getting Help

### Check Documentation
- Full deployment guide: `/opt/npanel/DEPLOYMENT_UBUNTU_FRESH.md`
- Operations runbook: `/opt/npanel/OPERATIONS_RUNBOOK.md`
- API documentation: `/opt/npanel/docs/API.md`

### Create GitHub Issue
https://github.com/omenyx/npanel/issues/new

Include:
1. Full error from `/var/log/npanel-install.log`
2. Exit code and line number
3. System information (OS, version, resources)
4. Steps to reproduce
5. Diagnostic bundle (see section above)

### Debugging Tips

**View real-time installation:**
```bash
# While installer is running in another terminal
tail -f /var/log/npanel-install.log
```

**Check service logs:**
```bash
# After partial installation
systemctl status npanel-api
journalctl -xeu npanel-api.service
```

**Verify database:**
```bash
sqlite3 /opt/npanel/data/npanel.db ".tables"
```

**Test package availability:**
```bash
# Before running installer
apt-cache policy golang-1.23
apt-cache policy grafana-server
```

## Success Indicators

After successful installation, you should see:

```bash
✓ nPanel is ready for production use!
Access your panel now at: http://<your-ip>

SERVICES STATUS
✓ npanel-agent         (running)
✓ npanel-api           (running)
✓ npanel-watchdog      (running)
✓ nginx                (running)
```

If any core service is not running, check logs:
```bash
journalctl -xeu npanel-api.service
journalctl -xeu nginx.service
```
