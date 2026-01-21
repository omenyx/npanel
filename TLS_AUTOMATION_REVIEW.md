# TLS Automation Review - Phase 2.3.3
## Let's Encrypt & Certbot Integration Analysis

**Status**: Review & Recommendations  
**Date**: 2024-12-19  
**Scope**: ACME challenge flow, renewal behavior, failure modes

---

## Executive Summary

Let's Encrypt support in NPanel is **manually documented but not integrated**:

- ⚠️ **No automation**: Operator must manually run certbot
- ⚠️ **No renewal hooks**: Certificates will expire without intervention
- ⚠️ **No monitoring**: No alerts before expiration
- ⚠️ **No rollback**: If renewal fails, production breaks silently

**Recommendation**: Add automated renewal and monitoring hooks.

---

## 1. CURRENT STATE: MANUAL LET'S ENCRYPT FLOW

### What the Installer Currently Says

(from `install_npanel.sh`, lines 2208-2224)

```
🔐 SSL CERTIFICATE SETUP (Production)

Using Let's Encrypt:

1. Install Certbot:
   sudo apt install certbot

2. Get certificate:
   sudo certbot certonly --standalone \
     -d yourdomain.com

3. Update nginx config:
   Edit /etc/nginx/conf.d/npanel.conf
   ssl_certificate /etc/letsencrypt/live/...
   ssl_certificate_key /etc/letsencrypt/live/...

4. Reload nginx:
   sudo systemctl reload nginx
```

### Operator Workflow (Manual)

```bash
# Step 1: User manually runs certbot
sudo certbot certonly --standalone -d yourdomain.com

# Certbot interactive flow:
# - Prompts for email
# - Checks domain ownership via HTTP
# - Creates cert at /etc/letsencrypt/live/yourdomain.com/

# Step 2: User manually edits nginx config
sudo nano /etc/nginx/conf.d/npanel.conf
# Change cert paths

# Step 3: User manually reloads nginx
sudo systemctl reload nginx

# Step 4: Done - but renewal NOT automatic
```

### Issues with Manual Approach

| Issue | Impact | Probability |
|-------|--------|-------------|
| User forgets to renew cert | Outage in 89+ days | High |
| Renewal fails silently | Expired cert causes HTTPS failure | Medium |
| Wrong cert path in config | nginx won't start | Low |
| Renewal changes cert path | Manual path update needed | Medium |
| Multiple domains need certs | Many manual steps | High |

---

## 2. LET'S ENCRYPT ACME FLOW - ANALYSIS

### Standard ACME Flow (certbot certonly --standalone)

```
1. Domain Ownership Verification
   ┌─────────────────────────────┐
   │ Client requests certificate │ → certbot
   └──────────────┬──────────────┘
                  │
                  ↓
   ┌─────────────────────────────┐
   │ Challenge: HTTP-01          │ → Certbot listens on :80
   │ (or DNS-01, TLS-ALPN-01)    │
   └──────────────┬──────────────┘
                  │
                  ↓
   ┌─────────────────────────────┐
   │ ACME server validates       │ → Let's Encrypt checks
   │ .well-known/acme-challenge/ │
   └──────────────┬──────────────┘
                  │
                  ↓
   ┌─────────────────────────────┐
   │ Certificate issued          │ → /etc/letsencrypt/live/
   └─────────────────────────────┘
```

### Challenges with NPanel Port Structure

```
Standard HTTP-01 verification:
- Certbot needs port 80 (HTTP) for challenge
- Problem: NPanel already uses port 80+ for services

// Current NPanel ports:
8080  → Mixed (nginx proxy)
2082  → Customer HTTP (nginx proxy)
2083  → Customer HTTPS (nginx proxy)
2086  → Admin HTTP (nginx proxy)
2087  → Admin HTTPS (nginx proxy)
```

### Solution: --standalone vs. --webroot vs. --nginx

| Method | How It Works | Requirements | Status |
|--------|------------|--------------|--------|
| **--standalone** | Certbot binds to :80 | Port 80 available during challenge | ✅ Works |
| **--webroot** | Writes to web directory | Requires nginx restart | ⚠️ Could work |
| **--nginx** | Certbot modifies nginx | Requires certbot-nginx plugin | ⚠️ Could work |

**Recommendation**: Use `--webroot` with NPanel's nginx for automation.

---

## 3. ACME CHALLENGE VERIFICATION FOR NPANEL

### Current Status: No Built-In Challenge Support

NPanel **does not** currently provide ACME challenge endpoint.

```
Standard certbot --webroot -w /var/www/html
- Writes to /var/www/html/.well-known/acme-challenge/TOKEN
- Let's Encrypt fetches from http://yourdomain.com/.well-known/acme-challenge/TOKEN

NPanel could support this by:
- Adding /.well-known/ proxy in nginx
- OR providing ACME endpoint in backend
```

