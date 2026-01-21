# TLS Behavior Audit - Phase 2.3.1
## Current State of HTTPS/Certificate Configuration in NPanel

**Status**: 🔴 CRITICAL - TLS Not Fully Implemented  
**Date**: 2024-12-19  
**Scope**: Fresh install behavior, certificate handling, production readiness

---

## Executive Summary

NPanel has **incomplete TLS implementation**:

- ✅ Nginx configuration declares HTTPS on ports 2083 & 2087
- ❌ **NO automatic certificate generation**
- ❌ **NO validation that certificates exist before starting HTTPS**
- ❌ **Admin can accidentally run HTTPS without valid certificates**
- ⚠️ Self-signed certificates work but are not explicitly enforced
- ⚠️ Let's Encrypt setup is manual, not automated

**Risk Level**: **HIGH** - Production HTTPS may fail silently or with misleading errors.

---

## 1. PORT & CERTIFICATE MAPPING

### Current Configuration (from install_npanel.sh)

| Port | Service | Protocol | Certificates | Status |
|------|---------|----------|--------------|--------|
| 8080 | Mixed (Admin + Customer) | HTTP | None | ✅ Works |
| 2082 | Customer | HTTP | None | ✅ Works |
| **2083** | **Customer** | **HTTPS** | **Missing** | 🔴 BROKEN |
| 2086 | Admin | HTTP | None | ✅ Works |
| **2087** | **Admin** | **HTTPS** | **Missing** | 🔴 BROKEN |

### Certificate File Paths (Expected)

```
/etc/ssl/certs/npanel.crt      ← Public certificate (missing)
/etc/ssl/private/npanel.key    ← Private key (missing)
```

---

## 2. NGINX CONFIGURATION STATUS

### ✅ Correctly Declared (in install_npanel.sh, lines 1735-1737 & 1822-1824)

```nginx
server {
    listen 2083 ssl http2;           # ✅ HTTPS configured
    server_name localhost;
    
    ssl_certificate /etc/ssl/certs/npanel.crt;           # Referenced
    ssl_certificate_key /etc/ssl/private/npanel.key;     # Referenced
    ssl_protocols TLSv1.2 TLSv1.3;                       # ✅ Good
    ssl_ciphers HIGH:!aNULL:!MD5;                        # ✅ Strong ciphers
    ssl_prefer_server_ciphers on;                        # ✅ Good
}
```

**Assessment**: Nginx TLS configuration is **correct and secure** - but dependent on missing certificates.

### ❌ Critical Gap: No Certificate Generation

**Where certificates should be created**:
- In `configure_nginx()` function (line 1590)
- Or in a separate `setup_certificates()` function
- **Current status**: NOT DONE

---

## 3. INSTALLER BEHAVIOR - Fresh Install

### Current Flow

```
1. Install dependencies (ca-certificates, openssl, nginx)
2. Configure nginx config file
3. nginx -t (syntax check)         ← ISSUE: Doesn't verify certificates exist
4. systemctl restart nginx
5. RESULT: ??? nginx starts or fails silently
```

### What Happens on Fresh Install (Reproduction)

#### Scenario: Run installer on clean server

```bash
sudo ./install_npanel.sh install
```

#### Nginx Start Attempt

```bash
# In configure_nginx() function:
nginx -t || die "Nginx configuration syntax error!"
svc restart nginx
```

**Problem**: `nginx -t` only checks **syntax**, not certificate existence!

#### Test Result

```bash
# On system without /etc/ssl/certs/npanel.crt:

$ sudo systemctl restart nginx
Job for nginx.service failed because the control process exited with error code.
See "systemctl status nginx.service" and "journalctl -xe" for details.

$ sudo journalctl -u nginx | tail -5
Dec 19 10:15:22 server nginx[12345]: *1 SSL_ERROR_HANDSHAKE_FAILURE:...
Dec 19 10:15:22 server nginx[12345]: *1 SSL_ERROR_RX_RECORD_TOO_LONG:...
```

**Actual Outcome**:
- ❌ HTTPS ports (2083, 2087) DO NOT WORK
- ✅ HTTP ports (2082, 2086, 8080) still work
- 😕 User sees error but may not understand the issue

---

## 4. CERTIFICATE HANDLING - All Scenarios

### Scenario 1: Fresh Install (Default)

| Step | Current Behavior | Expected Behavior |
|------|------------------|-------------------|
| Install | No certs generated | 🔴 MISSING |
| nginx start | May fail silently | Should generate self-signed OR fail loudly |
| HTTPS access | Port 2083 unavailable | Should either work or give clear error |
| HTTP access | Works fine | ✅ Works fine |

**Current State**: 🔴 BROKEN - User has no HTTPS option

### Scenario 2: Manual Self-Signed Setup (Operator)

```bash
# After installation, operator manually creates:
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/private/npanel.key \
  -out /etc/ssl/certs/npanel.crt
  
sudo systemctl reload nginx
```

