# nPanel Deployment Guide

## Installation Process (User View)

### Quick Install

```bash
# Step 1: Download installer
curl -fsSL https://npanel.io/install.sh -o /tmp/install-npanel.sh
chmod +x /tmp/install-npanel.sh

# Step 2: Run installer
sudo /tmp/install-npanel.sh

# Step 3: View credentials
cat /etc/npanel/initial-credentials.txt

# Step 4: Access UI
# Open browser: https://your-server-ip:443
# Login with credentials from step 3
```

### Binary Installer

```bash
curl -fsSL https://npanel.io/npanel-installer-linux-x64 -o /tmp/npanel-installer
chmod +x /tmp/npanel-installer
sudo /tmp/npanel-installer
```

## Installation Phases

### Phase 1: Validation

```
[ ] OS Detection (AlmaLinux 9, RHEL 9, Ubuntu 22.04+)
[ ] Disk space check (>10GB free in /)
[ ] RAM check (>2GB available)
[ ] CPU check (>2 cores)
[ ] Port availability (443, 8006, 8007)
[ ] Network connectivity
[ ] User privileges (must run as root)
```

### Phase 2: Dependency Installation

```
[ ] Install Go runtime (v1.23+)
[ ] Install build tools (gcc, make)
[ ] Install Nginx
[ ] Install SQLite / PostgreSQL
[ ] Install Redis
[ ] Install systemd utilities
```

### Phase 3: Build & Install

```
[ ] Clone/download nPanel source
[ ] Build installer binary
[ ] Build API binary
[ ] Build agent binary
[ ] Build static UI assets
[ ] Create directories (/etc/npanel, /var/lib/npanel, /var/log/npanel)
[ ] Set permissions (restricted)
```

### Phase 4: Configuration

```
[ ] Generate certificates (self-signed)
[ ] Create database schema
[ ] Create system users (npanel, npanel-agent)
[ ] Generate API secrets
[ ] Configure Redis
[ ] Configure Nginx reverse proxy
```

### Phase 5: Service Setup

```
[ ] Create systemd units:
    - npanel-api.service (starts API)
    - npanel-agent.service (starts Agent)
    - npanel-ui.service (Nginx reverse proxy)

[ ] Enable services to auto-start
[ ] Start all services
[ ] Wait for startup (30 seconds)
[ ] Verify all healthy
```

### Phase 6: First Run

```
[ ] Generate admin account
[ ] Generate initial password
[ ] Create default settings
[ ] Initialize audit log
[ ] Display access URL
[ ] Display login credentials
[ ] Show next steps
```

## File Layout

```
/etc/npanel/
├── config.yaml              # Main config
├── ssl/
│   ├── cert.pem            # Self-signed initially
│   └── key.pem
├── initial-credentials.txt  # SECURE - Delete after first login
└── secrets/
    ├── jwt-secret
    └── api-key-salt

/var/lib/npanel/
├── npanel.db               # SQLite database
├── ssl-cache/              # Let's Encrypt cache
└── backups/

/var/log/npanel/
├── api.log                 # JSON structured logs
├── agent.log
└── ui-access.log

/opt/npanel/
├── bin/
│   ├── npanel-api
│   ├── npanel-agent
│   └── npanel-installer
├── ui/                     # React build output
└── migrations/             # Database migrations

/var/run/npanel/
├── agent.sock              # Unix domain socket
└── api.pid
```

## Uninstall / Rollback

### Clean Uninstall

```bash
sudo /opt/npanel/bin/npanel-installer --uninstall
```

Steps:
```
[ ] Stop systemd services
[ ] Disable auto-start
[ ] Remove binaries from /opt/npanel
[ ] Remove config from /etc/npanel (optional: backup)
[ ] Remove logs from /var/log/npanel
[ ] Remove data from /var/lib/npanel (optional: backup)
[ ] Remove systemd units
[ ] Remove system users
[ ] Verify complete removal
```

### Rollback After Crash

If nPanel crashes and you need to rollback:

```bash
# Option 1: Just restart services
sudo systemctl restart npanel-api npanel-agent npanel-ui

# Option 2: Restore database from backup
sudo cp /var/lib/npanel/backups/latest.db /var/lib/npanel/npanel.db
sudo systemctl restart npanel-api

# Option 3: Full reinstall (preserves hosted data)
sudo /opt/npanel/bin/npanel-installer --reinstall
```