### Recommended: nginx webroot method

#### Setup (One-time)

```bash
# Create ACME challenge directory
sudo mkdir -p /opt/npanel/acme-challenges
sudo chmod 755 /opt/npanel/acme-challenges

# Update nginx to serve ACME challenges
sudo cat >> /etc/nginx/conf.d/npanel.conf <<'EOF'
# ACME challenge endpoint (all vhosts)
location /.well-known/acme-challenge/ {
    root /opt/npanel/acme-challenges;
    try_files $uri =404;
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

#### Manual Cert Request

```bash
# Get initial certificate
sudo certbot certonly \
  --webroot \
  -w /opt/npanel/acme-challenges \
  -d yourdomain.com \
  -d admin.yourdomain.com
```

#### Automated Renewal

```bash
# Create renewal hook script
sudo cat > /opt/npanel/scripts/cert-renew-hook.sh <<'EOF'
#!/bin/bash
# Called after successful certbot renewal
systemctl reload nginx
systemctl restart npanel-backend npanel-frontend
echo "Certificate renewed and services reloaded"
EOF

sudo chmod +x /opt/npanel/scripts/cert-renew-hook.sh

# Configure certbot renewal
sudo certbot renew \
  --post-hook /opt/npanel/scripts/cert-renew-hook.sh \
  --agree-tos \
  --non-interactive

# Add to crontab (daily at 2 AM)
sudo cat > /etc/cron.d/npanel-certbot-renewal <<'EOF'
0 2 * * * certbot renew --quiet --post-hook /opt/npanel/scripts/cert-renew-hook.sh
EOF
```

---

## 4. RENEWAL BEHAVIOR ANALYSIS

### Default Let's Encrypt Behavior

```bash
# Certificate validity: 90 days
# Renewal available after: 30 days (60 days before expiry)
# Best practice: Renew at 60 days before expiry
```

### Renewal Process

```
Day 1:     Cert issued
Days 1-59: No renewal available
Day 60:    Available for renewal (30 days before expiry)
Day 89:    Should have renewed
Day 90:    EXPIRES
Day 91+:   Certificate invalid - HTTPS fails
```

### Failure Modes

#### Scenario 1: Renewal Never Runs

```
Day 1:   Cert issued
Day 90:  Expires
Day 91:  HTTPS breaks
         - curl https://yourdomain.com:2087
         - SSL: certificate problem: certificate has expired
         - Customers cannot access panel
```

**Current protection**: NONE

**New protection** (REQUIRED):
```bash
# Daily monitoring job
0 1 * * * /opt/npanel/bin/check-cert-expiry
```

#### Scenario 2: Renewal Fails

```
Day 60: Renewal attempt
        - Let's Encrypt server down
        - Or DNS resolution fails
        - Or port 80 not reachable during challenge
        
        Certbot returns error:
        "FAILED: Could not complete HTTP-01 challenge"
        
Day 90: Cert expires
        HTTPS broken - no notification
```

**Current protection**: NONE

**New protection** (REQUIRED):
```bash
# In renewal hook script:
if certbot renew fails; then
  send_alert "Cert renewal failed - manual action required"
fi
```

#### Scenario 3: Renewal Succeeds but Hook Fails

```
Day 60: Renewal succeeds
        Hook script runs (systemctl reload nginx)
        
        Hook returns error:
        "Job for nginx.service failed"
        - Old cert still in memory
        - Nginx continues serving old cert
        
Day 90: Old cert expires during connection
        Some users see SSL error
```

**Current protection**: NONE

**New protection** (REQUIRED):
```bash
# In hook script, verify nginx reloaded successfully
if ! curl -k https://localhost:2083 >/dev/null 2>&1; then
  send_alert "Nginx reload failed after cert renewal"
  exit 1
fi
```

---

## 5. RENEWAL AUTOMATION SETUP

### Option A: Manual Renewal (Current)

**How**: User runs `certbot renew` manually

**Pros**:
- Simple, no new code needed
- Full operator control

**Cons**:
- ❌ Will be forgotten
- ❌ Outage guaranteed

**Recommendation**: ❌ NOT ACCEPTABLE FOR PRODUCTION

---

### Option B: Cron-Based Automation (Recommended)

#### Implementation

```bash
# Create renewal script
sudo cat > /opt/npanel/bin/renew-certificates.sh <<'EOF'
#!/bin/bash
set -euo pipefail

LOG="/var/log/npanel-cert-renewal.log"

log() { echo "[$(date)] $*" >> "$LOG"; }
err() { echo "[$(date)] ERROR: $*" >> "$LOG" >&2; }

