# TLS Operator Guide - Phase 2.3.4
## Clear Error Messages, No Silent Failures, Actionable Diagnostics

**Status**: Operator-Facing Documentation & UX Guide  
**Date**: 2024-12-19  
**Audience**: System administrators deploying & managing NPanel

---

## Executive Summary

This guide ensures NPanel provides:

- ✅ **Clear error messages** when TLS fails
- ✅ **No silent failures** - problems are visible
- ✅ **Actionable diagnostics** - errors explain what to fix
- ✅ **Documentation** - behavior matches reality

---

## 1. ERROR MESSAGE STANDARDS

### Principle: Tell the Operator WHAT & HOW TO FIX

#### ❌ BAD Error Messages (current state)

```
SSL connection error
CERTIFICATE_VERIFY_FAILED
nginx: [emerg] bind() to 0.0.0.0:2087 failed
```

**Problem**: Operator doesn't know what to do.

#### ✅ GOOD Error Messages (new standard)

```
ERROR: TLS certificate not found for production environment
  Location: /etc/ssl/certs/npanel.crt
  Environment: production
  
To fix:
  1. Obtain a valid SSL certificate (Let's Encrypt recommended)
  2. Place at: /etc/ssl/certs/npanel.crt
  3. Place key at: /etc/ssl/private/npanel.key
  4. Run: sudo ./install_npanel.sh install

For help: https://docs.npanel.io/production-tls
```

---

## 2. INSTALLATION ERROR MESSAGES

### Error: Environment Not Specified

#### Current Behavior
```bash
$ sudo ./install_npanel.sh install
# Installer runs, but which environment? Unknown.
```

#### New Behavior - FAIL LOUDLY
```bash
$ sudo ./install_npanel.sh install

[ERROR] Environment not specified

Please specify deployment environment:

  Option 1 - Set environment variable:
    export NPANEL_ENVIRONMENT=production
    export NPANEL_ENVIRONMENT=development
    sudo ./install_npanel.sh install

  Option 2 - Use command flag:
    sudo ./install_npanel.sh install --environment production

Development: Local testing, HTTP allowed, self-signed certs OK
Production: Public deployment, HTTPS required, valid cert required

Exit 1 ✗
```

---

### Error: Missing Certificate (Production)

#### Current Behavior
```bash
$ sudo ./install_npanel.sh install --environment production
# nginx config written but certs missing
# nginx start fails with cryptic error
```

#### New Behavior - CLEAR INSTRUCTIONS
```bash
$ sudo ./install_npanel.sh install --environment production

[VALIDATION] Checking environment...
[OK] Environment: production
[CHECKING] Looking for SSL certificates...
[ERROR] Production deployment requires valid SSL certificate

Current status:
  Location:  /etc/ssl/certs/npanel.crt
  Status:    NOT FOUND
  
To deploy NPanel in production, you need a valid SSL certificate.

OPTION 1 - Use Let's Encrypt (Recommended)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Install certbot:
   sudo apt-get install certbot

2. Get certificate for your domain:
   sudo certbot certonly --standalone -d yourdomain.com

3. Verify certificate was created:
   sudo openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -text

4. Update nginx config to use the certificate:
   sudo nano /etc/nginx/conf.d/npanel.conf
   
   Find these lines and update:
     ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

5. Test nginx configuration:
   sudo nginx -t

6. Reload nginx:
   sudo systemctl reload nginx

7. Re-run this installer:
   sudo ./install_npanel.sh install --environment production

OPTION 2 - Use Existing Certificate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Copy your certificate:
   sudo cp /path/to/your/cert.pem /etc/ssl/certs/npanel.crt
   sudo cp /path/to/your/key.pem /etc/ssl/private/npanel.key

2. Set proper permissions:
   sudo chmod 644 /etc/ssl/certs/npanel.crt
   sudo chmod 600 /etc/ssl/private/npanel.key

3. Continue with installer:
   sudo ./install_npanel.sh install --environment production

Questions?  https://docs.npanel.io/production-deployment

Exit 1 ✗
```

---

### Error: Self-Signed Certificate in Production

#### Current Behavior
```bash
$ sudo ./install_npanel.sh install --environment production
# nginx starts with self-signed cert
# No warning - operator thinks it's fine
# SSL errors in production - customer complaints
```

