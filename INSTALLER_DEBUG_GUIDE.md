# Npanel Installer Debug & Logging Guide

## Overview

The Npanel installer (`install_npanel.sh`) includes comprehensive logging, debugging, and diagnostic capabilities to help troubleshoot installation and runtime issues.

---

## Built-in Logging Functions

### Installer Output During Execution

The installer prints real-time logs with colored output:

```bash
[INFO]  - Informational messages (blue)
[ERROR] - Error messages (red)
```

### Log Files

All service output is logged to:

```bash
/var/log/npanel-backend.log   # Backend service logs
/var/log/npanel-frontend.log  # Frontend service logs
/var/log/nginx/error.log      # Nginx error logs (if available)
/var/log/nginx/access.log     # Nginx access logs (if available)
```

---

## Installation Diagnostics

### Service Error Tracking

The installer now tracks all failed services:

```bash
[INFO] Starting services for almalinux-9 (dnf)...
[INFO] Starting database services...
✓ MySQL started
✗ MySQL failed to start (may be normal if using MariaDB)
✓ MariaDB started
```

At the end, you get a summary:

```
============ SERVICE STARTUP SUMMARY ============
Failed to start or not available: dovecot exim pure-ftpd
================================================
```

### Port Listening Verification

Checks that critical services are actually listening:

```bash
✓ Nginx listening on port 8080
✓ Backend listening on port 3000
✓ Frontend listening on port 3001
✓ DNS service listening on port 53
```

If nginx is not listening, automatic diagnostics run:

```bash
=== NGINX DIAGNOSTIC REPORT ===
✓ Nginx is installed
✓ Nginx config is valid
✓ Nginx service is running (systemd)
✓ Port 8080 is listening
✓ SELinux is not enforcing (or not present)
✓ AppArmor not installed
...
```

---

## Nginx Diagnostics (`diagnose_nginx`)

Automatically triggered when nginx is not listening on port 8080.

### What It Checks

1. **Nginx Installation**
   - Verifies nginx binary exists
   
2. **Configuration**
   - Validates nginx config syntax with `nginx -t`
   - Shows config file content
   - Checks if npanel config exists at `/etc/nginx/conf.d/npanel.conf` or `/etc/nginx/sites-enabled/npanel.conf`

3. **Process Status**
   - Checks if nginx process is running (systemd or pgrep)
   - Verifies port 8080 is actually listening
   - Shows what process is using port 8080 (if not nginx)

4. **SELinux Issues**
   ```bash
   Checking SELinux status...
   SELinux status: Enforcing
   ⚠ SELinux is ENFORCING - may be blocking nginx
   
   To check SELinux denials for nginx:
     sudo grep nginx /var/log/audit/audit.log | tail -20
   
   To allow nginx to bind to port 8080:
     sudo semanage port -a -t http_port_t -p tcp 8080
   ```

5. **AppArmor Issues (Debian/Ubuntu)**
   - Checks if AppArmor is restricting nginx
   - Shows how to check AppArmor denials

6. **Firewall Issues**
   - Detects UFW and firewalld
   - Shows active firewall rules
   - Provides commands to open port 8080

7. **Error Logs**
   - Displays recent nginx error log entries

---

## Debug Commands

### View Service Logs

```bash
# View last 50 lines of backend logs
./install_npanel.sh logs
```

### View Specific Service Logs

```bash
# Backend logs (last 50 lines)
./install_npanel.sh backend-logs

# Frontend logs (last 50 lines, live)
./install_npanel.sh frontend-logs
```

### Check Service Status

```bash
# All services
./install_npanel.sh status

# Backend only
./install_npanel.sh backend-status

# Frontend only
./install_npanel.sh frontend-status
```

### Manage Services

```bash
# Start services
./install_npanel.sh start
./install_npanel.sh backend-start
./install_npanel.sh frontend-start

# Stop services
./install_npanel.sh stop
./install_npanel.sh backend-stop
./install_npanel.sh frontend-stop

# Restart services
./install_npanel.sh restart
./install_npanel.sh backend-restart
./install_npanel.sh frontend-restart
```

---

## Manual Debugging

### Check SystemD Logs

```bash
# Real-time backend logs
journalctl -u npanel-backend.service -f

# Real-time frontend logs
journalctl -u npanel-frontend.service -f

# Last 50 lines
journalctl -u npanel-backend.service -n 50
journalctl -u npanel-frontend.service -n 50
```

### Check Service Status

```bash
# Backend service status
systemctl status npanel-backend.service

# Frontend service status
systemctl status npanel-frontend.service

# Nginx status
systemctl status nginx
```

### Test Nginx Configuration

```bash
# Check nginx config syntax
nginx -t

# Test with specific config file
nginx -t -c /etc/nginx/conf.d/npanel.conf
```

### Check Port Listeners