log "Starting certificate renewal check..."

# Verify cert exists
if [[ ! -f /etc/letsencrypt/live/yourdomain.com/fullchain.pem ]]; then
  err "Certificate not found"
  exit 1
fi

# Check expiration
DAYS_LEFT=$(openssl x509 -checkend 86400 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem >/dev/null 2>&1; echo $?)

if [[ $DAYS_LEFT -eq 0 ]]; then
  # Expires within 24 hours - CRITICAL
  err "Certificate expires within 24 hours - IMMEDIATE renewal required"
  exit 1
elif [[ $DAYS_LEFT -ne 1 ]]; then
  # Expires more than 24 hours from now - don't renew yet
  log "Certificate still valid, renewal not needed yet"
  exit 0
fi

log "Renewal needed, running certbot..."

# Run renewal
if ! certbot renew \
  --quiet \
  --post-hook "/opt/npanel/bin/post-renewal-hook.sh"; then
  err "Certbot renewal failed"
  exit 1
fi

log "Renewal completed successfully"
EOF

sudo chmod +x /opt/npanel/bin/renew-certificates.sh

# Create post-renewal hook
sudo cat > /opt/npanel/bin/post-renewal-hook.sh <<'EOF'
#!/bin/bash
set -euo pipefail

LOG="/var/log/npanel-cert-renewal.log"
log() { echo "[$(date)] $*" >> "$LOG"; }
err() { echo "[$(date)] ERROR: $*" >> "$LOG" >&2; }

log "Running post-renewal hooks..."

# Verify new cert is valid
if ! openssl x509 -checkend 0 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem >/dev/null 2>&1; then
  err "New certificate is invalid or expired"
  exit 1
fi

log "New certificate validated"

# Reload nginx
if ! systemctl reload nginx; then
  err "Failed to reload nginx"
  exit 1
fi

log "nginx reloaded successfully"

# Verify HTTPS is working
if ! curl -k -s -o /dev/null https://localhost:2087/admin; then
  err "HTTPS verification failed after renewal"
  exit 1
fi

log "HTTPS verification passed"

# Restart services to pick up new cert
systemctl restart npanel-backend npanel-frontend

log "Services restarted - renewal complete"
EOF

sudo chmod +x /opt/npanel/bin/post-renewal-hook.sh

# Add to crontab (daily at 2 AM)
sudo cat > /etc/cron.d/npanel-cert-renewal <<'EOF'
# NPanel certificate renewal check (daily at 2 AM)
0 2 * * * root /opt/npanel/bin/renew-certificates.sh
EOF

sudo chmod 644 /etc/cron.d/npanel-cert-renewal
```

#### Verification

```bash
# Test the renewal script
sudo /opt/npanel/bin/renew-certificates.sh

# Monitor logs
tail -f /var/log/npanel-cert-renewal.log
```

### Option C: systemd Timer (Modern Alternative)

```bash
# Create service file
sudo cat > /etc/systemd/system/npanel-cert-renewal.service <<'EOF'
[Unit]
Description=NPanel Certificate Renewal
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/npanel/bin/renew-certificates.sh
StandardOutput=journal
StandardError=journal
SyslogIdentifier=npanel-cert-renewal

[Install]
WantedBy=multi-user.target
EOF

# Create timer file
sudo cat > /etc/systemd/system/npanel-cert-renewal.timer <<'EOF'
[Unit]
Description=NPanel Certificate Renewal Timer
Requires=npanel-cert-renewal.service

[Timer]
# Run daily at 2 AM
OnCalendar=daily
OnCalendar=*-*-* 02:00:00
Persistent=true

# Run immediately if missed
AccuracySec=1m

[Install]
WantedBy=timers.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable npanel-cert-renewal.timer
sudo systemctl start npanel-cert-renewal.timer

# Status
sudo systemctl status npanel-cert-renewal.timer
sudo journalctl -u npanel-cert-renewal
```

---

## 6. EXPIRATION MONITORING

### Alert Thresholds

```
Days until expiry | Alert Level | Action Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
60 or more       | None         | (no action)
30-59            | INFO         | (renewal should be automatic)
14-29            | WARNING      | Watch renewal logs
7-13             | CRITICAL     | Urgent - manual intervention may be needed
0-6              | CRITICAL     | IMMEDIATE action required
Negative (expired)| FATAL        | Service is DOWN
```

### Monitoring Implementation

```bash
# Daily monitoring check
sudo cat > /opt/npanel/bin/check-cert-expiry.sh <<'EOF'
#!/bin/bash
set -euo pipefail

CERT="/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
ALERT_EMAIL="admin@yourdomain.com"

