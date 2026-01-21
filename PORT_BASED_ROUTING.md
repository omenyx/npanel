# Port-Based Dashboard Separation

## Overview

Npanel now supports separate admin and customer dashboards accessible on dedicated ports with full HTTPS support.

## Port Configuration

### HTTP Access
- **Port 2082**: Customer HTTP  
- **Port 2086**: Admin HTTP

### HTTPS Access
- **Port 2083**: Customer HTTPS
- **Port 2087**: Admin HTTPS

### Development
- **Port 8080**: Mixed interface (uses stored user role for routing)
- **Port 3001**: Frontend dev server (mixed interface)

## Architecture

### Frontend Implementation

#### 1. **Middleware-Based Enforcement** (`frontend/src/middleware.ts`)
- Detects port from Host header
- Enforces role-based path restrictions
- Auto-redirects users to appropriate interface
- Allows public routes (/login, /) to bypass enforcement

#### 2. **Port Detection Utilities** (`frontend/src/shared/auth/port-routing.ts`)
```typescript
detectAccessMode()              // Returns: "admin" | "customer" | "mixed"
isRoleAllowedOnCurrentPort()    // Check if role has access
getDashboardPath()              // Get correct dashboard for role
isAdminPortAccess()             // Admin port check
isCustomerPortAccess()          // Customer port check
getAccessModeLabel()            // Human-readable label
```

#### 3. **Login Page Enhancement** (`frontend/src/app/login/page.tsx`)
- Detects port on load
- Shows appropriate portal indicator
- Enforces role-based access on login
- Prevents CUSTOMER from accessing admin port and vice versa
- Shows clear error if wrong role for port

### Backend Remains Unchanged
- All business logic unchanged
- API endpoints at `/v1/*` unchanged
- Role-based authorization in backend still applies
- Backend doesn't need to know about ports

### Nginx Configuration
Separate server blocks for each port:
- Each block has `/v1` and `/api` location proxies
- Each block has `/admin` and `/customer` location proxies
- Middleware adds additional client-side enforcement

## Access Control Flow

```
User Access Request
        ↓
[Nginx receives request on specific port]
        ↓
[Request proxied to frontend on port 3001]
        ↓
[Frontend middleware detects port]
        ↓
[For public routes] → [Allow]
        ↓
[For protected routes] → [Check detected port]
        ↓
[Port 2082/2083] → [Redirect to /customer]
[Port 2086/2087] → [Redirect to /admin]
[Port 8080/3001] → [Use stored role]
        ↓
[User attempts login]
        ↓
[Validate credentials with backend]
        ↓
[Check role matches port requirements]
        ↓
[If allowed] → [Store role & redirect to dashboard]
[If denied] → [Show "access denied" error]
```

## Usage Examples

### Admin Access (HTTPS)
```
https://server.example.com:2087/admin
↓
User sees admin portal
↓
Login with ADMIN role account → Success
Login with CUSTOMER role account → "This account does not have access to Admin Portal"
```

### Customer Access (HTTPS)
```
https://server.example.com:2083/customer
↓
User sees customer portal
↓
Login with CUSTOMER role account → Success
Login with ADMIN role account → "This account does not have access to Customer Portal"
```

### Mixed Access (HTTP - Development)
```
http://server.example.com:8080/login
↓
User can login with either role
↓
Login with ADMIN → Redirects to /admin
Login with CUSTOMER → Redirects to /customer
```

## Installation & SSL Certificates

### Self-Signed Certificates (Quick Setup)
The installer creates self-signed certificates at:
- `/etc/ssl/certs/npanel.crt`
- `/etc/ssl/private/npanel.key`

```bash
# Already done by installer, but to recreate:
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/npanel.key \
  -out /etc/ssl/certs/npanel.crt
```

### Let's Encrypt (Production)
```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --standalone -d your.domain.com

# Update nginx config:
sudo nano /etc/nginx/conf.d/npanel.conf
# Change:
# ssl_certificate /etc/letsencrypt/live/your.domain.com/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;

# Reload nginx
sudo systemctl reload nginx

# Auto-renew
sudo certbot renew --dry-run
```

## Nginx Configuration Structure

Each port has its own `server {}` block with:

```nginx
server {
    listen 2086;  # or 2087 ssl, 2082, 2083 ssl
    server_name localhost;
    
    # SSL configuration (for 2083, 2087)
    ssl_certificate /etc/ssl/certs/npanel.crt;
    ssl_certificate_key /etc/ssl/private/npanel.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Root redirect (admin vs customer)
    location = / {
        return 301 /admin;  # or /customer for 2082/2083
    }
    
    # API proxy
    location /v1 {
        proxy_pass http://npanel_backend;
        # headers...
    }
    
    # Dashboard proxy
    location /admin {
        proxy_pass http://npanel_frontend/admin;
        # headers...
    }
    
    # Customer proxy
    location /customer {
        proxy_pass http://npanel_frontend/customer;
        # headers...
    }
    
    # Frontend catch-all
    location / {
        proxy_pass http://npanel_frontend;
        # headers...
    }
}
```

## Security Implications

### Protection Against Role Escalation
1. **Port Enforcement**: Can't access admin functions via customer port
2. **Middleware Enforcement**: Frontend middleware prevents path traversal
3. **Backend Validation**: Backend also validates role before returning data
4. **Defense in Depth**: Multiple layers ensure security

### Attack Scenario Prevention
```
❌ Customer tries: POST https://server:2087/admin/create-admin
   → Middleware rejects (not customer port)
   → Even if bypassed, backend validates role

❌ Customer tries: POST https://server:2082/admin/create-admin
   → Middleware rejects (customer port can't access /admin)
   → Even if bypassed, backend validates role
```

### Certificate Security
- Self-signed for development (accept warning)
- Let's Encrypt for production (automatic renewal)
- HTTPS enforces encrypted communication
- TLS 1.2+ prevents downgrade attacks

## Testing Port-Based Routing

### Test Admin Port
```bash
# Direct to admin port
curl https://localhost:2087/admin --insecure

# Test API through admin port
curl https://localhost:2087/v1/health --insecure

# Test login as admin
curl -X POST https://localhost:2087/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  --insecure
```

### Test Customer Port
```bash
# Direct to customer port
curl https://localhost:2083/customer --insecure

# Test API through customer port
curl https://localhost:2083/v1/health --insecure

# Test login as customer
curl -X POST https://localhost:2083/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"password"}' \
  --insecure
```

### Test Mixed Port (8080 - HTTP only)
```bash
# Mixed port accepts both roles
curl http://localhost:8080/admin --insecure
curl http://localhost:8080/customer --insecure
```

## Troubleshooting

### HTTPS Certificate Errors
```
Problem: "ERR_SSL_PROTOCOL_ERROR" or untrusted cert warning
Solution: Use --insecure flag or accept warning in browser
          For production: Use Let's Encrypt certificates
```

### "Port already in use" Error
```bash
# Find what's using the port
sudo lsof -i :2087

# Kill the process if needed
sudo kill -9 <PID>

# Then restart nginx
sudo systemctl restart nginx
```

### Login Fails with "This account does not have access"
```
Problem: CUSTOMER trying to login on admin port (2086/2087)
Solution: Use correct port for your role
          - Customers: use 2082 (HTTP) or 2083 (HTTPS)
          - Admins: use 2086 (HTTP) or 2087 (HTTPS)
```

### Middleware Not Enforcing
```
Problem: User can access wrong dashboard on port
Solution: Check that middleware is enabled in next.config
         Restart frontend service: sudo systemctl restart npanel-frontend
```

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/middleware.ts` | NEW - Port detection and enforcement |
| `frontend/src/shared/auth/port-routing.ts` | NEW - Port routing utilities |
| `frontend/src/app/login/page.tsx` | Port detection & role enforcement |
| `install_npanel.sh` | Already has multi-port nginx config |

## Performance Impact

- **Minimal**: Port detection is lightweight HTTP header check
- **Frontend**: No database queries, pure logic
- **Nginx**: No additional load, just more server blocks
- **Scalability**: No impact, same backend regardless of port

## Future Enhancements

- [ ] Single-sign-on (SSO) across portals
- [ ] Rate limiting per port
- [ ] Audit logging for port access attempts
- [ ] Admin dashboard showing who's accessing which port
- [ ] Geolocation-based port restrictions

## Summary

Port-based separation provides:
- ✅ Clear isolation of admin and customer interfaces
- ✅ HTTPS support on all portals
- ✅ Defense in depth with multiple validation layers
- ✅ Zero impact on backend API
- ✅ Easy to extend with additional features
- ✅ Works across all supported Linux distributions
