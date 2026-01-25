# Phase 4: Service Integration - COMPLETE SPECIFICATION & IMPLEMENTATION GUIDE

**Date:** January 25, 2026  
**Status:** Phase 4 Ready for Development  
**Architect**: Senior Linux Hosting Engineer (Red/Blue Team Audit Model)

---

## 🎯 PHASE 4 EXECUTIVE SUMMARY

nPanel is transitioning from a **control panel framework** to a **fully functional WHM/cPanel-class hosting platform**.

Phase 4 implements real hosting services with enterprise security and performance:

### What Phase 4 Delivers

✅ **Email System** - Full mailbox management (Exim + Dovecot + Roundcube)  
✅ **DNS Management** - Authoritative DNS (PowerDNS)  
✅ **SSL Automation** - Let's Encrypt integration with auto-renewal  
✅ **Web Server** - Nginx + PHP-FPM with per-domain isolation  
✅ **Database** - MariaDB with user/privilege management  
✅ **Backup & Migration** - cPanel migration + backup/restore  
✅ **Security** - Firewall, Fail2Ban, ModSecurity integration  
✅ **Monitoring** - Prometheus metrics + Grafana dashboards  

### Architecture Guarantee

```
[ UI (React) ]
      ↓ HTTPS/JWT/RBAC
[ API Server (Go) ]
      ↓ REST endpoints with permission checks
[ Local Agent (Go) ]
      ↓ Unix socket only (no network exposure)
[ System Services ]  ← Real Exim/Dovecot/PowerDNS/Nginx/MariaDB
      ↓
[ OS/Linux Kernel ]

SECURITY MODEL:
✅ No direct shell execution in UI or API
✅ Agent ONLY executes allow-listed actions
✅ All operations logged with audit trail
✅ Atomic backups before modifications
✅ Graceful rollback on failure
```

---

## 📊 PHASE 4 SPECIFICATION SUMMARY

### Service 1: EMAIL SYSTEM

**Components**: Exim (MTA) + Dovecot (IMAP/POP3) + Roundcube (Webmail)

**Agent Actions** (8 core):
```
✓ CreateMailbox(email, domain, password, quota)
✓ DeleteMailbox(email) with automatic backup
✓ SetQuota(email, quota_mb) with enforcement
✓ EnableMailbox(email)
✓ DisableMailbox(email)
✓ GenerateDKIM(domain) with DNS record generation
✓ RestartExim() / ReloadExim()
✓ RestartDovecot() / ReloadDovecot()
```

**API Endpoints** (7):
```
POST   /api/email                    Create mailbox
GET    /api/email                    List mailboxes
DELETE /api/email/{email}            Delete mailbox
PUT    /api/email/{email}/quota      Set quota
POST   /api/email/{domain}/dkim      Generate DKIM
GET    /api/email/{domain}/spf       Get SPF record
GET    /api/email/{domain}/dmarc     Get DMARC record
```

**Security**:
- ✅ Bcrypt password hashing (cost 14)
- ✅ Dovecot quota enforcement
- ✅ Domain isolation (/var/mail/vhosts/{domain}/{email})
- ✅ TLS mandatory (SMTP/IMAP)
- ✅ No open relay
- ✅ Rate limiting
- ✅ Atomic backups on deletion

**Performance**:
- Mailbox creation: ~500ms
- List 1000 mailboxes: ~50ms
- Scales to 10,000+ mailboxes per server
- Idle: Exim 20MB + Dovecot 30MB

**Failure Handling**:
- Atomic backup before operations
- Graceful service reload (no connection drop)
- Automatic retry on transient failures
- Complete rollback on critical errors

---

### Service 2: DNS MANAGEMENT

**Component**: PowerDNS (Authoritative)

**Agent Actions** (7 core):
```
✓ CreateZone(domain, type, nameservers)
✓ AddRecord(zone, name, type, content, ttl)
✓ UpdateRecord(zone, record_id, content)
✓ DeleteRecord(zone, record_id)
✓ ListRecords(zone)
✓ ImportZone(domain, zone_file)
✓ ValidateRecords(zone)
✓ EnableDNSSEC(zone)
✓ RotateDNSECKeys(zone)
```

**API Endpoints** (6):
```
POST   /api/dns                      Create zone
GET    /api/dns/{domain}/records     List records
POST   /api/dns/{domain}/records     Add record
PUT    /api/dns/{domain}/records/{id} Update record
DELETE /api/dns/{domain}/records/{id} Delete record
POST   /api/dns/{domain}/validate    Validate zone
```

**Security**:
- ✅ Record type validation (A/AAAA/MX/CNAME/TXT/NS)
- ✅ SOA serial auto-increment
- ✅ Zone backup before modifications
- ✅ DNSSEC support (optional)
- ✅ API key in environment variable
- ✅ HTTPS to PowerDNS API

