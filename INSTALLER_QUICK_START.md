# nPanel Universal Installer - Quick Start & Reference

## Installation

### Standard Installation (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
```

### Alternative: Download & Run

```bash
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh -o npanel-install.sh
sudo bash npanel-install.sh
```

## Supported Systems

✅ **AlmaLinux** 8.x, 9.x
✅ **Rocky Linux** 8.x, 9.x
✅ **Ubuntu** 20.04 LTS, 22.04 LTS, 24.04
✅ **Debian** 11, 12

### Check Your System

```bash
cat /etc/os-release
```

## Pre-Installation Checklist

Before running the installer, verify:

```bash
# 1. Running as root or have sudo access
id

# 2. CPU cores (recommended: ≥2)
nproc

# 3. Memory (recommended: ≥2GB)
free -h

# 4. Disk space in /opt (required: ≥10GB)
df -h /opt

# 5. Inodes in /opt (required: <90% used)
df -i /opt

# 6. Ports available (80, 443, 8080, 9090, 3000)
sudo netstat -tlnp | grep -E ":80 |:443 |:8080 |:9090 |:3000 "

# 7. Network access to GitHub
curl -I https://api.github.com
```

## Installation Process

### Phase 1: Pre-Flight Checks
- OS and version validation
- Resource verification
- Permission checks
- Port availability
- GitHub connectivity

### Phase 2: State Detection
- Checks for existing installation
- Determines: fresh / upgrade / repair mode

### Phase 3: Verify GitHub Releases
- Fetches latest version info
- Downloads SHA256 checksums
- Validates integrity

### Phase 4: Dependency Installation
- Updates package manager cache
- Installs Go, Node, npm, nginx, sqlite3, certbot

### Phase 5: Binary Deployment
- Downloads binaries from GitHub (with checksum verification)
- Creates atomic staging environment
- Backs up previous version
- Deploys with zero-downtime swap

### Phase 6: Configuration
- Creates system users and groups
- Generates configuration files
- Initializes database
- Creates systemd services with cgroup limits

### Phase 7: Service Startup
- Starts agent, API, and watchdog
- Performs health checks
- Registers with systemd
- Prints access information

## First-Run Setup

After installation completes:

### 1. Access the Web UI

```bash
# Get credentials
cat /root/.npanel-credentials

# Access panel
open http://$(hostname -I | awk '{print $1}')
# Or
open https://your-domain.com
```

### 2. Login & Change Password

- **Email:** admin@yourdomain.com
- **Password:** See `/root/.npanel-credentials`
- **First Action:** Change admin password immediately

### 3. Configure Domain & SSL

```bash
# Update DNS
# Point your domain to: <server-ip>

# Install SSL certificate
sudo certbot certonly --nginx -d your-domain.com

# Or auto-renew
sudo certbot --nginx -d your-domain.com
```

### 4. Set Up Backups

Navigate to: Settings > Backups
- Enable automatic daily backups
- Set retention policy (e.g., keep 30 days)
- Test restore procedure

### 5. Configure Email

Navigate to: Settings > Email
- Set up SMTP credentials
- Configure sender email address
- Test email sending

## Common Operations

### View Installation Log

```bash
tail -f /var/log/npanel/install.log
```

### Debug Mode

```bash
sudo bash install-universal.sh --debug
tail -f /var/log/npanel/install-debug.log
```

### Check Service Status

```bash
sudo systemctl status npanel-*
sudo journalctl -u npanel-api -f
```

### Restart Services

```bash
sudo systemctl restart npanel-api
sudo systemctl restart npanel-agent
```

### View Configuration

```bash
cat /etc/npanel/config.yaml
cat /root/.npanel-manifest.json | jq .
```

## Upgrade

### Check Current Version

```bash
cat /root/.npanel-manifest.json | grep version
```

### Upgrade to Latest

```bash
# The installer detects existing installation and upgrades
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
```

The installer will:
- Detect current version
- Compare with latest available
- Offer upgrade if newer version exists
- Back up current binaries before upgrade
- Enable safe rollback if needed

## Repair / Reinstall

### Repair Current Installation

```bash
# Re-run installer in repair mode
sudo bash install-universal.sh --repair
```

This will:
- Keep all data intact
- Reinstall binaries
- Reconfigure services
- Useful if services became corrupted

## Uninstall

### Clean Uninstall (Remove Everything)

```bash
sudo bash npanel-uninstall.sh --full
```

⚠️ **Warning:** This removes:
- All nPanel binaries
- Configuration files
- BUT preserves: Database backups in `/opt/npanel/.backups/`

### Config-Only Uninstall (Keep Data)

```bash
sudo bash npanel-uninstall.sh --config-only
```

Removes configuration but preserves:
- `/opt/npanel/data/` (database, files)
- `/opt/npanel/.backups/` (backups)

### Rollback to Previous Version

```bash
sudo bash npanel-uninstall.sh --rollback
```

Restores from latest backup:
- Restores previous binaries
- Restarts services
- Database/data unchanged

## Troubleshooting

### Port 80/443 Already in Use

```bash
# Find what's using the port
sudo netstat -tlnp | grep :80

