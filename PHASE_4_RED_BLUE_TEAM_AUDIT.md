# Phase 4: Service Integration - Red/Blue Team Audit Framework & Implementation Roadmap

**Date:** January 25, 2026  
**Status:** Phase 4 Architecture Complete - Ready for Red/Blue Team Security Audits

---

## 📋 PHASE 4 SERVICE IMPLEMENTATION STATUS

### Services Designed & Documented

| Service | Status | Agent Actions | API Endpoints | Security Audit | Performance Analysis |
|---------|--------|---------------|---------------|-----------------|----------------------|
| **Email** (Exim+Dovecot+Roundcube) | ✅ Complete | 8 | 7 | ✅ Framework | ✅ Documented |
| **DNS** (PowerDNS) | ✅ Complete | 7 | 6 | ✅ Framework | ✅ Documented |
| **SSL** (Let's Encrypt) | ✅ Complete | 6 | 5 | ✅ Framework | ✅ Documented |
| **Web** (Nginx+PHP-FPM) | ✅ Complete | 4 | 4 | ✅ Framework | ✅ Documented |
| **Database** (MariaDB) | ✅ Complete | 4 | 4 | ✅ Framework | ✅ Documented |
| **Backup & Migration** | 🚧 In Progress | 10 | 5 | ⏳ Pending | ⏳ Pending |
| **Security** (Firewall, Fail2Ban) | 🚧 In Progress | 8 | 4 | ⏳ Pending | ⏳ Pending |
| **Monitoring** (Prometheus) | 🚧 In Progress | 6 | 3 | ⏳ Pending | ⏳ Pending |

**Total Agent Actions Specified**: 53+  
**Total API Endpoints Specified**: 38+  

---

## 🔴 RED TEAM SECURITY AUDIT FRAMEWORK

### Audit Execution Process

For EACH service, execute these attack vectors:

#### 1. INPUT VALIDATION TESTS

```
Email System:
  ✓ SQL Injection in mailbox email field
    - Test: email="; DROP TABLE virtual_users; --"
    - Expected: Rejected, parameterized query used
    - Fail: Error message leaks info or query executed
  
  ✓ Shell Injection in service commands
    - Test: service_restart="exim4 && rm -rf /"
    - Expected: Rejected, no shell interpretation
    - Fail: Command executed or path changed
  
  ✓ Path Traversal in maildir
    - Test: maildir="../../../etc/passwd"
    - Expected: Rejected, path validated
    - Fail: File accessible outside intended directory
  
  ✓ Password bypass
    - Test: password="1" or "1"="1"
    - Expected: Rejected
    - Fail: Mailbox created without proper password

DNS System:
  ✓ Record injection (DNS poisoning)
    - Test: record_content="example.com A 127.0.0.1; A 8.8.8.8;"
    - Expected: Rejected or escaped
    - Fail: Multiple records created
  
  ✓ Zone enumeration
    - Test: List all zones without permission
    - Expected: Only own zones returned
    - Fail: Cross-user zones visible
  
  ✓ DNSSEC bypass
    - Test: Modify zone without signature update
    - Expected: Rejected or signature auto-updated
    - Fail: Invalid DNSSEC state

SSL System:
  ✓ Certificate bypass
    - Test: Force certificate for unowned domain
    - Expected: ACME challenge fails
    - Fail: Certificate issued
  
  ✓ Key extraction
    - Test: Read /etc/letsencrypt/private/
    - Expected: Access denied (0600 perms)
    - Fail: Private key readable

Web Server:
  ✓ Config file exposure
    - Test: Access nginx vhost config via HTTP
    - Expected: 404 or 403
    - Fail: Config downloaded
  
  ✓ PHP-FPM socket accessible
    - Test: Connect to /run/php/php-fpm.sock
    - Expected: Connection denied (perms)
    - Fail: FastCGI interface accessible

Database:
  ✓ Root password exposure
    - Test: Query MySQL as non-root user, attempt privilege escalation
    - Expected: Denied
    - Fail: Privilege escalated
  
  ✓ User password in logs
    - Test: Grep /var/log/ for passwords
    - Expected: [REDACTED] or no passwords
    - Fail: Password visible in logs
```

#### 2. AUTHENTICATION & AUTHORIZATION TESTS

```
All Services:
  ✓ RBAC bypass
    - Test: User A creates/modifies/deletes User B's domain
    - Expected: Rejected with 403 Forbidden
    - Fail: Operation succeeds
  
  ✓ Session hijacking
    - Test: Use invalid/expired JWT token
    - Expected: Rejected with 401 Unauthorized
    - Fail: Token accepted or privilege escalation
  
  ✓ Token forgery
    - Test: Create fake JWT without secret
    - Expected: Rejected
    - Fail: Accepted as valid
  
  ✓ Default credentials
    - Test: Login with default user/pass
    - Expected: No defaults exist
    - Fail: Access granted

  ✓ Permission escalation
    - Test: Regular user attempting admin operations
    - Expected: Rejected
    - Fail: Operation succeeds
```

#### 3. PERFORMANCE & RESOURCE TESTS

```
Email System:
  ✓ Quota exhaustion
    - Create 1000 mailboxes simultaneously
    - Expected: All created, system responsive
    - Fail: System timeout or crash
  
  ✓ Rate limiting
    - Hammer mailbox creation endpoint
    - Expected: After N requests, 429 Too Many Requests
    - Fail: All requests succeed

DNS System:
  ✓ Record DOS
    - Add 10,000 A records to single zone
    - Expected: System responsive, query time <100ms
    - Fail: Query timeout or lockup

Web Server:
  ✓ Vhost creation DOS
    - Create 100 vhosts simultaneously
    - Expected: All created within 60s
    - Fail: Nginx crashes or hangs

Database:
  ✓ Connection pool exhaustion
    - Open 100 simultaneous connections
    - Expected: Graceful rejection after max
    - Fail: System crash
```

#### 4. FAILURE & RECOVERY TESTS

```
Email System:
  ✓ Mailbox creation failure
    - Kill dovecot mid-creation
    - Expected: Atomic rollback, no partial files
    - Fail: Incomplete mailbox or corruption
  
  ✓ Service restart failure
    - Make exim config invalid, attempt reload
    - Expected: Graceful failure, old config remains
    - Fail: Service crashes or unresponsive

DNS System:
  ✓ Zone update failure
    - Corrupt PowerDNS database, attempt record add
    - Expected: Graceful error, rollback
    - Fail: Data corruption

SSL System:
  ✓ Certificate renewal failure
    - Block Let's Encrypt API, trigger renewal
    - Expected: Graceful retry with backoff
    - Fail: Certificate expires without warning

Database:
  ✓ Backup failure
    - Fill disk during database deletion
    - Expected: Graceful error, no data loss
    - Fail: Database partially deleted
```

#### 5. DATA ISOLATION TESTS

```
Email System:
  ✓ Cross-domain mailbox access
    - Attempt to access User A mailbox from User B account
    - Expected: Permission denied
    - Fail: Mailbox accessible
  
  ✓ Quota isolation
    - User A exhausts quota
    - Expected: Only User A affected, others unaffected
    - Fail: Other users can't create mail

DNS System:
  ✓ Zone isolation
    - User A queries User B's zone
    - Expected: Not found or forbidden
    - Fail: Zone records visible

Web Server:
  ✓ Vhost isolation
    - PHP code in vhost A attempts to access vhost B files
    - Expected: Permission denied (different Unix users)
    - Fail: Files accessible

Database:
  ✓ Database isolation
    - User A connects to User B's database
    - Expected: Permission denied
    - Fail: Database accessible
```

---

## 🔵 BLUE TEAM HARDENING CHECKLIST

### For EACH service, verify:

#### Security Requirements

```
[ ] NO SQL INJECTION
    - Every database query uses parameterized statements
    - No string concatenation in SQL
    - Test with: "; DROP TABLE--", "1' OR '1'='1"
    - Verify: All queries use PreparedStatement or parameterized

[ ] NO SHELL INJECTION
    - Every OS command uses exec.Command (Go) or subprocess module (Python)
    - No string interpolation in command arguments
    - Test with: "; rm -rf /", "$(cat /etc/passwd)"
    - Verify: Command args are array, not concatenated string

[ ] NO HARDCODED SECRETS
    - API keys in environment variables
    - Passwords in environment variables
    - Test with: grep -r "password" *.go | grep -v "password_hash"
    - Verify: All secrets from os.Getenv()

[ ] NO INFO DISCLOSURE
    - Error messages sanitized
    - Stack traces not returned to client
    - Log files not world-readable
    - Test with: Trigger errors, check response
    - Verify: Generic error messages returned

[ ] PASSWORD SECURITY
    - Passwords hashed with Bcrypt (cost 14)
    - Test with: Create user, hash should be $2a$14$...
    - Verify: Hash function verified in code

[ ] PERMISSION ENFORCEMENT
    - All files/directories have proper permissions
    - Sensitive files: 0600 (owner only)
    - Directories: 0700 (owner only)
    - Config files: 0640 (owner, group read)
    - Test with: ls -la on all critical dirs
    - Verify: No world-readable secrets

[ ] AUDIT LOGGING
    - Every privileged operation logged
    - Timestamp, user, action, result captured
    - Logs immutable or append-only
    - Test with: Grep logs for operation
    - Verify: Complete trail for every action

[ ] RBAC ENFORCEMENT
    - Every API endpoint checks user.HasRole()
    - Admin-only endpoints verified
    - User's own resources only
    - Test with: Non-admin user accessing admin endpoint
    - Verify: 403 Forbidden response

[ ] ATOMIC OPERATIONS
    - Backup created before modification
    - Rollback on any error
    - No partial/corrupt state possible
    - Test with: Kill process mid-operation
    - Verify: Original state restored

[ ] GRACEFUL DEGRADATION
    - Service restarts don't drop connections
    - Async jobs queue during outages
    - Exponential backoff on failures
    - Test with: Kill service, observe recovery
    - Verify: No data loss, connections preserved
```

#### Performance Requirements

```
[ ] IDLE RESOURCE USAGE
    - Exim: <20MB RAM, <0.5% CPU
    - Dovecot: <30MB RAM, <0.5% CPU
    - Nginx: <10MB RAM, <0.5% CPU
    - Verify with: top, ps aux

[ ] OPERATION LATENCY
    - Create mailbox: <500ms
    - Create DNS zone: <100ms
    - Issue SSL cert: <5s (async)
    - Create vhost: <200ms
    - Create database: <100ms
    - Verify with: timing measurements

[ ] SCALING
    - 10,000 mailboxes on single server
    - 10,000 DNS zones on single server
    - 1000 vhosts on single Nginx
    - 1000 databases on single MariaDB
    - Verify with: load tests

[ ] THROUGHPUT
    - >100 concurrent mailbox creations
    - >100 concurrent DNS updates
    - >1000 concurrent website requests
    - Verify with: concurrent load tests
```

---

## 🛠️ IMPLEMENTATION ROADMAP - WEEK BY WEEK

### WEEK 1: Core Services (Priority 1)

**Monday-Tuesday: Email System**
- [ ] Implement EximService in agent
- [ ] Implement DovecotService in agent
- [ ] Create Exim config templates
- [ ] Create Dovecot config templates
- [ ] Implement API endpoints
- [ ] Write 10+ unit tests
- [ ] Security audit (Red Team)
- [ ] Fix any findings (Blue Team)

**Wednesday-Thursday: DNS System**
- [ ] Implement PowerDNSService in agent
- [ ] PowerDNS API integration
- [ ] Record validation functions
- [ ] Zone import/export
- [ ] Implement API endpoints
- [ ] Write 10+ unit tests
- [ ] Security audit (Red Team)
- [ ] Fix any findings (Blue Team)

**Friday: SSL System**
- [ ] Implement SSLService in agent
- [ ] Certbot integration
- [ ] ACME challenge handler
- [ ] Auto-renewal scheduler
- [ ] Implement API endpoints
- [ ] Write 5+ unit tests
- [ ] Security audit (Red Team)
- [ ] Fix any findings (Blue Team)

### WEEK 2: Web & Database (Priority 1)

**Monday: Web Server**
- [ ] Implement WebServerService in agent
- [ ] Nginx vhost template generation
- [ ] PHP-FPM pool generation
- [ ] Implement API endpoints
- [ ] Write 5+ unit tests
- [ ] Security audit (Red Team)
- [ ] Fix findings

**Tuesday: Database**
- [ ] Implement DatabaseService in agent
- [ ] MariaDB integration
- [ ] User/privilege management
- [ ] Automated backups
- [ ] Implement API endpoints
- [ ] Write 5+ unit tests
- [ ] Security audit (Red Team)
- [ ] Fix findings

**Wednesday-Friday: Integration Testing**
- [ ] All services deployed on test VM
- [ ] Create test domains
- [ ] Create test mailboxes
- [ ] Create test DNS zones
- [ ] Request test SSL certificates
- [ ] Create test databases
- [ ] Verify end-to-end workflows
- [ ] Performance testing under load

### WEEK 3: Backup & Migration (Priority 2)

**Monday-Wednesday: Backup System**
- [ ] Implement rsync integration
- [ ] Implement Bacula integration (optional)
- [ ] Backup scheduling
- [ ] Restore testing
- [ ] API endpoints
- [ ] Security audit

**Thursday-Friday: cPanel Migration**
- [ ] cPanel account scanner
- [ ] Account sync engine
- [ ] Data verification
- [ ] DNS cutover automation
- [ ] Rollback capability

### WEEK 4: Security & Monitoring (Priority 2-3)

**Monday-Tuesday: Security Services**
- [ ] firewalld integration
- [ ] Fail2Ban integration
- [ ] ModSecurity (optional)
- [ ] Rate limiting framework
- [ ] API endpoints

**Wednesday-Friday: Monitoring**
- [ ] Prometheus exporter
- [ ] Grafana dashboards
- [ ] Alerting rules
- [ ] Health checks
- [ ] Performance metrics

---

## 📊 PHASE 4 SUCCESS CRITERIA

### Functional Requirements

- [ ] Users can create domains
- [ ] Users can create email accounts
- [ ] Users can send and receive email
- [ ] Users can manage DNS records
- [ ] Users can request SSL certificates (auto-renewing)
- [ ] Users can create databases
- [ ] Users can backup and restore
- [ ] Admins can manage users and packages
- [ ] Admins can view server statistics
- [ ] Admins can perform migrations from cPanel

### Security Requirements

- [ ] Zero high-severity vulnerabilities
- [ ] All medium vulnerabilities documented + mitigated
- [ ] All operations logged with audit trail
- [ ] All secrets encrypted or environment-based
- [ ] RBAC enforced on all operations
- [ ] SQL injection protection verified
- [ ] Shell injection protection verified
- [ ] Cross-domain isolation verified
- [ ] Automatic backups on data modification
- [ ] Atomic operations with rollback capability

### Performance Requirements

- [ ] <500ms mailbox creation
- [ ] <100ms DNS record creation
- [ ] <5s SSL certificate issuance (async)
- [ ] <200ms web vhost creation
- [ ] <100ms database creation
- [ ] 10,000+ mailboxes on single server
- [ ] <1% CPU idle usage
- [ ] <150MB RAM idle usage

### Reliability Requirements

- [ ] Services restart automatically on failure
- [ ] No data loss on any failure scenario
- [ ] <5 minute recovery time on outage
- [ ] 99.5% uptime target
- [ ] Graceful degradation under overload
- [ ] Exponential backoff on retries
- [ ] Circuit breaker pattern for external APIs

### Production Readiness

- [ ] Complete end-to-end integration tests
- [ ] Load tests verified
- [ ] Failure recovery tested
- [ ] Red/Blue team audit completed
- [ ] Documentation complete
- [ ] Runbooks for common operations
- [ ] Disaster recovery procedures documented

---

## 🎯 PHASE 4 COMPLETION CHECKPOINT

**When All Services Complete & Audited:**

1. ✅ Email system (Exim+Dovecot+Roundcube) deployed & tested
2. ✅ DNS system (PowerDNS) deployed & tested
3. ✅ SSL system (Let's Encrypt) deployed & tested
4. ✅ Web server (Nginx+PHP-FPM) deployed & tested
5. ✅ Database (MariaDB) deployed & tested
6. ✅ Backup & migration tools deployed
7. ✅ Security services configured
8. ✅ Monitoring setup complete
9. ✅ Red/Blue team audit passed
10. ✅ Performance benchmarks met
11. ✅ Documentation complete
12. ✅ All 53+ agent actions implemented
13. ✅ All 38+ API endpoints functional
14. ✅ Zero known vulnerabilities

**At this point: nPanel is PRODUCTION-READY hosting control panel**

---

## 🚀 NEXT IMMEDIATE ACTION

**Start WEEK 1:**
1. Implement Email System (Exim + Dovecot)
2. Write comprehensive agent actions
3. Create API endpoints
4. Execute Red Team security audit
5. Fix any findings (Blue Team)
6. Move to DNS System

Each service follows the same pattern:
1. Design (✅ Complete)
2. Implement agent actions
3. Implement API endpoints
4. Red Team audit
5. Blue Team fixes
6. Integration test

**Total Phase 4 Timeline: 4 weeks**

---

## 📝 AUDIT RESULTS TRACKING

**Red Team Findings Template:**

```
Service: [Email/DNS/SSL/Web/Database]
Date: [Date]
Auditor: Red Team

FINDINGS:

1. [Severity] [Title]
   Description: [Details]
   Attack Vector: [How to exploit]
   Expected Behavior: [What should happen]
   Actual Behavior: [What happens]
   Impact: [Security/Performance/Availability]
   Fix: [Recommended fix]

Status: [Open/In Progress/Fixed/Verified]
```

**Blue Team Fix Template:**

```
Service: [Email/DNS/SSL/Web/Database]
Date: [Date]
Finding ID: [Red Team ID]

FIX:

1. Code change: [File/Line]
   Before: [Old code]
   After: [New code]
   Reason: [Why this fixes it]

2. Configuration change: [File]
   Change: [What changed]

3. Testing:
   [ ] Unit test added/updated
   [ ] Integration test added/updated
   [ ] Load test passed
   [ ] Red Team re-audit passed

Status: VERIFIED
```

---

**Status: Phase 4 Architecture Complete ✅  
Ready to Begin Implementation with Red/Blue Team Auditing**

This is not a demo. This is a production hosting control panel with:
- ✅ Enterprise-grade architecture
- ✅ Complete security specification
- ✅ Performance targets defined
- ✅ Red/Blue team audit process
- ✅ Full implementation roadmap

**Proceed with Week 1 Email System Implementation.**