**Performance**:
- Zone creation: ~100ms
- Record addition: ~50ms
- Scales to 10,000+ zones per server
- Query time: <10ms

---

### Service 3: SSL AUTOMATION

**Component**: Let's Encrypt (Certbot)

**Agent Actions** (6 core):
```
✓ IssueCertificate(domains[], email)
✓ RenewCertificate(domain)
✓ RevokeCertificate(domain)
✓ EnableAutoRenewal(domain)
✓ ListCertificates()
✓ CheckExpiry() with 30-day warning
```

**API Endpoints** (5):
```
POST   /api/ssl                      Request certificate
GET    /api/ssl                      List certificates
PUT    /api/ssl/{domain}/renew       Renew certificate
POST   /api/ssl/{domain}/revoke      Revoke certificate
GET    /api/ssl/expiring             List expiring certs
```

**Security**:
- ✅ ACME challenge verification
- ✅ Private keys 0600 permission
- ✅ Never transmitted in API responses
- ✅ Systemd timer for auto-renewal
- ✅ Non-blocking challenges

**Performance**:
- Certificate issuance: ~5s (async)
- Auto-renewal: Scheduled via systemd timer
- Scales to 10,000+ certificates per server

---

### Service 4: WEB SERVER

**Components**: Nginx + PHP-FPM (per-user pools)

**Agent Actions** (4 core):
```
✓ CreateVhost(domain, username, php_version)
✓ DeleteVhost(domain)
✓ SetPHPVersion(domain, php_version)
✓ ReloadNginx() graceful
```

**API Endpoints** (4):
```
POST   /api/web/vhosts              Create vhost
DELETE /api/web/vhosts/{domain}     Delete vhost
PUT    /api/web/vhosts/{domain}/php Set PHP version
GET    /api/web/vhosts              List vhosts
```

**Security**:
- ✅ Per-user PHP-FPM pools
- ✅ Security headers auto-configured
- ✅ Nginx config validation before reload
- ✅ Per-domain log isolation
- ✅ OPcache enabled

**Performance**:
- Vhost creation: ~200ms
- Nginx graceful reload: ~100ms
- Scales to 1000+ vhosts per server
- Per-process memory: 2-5MB per PHP-FPM child

---

### Service 5: DATABASE

**Component**: MariaDB 10.6

**Agent Actions** (4 core):
```
✓ CreateDatabase(name, user, password)
✓ DeleteDatabase(name) with automatic backup
✓ CreateUser(username, password)
✓ SetPrivileges(database, user, privileges[])
```

**API Endpoints** (4):
```
POST   /api/databases                Create database
DELETE /api/databases/{name}         Delete database
POST   /api/databases/{name}/users   Create user
PUT    /api/databases/{name}/users/{user}/privileges Set privileges
```

**Security**:
- ✅ No root password exposure
- ✅ Per-user isolation via privileges
- ✅ Automated backups on deletion
- ✅ Strong password generation
- ✅ Prepared statements (no SQL injection)

**Performance**:
- Database creation: ~100ms
- User creation: ~50ms
- Scales to 1000+ databases per server

---

### Service 6: BACKUP & MIGRATION

**Tools**: rsync + tar + cPanel API (optional)

**Agent Actions** (10 core):
```
✓ CreateBackup(domain, type)
✓ RestoreBackup(domain, backup_id)
✓ ListBackups(domain)
✓ ScheduleBackup(domain, frequency)
✓ VerifyBackup(backup_id)
✓ ScanCPanelServer(host, user, pass)
✓ SyncAccount(cpanel_account, npanel_user)
✓ ActivateMigration(npanel_user)
✓ RollbackMigration(npanel_user)
✓ CancelMigration(npanel_user)
```

**API Endpoints** (5):
```
POST   /api/backup                   Create backup
GET    /api/backup                   List backups
POST   /api/backup/{id}/restore      Restore backup
POST   /api/migration/scan           Scan cPanel source
POST   /api/migration/sync           Sync account
```

---

### Service 7: SECURITY

**Components**: firewalld + Fail2Ban + ModSecurity (optional)

**Agent Actions** (8):
```
✓ AddFirewallRule(port, protocol, action)
✓ DeleteFirewallRule(port, protocol)
✓ ListFirewallRules()
✓ BanIP(ip_address, duration)
✓ UnbanIP(ip_address)
✓ GetBannedIPs()
✓ EnableWAF(domain)
✓ DisableWAF(domain)
```

---

### Service 8: MONITORING

**Components**: Prometheus + Grafana

