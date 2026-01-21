# PRODUCTION DEPLOYMENT PLAYBOOK

**Date**: January 22, 2026  
**Task**: D6 - Single source of truth for operators  
**Audience**: System Administrators, DevOps Engineers, Hosting Operators  
**Scope**: Fresh install, upgrades, rollback, emergency recovery

---

## TABLE OF CONTENTS

1. **Quick Reference**
2. **Pre-Deployment Checklist**
3. **Fresh Installation (Development)**
4. **Fresh Installation (Production)**
5. **Update & Upgrade Procedure**
6. **Emergency Rollback**
7. **Post-Deployment Verification**
8. **Troubleshooting Guide**
9. **Service Lifecycle Commands**
10. **Disaster Recovery**

---

## QUICK REFERENCE

### ⚡ ONE-LINER COMMANDS

```bash
# Fresh install (automated)
curl -sSL https://install.npanel.io/install.sh | bash

# Fresh install (from GitHub - development)
git clone https://github.com/omenyx/npanel.git /opt/npanel && \
  cd /opt/npanel && \
  bash install_npanel.sh

# Check deployment status
sudo systemctl status npanel-backend npanel-frontend npanel-nginx

# View logs (last 50 lines)
sudo journalctl -u npanel-backend -n 50 -f  # Backend logs
sudo journalctl -u npanel-frontend -n 50 -f # Frontend logs
sudo tail -f /var/log/npanel-backend.log    # Application log

# Emergency stop
sudo systemctl stop npanel-backend npanel-frontend

# Quick rollback (to previous commit)
cd /opt/npanel && \
  sudo git reset --hard HEAD~1 && \
  cd backend && npm install && npm run build && cd .. && \
  cd frontend && npm install && npm run build && cd .. && \
  sudo systemctl restart npanel-backend npanel-frontend

# Full service restart
sudo systemctl restart npanel-backend npanel-frontend

# Health check
curl http://localhost:8080/health  # Should return JSON with status
```

---

## PRE-DEPLOYMENT CHECKLIST

### Hardware Requirements

| Resource | Minimum | Recommended | Production |
|----------|---------|-------------|-----------|
| **CPU** | 2 cores | 4 cores | 8+ cores |
| **RAM** | 2 GB | 4 GB | 16+ GB |
| **Disk** | 10 GB | 50 GB | 500+ GB |
| **Network** | 1 Mbps | 10 Mbps | 1+ Gbps |

### Software Requirements

```bash
# Check OS
uname -a  # Should be Linux

# Check required packages
which node        # Node.js 18+
which npm         # npm 8+
which mysql       # MySQL 5.7 or MariaDB 10.3+
which git         # git 2.0+
which nginx       # nginx 1.18+
which openssl     # openssl 1.1+
which systemctl   # systemd (Ubuntu 18.04+, CentOS 7+, Debian 10+)

# Install missing packages (Ubuntu/Debian)
sudo apt update && sudo apt install -y \
  nodejs npm mysql-server nginx openssl git build-essential

# Install missing packages (CentOS/RHEL)
sudo yum install -y \
  nodejs npm mariadb-server nginx openssl git gcc-c++
```

### Pre-Flight Checks

```bash
# 1. Verify ports are free
sudo netstat -tulpn | grep -E ':(3000|3001|8080|2082|2083|2086|2087|3306|25)'
# Should be empty or show existing NPanel services

# 2. Check disk space
df -h /  # Should have at least 5 GB free

# 3. Verify user permissions
sudo id npanel 2>/dev/null || echo "User npanel does not exist (OK - will be created)"

# 4. Test internet connectivity
ping -c 2 github.com  # Should succeed

# 5. Check root access
sudo whoami  # Should output "root"
```

---

## FRESH INSTALLATION (Development)

### Scenario: Deploy NPanel on development/test server

**Time**: ~10 minutes  
**Risk**: LOW (dev environment)  
**Rollback**: Simple (delete /opt/npanel)