# Either:
# 1. Stop the conflicting service
sudo systemctl stop <service>

# 2. Or change nPanel API port in config
# Edit: /etc/npanel/config.yaml
# Restart: sudo systemctl restart npanel-api
```

### GitHub Unreachable

```bash
# Check network
curl -I https://api.github.com

# If behind proxy, configure:
export http_proxy=http://proxy.example.com:8080
export https_proxy=http://proxy.example.com:8080

# Then retry installation
curl -fsSL ... | bash
```

### Insufficient Disk Space

```bash
# Check current usage
df -h /opt

# Clean up logs
sudo rm -rf /var/log/npm*
sudo journalctl --vacuum=1w

# Or extend partition
sudo lvextend -L +10G /dev/vg0/opt
sudo resize2fs /dev/vg0/opt
```

### Service Failed to Start

```bash
# Check logs
sudo journalctl -xeu npanel-api.service

# Check configuration
cat /etc/npanel/config.yaml

# Try manual start
sudo /opt/npanel/bin/npanel-api
```

### Can't Connect to API

```bash
# Verify API is listening
sudo netstat -tlnp | grep npanel-api

# Check if firewall blocking
sudo ufw allow 8080/tcp
# or
sudo firewall-cmd --permanent --add-port=8080/tcp

# Test connectivity
curl http://127.0.0.1:8080/api/health
```

## Getting Help

### Check Documentation

```bash
# Installation architecture
less INSTALLER_ARCHITECTURE.md

# Error recovery guide
less INSTALLER_ERROR_RECOVERY.md

# Operations runbook
less /opt/npanel/OPERATIONS_RUNBOOK.md
```

### Create GitHub Issue

https://github.com/omenyx/npanel/issues/new

Include:
1. Your OS and version
2. Installation log: `cat /var/log/npanel/install.log`
3. Error message (if any)
4. Steps to reproduce

## Performance Monitoring

### Check CPU/Memory Usage

```bash
# Real-time monitoring
top -p $(pgrep -f npanel-api)

# Or use systemd
systemctl status npanel-api
```

### View Logs

```bash
# Recent API logs
journalctl -u npanel-api -n 50

# Follow logs in real-time
journalctl -u npanel-api -f
```

### Check Database

```bash
# Database location
ls -lh /opt/npanel/data/

# Backup database
sudo sqlite3 /opt/npanel/data/npanel.db ".backup /tmp/npanel-backup.db"
```

## Security Best Practices

### 1. Change Default Credentials
```bash
# Immediately after installation
cat /root/.npanel-credentials
# Then login and change password
```

### 2. Enable TLS/SSL
```bash
# Use Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

### 3. Restrict Access
```bash
# Firewall (Ubuntu)
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
```

### 4. Regular Backups
```bash
# Automated backups (UI: Settings > Backups)
# Manual backup
sudo sqlite3 /opt/npanel/data/npanel.db ".backup /mnt/backups/npanel-$(date +%s).db"
```

### 5. Keep Updated
```bash
# Check for updates
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
# The installer will automatically upgrade if newer version available
```

## Unattended Installation

For automation/IaC:

```bash
# Script mode (no prompts)
sudo bash install-universal.sh << 'EOF'
# Non-interactive mode
# (Design: installer detects fresh install and proceeds)
EOF

# Or via Ansible
ansible-playbook -i inventory.yml npanel-install.yml
```

## Support & Community

- **GitHub:** https://github.com/omenyx/npanel
- **Issues:** https://github.com/omenyx/npanel/issues
- **Documentation:** https://github.com/omenyx/npanel/wiki
- **Email:** support@npanel.example.com

---

**Last Updated:** 2026-01-25
**Installer Version:** 1.0.0
