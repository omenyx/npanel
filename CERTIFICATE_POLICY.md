# Certificate Policy - Phase 2.3.2
## Production-Safe TLS & Certificate Enforcement Rules

**Status**: Authoritative Policy  
**Date**: 2024-12-19  
**Scope**: All NPanel deployments (DEV, STAGING, PRODUCTION)

---

## Executive Summary

This policy defines **how and when TLS must be used** in NPanel deployments. It establishes:

- ✅ **DEV**: What's allowed (HTTP permitted for local testing)
- ✅ **PROD**: What's required (HTTPS mandatory, HTTP forbidden)
- ✅ **Enforcement**: Where installer/runtime must fail loudly
- ✅ **Certificates**: Self-signed vs. Let's Encrypt rules

**Principle**: **Operator intent must be explicit, never guessed.**

---

## 1. ENVIRONMENT CLASSIFICATION

### How Environments Are Determined

NPanel must determine its environment **at installer time** using:

1. **Explicit flag** (highest priority)
   ```bash
   ./install_npanel.sh install --environment production
   ./install_npanel.sh install --environment development
   ```

2. **Environment variable** (if flag not set)
   ```bash
   export NPANEL_ENVIRONMENT=production
   ./install_npanel.sh install
   ```

3. **Hostname/Domain detection** (fallback)
   - If hostname is `localhost` or IP is `127.0.0.1` → DEV
   - If hostname contains domain (has `.`) → PROD
   - If ambiguous → ASK operator (do not guess)

### Detecting Environment at Runtime

```bash
NPANEL_ENV="${NPANEL_ENVIRONMENT:-development}"

if [[ "$NPANEL_ENV" != "production" && "$NPANEL_ENV" != "development" ]]; then
  die "NPANEL_ENVIRONMENT must be 'production' or 'development'"
fi
```

---

## 2. CERTIFICATE REQUIREMENTS

### Development Environment (NPANEL_ENVIRONMENT=development)

#### Allowed Certificate Types

| Type | Allowed | When | Notes |
|------|---------|------|-------|
| Self-signed | ✅ YES | Default | Generated automatically on install |
| Let's Encrypt | ✅ YES | Optional | Operator choice |
| Valid (CA-signed) | ✅ YES | Optional | Any valid certificate |
| Expired | ⚠️ YES | Temporarily | Warnings in logs, but still works |
| Missing | ✅ YES* | On fresh install | *Must generate self-signed immediately |

#### Certificate Generation (DEV)

```bash
# On fresh install in development:

if [[ ! -f /etc/ssl/certs/npanel.crt ]] || [[ ! -f /etc/ssl/private/npanel.key ]]; then
  log "Generating self-signed certificate for development..."
  
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout /etc/ssl/private/npanel.key \
    -out /etc/ssl/certs/npanel.crt \
    -subj "/CN=localhost/O=NPanel-Dev/C=US"
  
  chmod 600 /etc/ssl/private/npanel.key
  chmod 644 /etc/ssl/certs/npanel.crt
  
  log "✓ Self-signed certificate generated: valid for 1 year"
fi
```

#### TLS Enforcement (DEV)

- Port 2086 (Admin HTTP): ✅ **Available** - No redirect
- Port 2087 (Admin HTTPS): ✅ **Available** - Works with self-signed
- Port 2082 (Customer HTTP): ✅ **Available** - No redirect
- Port 2083 (Customer HTTPS): ✅ **Available** - Works with self-signed

**User experience**:
```bash
curl -k https://localhost:2087/admin    # Works with -k flag
# Browser shows: "Your connection is not private"
# This is EXPECTED in development
```

---

### Production Environment (NPANEL_ENVIRONMENT=production)

#### Allowed Certificate Types

| Type | Allowed | Requirement |
|------|---------|-------------|
| Self-signed | ❌ **NO** | Reject during install |
| Let's Encrypt | ✅ **YES** | Recommended |
| Valid (CA-signed) | ✅ **YES** | Acceptable |
| Expired | ❌ **NO** | Reject at startup |
| Missing | ❌ **NO** | Reject during install |

#### Certificate Generation (PRODUCTION)