### Step 1: Clone Repository

```bash
cd /tmp
git clone https://github.com/omenyx/npanel.git /opt/npanel
cd /opt/npanel
```

### Step 2: Run Installer

```bash
# Dry-run first (non-destructive)
sudo bash install_npanel.sh --dry-run

# If OK, run full installer
sudo bash install_npanel.sh
```

### Step 3: Configure Environment

```bash
# Edit backend environment
sudo nano /opt/npanel/backend/.env

# Should contain:
NODE_ENV=development          # ← CHANGE to 'development'
DB_HOST=localhost
DB_NAME=npanel
DB_USER=npanel
DB_PASSWORD=<generated>
JWT_SECRET=<generated>

# Save and exit (Ctrl+X, Y, Enter)
```

### Step 4: Start Services

```bash
# Start all services
sudo systemctl start npanel-backend npanel-frontend

# Enable auto-start on reboot
sudo systemctl enable npanel-backend npanel-frontend

# Check status
sudo systemctl status npanel-backend npanel-frontend
```

### Step 5: Verify Deployment

```bash
# Check backend is running
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}

# Check frontend is running
curl http://localhost:3001
# Expected: HTML content

# Check Nginx proxy
curl http://localhost:8080
# Expected: Redirects to login

# Check logs for errors
sudo journalctl -u npanel-backend -n 20
sudo journalctl -u npanel-frontend -n 20
```

---

## FRESH INSTALLATION (Production)

### Scenario: Deploy NPanel on production hosting control panel

**Time**: ~15 minutes  
**Risk**: MEDIUM (production)  
**Rollback**: git reset --hard to previous commit

### Pre-Production Checklist

- [ ] Firewall rules configured (allow 8080, 2082, 2083, 2086, 2087)
- [ ] DNS records updated (if using hostname)
- [ ] TLS certificates obtained/generated
- [ ] Database backups enabled
- [ ] Monitoring configured
- [ ] Post-deploy health check script prepared
- [ ] Rollback procedure documented and tested
- [ ] Change window scheduled (off-peak hours)
- [ ] On-call engineer available
- [ ] System snapshot taken (if possible)

### Step 1: Prepare System

```bash
# Create backup of system state
sudo cp -r /etc/nginx /etc/nginx.backup
sudo mysqldump --all-databases > /tmp/databases-backup.sql

# Create deployment log
DEPLOY_LOG="/var/log/npanel-deployment-$(date +%Y%m%d-%H%M%S).log"
sudo touch "$DEPLOY_LOG"
```

### Step 2: Clone & Install

```bash
# Clone latest release
cd /tmp
git clone --branch main https://github.com/omenyx/npanel.git /opt/npanel-new

# Run installer
cd /opt/npanel-new
sudo bash install_npanel.sh 2>&1 | tee "$DEPLOY_LOG"

# Check for errors
tail "$DEPLOY_LOG" | grep -i "error\|fail\|abort"
```

### Step 3: Configure for Production

```bash
# Edit backend environment
sudo nano /opt/npanel/backend/.env

# CRITICAL settings:
NODE_ENV=production          # ← Set to production
PORT=3000                    # ← Should be 3000
LOG_LEVEL=warn              # ← NOT debug
DB_HOST=localhost
DB_NAME=npanel
DB_USER=npanel
DB_PASSWORD=<secure-random> # ← Change from installer default
JWT_SECRET=<secure-random>  # ← Change from installer default
JWT_EXPIRY=24h              # ← Adjust as needed

# Save and exit
```

### Step 4: Install TLS Certificates

