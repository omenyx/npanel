# Npanel Self-Diagnostic Guide

## Quick Diagnostic (WSL AlmaLinux)

If your frontend loads but shows "Unable to reach backend API", run the comprehensive diagnostic:

```bash
sudo ./install_npanel.sh --full-diagnose
```

This will check:

### System Health
- ✓ OS, kernel, uptime
- ✓ Service status (backend, frontend, nginx)
- ✓ Port listening verification (3000, 3001, 8080, 2082-2087)

### Database Status
- ✓ Database file exists and location
- ✓ Database permissions (readable/writable)
- ✓ Database file size

### Configuration
- ✓ Backend .env file exists
- ✓ JWT_SECRET is configured
- ✓ DATABASE_PATH is configured

### Network Connectivity
- ✓ Backend API health check (port 3000)
- ✓ Frontend responsiveness (port 3001)
- ✓ Nginx proxy health (port 8080)

### Error Analysis
- ✓ Recent error logs from backend
- ✓ Recent error logs from frontend
- ✓ Actionable recommendations

---

## Quick Manual Checks

If you want to check specific things manually:

### Check if backend is running
```bash
systemctl status npanel-backend
```

### Check if port 3000 is listening
```bash
sudo netstat -tln | grep 3000
# or
sudo ss -tln | grep 3000
```

### View backend logs
```bash
sudo journalctl -u npanel-backend -n 100 --no-pager
```

### Test backend directly
```bash
curl -i http://127.0.0.1:3000/v1/health
```

### Check database file
```bash
ls -la /opt/npanel/data/npanel.sqlite
```

### Restart backend
```bash
sudo systemctl restart npanel-backend
# Then wait 3-5 seconds and check status
sleep 5
systemctl status npanel-backend
```

### Check nginx configuration
```bash
sudo nginx -t
```

### Restart all services
```bash
sudo ./install_npanel.sh --restart
```

---

## Common Issues & Solutions

### Issue: "Unable to reach backend API" on login page

**Cause 1: Backend service not running**
```bash
# Check status
systemctl status npanel-backend

# Restart
sudo systemctl restart npanel-backend

# View logs
sudo journalctl -u npanel-backend -n 50 --no-pager
```

**Cause 2: Database permission issues**
```bash
# Check database permissions
ls -la /opt/npanel/data/npanel.sqlite

# Should show something like: -rw-r--r-- 1 npanel npanel
# If permissions wrong, fix:
sudo chown npanel:npanel /opt/npanel/data/npanel.sqlite
sudo chmod 644 /opt/npanel/data/npanel.sqlite
```

**Cause 3: Port 3000 not listening**
```bash
# Verify port is listening
sudo netstat -tln | grep 3000

# If not, restart backend and check logs
sudo systemctl restart npanel-backend
sudo journalctl -u npanel-backend -n 100 --no-pager
```

**Cause 4: Nginx routing issue**
```bash
# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx

# Check nginx logs
sudo journalctl -u nginx -n 50 --no-pager
```

### Issue: Backend logs show "database handle is closed"

**Solution:**
```bash
# Delete old database
sudo rm /opt/npanel/data/npanel.sqlite

# Restart backend (will create new database)
sudo systemctl restart npanel-backend

# Wait for initialization
sleep 5

# Check status
systemctl status npanel-backend
```

### Issue: "Error: ENOENT: no such file or directory" for database

**Solution:**
```bash
# Create database directory manually
sudo mkdir -p /opt/npanel/data
sudo chown npanel:npanel /opt/npanel/data
sudo chmod 755 /opt/npanel/data

# Restart backend
sudo systemctl restart npanel-backend
```

---

## Diagnostic Output Interpretation

### GREEN (✓) indicators
- All services show ACTIVE
- All expected ports show LISTENING
- Database file exists and is readable/writable
- Backend API responds to health checks
- All network tests pass

**Next Step:** If all green, but issue persists, run:
```bash
sudo journalctl -u npanel-backend --no-pager | tail -100
```

### RED (✗) indicators
- Service is INACTIVE
- Port is NOT LISTENING
- Database file NOT FOUND
- API not responding

**Next Step:** Run the specific solution for that component above.

---

## Full Diagnostic Output Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 NPANEL FULL SYSTEM DIAGNOSTIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 SYSTEM INFORMATION
   OS: AlmaLinux 9.1
   Kernel: 5.15.90.1-microsoft-standard-WSL2
   Uptime: up 2 hours, 15 minutes

🔧 SERVICE STATUS
   ✓ npanel-backend: ACTIVE
   ✓ npanel-frontend: ACTIVE
   ✓ nginx: ACTIVE

🔌 PORT LISTENING STATUS
   ✓ Port 3000: LISTENING
   ✓ Port 3001: LISTENING
   ✓ Port 8080: LISTENING
   ✓ Port 2082: LISTENING
   ✓ Port 2083: LISTENING
   ✓ Port 2086: LISTENING
   ✓ Port 2087: LISTENING

💾 DATABASE STATUS
   ✓ Database file exists: /opt/npanel/data/npanel.sqlite (512K)
   ✓ Database is readable
   ✓ Database is writable

⚙️  ENVIRONMENT CONFIGURATION
   ✓ Backend .env exists
     - JWT_SECRET set: yes
     - DATABASE_PATH set: yes

🌐 NETWORK CONNECTIVITY TEST
   ✓ Backend API responding: http://127.0.0.1:3000/v1/health
   ✓ Frontend responding: http://127.0.0.1:3001
   ✓ Nginx proxy responding: http://127.0.0.1:8080

⚠️  RECENT SERVICE ERRORS (last 5 from each)
   Backend errors:
     (no errors found in logs)

   Frontend errors:
     (no errors found in logs)

💡 DIAGNOSTIC RECOMMENDATIONS
   ✓ No obvious issues detected - system appears healthy
   • If issues persist, check backend logs for details
   • Run: sudo journalctl -u npanel-backend --no-pager | tail -50

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## WSL-Specific Considerations

### Network Access from Windows
If you want to access from Windows host:
```bash
# Get WSL IP
hostname -I

# Access from Windows: http://<WSL-IP>:8080
```

### Database Location in WSL
```bash
# Default location
/opt/npanel/data/npanel.sqlite

# Can be viewed from Windows
\\wsl$\AlmaLinux\opt\npanel\data\npanel.sqlite
```

### Systemd on WSL
WSL2 supports systemd natively. Services run in background automatically.

---

## Emergency Reset

If everything is broken and you need to reset:

```bash
# Stop all services
sudo systemctl stop npanel-backend npanel-frontend nginx

# Delete database
sudo rm /opt/npanel/data/npanel.sqlite

# Restart
sudo systemctl start npanel-backend npanel-frontend nginx

# Wait 5 seconds
sleep 5

# Check status
sudo ./install_npanel.sh --status
```

---

## Getting Help

If diagnostic doesn't identify the issue, collect this information:

1. **Full diagnostic output**
   ```bash
   sudo ./install_npanel.sh --full-diagnose > diagnostic.txt 2>&1
   ```

2. **Backend logs** (last 200 lines)
   ```bash
   sudo journalctl -u npanel-backend -n 200 --no-pager > backend_logs.txt
   ```

3. **Backend startup logs**
   ```bash
   sudo journalctl -u npanel-backend --no-pager | tail -50 > startup_logs.txt
   ```

Then share these files with support.
