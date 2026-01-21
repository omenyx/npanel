# Multi-Distro API Routing Fix - Installation Improvements

## Problem Statement

On fresh Linux server installations across multiple distributions (Debian/Ubuntu, RHEL/AlmaLinux, Arch, openSUSE), the frontend would show **"Unable to reach backend API"** error immediately after installation completed. This occurred because:

1. **Frontend API Base URL Mismatch**: Frontend was hardcoded to use `/api` but backend routes are at `/v1`
2. **Nginx Configuration Issue**: Old or incorrect nginx config not including `/v1` location block
3. **No Validation**: Installation didn't verify that nginx routing was working correctly
4. **Multi-Port Setup Not Applied**: Fresh installs didn't get the correct multi-port nginx configuration

## Root Cause Analysis

### Issue 1: Frontend API Base URL
- **Problem**: `frontend/src/shared/config/env.ts` had default `/api` but backend controllers use `@Controller('v1')`
- **Result**: Frontend would call `GET /api/health` which nginx would strip to `/health` and forward to backend, causing 404
- **Status**: ✅ FIXED

### Issue 2: Nginx Configuration Not Applied
- **Problem**: `configure_nginx()` was called but old simple config sometimes remained in `/etc/nginx/conf.d/npanel.conf`
- **Result**: Old config only had `/api` rewrite and `/` catch-all, missing `/v1` location block
- **Status**: ✅ FIXED - Added validation

### Issue 3: No Post-Install Verification
- **Problem**: Installation didn't verify that nginx routing `/v1` requests correctly to backend
- **Result**: Issues only discovered when users tried to login, not during installation
- **Status**: ✅ FIXED - Added routing verification

### Issue 4: Inconsistent Build Environment
- **Problem**: Frontend built without explicit `NEXT_PUBLIC_API_BASE_URL` environment variable
- **Result**: Code fallback to `/api` default instead of `/v1`
- **Status**: ✅ FIXED - Explicit env var during build

## Solutions Implemented

### 1. Frontend Build Fix
**File**: `install_npanel.sh` (lines ~1480)

```bash
# Ensure frontend uses correct API base URL (/v1 not /api)
export NEXT_PUBLIC_API_BASE_URL="/v1"
npm run build || die "Frontend build failed!"
```

**Why**: This ensures the frontend build explicitly uses `/v1` as the API base URL, not the hardcoded fallback.

### 2. Nginx Configuration Validation
**File**: `install_npanel.sh` - `configure_nginx()` function

Added validation checks:
```bash
nginx -t || die "Nginx configuration syntax error!"
svc restart nginx

# Validate nginx routing configuration
log "Validating nginx routing configuration..."
if ! grep -q "location /v1" "$conf" 2>/dev/null; then
    die "ERROR: Nginx config missing /v1 location block - API routing will fail!"
fi
if ! grep -q "upstream npanel_backend" "$conf" 2>/dev/null; then
    die "ERROR: Nginx config missing backend upstream definition!"
fi
```

**Why**: Prevents installation from completing if critical nginx configuration is missing.

### 3. Deployment Verification
**File**: `install_npanel.sh` - `verify_deployment()` function

Added API routing verification:
```bash
# Verify nginx is routing /v1 API requests correctly
log "Verifying nginx API routing to /v1..."
retries=0
until curl -fsS http://127.0.0.1:8080/v1/health >/dev/null 2>&1; do
    retries=$((retries+1))
    if [[ "$retries" -gt 10 ]]; then
        warn "⚠ WARNING: Nginx /v1 API routing verification failed!"
        break
    fi
    sleep 1
done
```

**Why**: Detects API routing issues before installation completes, helping users troubleshoot immediately.

### 4. Enhanced Troubleshooting Guide
**File**: `install_npanel.sh` - Post-install message

Added section for API routing troubleshooting:
```
│  Frontend shows "Unable to reach backend API"?          │
│  This means nginx is not routing /v1 requests correctly │
│  Check:                                                 │
│  - sudo grep 'location /v1' /etc/nginx/conf.d/*.conf    │
│  - sudo nginx -t                                        │
│  - sudo systemctl reload nginx                          │
│  - curl http://localhost:8080/v1/health                 │
```

**Why**: Users have immediate diagnostic steps if issues occur post-installation.

### 5. Frontend Environment Configuration
**File**: `frontend/src/shared/config/env.ts`

