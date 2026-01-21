# Frontend Startup Error - Quick Fix Guide

## Problem
```
[ERROR] Frontend failed to start behind nginx (port 8080).
```

The build succeeds but the Next.js frontend service fails to start properly.

---

## Root Cause

The systemd service was using the wrong command to start the production Next.js server:

❌ **Before:**
```bash
ExecStart=/usr/bin/npm start -- -p 3001
```

✅ **After:**
```bash
ExecStart=/usr/bin/npm run start -- -p 3001
Environment="NODE_ENV=production"
```

### Why This Matters

- **Next.js 16** requires explicit `run` for the start script
- **NODE_ENV=production** must be set for production mode
- The build generates optimized `.next` directory which requires these settings
- Without `NODE_ENV=production`, Next.js may try to rebuild at runtime

---

## Solution

### Quick Fix (One-Liner)

```bash
# Re-run the installer to update systemd services
./install_npanel.sh --update --skip-deps --no-rebuild

# Or manually restart frontend after updating install script
systemctl restart npanel-frontend.service
systemctl status npanel-frontend.service
```

### Manual Fix

If you need to fix just the systemd service without re-running the installer:

```bash
# Edit the systemd service
sudo nano /etc/systemd/system/npanel-frontend.service
```

Update the `[Service]` section to:

```ini
[Service]
Type=simple
WorkingDirectory=/opt/npanel/frontend
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npm run start -- -p 3001
Restart=always
User=root
StandardOutput=append:/var/log/npanel-frontend.log
StandardError=append:/var/log/npanel-frontend.log
```

Then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart npanel-frontend.service
```

---

## Verification

### Check Service Status
```bash
systemctl status npanel-frontend.service
```

Should show:
```
● npanel-frontend.service - Npanel Frontend
     Active: active (running)
```

### Check Service Logs
```bash
journalctl -u npanel-frontend.service -n 50 -f

# Or view the log file directly
tail -f /var/log/npanel-frontend.log
```

### Check Port is Listening
```bash
netstat -tln | grep -E '3001|8080'
# Should show:
# tcp  0  0 0.0.0.0:3001  0.0.0.0:*  LISTEN
# tcp  0  0 0.0.0.0:8080  0.0.0.0:*  LISTEN
```

### Test Frontend Access
```bash
# Direct to Next.js server
curl http://127.0.0.1:3001/

# Through nginx proxy
curl http://127.0.0.1:8080/

# Admin page
curl http://127.0.0.1:8080/admin
```

---

## Debugging If Still Failing

### Check if npm packages are installed
```bash
cd /opt/npanel/frontend
npm list next
# Should show: next@16.1.3
```

### Try starting manually
```bash
cd /opt/npanel/frontend
export NODE_ENV=production
npm run start -- -p 3001
```

Look for errors in the output. Common issues:

| Error | Solution |
|-------|----------|
| `PORT 3001 already in use` | Kill the old process: `pkill -f 'node.*3001'` then restart service |
| `Cannot find module` | Run `npm ci` in frontend directory |
| `EACCES permission denied` | Check file permissions: `ls -la /var/log/npanel-frontend.log` |
| `next not found` | Run `npm install` in frontend directory |

### Check nginx configuration
```bash
# Verify nginx is running
systemctl status nginx

# Check nginx config
sudo nginx -t
# Should show: nginx: configuration file test is successful

# View the npanel configuration
cat /etc/nginx/conf.d/npanel.conf
# or
cat /etc/nginx/sites-enabled/npanel
```

---

## What The Fix Changes

The change enables:
1. **Explicit production mode** - `NODE_ENV=production`
2. **Proper script execution** - `npm run start` instead of `npm start`
3. **Port binding** - `-p 3001` flag properly passed to Next.js

This ensures:
- ✅ Next.js starts in production mode
- ✅ Uses the pre-built `.next` directory
- ✅ Listens on port 3001
- ✅ Nginx can proxy from 8080 → 3001

---

## Prevention

The fix has been applied to `install_npanel.sh`. Future installations will not have this issue.

If using an older version of the installer, update to the latest version:

```bash
git pull origin main
./install_npanel.sh --update
```

---

## Related Documentation

- [INSTALLATION_FIX_GUIDE.md](INSTALLATION_FIX_GUIDE.md) - Comprehensive installation troubleshooting
- [README.md](README.md) - Project overview
- [Nginx Configuration](INSTALLATION_FIX_GUIDE.md#nginx-proxy) - Proxy setup details