```bash
# View all listening ports
netstat -tln

# Check specific port
netstat -tln | grep 8080
lsof -i :8080
ss -tln | grep 8080
```

### Check Connectivity

```bash
# Test backend directly
curl -v http://127.0.0.1:3000/v1/health

# Test frontend directly
curl -v http://127.0.0.1:3001/

# Test through nginx proxy
curl -v http://127.0.0.1:8080/
curl -v http://127.0.0.1:8080/admin
curl -v http://127.0.0.1:8080/api/v1/health
```

---

## Common Issues & Solutions

### Nginx Not Listening on Port 8080

Run the installer and check the nginx diagnostic output, or manually:

```bash
# Run diagnostics
./install_npanel.sh --no-restart

# Or check manually
nginx -t
systemctl status nginx
lsof -i :8080
```

**Check for:**
- SELinux blocking port 8080 (see SELinux section above)
- AppArmor profile restricting nginx
- Firewall blocking port 8080
- nginx config errors
- Another process using port 8080

### Backend Not Starting

```bash
# Check logs
journalctl -u npanel-backend.service -n 50
tail -f /var/log/npanel-backend.log

# Check if port 3000 is in use
lsof -i :3000

# Try manual start
cd /opt/npanel/backend
export $(grep -v '^#' .env | xargs)
npm run start:prod
```

### Frontend Not Starting

```bash
# Check logs
journalctl -u npanel-frontend.service -n 50
tail -f /var/log/npanel-frontend.log

# Check if port 3001 is in use
lsof -i :3001

# Try manual start
cd /opt/npanel/frontend
NODE_ENV=production npm start -- -p 3001
```

---

## Debug Output Examples

### Successful Installation

```
[INFO] Frontend build successful: .next directory verified
[INFO] Verifying all services are running...
[INFO] Starting services for almalinux-9 (dnf)...
[INFO] Starting database services...
✓ MariaDB started
[INFO] Starting nginx web server...
✓ Nginx started
...
[INFO] ✓ Nginx listening on port 8080
[INFO] ✓ Backend listening on port 3000
[INFO] ✓ Frontend listening on port 3001
[INFO] ✓ All critical services verified and running!
[INFO] Npanel is running:
[INFO]   API:     http://localhost:3000
[INFO]   Panel:   http://localhost:8080/admin
```

### Nginx Diagnostic Output

```
=== NGINX DIAGNOSTIC REPORT ===
✓ Nginx is installed
✓ Nginx config is valid
✓ Nginx service is running (systemd)
✗ Port 8080 is NOT listening
⚠ SELinux is ENFORCING - may be blocking nginx

To check SELinux denials for nginx:
  sudo grep nginx /var/log/audit/audit.log | tail -20

To allow nginx to bind to port 8080:
  sudo semanage port -a -t http_port_t -p tcp 8080
=== END NGINX DIAGNOSTIC REPORT ===
```

---

## Environment Variables

### Debug Options

```bash
# Skip self-update check
NPANEL_SKIP_SELF_UPDATE=1 ./install_npanel.sh

# Skip dependency installation
./install_npanel.sh --skip-deps

# Skip rebuild (use existing built files)
./install_npanel.sh --no-rebuild

# Don't restart services (useful for testing config)
./install_npanel.sh --no-restart

# Custom installation directory
NPANEL_DIR=/custom/path ./install_npanel.sh

# Custom git branch
NPANEL_BRANCH=develop ./install_npanel.sh

# Custom git ref (commit, tag, branch)
NPANEL_REF=abc123def ./install_npanel.sh
```

---

## Log Rotation

Service logs are appended to files. To view only recent entries:

```bash
# Last 100 lines
tail -n 100 /var/log/npanel-backend.log
tail -n 100 /var/log/npanel-frontend.log

# Follow in real-time
tail -f /var/log/npanel-backend.log
tail -f /var/log/npanel-frontend.log

# Search for errors
grep ERROR /var/log/npanel-backend.log
grep ERROR /var/log/npanel-frontend.log
```

---

## Getting Help

When reporting issues, include:

1. **Installation output** - Copy full installer output
2. **Service status** - `./install_npanel.sh status`
3. **Logs** - `./install_npanel.sh logs`
4. **Nginx diagnostics** - Output from `diagnose_nginx`
5. **System info** - OS, distro, kernel version
6. **Error messages** - Any visible errors

---

## Summary

The installer includes:

✅ Real-time colored logging  
✅ Service error tracking  
✅ Port listening verification  
✅ Automatic nginx diagnostics  
✅ SELinux/AppArmor detection  
✅ Firewall issue detection  
✅ Service management commands  
✅ Log viewing utilities  
✅ Manual debugging commands  

Use `./install_npanel.sh logs` to view logs anytime, and the installer will automatically diagnose any issues during deployment.