```bash
# Option A: Self-signed (for testing)
sudo openssl req -x509 -newkey rsa:2048 \
  -keyout /etc/ssl/private/npanel.key \
  -out /etc/ssl/certs/npanel.crt \
  -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Org/CN=$(hostname)"

# Option B: Real certificate (production)
# Upload your certificate files to:
#   /etc/ssl/certs/npanel.crt
#   /etc/ssl/private/npanel.key
# Then set permissions:
sudo chmod 644 /etc/ssl/certs/npanel.crt
sudo chmod 600 /etc/ssl/private/npanel.key
```

### Step 5: Verify Configuration

```bash
# Validate Nginx configuration
sudo nginx -t
# Expected: nginx: configuration file test is successful

# Verify required services
sudo systemctl list-unit-files | grep npanel
# Expected: 
#   npanel-backend.service        enabled
#   npanel-frontend.service       enabled
```

### Step 6: Start Services (Safe)

```bash
# Start backend first
sudo systemctl start npanel-backend
sleep 2

# Check backend is healthy
curl -s http://localhost:3000/health | grep -q status && echo "✓ Backend healthy" || echo "✗ Backend failed"

# Start frontend
sudo systemctl start npanel-frontend
sleep 2

# Check frontend is healthy
curl -s http://localhost:3001 > /dev/null && echo "✓ Frontend healthy" || echo "✗ Frontend failed"

# Reload Nginx
sudo systemctl reload npanel-nginx

# Check Nginx is healthy
sudo systemctl is-active npanel-nginx >/dev/null && echo "✓ Nginx healthy" || echo "✗ Nginx failed"
```

### Step 7: Post-Deployment Verification

```bash
# Full health check
bash scripts/health-check.sh  # Creates full report

# Sample manual checks:
curl http://localhost:8080/health    # Proxy health
curl https://localhost:2082/health   # HTTPS port 1
curl https://localhost:2083/health   # HTTPS port 2

# Database connectivity
mysql -u npanel -p"$DB_PASSWORD" -e "SELECT 1;" npanel

# Service logs
sudo journalctl -u npanel-backend --no-pager -n 10
sudo journalctl -u npanel-frontend --no-pager -n 10
```

### Step 8: Monitoring & Alerts

```bash
# Start continuous monitoring
watch -n 5 'sudo systemctl status npanel-backend npanel-frontend | grep Active'

# Set up log alerts
sudo tail -f /var/log/npanel-backend.log | grep -i "error"
```

---

## UPDATE & UPGRADE PROCEDURE

### Scenario: Update NPanel from current version to latest

**Time**: ~5 minutes  
**Risk**: MEDIUM (service restart)  
**Rollback**: git reset --hard to previous commit

### Pre-Update

```bash
# Document current state
CURRENT_COMMIT=$(cd /opt/npanel && git rev-parse HEAD)
echo "Current commit: $CURRENT_COMMIT"

# Backup .env files
sudo cp /opt/npanel/backend/.env /opt/npanel/backend/.env.backup
sudo cp /opt/npanel/frontend/.env /opt/npanel/frontend/.env.backup

# Check disk space
df -h / | tail -1  # Need at least 2 GB free

# Verify services running
sudo systemctl status npanel-backend npanel-frontend | grep Active
```

### Update Process