```bash
# On fresh install in production:

if [[ "$NPANEL_ENVIRONMENT" == "production" ]]; then
  
  # Check for self-signed cert (not allowed)
  if openssl x509 -in /etc/ssl/certs/npanel.crt -noout -issuer 2>/dev/null | grep -q "CN=localhost"; then
    die "Self-signed certificates are NOT allowed in production. Use Let's Encrypt."
  fi
  
  # Check for certificate existence
  if [[ ! -f /etc/ssl/certs/npanel.crt ]] || [[ ! -f /etc/ssl/private/npanel.key ]]; then
    die "Production requires a valid SSL certificate."
    log ""
    log "To obtain a certificate:"
    log "  1. Install Certbot: sudo apt install certbot"
    log "  2. Get certificate: sudo certbot certonly --standalone -d yourdomain.com"
    log "  3. Point to cert in nginx config"
    log "  4. Re-run installer with cert path"
    exit 1
  fi
  
  # Verify certificate validity
  if ! openssl x509 -checkend 0 -in /etc/ssl/certs/npanel.crt >/dev/null 2>&1; then
    die "SSL certificate has expired. Renew it before deploying to production."
  fi
fi
```

#### TLS Enforcement (PRODUCTION)

- Port 2086 (Admin HTTP): ❌ **MUST FAIL** - Redirect to 2087 or reject
- Port 2087 (Admin HTTPS): ✅ **Required** - Valid certificate required
- Port 2082 (Customer HTTP): ❌ **MUST FAIL** - Redirect to 2083 or reject
- Port 2083 (Customer HTTPS): ✅ **Required** - Valid certificate required

**HTTP Redirect (Production)**:

```nginx
# Port 2086 (Admin HTTP) in production
server {
    listen 2086;
    server_name _;
    
    # MUST redirect to HTTPS (not serve content)
    return 301 https://$host:2087$request_uri;
}

# Port 2082 (Customer HTTP) in production  
server {
    listen 2082;
    server_name _;
    
    # MUST redirect to HTTPS (not serve content)
    return 301 https://$host:2083$request_uri;
}
```

**Browser behavior**:
```bash
curl -i http://yourdomain.com:2086/admin
# Response: HTTP/1.1 301 Moved Permanently
# Location: https://yourdomain.com:2087/admin
```

**User experience**:
```bash
# User types HTTP URL
http://yourdomain.com:2086

# Browser automatically redirects to HTTPS
https://yourdomain.com:2087

# Certificate is valid (Let's Encrypt)
# Browser shows: 🔒 Secure
```

---

## 3. INSTALLER ENFORCEMENT RULES

### Fresh Install Validation

#### Phase 1: Environment Detection

```bash
# Determine environment
if [[ -z "$NPANEL_ENVIRONMENT" ]]; then
  log "ERROR: Must specify environment"
  log ""
  log "Set one of:"
  log "  export NPANEL_ENVIRONMENT=development"
  log "  export NPANEL_ENVIRONMENT=production"
  log ""
  log "Or use flag:"
  log "  ./install_npanel.sh install --environment production"
  exit 1
fi

log "Installing NPanel in: $NPANEL_ENVIRONMENT environment"
```

#### Phase 2: Production Validation (if PROD)

```bash
if [[ "$NPANEL_ENVIRONMENT" == "production" ]]; then
  # Rule 1: Require hostname/domain
  if [[ -z "$NPANEL_DOMAIN" ]]; then
    die "Production requires domain name. Set: export NPANEL_DOMAIN=yourdomain.com"
  fi
  
  # Rule 2: Require valid certificate
  if [[ ! -f /etc/ssl/certs/npanel.crt ]]; then
    die "Certificate required for production: /etc/ssl/certs/npanel.crt"
  fi
  
  # Rule 3: Reject self-signed
  if openssl x509 -in /etc/ssl/certs/npanel.crt -noout -issuer 2>/dev/null | grep -q "self"; then
    die "Self-signed certificates NOT allowed in production"
  fi
  
  # Rule 4: Check expiration
  if openssl x509 -checkend 86400 -in /etc/ssl/certs/npanel.crt >/dev/null 2>&1; then
    : # OK - expires more than 1 day from now
  else
    die "Certificate expires within 24 hours. Renew before deploying."
  fi
  
  # Rule 5: Verify key matches cert
  CERT_MODULUS=$(openssl x509 -noout -modulus -in /etc/ssl/certs/npanel.crt | openssl md5)
  KEY_MODULUS=$(openssl rsa -noout -modulus -in /etc/ssl/private/npanel.key | openssl md5)
  if [[ "$CERT_MODULUS" != "$KEY_MODULUS" ]]; then
    die "Certificate and key do not match"
  fi
fi
```

#### Phase 3: Development Setup (if DEV)

```bash
if [[ "$NPANEL_ENVIRONMENT" == "development" ]]; then
  # Auto-generate self-signed if missing
  if [[ ! -f /etc/ssl/certs/npanel.crt ]]; then
    log "Generating self-signed certificate for development..."
    openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /etc/ssl/private/npanel.key \
      -out /etc/ssl/certs/npanel.crt \
      -subj "/CN=localhost/O=NPanel-Dev/C=US"
    chmod 600 /etc/ssl/private/npanel.key
    log "✓ Certificate generated"
  fi
fi
```