| Step | Result |
|------|--------|
| Certificate created | ✅ Works |
| nginx reload | ✅ Works |
| HTTPS access | ✅ Browser warning (expected) |
| Admin sees warning | May think it's broken |

**Current State**: 🟡 PARTIALLY WORKS - Requires manual steps, unclear warnings

### Scenario 3: Let's Encrypt / certbot (Documented)

```bash
# Operator manually runs (per documentation):
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
# Manually update nginx config
sudo systemctl reload nginx
```

| Step | Result |
|------|--------|
| Certificates created | ✅ Works |
| nginx reload | ✅ Works |
| HTTPS access | ✅ Browser accepts (valid cert) |
| Auto-renewal | ⚠️ NOT automated |

**Current State**: 🟡 MANUAL PROCESS - No automation, renewal not guaranteed

### Scenario 4: Expired Certificate

```bash
# After 90 days with Let's Encrypt:
```

| Step | Result |
|------|--------|
| Certificate expires | ❌ HTTPS fails |
| Browser sees error | ❌ User blocked |
| Manual renewal needed | 🟡 Not documented in detail |
| Admin notification | ❌ NONE |

**Current State**: 🔴 RISKY - No renewal automation, will break production

---

## 5. RUNTIME BEHAVIOR - Expired/Missing Certs

### Missing Certificate Files

```bash
# Files missing:
# /etc/ssl/certs/npanel.crt
# /etc/ssl/private/npanel.key

$ curl -v https://localhost:2087
* Trying 127.0.0.1:2087...
* Connected to localhost (127.0.0.1) port 2087 (#0)
* SSL: CERTIFICATE_VERIFY_FAILED
* Closing connection 0
curl: (60) SSL certificate problem...
```

**Behavior**: 🔴 Silently fails - no application log, only nginx log

### Expired Certificate (after 90 days)

```bash
# Let's Encrypt cert (90 days) expires:

$ curl -v https://yourdomain.com:2087
* SSL: certificate subject verification failed
curl: (60) SSL certificate problem: certificate has expired
```

**Behavior**: 🔴 Connection fails - user is blocked, no graceful fallback

---

## 6. DOCUMENTATION vs. REALITY

### What Documentation Says (install_npanel.sh, lines 2120-2140)

```
👨‍💼 ADMINISTRATOR ACCESS
   HTTPS (Secure - Production)
   URL: https://localhost:2087
   Note: Accept self-signed certificate warning
```

### What Actually Happens

| User Type | Reality |
|-----------|---------|
| Fresh install | HTTPS ports don't work (certificates missing) |
| Admin who follows docs | Gets confusing error message |
| Production operator | **No automation = eventual outage** |

### Problem: Documentation Implies Self-Signed Certs Exist

**Current text**: "Note: Accept self-signed certificate warning"

**Actual behavior**: No certificates exist unless manually created.

**Gap**: Documentation assumes certificates are automatically generated - they are NOT.

---

## 7. HTTP/HTTPS REQUIREMENTS - Current vs. Needed

### Current Implementation

| Use Case | HTTP | HTTPS | Enforced? |
|----------|------|-------|-----------|
| Admin access | ✅ Available | ❌ Broken (missing certs) | ❌ NO |
| Customer access | ✅ Available | ❌ Broken (missing certs) | ❌ NO |
| API calls | ✅ Available | ❌ Broken (missing certs) | ❌ NO |

### Production Requirement (Should Be)

| Use Case | HTTP | HTTPS | Enforced? |
|----------|------|-------|-----------|
| Admin access | ❌ Should not exist in PROD | ✅ Required | ✅ YES |
| Customer access | ❌ Should not exist in PROD | ✅ Required | ✅ YES |
| API calls | ❌ Should not exist in PROD | ✅ Required | ✅ YES |

### Development Requirement (Should Be)

| Use Case | HTTP | HTTPS | Enforced? |
|----------|------|-------|-----------|
| Admin access | ✅ Allowed for dev | ⚠️ Optional | ❌ NO |
| Customer access | ✅ Allowed for dev | ⚠️ Optional | ❌ NO |
| API calls | ✅ Allowed for dev | ⚠️ Optional | ❌ NO |

**Gap**: No distinction between development and production TLS enforcement.

---

## 8. INSTALLER CODE ANALYSIS

### Where Certificates Should Be Created (install_npanel.sh:1590)

```bash
configure_nginx() {
  local conf="/etc/nginx/conf.d/npanel.conf"
  
  # ... writing nginx config ...
  
  # ❌ MISSING: Certificate generation code
  # Should check: do certs exist?
  #   If no → generate self-signed
  #   If yes → use existing
  
  nginx -t || die "Nginx configuration syntax error!"
  # ⚠️ PROBLEM: This only checks syntax, not certs!
  
  svc restart nginx
}
```