## Post-Installation

### 1. First Login

- User must change password
- Enable MFA (recommended)
- Configure SSL certificate (Let's Encrypt)

### 2. Server Configuration

```bash
# Access nPanel admin panel
https://your-server:443/admin

# Configure:
- Mail server settings
- DNS nameservers
- Backup destinations
- Resource limits
- Service settings (Apache/Nginx)
```

### 3. Create User Accounts

```bash
# Via CLI
sudo npanel-cli create-user \
  --email user@example.com \
  --password secure-password \
  --role reseller

# Via Web UI
Admin Panel → Users → Create New User
```

### 4. Create Hosting Packages

```bash
# Via CLI
sudo npanel-cli create-package \
  --name "Starter" \
  --domains 10 \
  --disk 50GB \
  --bandwidth 500GB \
  --databases 5

# Via Web UI
Admin Panel → Packages → Create Package
```

## Troubleshooting

### Services Not Starting

```bash
# Check systemd status
sudo systemctl status npanel-api
sudo systemctl status npanel-agent
sudo systemctl status npanel-ui

# View detailed logs
sudo journalctl -u npanel-api -n 50
sudo journalctl -u npanel-agent -n 50

# Manual start with output
sudo /opt/npanel/bin/npanel-api --debug
```

### Port Already in Use

```bash
# Find process using port 443
sudo lsof -i :443

# Kill conflicting service
sudo systemctl stop httpd    # or nginx, etc
```

### Database Issues

```bash
# Check database
sudo sqlite3 /var/lib/npanel/npanel.db "SELECT COUNT(*) FROM users;"

# Reset database
sudo rm /var/lib/npanel/npanel.db
sudo /opt/npanel/bin/npanel-api --init-db
sudo systemctl restart npanel-api
```

### Agent Communication Failure

```bash
# Check socket permissions
ls -la /var/run/npanel/agent.sock

# Check agent process
ps aux | grep npanel-agent

# Restart agent
sudo systemctl restart npanel-agent
```

## Performance Tuning

### Increase Job Workers

```yaml
# /etc/npanel/config.yaml
agent:
  max_workers: 10        # Increase from default 5
```

### Enable Caching

```yaml
redis:
  addr: localhost:6379
  cache_ttl: 3600
```

### Database Optimization

```bash
# Vacuum database
sudo sqlite3 /var/lib/npanel/npanel.db VACUUM;

# Analyze query plans
sudo sqlite3 /var/lib/npanel/npanel.db ANALYZE;
```

## Security Hardening

### 1. Firewall Rules

```bash
# Allow only management IPs
sudo firewall-cmd --add-rich-rule='rule family=ipv4 source address=203.0.113.0/24 port protocol=tcp port=443 accept'

# Deny all others
sudo firewall-cmd --add-rich-rule='rule family=ipv4 port protocol=tcp port=443 reject'
```

### 2. SSL Hardening

```bash
# Use Let's Encrypt instead of self-signed
sudo npanel-cli configure-ssl \
  --provider letsencrypt \
  --domain your-server.com
```

### 3. Enable SELinux Policy

```bash
# Apply nPanel-specific policy
sudo semanage fcontext -a -t npanel_var_lib_t "/var/lib/npanel(/.*)?"
sudo restorecon -R /var/lib/npanel
```

### 4. Disable Unnecessary Features

```yaml
# /etc/npanel/config.yaml
features:
  enable_ftp: false        # Disable if not needed
  enable_shell: false      # Disable shell access
```

## Monitoring

### Health Checks

```bash
# API health
curl https://localhost/health

# Agent health
curl --unix-socket /var/run/npanel/agent.sock http://localhost/health

# Redis health
redis-cli PING
```

### Metrics Export

```bash
# View metrics
curl https://localhost/metrics

# Parse Prometheus format
# Integrates with Prometheus/Grafana
```

## Support & Issues

See logs for troubleshooting:
```bash
tail -f /var/log/npanel/api.log
tail -f /var/log/npanel/agent.log
tail -f /var/log/npanel/ui-access.log
```
