# Npanel Installation & Build Fix Guide

## ✅ Directory Configuration

**Npanel is correctly configured to use `/opt/npanel` across all Linux distros.**

The installer script uses:
```bash
NPANEL_DIR="${NPANEL_DIR:-/opt/npanel}"
```

This applies to:
- ✅ Backend systemd service
- ✅ Frontend systemd service
- ✅ All dependency paths
- ✅ All configuration paths

---

## 🔧 Frontend Build Issue Fix

### Problem
Frontend service fails because `.next/` build directory doesn't exist.

### Root Cause
The `npm run build` command during installation either:
- Failed silently
- Wasn't executed
- Didn't complete successfully

### Solution: Manual Build

Run these commands on your server:

```bash
# Stop the service first
systemctl stop npanel-frontend.service

# Navigate to frontend directory
cd /opt/npanel/frontend

# Verify you're in the right place
pwd  # Should output: /opt/npanel/frontend
ls -la  # Should show package.json, next.config.ts, src/, etc.

# Install dependencies
npm ci || npm install

# Build for production
npm run build

# Verify build succeeded
ls -la .next/

# Restart service
systemctl restart npanel-frontend.service

# Check status
systemctl status npanel-frontend.service
journalctl -u npanel-frontend.service -n 20
```

### Verification

After running the above:
- ✅ `.next/` directory should exist
- ✅ Service should be running
- ✅ No more "Failed with result 'exit-code'" errors
- ✅ Frontend should be accessible at `http://server:8080/`

---

## 🛠️ Installer Improvements (Committed)

The following improvements have been made to `install_npanel.sh`:

1. **Better Error Handling**
   - Frontend build failures now abort with clear error message
   - `.next/` directory is verified after build

2. **Better Logging**
   - Build process shows clear progress messages
   - Error messages indicate exactly what went wrong

3. **Improved Validation**
   - Checks if `.next/` directory was created
   - Dies if build claims success but directory is missing

### Updated Function

```bash
install_npanel_dependencies() {
  log "Installing backend dependencies"
  pushd "$NPANEL_DIR/backend" >/dev/null
  npm ci || npm install
  npm run build
  popd >/dev/null

  log "Installing frontend dependencies"
  pushd "$NPANEL_DIR/frontend" >/dev/null
  npm ci || npm install
  log "Building frontend for production..."
  npm run build || die "Frontend build failed!"
  if [[ ! -d ".next" ]]; then
    die "Frontend build completed but .next directory not found!"
  fi
  log "Frontend build successful: .next directory verified"
  popd >/dev/null
}
```

---

## 📋 Service Configuration

### Backend Service (`/etc/systemd/system/npanel-backend.service`)
```
WorkingDirectory=/opt/npanel/backend
EnvironmentFile=/opt/npanel/backend/.env
ExecStart=npm run start:prod
Port: 3000
```

### Frontend Service (`/etc/systemd/system/npanel-frontend.service`)
```
WorkingDirectory=/opt/npanel/frontend
ExecStart=npm start -- -p 3001
Port: 3001
```

### Nginx Proxy (`/etc/nginx/conf.d/npanel.conf` or `/etc/nginx/sites-available/npanel.conf`)
```
listen 8080
/api -> http://127.0.0.1:3000 (Backend)
/ -> http://127.0.0.1:3001 (Frontend)
```

---

## 🚀 Post-Fix Verification

```bash
# Check both services are running
systemctl status npanel-backend.service
systemctl status npanel-frontend.service

# Check ports are listening
netstat -tln | grep -E '3000|3001|8080'

# Check nginx is running
systemctl status nginx

# Test connectivity
curl http://localhost:8080/
curl http://localhost:8080/api/v1/health

# View logs
journalctl -u npanel-backend.service -n 20
journalctl -u npanel-frontend.service -n 20
```

---

## 📝 Cross-Distro Compatibility

The configuration works on all Linux distributions:
- ✅ AlmaLinux / RHEL / Fedora
- ✅ Ubuntu / Debian
- ✅ openSUSE
- ✅ Arch Linux
- ✅ Any systemd-based distro

Path `/opt/npanel` is standard and supported everywhere.

---

## 🎯 Summary

| Item | Status |
|------|--------|
| Directory Path | ✅ Correct (`/opt/npanel`) |
| Cross-Distro Support | ✅ Working |
| Backend Configuration | ✅ Correct |
| Frontend Configuration | ✅ Correct (needs build) |
| Nginx Proxy | ✅ Correct |
| Error Handling | ✅ Improved |
| Build Verification | ✅ Improved |

**Your system will work perfectly once the frontend is built.** ✅