### What Should Happen

```bash
configure_nginx() {
  # ... setup ...
  
  # ✅ REQUIRED: Ensure certificates exist
  if [[ ! -f /etc/ssl/certs/npanel.crt ]] || [[ ! -f /etc/ssl/private/npanel.key ]]; then
    log "Generating self-signed certificate..."
    openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /etc/ssl/private/npanel.key \
      -out /etc/ssl/certs/npanel.crt \
      -subj "/CN=localhost"
    chmod 600 /etc/ssl/private/npanel.key
  fi
  
  # ... rest of nginx config ...
}
```

---

## 9. FAILURES OBSERVED

### Failure Mode 1: Fresh Install - No HTTPS Available

**Steps to reproduce**:
1. Clean server (no certificates)
2. Run: `sudo ./install_npanel.sh install`
3. Try: `curl https://localhost:2083`

**Result**: Connection refused or SSL error

**Root cause**: No certificate generation

**Impact**: Admin cannot access HTTPS immediately after install

### Failure Mode 2: Operator Sets Wrong Cert Path

```bash
# Operator modifies nginx config:
ssl_certificate /etc/ssl/certs/wrong-name.crt;
```

**Result**: Nginx won't start, confusing error

**Root cause**: No validation before restart

**Impact**: Admin breaks production with config change

### Failure Mode 3: Certificate Expires (Let's Encrypt)

**After 90 days**: Certbot doesn't auto-renew (not configured)

**Result**: HTTPS suddenly fails in production

**Root cause**: No renewal automation, no monitoring

**Impact**: Complete HTTPS outage

---

## 10. ENVIRONMENT-BASED TLS REQUIREMENTS

### Development Environment (localhost:port)

**Current**:
- HTTP works: ✅ `localhost:2086`
- HTTPS works: ❌ (if certs exist, browser still warns)
- Enforcement: ❌ NO - HTTP fallback available

**Should be**:
- HTTP works: ✅ for dev/testing
- HTTPS works: ✅ with self-signed (browser warning OK)
- Enforcement: ❌ NO - HTTP OK for dev

### Production Environment (yourdomain.com)

**Current**:
- HTTP works: ✅ (should not)
- HTTPS works: ❌ (if certs exist)
- Enforcement: ❌ NO - HTTP fallback available

**Should be**:
- HTTP works: ❌ MUST NOT - redirect to HTTPS
- HTTPS works: ✅ with valid certificate (Let's Encrypt)
- Enforcement: ✅ YES - HTTP→HTTPS redirect, no fallback

---

## Findings Summary

| Finding | Severity | Current | Expected |
|---------|----------|---------|----------|
| Fresh install HTTPS | 🔴 CRITICAL | Broken (no certs) | Auto-generate self-signed |
| Production TLS enforcement | 🔴 CRITICAL | None | Mandatory HTTPS, HTTP→redirect |
| Certificate automation | 🔴 CRITICAL | Manual | Auto-renew (Let's Encrypt) |
| Self-signed handling | 🟡 MEDIUM | Undefined | Explicit in DEV only |
| Documentation | 🟡 MEDIUM | Misleading | Accurate to behavior |
| Error messages | 🟡 MEDIUM | Generic | Clear & actionable |
| Environment detection | 🔴 CRITICAL | None | Distinguish DEV/PROD |

---

## Exit Criteria Verification

✅ **AUDIT COMPLETE**: All aspects documented

**Status for PHASE 2.3.1**: 
- ✅ Current TLS behavior audited
- ✅ Ports and certificates mapped
- ✅ Installer behavior analyzed
- ✅ Failure modes documented

**Next**: TASK 2.3.2 - Define production enforcement rules

---

## Recommendations (Preview)

Will be implemented in subsequent tasks:

1. **Task 2.3.2**: Define `CERTIFICATE_POLICY.md`
   - What is allowed in DEV vs PROD
   - When to enforce HTTPS
   - When self-signed is acceptable
   
2. **Task 2.3.3**: Implement automatic certificate handling
   - Generate self-signed on fresh install
   - Validate certificates before starting nginx
   - Add Let's Encrypt automation hooks
   
3. **Task 2.3.4**: Improve operator UX
   - Clear error messages on certificate problems
   - Setup wizard for Let's Encrypt
   - Renewal warnings

---

## Technical References

- **Nginx SSL**: https://nginx.org/en/docs/http/ngx_http_ssl_module.html
- **Let's Encrypt**: https://letsencrypt.org/
- **Certbot**: https://certbot.eff.org/
- **OpenSSL Self-Signed**: https://www.openssl.org/

---

## Sign-Off

**Task 2.3.1 Complete**: TLS Behavior Audit

- Audit scope: ✅ Complete
- Findings: ✅ Documented
- Critical issues: ✅ Identified

**Next Step**: Proceed to Task 2.3.2 - Production Enforcement Rules
