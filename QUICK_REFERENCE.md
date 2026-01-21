# Npanel Quick Reference - WSL AlmaLinux

## 🚀 Quick Start Commands

### Full System Diagnostic (Recommended First Step)
```bash
sudo ./install_npanel.sh --full-diagnose
```

### Service Management
```bash
sudo systemctl status npanel-backend npanel-frontend nginx    # Check status
sudo systemctl restart npanel-backend npanel-frontend nginx   # Restart all
sudo systemctl stop npanel-backend npanel-frontend nginx      # Stop all
sudo systemctl start npanel-backend npanel-frontend nginx     # Start all
```

### Helper Commands
```bash
sudo ./install_npanel.sh --status            # Check deployment status
sudo ./install_npanel.sh logs                # View combined logs
sudo ./install_npanel.sh backend-logs        # View backend logs only
sudo ./install_npanel.sh backend-restart     # Restart backend
sudo ./install_npanel.sh frontend-restart    # Restart frontend
sudo ./install_npanel.sh --rebuild-nginx     # Rebuild nginx config
```

---

## 🔍 Diagnostic Checks

### Is Backend Running?
```bash
systemctl status npanel-backend
# Should show: Active: active (running)
```

### Is Port 3000 Listening?
```bash
sudo netstat -tln | grep 3000
sudo ss -tln | grep 3000
# Should show: tcp ... 0.0.0.0:3000 ... LISTEN
```

### Can You Reach Backend?
```bash
curl -i http://127.0.0.1:3000/v1/health
# Should return HTTP 200 with {"status":"ok"}
```

### Is Database File Present?
```bash
ls -la /opt/npanel/data/npanel.sqlite
# Should show file with permissions -rw-r--r-- 1 npanel npanel
```

### Check Backend Logs for Errors
```bash
sudo journalctl -u npanel-backend -n 50 --no-pager
# Look for ERROR, FAILED, or EXCEPTION lines
```

---

## 🛠️ Common Fixes

### Backend Not Starting
```bash
# 1. Check logs
sudo journalctl -u npanel-backend -n 100 --no-pager

# 2. If "Cannot find module" error:
cd /opt/npanel/backend && npm install && npm run build

# 3. Restart
sudo systemctl restart npanel-backend
```

### Database Errors
```bash
# If "database handle is closed" or permission denied:

# Option 1: Delete corrupted database
sudo rm /opt/npanel/data/npanel.sqlite
sudo systemctl restart npanel-backend

# Option 2: Fix permissions
sudo chown npanel:npanel /opt/npanel/data/npanel.sqlite
sudo chmod 644 /opt/npanel/data/npanel.sqlite
sudo systemctl restart npanel-backend
```

### Port Already in Use
```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>

# Restart service
sudo systemctl restart npanel-backend
```

### Nginx Config Issues
```bash
# Test configuration
sudo nginx -t

# View error log
sudo tail -50 /var/log/nginx/error.log

# Restart nginx
sudo systemctl restart nginx
```

---

## 📊 Full Diagnostic Output Meanings

### ✓ (Green Check)
All good for that component. No action needed.

### ✗ (Red X)
Something is wrong. Review recommendations section.

---

## 📝 Log Locations

| Component | Log Command |
|-----------|------------|
| Backend | `sudo journalctl -u npanel-backend -n 100 --no-pager` |
| Frontend | `sudo journalctl -u npanel-frontend -n 100 --no-pager` |
| Nginx | `sudo tail -50 /var/log/nginx/error.log` |
| System | `sudo journalctl -n 50 --no-pager` |

---

## 📂 Important Paths

| Item | Path |
|------|------|
| Installation | `/opt/npanel` |
| Backend | `/opt/npanel/backend` |
| Frontend | `/opt/npanel/frontend` |
| Database | `/opt/npanel/data/npanel.sqlite` |
| Installer | `/opt/npanel/install_npanel.sh` |
| Backend .env | `/opt/npanel/backend/.env` |
| Frontend .env | `/opt/npanel/frontend/.env` |
| Nginx Config | `/etc/nginx/conf.d/npanel.conf` or `/etc/nginx/sites-available/npanel.conf` |
| SSL Certs | `/etc/ssl/certs/npanel.crt` and `/etc/ssl/private/npanel.key` |