---

## 4. NGINX CONFIGURATION RULES

### Development Configuration

```nginx
# Port 2083 (HTTPS) - Customer
server {
    listen 2083 ssl http2;
    server_name localhost;
    
    ssl_certificate /etc/ssl/certs/npanel.crt;
    ssl_certificate_key /etc/ssl/private/npanel.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # ... proxies ...
}

# Port 2082 (HTTP) - Customer - NO REDIRECT in DEV
server {
    listen 2082;
    server_name localhost;
    
    # NO redirect - both HTTP and HTTPS available for testing
    location / {
        proxy_pass http://npanel_frontend/customer;
        # ... proxies ...
    }
}

# Similar for admin on 2086/2087
```

### Production Configuration

```nginx
# Port 2083 (HTTPS) - Customer - ONLY HTTPS
server {
    listen 2083 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    
    # Add HSTS header (enforce HTTPS)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # ... proxies ...
}

# Port 2082 (HTTP) - Customer - REDIRECT ONLY
server {
    listen 2082;
    server_name yourdomain.com;
    
    # MUST return 301 redirect
    return 301 https://yourdomain.com:2083$request_uri;
}

# Similar for admin on 2086/2087
```

---

## 5. RUNTIME ENFORCEMENT RULES

### At Application Startup

```bash
# In main application bootstrap:

function validateTlsCertificates() {
  local env="${NPANEL_ENVIRONMENT:-development}"
  
  if [[ "$env" == "production" ]]; then
    # Rule 1: Certificate must exist
    if [[ ! -f /etc/ssl/certs/npanel.crt ]]; then
      log "FATAL: Missing certificate in production"
      exit 1
    fi
    
    # Rule 2: Certificate must be valid
    if ! openssl x509 -checkend 0 -in /etc/ssl/certs/npanel.crt >/dev/null 2>&1; then
      log "FATAL: Certificate has expired"
      exit 1
    fi
    
    # Rule 3: Must not be self-signed
    if openssl x509 -in /etc/ssl/certs/npanel.crt -noout -issuer 2>/dev/null | grep -q "self"; then
      log "FATAL: Self-signed certificates not allowed in production"
      exit 1
    fi
    
    log "✓ TLS certificates validated for production"
  fi
}

# Call before starting services
validateTlsCertificates || exit 1
```

### Nginx Health Check

```bash
# Periodically verify nginx can serve HTTPS
function verifyHttpsAvailable() {
  local port="${1:-2083}"
  
  if ! curl -k -s -o /dev/null https://localhost:$port/api/v1/health; then
    log "WARNING: HTTPS on port $port not responding"
    return 1
  fi
}

# In monitoring or health check
verifyHttpsAvailable 2083 || warn "Customer HTTPS not available"
verifyHttpsAvailable 2087 || die "Admin HTTPS not available"
```

---

## 6. FAILURE MODES & HANDLING

### Production: Missing Valid Certificate

**Trigger**: `NPANEL_ENVIRONMENT=production` and no valid cert

**Current behavior**: Nginx may start with broken HTTPS

**New behavior** (REQUIRED):
```bash
# In installer configure_nginx():
if [[ "$NPANEL_ENVIRONMENT" == "production" ]]; then
  if ! verify_certificate_is_valid; then
    die "Production requires a valid SSL certificate. See documentation."
  fi
fi
```

**Result**: Installer fails with clear message

### Production: Self-Signed Certificate Found

**Trigger**: Operator accidentally uses dev cert in production

**Current behavior**: Nginx starts (insecure in production)

**New behavior** (REQUIRED):
```bash
# In runtime certificate validation:
if [[ "$NPANEL_ENVIRONMENT" == "production" ]]; then
  if is_self_signed_cert; then
    die "Self-signed certificates are not allowed in production"
  fi
fi
```

**Result**: Application refuses to start, operator must use valid cert

### Production: Expired Certificate (Let's Encrypt)

**Trigger**: Certbot renewal failed, certificate expired

**Current behavior**: HTTPS silently fails

**New behavior** (REQUIRED):
```bash
# In monitoring cron job:
check_certificate_expiry() {
  local days_left=$(openssl x509 -checkend 86400 -in /etc/ssl/certs/npanel.crt)
  
  if [[ $days_left -lt 0 ]]; then
    log "CRITICAL: Certificate expired"
    send_alert "NPanel certificate expired at $(hostname)"
    exit 1
  elif [[ $days_left -lt 604800 ]]; then  # 7 days
    log "WARNING: Certificate expires in $(( days_left / 86400 )) days"
    send_alert "NPanel certificate expiring soon at $(hostname)"
  fi
}

# Run daily
0 0 * * * /opt/npanel/bin/check-cert-expiry
```