#### New Behavior - REJECT & EDUCATE
```bash
$ sudo ./install_npanel.sh install --environment production

[VALIDATION] Checking environment...
[OK] Environment: production
[CHECKING] Verifying SSL certificate...
[ERROR] Self-signed certificate detected - NOT allowed in production

Current certificate:
  Path: /etc/ssl/certs/npanel.crt
  Subject: CN=localhost,O=NPanel-Dev,C=US
  Type: Self-signed (development only)
  
In production, NPanel requires a trusted SSL certificate.

WHY NOT SELF-SIGNED?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Self-signed certificates cause browser warnings:
  "Your connection is not private"
  "Attackers might be trying to steal your information"
  
This is UNACCEPTABLE for customer-facing services.

SOLUTION - Use Let's Encrypt (Free)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Let's Encrypt provides FREE, trusted certificates:

1. Install certbot:
   sudo apt-get install certbot

2. Get certificate:
   sudo certbot certonly --standalone -d yourdomain.com

3. This will create properly signed certificate at:
   /etc/letsencrypt/live/yourdomain.com/

4. Update your nginx config to point to Let's Encrypt cert

5. Deployment will automatically succeed

Questions?  https://docs.npanel.io/let's-encrypt-setup

Exit 1 ✗
```

---

### Error: Certificate Has Expired

#### Current Behavior
```bash
$ sudo ./install_npanel.sh install --environment production
# Installer doesn't check expiration
# nginx starts with expired cert
# SSL errors begin immediately
```

#### New Behavior - CHECK & WARN
```bash
$ sudo ./install_npanel.sh install --environment production

[VALIDATION] Checking environment...
[OK] Environment: production
[CHECKING] Verifying SSL certificate...
[ERROR] Certificate has expired

Current certificate:
  Path: /etc/ssl/certs/npanel.crt
  Expiry: 2024-12-10 (9 days ago)
  Status: EXPIRED
  
An expired certificate will cause HTTPS to fail immediately.

QUICK FIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If using Let's Encrypt:
  sudo certbot renew --force-renewal
  sudo systemctl reload nginx

If using other certificate authority:
  1. Renew/reissue certificate
  2. Copy new certificate to /etc/ssl/certs/npanel.crt
  3. Copy new key to /etc/ssl/private/npanel.key
  4. sudo systemctl reload nginx

VERIFY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Check certificate is now valid:
  openssl x509 -in /etc/ssl/certs/npanel.crt -text -noout | grep -A2 Validity

Then retry installation:
  sudo ./install_npanel.sh install --environment production

Exit 1 ✗
```

---

## 3. RUNTIME ERROR MESSAGES

### Error: HTTPS Not Responding (Port 2083)

#### Current Behavior
```bash
curl: (60) SSL certificate problem
# Operator confused about cause
```

#### New Behavior - DIAGNOSTIC HELPER
```bash
#!/bin/bash
# Run: sudo ./install_npanel.sh diagnose-tls

[DIAGNOSTICS] Running TLS health check...

PORT 2083 (HTTPS - Customer)
────────────────────────────────────────────────────────

Status: ✗ NOT RESPONDING

Checking certificate files...
  /etc/ssl/certs/npanel.crt      ✗ NOT FOUND
  /etc/ssl/private/npanel.key    ✗ NOT FOUND

Checking nginx configuration...
  ✓ nginx is running
  ✓ Port 2083 configured for SSL
  ✗ nginx cannot start SSL because certificate files missing

Checking nginx logs...
  2024-12-19 10:15:22 [emerg] SSL_ERROR: certificate file not found

ACTION REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The SSL certificate files are missing.

OPTION 1 - Get Let's Encrypt certificate:
  sudo certbot certonly --standalone -d yourdomain.com
  
OPTION 2 - Copy existing certificate:
  sudo cp /path/to/cert /etc/ssl/certs/npanel.crt
  sudo cp /path/to/key /etc/ssl/private/npanel.key

THEN:
  sudo systemctl reload nginx
  sudo ./install_npanel.sh diagnose-tls

---

PORT 2087 (HTTPS - Admin)
────────────────────────────────────────────────────────
[Similar diagnostics for admin port]
```

---