---

## 🌐 Service Ports

| Service | Port | Access |
|---------|------|--------|
| Backend API | 3000 | http://127.0.0.1:3000 |
| Frontend | 3001 | http://127.0.0.1:3001 |
| Admin Dashboard | 2086 | https://127.0.0.1:2086 |
| Admin Dashboard (alt) | 2087 | https://127.0.0.1:2087 |
| Customer Portal | 2082 | https://127.0.0.1:2082 |
| Customer Portal (alt) | 2083 | https://127.0.0.1:2083 |
| Unified Proxy | 8080 | http://127.0.0.1:8080 |

---

## ⚡ Emergency Commands

### Full Reset
```bash
sudo systemctl stop npanel-backend npanel-frontend nginx
sudo rm /opt/npanel/data/npanel.sqlite
cd /opt/npanel
sudo bash install_npanel.sh --install
```

### View Real-Time Logs
```bash
sudo journalctl -u npanel-backend -f
# Press Ctrl+C to stop
```

### Kill All Npanel Processes
```bash
sudo killall -9 node npm
sudo systemctl restart npanel-backend npanel-frontend
```

---

## 🧪 Testing

### Test Backend Health
```bash
curl -i http://127.0.0.1:3000/v1/health
```

### Test Frontend
```bash
curl -i http://127.0.0.1:3001
```

### Test Nginx Proxy
```bash
curl -i http://127.0.0.1:8080
```

### Test Database
```bash
sqlite3 /opt/npanel/data/npanel.sqlite ".tables"
```

---

## 📚 Documentation Files

- [SELF_DIAGNOSTIC_GUIDE.md](SELF_DIAGNOSTIC_GUIDE.md) - Comprehensive diagnostic guide
- [BACKEND_CONNECTIVITY_TROUBLESHOOTING.md](BACKEND_CONNECTIVITY_TROUBLESHOOTING.md) - Backend API issues
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) - Full operations guide
- [DEPLOYMENT_PLAYBOOK.md](DEPLOYMENT_PLAYBOOK.md) - Deployment procedures

---

## 💡 Pro Tips

1. **Always run diagnostic first** → `sudo ./install_npanel.sh --full-diagnose`
2. **Check logs before restarting** → `sudo journalctl -u npanel-backend -n 50 --no-pager`
3. **Wait after restart** → Services take 3-5 seconds to stabilize
4. **Verify ports listening** → Before assuming service is down
5. **Check permissions** → Database needs to be readable/writable by `npanel` user
6. **Monitor logs while restarting** → Catch startup errors in real-time

```bash
# Run in one terminal
sudo journalctl -u npanel-backend -f

# In another terminal, restart
sudo systemctl restart npanel-backend
```

---

## ❓ Quick Decision Tree

**Frontend loads but shows "Unable to reach backend API"?**
1. Run: `sudo ./install_npanel.sh --full-diagnose`
2. Check: `sudo systemctl status npanel-backend`
3. Check: `sudo netstat -tln | grep 3000`
4. Check: `curl http://127.0.0.1:3000/v1/health`
5. View: `sudo journalctl -u npanel-backend -n 100 --no-pager`

**Can't access login page?**
1. Check: `sudo systemctl status nginx`
2. Test: `sudo nginx -t`
3. Restart: `sudo systemctl restart nginx`
4. Try: `curl http://127.0.0.1:8080`

**Database errors?**
1. Delete: `sudo rm /opt/npanel/data/npanel.sqlite`
2. Restart: `sudo systemctl restart npanel-backend`
3. Wait: `sleep 5`
4. Check: `ls -la /opt/npanel/data/npanel.sqlite`

---

**For detailed guides, see the documentation files listed above.**