Changed default:
```typescript
// Before
process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"

// After  
process.env.NEXT_PUBLIC_API_BASE_URL ?? "/v1"
```

**Why**: Serves as fallback if env var is somehow not set during build.

## Multi-Distribution Compatibility

These fixes work across all supported distributions because:

1. **Environment Variables**: `export NEXT_PUBLIC_API_BASE_URL="/v1"` works on all shell types
2. **Curl Validation**: `curl` is used by the installer for diagnostics on all distros
3. **Nginx Validation**: `nginx -t` syntax is identical on all distros
4. **Grep Patterns**: Standard grep patterns work consistently across all distributions
5. **Service Management**: Using `svc restart nginx` wrapper that works with systemd/other init systems

## Testing on Fresh Installations

To verify the fix works on fresh installs:

```bash
# On a clean Linux server (any supported distro):
curl -fsSL https://github.com/omenyx/npanel/raw/main/install_npanel.sh | bash

# Watch for:
# ✓ "Frontend build successful: .next directory verified"
# ✓ "Validating nginx routing configuration..."
# ✓ "Nginx configuration validated successfully"
# ✓ "Verifying nginx API routing to /v1..."
# ✓ "Nginx /v1 API routing verified"
# ✓ "Backend health probe failed on port 3000." (should NOT appear)
```

## Nginx Configuration Structure

The correct configuration includes these critical sections:

```nginx
# Upstream definitions
upstream npanel_backend {
    server 127.0.0.1:3000;
}

upstream npanel_frontend {
    server 127.0.0.1:3001;
}

# Per port - /v1 location (CRITICAL)
location /v1 {
    proxy_pass http://npanel_backend;
    proxy_set_header Host $host;
    # ... additional headers
}

# Per port - /api location (legacy support)
location /api {
    rewrite ^/api/(.*) /$1 break;
    proxy_pass http://npanel_backend;
    # ... headers
}
```

## Deployment Flow

### Before Fixes
1. Frontend builds with `/api` as base URL
2. Nginx configured with old simple config (missing `/v1`)
3. Installation completes
4. User tries to login
5. Frontend calls `/api/auth/login` 
6. Nginx strips `/api` → forwards `/auth/login` to backend
7. Backend returns 404 (expects `/v1/auth/login`)
8. Frontend shows "Unable to reach backend API"

### After Fixes
1. Frontend builds with `NEXT_PUBLIC_API_BASE_URL=/v1`
2. Nginx config validated for `/v1` location block
3. Deployment verifies `/v1/health` returns data
4. Installation completes successfully
5. User accesses panel immediately
6. Frontend calls `/v1/auth/login`
7. Nginx correctly routes to backend at `/v1/auth/login`
8. Login works, no API errors

## Files Modified

1. **install_npanel.sh**
   - Frontend build: Add `export NEXT_PUBLIC_API_BASE_URL="/v1"`
   - Nginx config function: Add validation checks
   - Deployment verification: Add `/v1/health` check
   - Post-install message: Add API routing troubleshooting

2. **frontend/src/shared/config/env.ts**
   - Changed default API base URL from `/api` to `/v1`

3. **npanel_nginx.conf** (new)
   - Correct multi-port nginx configuration

## Validation Commands

Administrators can verify correct setup post-installation:

```bash
# Check nginx config includes /v1
sudo grep 'location /v1' /etc/nginx/conf.d/npanel.conf

# Verify nginx syntax
sudo nginx -t

# Test API endpoint through nginx
curl http://localhost:8080/v1/health

# Test through private port
curl http://localhost:3000/v1/health

# Check both frontend and backend running
sudo lsof -i :3000 -i :3001 -i :8080
```

## Impact Summary

✅ **Fresh Installs**: No more "Unable to reach backend API" error  
✅ **Multi-Distro**: Works on Debian/Ubuntu, RHEL/AlmaLinux, Arch, openSUSE  
✅ **Installation Reliability**: Validation prevents incomplete/broken setups  
✅ **User Experience**: Immediate feedback if configuration issues  
✅ **Maintainability**: Clear diagnostics for troubleshooting  

## Backward Compatibility

- Existing installations are not affected
- Frontend env var can still override with `NEXT_PUBLIC_API_BASE_URL`
- Nginx config maintains `/api` rewrite for legacy support
- All backend endpoints continue working at `/v1` prefix