```bash
# Step 1: Stop services (important!)
echo "Stopping services..."
sudo systemctl stop npanel-backend npanel-frontend
sleep 2

# Step 2: Verify stopped
sudo systemctl is-active npanel-backend npanel-frontend | grep inactive
if [[ $? -ne 0 ]]; then
  echo "ERROR: Services not stopped! Aborting."
  sudo systemctl start npanel-backend npanel-frontend
  exit 1
fi

# Step 3: Fetch latest code
echo "Fetching latest code..."
cd /opt/npanel
sudo git fetch origin main

# Step 4: Check for local changes
LOCAL_CHANGES=$(git status --porcelain | grep -v "^??")
if [[ -n "$LOCAL_CHANGES" ]]; then
  echo "WARNING: Local changes detected:"
  echo "$LOCAL_CHANGES"
  echo "Backing up changed files..."
  sudo git stash
  echo "Original changes saved to: git stash"
fi

# Step 5: Update code
echo "Updating code..."
sudo git reset --hard origin/main
sudo git clean -fd

# Step 6: Rebuild backend
echo "Rebuilding backend..."
cd /opt/npanel/backend
sudo npm install --production
sudo npm run build || {
  echo "ERROR: Backend build failed! Rolling back..."
  cd /opt/npanel
  sudo git reset --hard "$CURRENT_COMMIT"
  sudo systemctl start npanel-backend npanel-frontend
  exit 1
}

# Step 7: Rebuild frontend
echo "Rebuilding frontend..."
cd /opt/npanel/frontend
sudo npm install --production
sudo npm run build || {
  echo "ERROR: Frontend build failed! Rolling back..."
  cd /opt/npanel
  sudo git reset --hard "$CURRENT_COMMIT"
  sudo systemctl start npanel-backend npanel-frontend
  exit 1
}

# Step 8: Restart services
echo "Restarting services..."
cd /opt/npanel
sudo systemctl start npanel-backend npanel-frontend
sleep 3

# Step 9: Verify health
echo "Verifying health..."
curl -s http://localhost:3000/health | grep -q status || {
  echo "ERROR: Backend health check failed! Rolling back..."
  git reset --hard "$CURRENT_COMMIT"
  sudo systemctl restart npanel-backend npanel-frontend
  exit 1
}

echo "✓ Update successful!"
git log --oneline -5  # Show new commits
```

### Post-Update

```bash
# Monitor logs for errors
sudo journalctl -u npanel-backend -n 50 | grep -i error

# Full health check
bash scripts/health-check.sh

# Verify features work
curl http://localhost:8080/health

# Document update
echo "Update to $(git rev-parse --short HEAD) complete at $(date)" >> /var/log/npanel-updates.log
```

---

## EMERGENCY ROLLBACK

### Scenario: Update introduced critical bug, must rollback immediately

**Time**: ~5 minutes  
**Risk**: LOW (previous commit known good)  
**Recovery**: Returns to previous stable state

### Quick Rollback (Automated)

```bash
#!/bin/bash
set -e

echo "EMERGENCY ROLLBACK INITIATED"
CURRENT=$(cd /opt/npanel && git rev-parse --short HEAD)
PREVIOUS=$(cd /opt/npanel && git rev-parse --short HEAD~1)

# Stop services
echo "Stopping services..."
sudo systemctl stop npanel-backend npanel-frontend

# Rollback code
echo "Rolling back from $CURRENT to $PREVIOUS..."
cd /opt/npanel
sudo git reset --hard HEAD~1
sudo git clean -fd

# Rebuild
echo "Rebuilding..."
cd backend && sudo npm install --production && sudo npm run build && cd ..
cd frontend && sudo npm install --production && sudo npm run build && cd ..

# Restart
echo "Restarting services..."
sudo systemctl start npanel-backend npanel-frontend
sleep 2

# Verify
echo "Verifying health..."
curl -s http://localhost:3000/health || {
  echo "ERROR: Rollback failed - health check error!"
  exit 1
}

echo "✓ Rollback successful - now on $PREVIOUS"
```

### Manual Rollback (Step-by-Step)

```bash
# Step 1: View commit history
cd /opt/npanel
git log --oneline -10
# Pick the commit to rollback to (usually HEAD~1)

# Step 2: Stop services
sudo systemctl stop npanel-backend npanel-frontend

# Step 3: Rollback to specific commit
git reset --hard 37b4cf12  # Use commit hash from above
git clean -fd

# Step 4: Rebuild
cd backend && npm install && npm run build && cd ..
cd frontend && npm install && npm run build && cd ..

# Step 5: Restart
sudo systemctl start npanel-backend npanel-frontend

# Step 6: Verify
curl http://localhost:3000/health
echo "Rollback complete"
```

---

## POST-DEPLOYMENT VERIFICATION