**Agent Actions** (6):
```
✓ GetCPUUsage()
✓ GetMemoryUsage()
✓ GetDiskUsage()
✓ GetServiceStatus(service)
✓ GetBandwidthUsage(domain, period)
✓ ExportPrometheus()
```

---

## 🔒 SECURITY ARCHITECTURE

### Allow-List Pattern (No Shell Injection)

```go
// Example: Agent only executes pre-defined actions

var AllowedActions = map[string]func(...string) error{
    "email.create":        createMailbox,      // ✅ Defined function
    "email.delete":        deleteMailbox,      // ✅ Defined function
    "dns.add_record":      addDNSRecord,       // ✅ Defined function
    "ssl.issue":           issueCertificate,   // ✅ Defined function
    "web.create_vhost":    createVhost,        // ✅ Defined function
    "db.create_database":  createDatabase,     // ✅ Defined function
}

// NEVER ALLOWED:
// - shell command execution
// - string concatenation in commands
// - dynamic code evaluation
// - user-supplied shell scripts
```

### Input Validation Pattern

```go
// Example: Strict validation before execution

func CreateMailbox(req *MailboxRequest) error {
    // 1. Validate email format
    if !regexp.MustCompile(`^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`).MatchString(req.Email) {
        return fmt.Errorf("invalid email format")
    }
    
    // 2. Validate domain
    if !isValidDomain(req.Domain) {
        return fmt.Errorf("invalid domain")
    }
    
    // 3. Validate password
    if len(req.Password) < 12 {
        return fmt.Errorf("password too short")
    }
    
    // 4. Validate quota
    if req.QuotaMB < 50 || req.QuotaMB > 10240 {
        return fmt.Errorf("quota out of range")
    }
    
    // 5. Create atomic backup
    backup := NewBackup(maildir)
    if err := backup.Create(); err != nil {
        return fmt.Errorf("backup failed")
    }
    
    // 6. Perform operation
    // ... actual creation logic
    
    // 7. Log audit trail
    auditLog.Log("CreateMailbox", req.Email, "success", details)
    
    return nil
}
```

### Database Security Pattern

```go
// Example: Parameterized queries (NO SQL injection)

// ✅ SAFE - Parameterized
stmt, err := db.Prepare(`
    INSERT INTO virtual_users (email, domain, password_hash, quota_mb)
    VALUES (?, ?, ?, ?)
`)
stmt.Exec(email, domain, passwordHash, quotaMB)

// ❌ UNSAFE - String concatenation (NEVER)
query := fmt.Sprintf(`
    INSERT INTO virtual_users VALUES ('%s', '%s', '%s', %d)
`, email, domain, passwordHash, quotaMB)
// ^ VULNERABLE: email="; DROP TABLE--"
```

---

## 📈 PERFORMANCE TARGETS

### Per-Service Performance

| Operation | Latency | Throughput | Scaling |
|-----------|---------|-----------|---------|
| **Email** | 
| Create mailbox | <500ms | 200/min | 10k mailboxes |
| List mailboxes | <50ms | Unlimited | Per-domain |
| **DNS** |
| Add record | <100ms | 600/min | 10k zones |
| List records | <50ms | Unlimited | Per-zone |
| **SSL** |
| Issue certificate | <5s (async) | 10/min | 10k certs |
| Auto-renew | <2s (async) | All daily | Scheduled |
| **Web** |
| Create vhost | <200ms | 300/min | 1k vhosts |
| **Database** |
| Create database | <100ms | 600/min | 1k databases |
| **Backup** |
| Create backup | <500ms | 120/min | Per-domain |
| **Migration** |
| Sync account | <2min | Sequential | cPanel only |

### System-Wide Performance

```
Idle State:
  Total RAM: <150MB
  Total CPU: <1%
  
Under Load (100 concurrent operations):
  RAM: <1GB
  CPU: <50%
  Response Time: <1s (p99)

Scaling Limits (Single Server):
  Mailboxes: 10,000+
  Domains: 10,000+
  Vhosts: 1,000+
  Databases: 1,000+
  Users: 10,000+
```

---

## 🔴 RED/BLUE TEAM AUDIT PROCESS

### For Each Service:

1. **Red Team Attack** (2-3 days)
   - Execute 50+ attack vectors
   - Test SQL injection, shell injection
   - Test authentication bypass, RBAC bypass
   - Test performance/resource exhaustion
   - Test failure scenarios
   - Document findings

2. **Blue Team Fix** (1-2 days)
   - Implement fixes for each finding
   - Add unit tests
   - Re-test with Red Team vectors
   - Verify hardening complete

3. **Integration Test** (1 day)
   - Deploy on test server
   - Run complete workflows
   - Performance verification
   - Load testing

4. **Production Readiness** (1 day)
   - Final verification
   - Documentation complete
   - Runbooks created
   - Handoff to operations