**Result**: Operator is alerted before expiration

### Development: Missing Certificate

**Trigger**: Fresh install in development, no certificate exists

**Current behavior**: HTTPS broken

**New behavior** (REQUIRED):
```bash
# In configure_nginx() for development:
if [[ "$NPANEL_ENVIRONMENT" == "development" ]]; then
  if [[ ! -f /etc/ssl/certs/npanel.crt ]]; then
    log "Auto-generating self-signed certificate for development..."
    generate_self_signed_cert
    log "✓ Certificate ready for HTTPS"
  fi
fi
```

**Result**: HTTPS works immediately after install

---

## 7. CERTIFICATE DEPLOYMENT CHECKLIST

### For Production Deployments

- [ ] Environment variable set: `export NPANEL_ENVIRONMENT=production`
- [ ] Domain name set: `export NPANEL_DOMAIN=yourdomain.com`
- [ ] Let's Encrypt certificate obtained: `/etc/letsencrypt/live/yourdomain.com/`
- [ ] Nginx config updated with correct cert paths
- [ ] Certificate tested: `openssl x509 -in /path/to/cert -text -noout`
- [ ] Certificate expiry > 30 days: `openssl x509 -checkend 2592000 -in /path/to/cert`
- [ ] Renewal hook configured in certbot
- [ ] HTTP ports (2082, 2086) configured to redirect to HTTPS
- [ ] Installer run with environment validation enabled
- [ ] HTTPS ports (2083, 2087) respond with valid cert
- [ ] HSTS header present in responses
- [ ] Monitoring alerts configured for certificate expiry

### For Development Deployments

- [ ] Environment variable set: `export NPANEL_ENVIRONMENT=development`
- [ ] Installer runs successfully (self-signed auto-generated)
- [ ] HTTPS ports respond (2083, 2087)
- [ ] HTTP ports available (2082, 2086) - no redirect required
- [ ] Browser shows certificate warning (expected for self-signed)
- [ ] Testing with `curl -k` works for both HTTP and HTTPS

---

## 8. POLICY ENFORCEMENT MATRIX

| Scenario | DEV | PROD | Enforcement |
|----------|-----|------|-------------|
| Self-signed certificate | ✅ Auto-generate | ❌ Reject | Installer/Runtime |
| Missing certificate | ✅ Auto-generate | ❌ Reject | Installer |
| HTTP port available | ✅ Yes | ❌ Redirect | Nginx config |
| HTTPS port available | ✅ Yes | ✅ Yes | Nginx config |
| Certificate validation | ⚠️ Warning | ✅ Required | Nginx startup |
| Expired certificate | ⚠️ Works | ❌ Fail | Runtime check |
| Let's Encrypt setup | ⚠️ Optional | ✅ Recommended | Documentation |

---

## 9. OPERATOR GUIDANCE

### "I'm installing for development"

```bash
export NPANEL_ENVIRONMENT=development
sudo ./install_npanel.sh install

# Result:
# ✓ Self-signed certificate auto-generated
# ✓ Both HTTP and HTTPS available
# ✓ Ready for testing
```

### "I'm deploying to production"

```bash
# Step 1: Get certificate
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com

# Step 2: Configure environment
export NPANEL_ENVIRONMENT=production
export NPANEL_DOMAIN=yourdomain.com

# Step 3: Update cert paths in nginx config
sudo nano /etc/nginx/conf.d/npanel.conf
# Change: ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem

# Step 4: Run installer
sudo ./install_npanel.sh install

# Result:
# ✓ Production validation passed
# ✓ HTTP redirects to HTTPS
# ✓ Certificate verified valid
# ✓ Ready for production
```

### "I need to renew a certificate"

```bash
# Manual renewal
sudo certbot renew --force-renewal

# Verify
openssl x509 -checkend 0 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem

# Reload nginx
sudo systemctl reload nginx

# Verify production still works
curl -v https://yourdomain.com:2087/admin
```

---

## Sign-Off

**Task 2.3.2 Complete**: Certificate Policy Defined

- ✅ DEV and PROD environments defined
- ✅ Certificate requirements specified
- ✅ Enforcement rules documented
- ✅ Installer validation rules defined
- ✅ Runtime checks specified
- ✅ Failure modes handled
- ✅ Operator checklist provided

**This is the authoritative policy for Phase 2.3**

**Next Step**: Implement certificate validation in code