### Comprehensive Health Check

```bash
#!/bin/bash

echo "=== NPanel Deployment Health Check ==="
echo ""

# Service status
echo "1. Service Status:"
sudo systemctl status npanel-backend --no-pager | grep Active
sudo systemctl status npanel-frontend --no-pager | grep Active
sudo systemctl status npanel-nginx --no-pager | grep Active

# Port availability
echo ""
echo "2. Port Availability:"
nc -zv localhost 3000 2>&1 | grep -q "succeeded" && echo "✓ Port 3000 (Backend)" || echo "✗ Port 3000 FAILED"
nc -zv localhost 3001 2>&1 | grep -q "succeeded" && echo "✓ Port 3001 (Frontend)" || echo "✗ Port 3001 FAILED"
nc -zv localhost 8080 2>&1 | grep -q "succeeded" && echo "✓ Port 8080 (Nginx)" || echo "✗ Port 8080 FAILED"

# HTTP Health Checks
echo ""
echo "3. HTTP Health Endpoints:"
curl -s http://localhost:3000/health | jq . && echo "✓ Backend /health" || echo "✗ Backend /health FAILED"
curl -s http://localhost:3001/health 2>/dev/null | head -20 | grep -q "html" && echo "✓ Frontend /health" || echo "✗ Frontend /health FAILED"
curl -s http://localhost:8080/health | jq . && echo "✓ Nginx /health" || echo "✗ Nginx /health FAILED"

# Database Connectivity
echo ""
echo "4. Database Connectivity:"
mysql -u npanel -h localhost -e "SELECT 1;" 2>/dev/null && echo "✓ MySQL connectivity" || echo "✗ MySQL FAILED"

# Disk Usage
echo ""
echo "5. Disk Usage:"
df -h /opt/npanel | tail -1 | awk '{print "  " $5 " used on /opt/npanel"}'
df -h / | tail -1 | awk '{print "  " $5 " used on /"}'

# Recent Errors
echo ""
echo "6. Recent Errors (last 10):"
sudo journalctl -u npanel-backend -p err --no-pager -n 10 || echo "  (none)"

echo ""
echo "=== Health Check Complete ==="
```

---

## TROUBLESHOOTING GUIDE

### Issue: Backend won't start

```bash
# Check logs
sudo journalctl -u npanel-backend -n 50

# Common causes:
# 1. Database not running
sudo systemctl status mysql

# 2. Database credentials wrong in .env
sudo cat /opt/npanel/backend/.env | grep DB_

# 3. Port 3000 already in use
sudo netstat -tulpn | grep :3000

# 4. Missing environment variables
sudo cat /opt/npanel/backend/.env | grep "^[A-Z]"

# 5. Build failed
cd /opt/npanel/backend && npm run build
```

### Issue: Frontend won't start

```bash
# Check logs
sudo journalctl -u npanel-frontend -n 50

# Common causes:
# 1. Port 3001 already in use
sudo netstat -tulpn | grep :3001

# 2. Build cache corrupted
cd /opt/npanel/frontend && rm -rf .next && npm run build

# 3. Node version wrong
node --version  # Should be 18+

# 4. Out of memory
free -h  # Check available RAM
```

### Issue: Nginx not serving

```bash
# Check Nginx syntax
sudo nginx -t

# Check Nginx logs
sudo journalctl -u npanel-nginx -n 50

# Common causes:
# 1. Backend/frontend not running
sudo systemctl status npanel-backend npanel-frontend

# 2. Upstream server wrong in nginx config
sudo grep -A 10 "upstream npanel" /etc/nginx/sites-available/npanel

# 3. Port 8080 already in use
sudo netstat -tulpn | grep :8080

# Restart Nginx
sudo systemctl restart npanel-nginx
```

---

## SERVICE LIFECYCLE COMMANDS

### Basic Commands