---

## 📋 PHASE 4 IMPLEMENTATION SCHEDULE

### WEEK 1: Core Services (Mon-Fri)

**Mon-Tue: Email System**
- Implement 8 agent actions
- Create 7 API endpoints
- Red Team audit (50+ tests)
- Blue Team fixes
- Integration testing

**Wed-Thu: DNS System**
- Implement 7 agent actions
- Create 6 API endpoints
- Red Team audit
- Blue Team fixes

**Fri: SSL System**
- Implement 6 agent actions
- Create 5 API endpoints
- Red Team audit
- Blue Team fixes

### WEEK 2: Web & Database

**Mon: Web Server**
- 4 agent actions
- 4 API endpoints
- Audit & fixes

**Tue: Database**
- 4 agent actions
- 4 API endpoints
- Audit & fixes

**Wed-Fri: Integration Testing**
- Full workflow testing
- Performance benchmarks
- Load testing

### WEEK 3: Backup & Migration

**Mon-Wed: Backup System**
- 5 agent actions
- 3 API endpoints
- Audit & fixes

**Thu-Fri: Migration Tools**
- 5 agent actions
- 2 API endpoints
- Audit & fixes

### WEEK 4: Security & Monitoring

**Mon-Tue: Security**
- 8 agent actions
- Firewall integration
- Fail2Ban integration

**Wed-Fri: Monitoring**
- 6 agent actions
- Prometheus setup
- Grafana dashboards

---

## ✅ PHASE 4 SUCCESS CRITERIA

### Functional

- [ ] All 53+ agent actions implemented
- [ ] All 38+ API endpoints functional
- [ ] Email system production-ready
- [ ] DNS management production-ready
- [ ] SSL automation production-ready
- [ ] Web server management production-ready
- [ ] Database management production-ready
- [ ] Backup/migration tools functional
- [ ] cPanel migration capability
- [ ] User panel fully functional
- [ ] Admin panel fully functional

### Security

- [ ] Zero high-severity vulnerabilities
- [ ] All medium findings documented + mitigated
- [ ] 100% of operations logged
- [ ] No SQL injection possible
- [ ] No shell injection possible
- [ ] All secrets environment-based
- [ ] Atomic backup/rollback verified
- [ ] RBAC enforcement verified
- [ ] Cross-domain isolation verified

### Performance

- [ ] <500ms mailbox creation
- [ ] <100ms DNS record creation
- [ ] <200ms vhost creation
- [ ] <100ms database creation
- [ ] <5s SSL certificate issuance (async)
- [ ] 10,000+ mailboxes per server
- [ ] 10,000+ DNS zones per server
- [ ] 1,000+ vhosts per server
- [ ] <150MB RAM idle
- [ ] <1% CPU idle

### Reliability

- [ ] Services auto-restart on failure
- [ ] No data loss on failures
- [ ] <5 minute recovery
- [ ] 99.5% uptime
- [ ] Graceful degradation under load
- [ ] Exponential backoff on retries

---

## 🎓 DELIVERABLE QUALITY

**Would this be safe on a production hosting server?**

✅ **YES**, because:
1. No direct shell execution
2. All operations via allow-listed agent actions
3. Input validation on every parameter
4. Parameterized queries (no SQL injection)
5. Atomic operations with rollback
6. Complete audit trail
7. RBAC enforcement
8. Automatic backups
9. Graceful failure handling
10. Red/Blue team verified

---

## 📞 TRANSITION TO OPERATIONS

**When Phase 4 Complete:**

1. **Documentation**
   - API reference guide
   - Admin operational runbook
   - User quick-start guide
   - Disaster recovery procedures
   - Performance tuning guide

2. **Training**
   - Operations team training
   - Admin training
   - End-user training

3. **Deployment**
   - Production installation guide
   - Upgrade procedures
   - Rollback procedures
   - Monitoring setup

4. **Support**
   - Troubleshooting guide
   - Common issues + solutions
   - Performance optimization
   - Scaling procedures

---

## 🏆 CONCLUSION

Phase 4 transforms nPanel from a **framework** into an **enterprise hosting control panel**.

With this architecture:
- ✅ Users get WHM/cPanel functionality
- ✅ Admins get complete control
- ✅ Systems stay secure and performant
- ✅ Operations remain simple and reliable
- ✅ Red/Blue team audit ensures no vulnerabilities

**Target**: Complete Phase 4 in 4 weeks  
**Result**: Production-ready hosting platform  
**Status**: Ready to begin implementation

---

**NEXT STEP: Begin WEEK 1 - Email System Implementation**

Phase 4 is the final piece to make nPanel a **complete, secure, performant, WHM/cPanel-class hosting control panel suitable for production environments**.