### Error: Certificate About to Expire

#### Automated Alert (via monitoring script)

```
Subject: WARNING - NPanel certificate expires in 14 days

Your NPanel SSL certificate will expire on 2025-01-02 (14 days).

IMMEDIATE ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If using Let's Encrypt, renewal is automatic via cron job.
To manually renew:

  sudo certbot renew
  sudo systemctl reload nginx

To verify renewal:

  openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem \
    -noout -dates

If using other certificate authority:
  Contact your CA to renew certificate
  Then copy new certificate files:
  
  sudo cp /path/to/new/cert /etc/ssl/certs/npanel.crt
  sudo cp /path/to/new/key /etc/ssl/private/npanel.key
  sudo systemctl reload nginx

Questions? https://docs.npanel.io/cert-renewal
```

---

## 4. DIAGNOSTIC COMMANDS

### Command: diagnose-tls

Comprehensive TLS health check:

```bash
$ sudo ./install_npanel.sh diagnose-tls

╔═══════════════════════════════════════════════════════════════╗
║              NPanel TLS Diagnostics                           ║
╚═══════════════════════════════════════════════════════════════╝

ENVIRONMENT CONFIGURATION
────────────────────────────────────────────────────────────────
NPANEL_ENVIRONMENT: production
NPANEL_DOMAIN: yourdomain.com
Status: ✓ Correctly configured

CERTIFICATE FILES
────────────────────────────────────────────────────────────────
Certificate: /etc/ssl/certs/npanel.crt
  Status: ✓ Exists
  Owner: root:root
  Permissions: 644 (correct)
  
Private Key: /etc/ssl/private/npanel.key  
  Status: ✓ Exists
  Owner: root:root
  Permissions: 600 (correct)

CERTIFICATE DETAILS
────────────────────────────────────────────────────────────────
Subject: CN=yourdomain.com
Issued by: C=US, O=Let's Encrypt, CN=Let's Encrypt Authority X3
Valid from: 2024-10-01 to 2025-01-02
Days remaining: 45
Status: ✓ Valid and trusted

CERTIFICATE CHAIN
────────────────────────────────────────────────────────────────
Certificate verification: ✓ Valid
Chain complete: ✓ Yes
Root CA present: ✓ Yes

NGINX CONFIGURATION  
────────────────────────────────────────────────────────────────
Nginx running: ✓ Yes
Config syntax: ✓ Valid
SSL module loaded: ✓ Yes

Port 2083 (Customer HTTPS):
  Status: ✓ Listening
  Protocol: TLS 1.2, TLS 1.3
  Ciphers: HIGH (strong)
  Certificate: ✓ Matches certificate file
  
Port 2087 (Admin HTTPS):
  Status: ✓ Listening
  Protocol: TLS 1.2, TLS 1.3
  Ciphers: HIGH (strong)
  Certificate: ✓ Matches certificate file

CONNECTIVITY TEST
────────────────────────────────────────────────────────────────
Testing port 2083: ✓ Responding
Testing port 2087: ✓ Responding

curl -k https://localhost:2083/customer
  Status: 200 OK ✓

curl -k https://localhost:2087/admin
  Status: 200 OK ✓

RENEWAL AUTOMATION (Let's Encrypt)
────────────────────────────────────────────────────────────────
Certbot installed: ✓ Yes
Renewal cron job: ✓ Installed
Last renewal attempt: 2024-12-15 02:00:00
Next renewal check: 2024-12-20 02:00:00
Status: ✓ Running

CERTIFICATE RENEWAL LOG
────────────────────────────────────────────────────────────────
2024-12-15 02:00:30 Renewal check started
2024-12-15 02:00:31 Certificate valid for 47 days, no renewal needed
2024-12-15 02:00:32 Check completed successfully

MONITORING ALERTS
────────────────────────────────────────────────────────────────
Expiration monitoring: ✓ Enabled
Alert threshold: 14 days
Next alert check: 2024-12-20 01:00:00
Status: ✓ No alerts pending

SUMMARY
════════════════════════════════════════════════════════════════
Overall Status: ✓ HEALTHY

All systems operational:
  ✓ Certificate files present and readable
  ✓ Certificate valid and properly signed
  ✓ Nginx listening on HTTPS ports
  ✓ Certificate renewal automated
  ✓ Monitoring alerts active
  
No action required. System is ready for production use.

For detailed information, see:
  Certificate details: openssl x509 -in /etc/ssl/certs/npanel.crt -text
  Nginx config: sudo nginx -T | grep -A5 ssl
  Renewal logs: sudo journalctl -u certbot-renewal
```