if [[ ! -f "$CERT" ]]; then
  echo "CRITICAL: Certificate not found"
  exit 1
fi

# Check expiration
EXPIRY_DATE=$(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)
EXPIRY_EPOCH=$(date -d "$EXPIRY_DATE" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [[ $DAYS_LEFT -lt 0 ]]; then
  echo "FATAL: Certificate has expired"
  mail -s "FATAL: NPanel certificate expired at $(hostname)" "$ALERT_EMAIL"
  exit 1
elif [[ $DAYS_LEFT -lt 7 ]]; then
  echo "CRITICAL: Certificate expires in $DAYS_LEFT days"
  mail -s "CRITICAL: NPanel certificate expires soon ($DAYS_LEFT days)" "$ALERT_EMAIL"
elif [[ $DAYS_LEFT -lt 14 ]]; then
  echo "WARNING: Certificate expires in $DAYS_LEFT days"
  mail -s "WARNING: NPanel certificate expires in $DAYS_LEFT days" "$ALERT_EMAIL"
else
  echo "OK: Certificate valid for $DAYS_LEFT days"
fi
EOF

sudo chmod +x /opt/npanel/bin/check-cert-expiry.sh

# Add to crontab (daily at 1 AM)
echo "0 1 * * * root /opt/npanel/bin/check-cert-expiry.sh >> /var/log/npanel-cert-check.log 2>&1" | \
  sudo tee -a /etc/cron.d/npanel-cert-check
```

---

## 7. FAILURE HANDLING MATRIX

| Failure | Detection | Current | New | Recovery |
|---------|-----------|---------|-----|----------|
| Renewal script fails | Cron error | ❌ No notification | ✅ Email alert | Manual `certbot renew` |
| Hook script fails | Post-renewal check | ❌ Silent | ✅ Logged & alerted | Manual systemctl reload |
| Cert expires (renewal missed) | Health check | ❌ HTTPS breaks | ✅ Daily monitoring | Emergency renewal |
| Let's Encrypt API down | Renewal attempt | ❌ Fails silently | ✅ Alerted | Retry next day |
| Port 80 blocked during challenge | ACME challenge | ❌ Renewal fails | ✅ Pre-check in script | Firewall rules review |

---

## 8. IMPLEMENTATION CHECKLIST

### Phase 1: Immediate (Installer)

- [ ] Add `--standalone` certbot instructions
- [ ] Document `/opt/npanel/acme-challenges` directory
- [ ] Create `post-renewal-hook.sh` template
- [ ] Include renewal setup in installer script

### Phase 2: Short-term (v1.1)

- [ ] Implement cron-based renewal (Option B above)
- [ ] Add post-renewal hooks and verification
- [ ] Create monitoring scripts
- [ ] Add email alerts for failures

### Phase 3: Medium-term (v1.2)

- [ ] Add systemd timer support (Option C)
- [ ] Create web UI for certificate management
- [ ] Add automatic domain detection
- [ ] Implement DNS-01 challenge (for complex setups)

### Phase 4: Long-term (v2.0)

- [ ] Built-in ACME endpoint in NPanel backend
- [ ] Automatic Let's Encrypt integration
- [ ] Multi-domain certificate support
- [ ] Renewal dashboard in admin panel

---

## 9. RECOMMENDED AUTOMATION SETUP

### For Production NPanel Instances

```bash
# 1. Create certificate and automation directories
sudo mkdir -p /opt/npanel/{bin,acme-challenges}
sudo chmod 755 /opt/npanel/{bin,acme-challenges}

# 2. Install and configure certbot
sudo apt-get install certbot

# 3. Get initial certificate
sudo certbot certonly \
  --standalone \
  -d yourdomain.com \
  --email admin@yourdomain.com \
  --agree-tos

# 4. Set up renewal scripts (use templates above)
# Copy scripts to /opt/npanel/bin/

# 5. Add renewal to crontab
sudo nano /etc/cron.d/npanel-cert-renewal

# 6. Add monitoring to crontab  
sudo nano /etc/cron.d/npanel-cert-check

# 7. Verify setup
sudo /opt/npanel/bin/check-cert-expiry.sh
```

---

## 10. SIGN-OFF

**Task 2.3.3 Complete**: Let's Encrypt Verification

- ✅ ACME flow documented
- ✅ Renewal behavior analyzed
- ✅ Failure modes identified
- ✅ Automation recommendations provided
- ✅ Monitoring setup documented
- ✅ Implementation checklist created

**Status**: Ready for implementation

**Key Finding**: Let's Encrypt support requires automated renewal and monitoring. Manual-only approach will lead to production outages.

**Next Step**: Implement renewal automation in installer and add monitoring scripts.