```bash
# Start all services
sudo systemctl start npanel-backend npanel-frontend

# Stop all services
sudo systemctl stop npanel-backend npanel-frontend

# Restart all services
sudo systemctl restart npanel-backend npanel-frontend

# Reload configuration (without stopping)
sudo systemctl reload npanel-nginx

# Check status
sudo systemctl status npanel-backend npanel-frontend

# Enable auto-start on reboot
sudo systemctl enable npanel-backend npanel-frontend

# Disable auto-start
sudo systemctl disable npanel-backend npanel-frontend
```

### Advanced Commands

```bash
# Watch real-time status
watch -n 2 'sudo systemctl status npanel-backend npanel-frontend | grep -E "Active|Main PID"'

# Check service dependencies
systemctl list-dependencies npanel-backend

# Restart only backend
sudo systemctl restart npanel-backend

# Restart only frontend
sudo systemctl restart npanel-frontend

# View service environment
systemctl show npanel-backend | grep Environment

# Show last 50 journal entries
sudo journalctl -u npanel-backend -n 50

# Stream logs in real-time
sudo journalctl -u npanel-backend -f
```

---

## DISASTER RECOVERY

### Database Corruption / Data Loss

```bash
# Step 1: Stop services
sudo systemctl stop npanel-backend npanel-frontend

# Step 2: Check backup exists
ls -la /var/backups/npanel/
# Expected: daily, weekly, monthly backups

# Step 3: Restore from backup
sudo mysql < /var/backups/npanel/npanel-latest.sql

# Step 4: Restart services
sudo systemctl start npanel-backend npanel-frontend

# Step 5: Verify
mysql -e "SELECT COUNT(*) as tables FROM information_schema.tables WHERE table_schema='npanel';"
```

### Complete Service Failure

```bash
# Step 1: Check what's broken
sudo systemctl status npanel-*

# Step 2: Attempt service recovery
sudo systemctl start npanel-backend npanel-frontend

# Step 3: If that fails, check logs
sudo journalctl -p err -n 100

# Step 4: If still broken, rollback to previous commit
cd /opt/npanel && git reset --hard HEAD~1

# Step 5: Rebuild and restart
cd backend && npm install && npm run build && cd ..
cd frontend && npm install && npm run build && cd ..
sudo systemctl restart npanel-backend npanel-frontend
```

### Manual Service Restart (Debug Mode)

```bash
# If systemd can't start service, debug with manual start
sudo systemctl stop npanel-backend

# Start with verbose output
cd /opt/npanel/backend
npm start  # Should show errors

# Common errors and fixes:
# - "Cannot find module X" → npm install
# - "EADDRINUSE" → port 3000 in use, kill process
# - "Database connection failed" → verify MySQL is running
```

---

## DEPLOYMENT SUCCESS CRITERIA

✅ **Deployment is successful when ALL of these are true:**

1. ✅ Backend service is running (`systemctl status npanel-backend` = active)
2. ✅ Frontend service is running (`systemctl status npanel-frontend` = active)
3. ✅ Nginx service is running (`systemctl status npanel-nginx` = active)
4. ✅ Backend health endpoint responds (`curl http://localhost:3000/health` = 200)
5. ✅ Frontend home page loads (`curl http://localhost:3001` = HTML content)
6. ✅ Proxy endpoint responds (`curl http://localhost:8080` = redirect to login)
7. ✅ Database connectivity works (`mysql -u npanel -e "SELECT 1;"` = success)
8. ✅ No error messages in logs (`journalctl -u npanel-backend -p err` = no recent errors)
9. ✅ Ports are listening (`netstat -tulpn | grep -E "3000|3001|8080"` = all present)
10. ✅ Services auto-start on reboot (`systemctl is-enabled npanel-backend` = enabled)

---

**Deployment Playbook Complete**: January 22, 2026  
**Audience**: Production Operators  
**Version**: 1.0 (Stable)  
**Last Updated**: January 22, 2026