---

## 5. DOCUMENTATION ALIGNMENT

### Installation Documentation (install_npanel.sh output)

**Current**:
```
HTTPS (Secure - Production)
URL: https://localhost:2087
Note: Accept self-signed certificate warning
```

**Problem**: Misleading - no self-signed cert exists by default.

**New** (ACCURATE):

For DEVELOPMENT:
```
HTTPS (Secure - Development)
URL: https://localhost:2087
Note: Self-signed certificate generated automatically
      Accept browser warning (expected for self-signed)
```

For PRODUCTION:
```
HTTPS (Secure - Production)
URL: https://yourdomain.com:2087
Note: Using Let's Encrypt certificate
      Browser shows "Secure" indicator
```

---

### README Documentation

**Current**: Missing TLS setup instructions

**New** (REQUIRED): Add section

```markdown
## SSL/TLS Setup

### Development (localhost)

SSL is automatically configured with a self-signed certificate:

- Admin: https://localhost:2087
- Customer: https://localhost:2083

The browser will show a security warning (expected).
Use curl -k or import the cert in your browser.

### Production (yourdomain.com)

NPanel requires a valid SSL certificate for production.

1. Install Certbot
2. Get Let's Encrypt certificate
3. Configure nginx paths
4. Run installer with production flag

See: CERTIFICATE_POLICY.md for detailed instructions
```

---

## 6. SUPPORT RESOURCES

### Built-In Help Commands

```bash
# Show TLS troubleshooting guide
sudo ./install_npanel.sh help tls

# Show Let's Encrypt setup
sudo ./install_npanel.sh help letsencrypt

# Show certificate renewal
sudo ./install_npanel.sh help renewal

# Show complete list
sudo ./install_npanel.sh help
```

### Online Documentation URLs

Reference in all error messages:

- `https://docs.npanel.io/production-tls`
- `https://docs.npanel.io/certificate-policy`
- `https://docs.npanel.io/let's-encrypt-setup`
- `https://docs.npanel.io/troubleshooting-https`

---

## 7. OPERATOR CHECKLIST

### Pre-Production Deployment

Before deploying to production:

- [ ] Environment set to `production` not `development`
- [ ] Valid SSL certificate obtained (Let's Encrypt recommended)
- [ ] Certificate file at `/etc/ssl/certs/npanel.crt`
- [ ] Private key at `/etc/ssl/private/npanel.key`
- [ ] Certificate expiration > 30 days away
- [ ] Nginx configuration updated with cert paths
- [ ] `sudo nginx -t` passes syntax check
- [ ] `sudo ./install_npanel.sh diagnose-tls` shows all ✓
- [ ] `curl -k https://yourdomain.com:2087` works
- [ ] Renewal automation configured (cron or systemd timer)
- [ ] Monitoring alerts enabled for expiration
- [ ] HTTP ports (2082, 2086) redirect to HTTPS
- [ ] HSTS headers enabled in nginx

### Day-1 Deployment

- [ ] Installer runs with `--environment production`
- [ ] No blocking errors
- [ ] HTTPS ports respond
- [ ] Certificate shown as valid in browser

### Ongoing Maintenance

- [ ] Monitor certificate renewal logs monthly
- [ ] Alert thresholds set for expiration warnings
- [ ] Test renewal process quarterly (`certbot renew --dry-run`)
- [ ] Review TLS configuration annually for security updates

---

## 8. SIGN-OFF

**Task 2.3.4 Complete**: Operator UX & Messaging

- ✅ Error messages are clear and actionable
- ✅ No silent failures
- ✅ Diagnostic tools provided
- ✅ Documentation matches behavior
- ✅ Support resources documented
- ✅ Operator checklists provided

**Quality Metrics**:
- All errors have example output
- All errors have remediation steps
- All errors link to further resources
- All diagnostics are automated

**Next Step**: Complete Phase 2.3 with final integration report.
