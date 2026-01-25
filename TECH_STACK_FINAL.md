# nPanel Technology Stack & Integration Plan

**Date:** January 25, 2026  
**Status:** Technology Stack Finalized  

---

## 🎯 USER-SPECIFIED COMPONENTS

### ✅ Email System
| Component | Choice | Purpose |
|-----------|--------|---------|
| **MTA** | Exim | Mail transport agent |
| **IMAP/POP3** | Dovecot | Mail retrieval + storage |
| **Webmail** | Roundcube | Web-based email client |

### ✅ DNS
| Component | Choice | Purpose |
|-----------|--------|---------|
| **DNS Server** | PowerDNS | Authoritative DNS + API-driven management |

### ✅ Database
| Component | Choice | Purpose |
|-----------|--------|---------|
| **Primary** | MariaDB | MySQL-compatible, production-grade |
| **Alternative** | PostgreSQL | Advanced features, JSON support |

### ✅ Migration
| Component | Choice | Purpose |
|-----------|--------|---------|
| **Data Transfer** | rsync | cPanel/WHM migration, incremental syncs |

### ✅ SSL/TLS
| Component | Choice | Purpose |
|-----------|--------|---------|
| **Certificate Authority** | Let's Encrypt | Free automated certificates |
| **Renewal Agent** | Certbot / acme.sh | Automated renewal + hooks |

---

## 🏗️ RECOMMENDED ADDITIONAL COMPONENTS

For production hosting control panel, we also recommend:

### Web Server
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Primary Web Server** | Nginx | Lightweight, fast, async, perfect for cPanel alternative |
| **Alternative** | Apache 2.4 | Legacy support, .htaccess, mod_* modules |
| **PHP Handler** | PHP-FPM | Async processing, cgroups integration |

### System Management
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Process Manager** | systemd | Integrated with AlmaLinux 9, resource limits |
| **Container Runtime** | OpenVZ (if needed) | Lightweight virtualization for resellers |
| **Backup** | Bacula / Duplicacy | Automated backups + incremental |

### Monitoring & Logging
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Metrics Collection** | Prometheus | Time-series metrics, nPanel exporter |
| **Logs Aggregation** | rsyslog → Loki | Centralized logging |
| **Alerts** | Alertmanager | nPanel integration with webhooks |
| **Dashboard** | Grafana | Visualization + custom dashboards |

### System Utilities
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **FTP/SFTP** | ProFTPD or Pure-FTPd | FTP for legacy clients |
| **SSH Key Mgmt** | Authorized_keys API | Web-based SSH key management |
| **Cron Management** | fcron | Persistent cron job management |
| **IP Manager** | ISC DHCP / Static | IP allocation for resellers |

### Security Hardening
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Firewall** | firewalld | Dynamic rule management from API |
| **Intrusion Detection** | Fail2Ban | Integration with nPanel API |
| **ModSecurity** | ModSecurity v3 | WAF integration for web apps |
| **OS Hardening** | systemd-hardening | cgroups v2, AppArmor, seccomp |

---

## 📋 COMPLETE TECH STACK MATRIX

### Core Infrastructure

| Layer | Component | Tech | Purpose | Agent Action |
|-------|-----------|------|---------|--------------|
| **OS** | AlmaLinux 9 | RHEL-based | Base OS | System detection |
| **Runtime** | Go 1.23 | Backend lang | API + Agent | Compiler ready |
| **Web Server** | Nginx | Reverse proxy | UI hosting | `nginx.{start,stop,reload}` |
| **PHP Runtime** | PHP-FPM 8.2 | App server | PHP applications | `php.{start,stop,reload}` |
| **Database** | MariaDB 10.6 | SQL DB | Data storage | `mariadb.{start,stop,create_db}` |
| **Cache** | Redis 7.0 | In-memory cache | Job queue + sessions | `redis.{start,stop}` |

### Email System

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **MTA** | Exim 4.96+ | Mail transport | `exim.{start,stop,queue_flush}` |
| **IMAP/POP3** | Dovecot 2.3+ | Mail delivery | `dovecot.{start,stop,create_user}` |
| **Webmail** | Roundcube 1.6+ | Web access | `roundcube.{enable,disable,update}` |
| **Spam Filter** | SpamAssassin + Sieve | Filtering | `spam.{train_ham,train_spam}` |
| **Antivirus** | ClamAV | Malware scanning | `clamav.{start,stop,update}` |

### DNS Management

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **DNS Server** | PowerDNS 4.7+ | Authoritative DNS | `powerdns.{add_zone,del_zone,update_record}` |
| **Reverse DNS** | PowerDNS | rDNS zones | `powerdns.add_reverse_zone` |
| **DNSSEC** | PKCS#11 support | DNS signing | `powerdns.{enable_dnssec,rotate_keys}` |

### SSL/TLS Management

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **ACME Client** | certbot | Let's Encrypt | `ssl.{request_cert,renew_cert}` |
| **Certificate Store** | /etc/ssl/private | Key storage | `ssl.{install_cert,backup_cert}` |
| **Self-Signed** | OpenSSL | Initial certs | `ssl.generate_selfsigned` |
| **Auto-Renewal** | systemd timer | Renewal scheduling | `ssl.enable_auto_renew` |

### User & Account Management

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **System Users** | PAM + Shadow | Unix accounts | `user.{create,delete,set_password}` |
| **Email Accounts** | Virtual mailbox | Mail users | `email.{create,delete,set_quota}` |
| **FTP Accounts** | ProFTPD vhost | FTP users | `ftp.{create_user,delete_user}` |
| **SSH Keys** | Authorized_keys | SSH access | `ssh.{add_key,remove_key}` |
| **RBAC** | nPanel roles | Access control | API-level enforcement |

### Domain & DNS Management

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **Domain Registration** | API integration | Domain management | `domain.create` → PowerDNS zone |
| **Zone Management** | PowerDNS API | Zone records | `dns.{add_record,update_record,delete_record}` |
| **SPF/DKIM/DMARC** | BIND/PowerDNS | Email security | `email.{add_dkim,add_spf,add_dmarc}` |
| **Auto-DNS Propagation** | PowerDNS replication | Multi-NS | `dns.add_secondary_ns` |

### Backup & Migration

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **File Backup** | rsync + Bacula | Incremental backups | `backup.{schedule,restore,verify}` |
| **Database Backup** | mysqldump + Bacula | DB snapshots | `backup.{mysql_dump,restore_db}` |
| **cPanel Migration** | rsync + Custom scripts | cPanel import | `migration.{scan_cpanel,sync,activate}` |
| **Disaster Recovery** | Bacula + verification | Restore testing | `backup.restore_test` |

### Monitoring & Performance

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **System Metrics** | Prometheus | Monitoring | `metrics.{cpu,memory,disk,network}` |
| **Web Server Logs** | Nginx JSON | Access logs | `logs.{nginx_access,nginx_error}` |
| **Database Logs** | MySQL slow log | Query analysis | `logs.mysql_slow_log` |
| **Email Logs** | Exim/Dovecot logs | Mail tracking | `logs.{exim,dovecot}` |
| **Application Logs** | rsyslog → Loki | Centralized logs | `logs.{application,system}` |

### Security Hardening

| Component | Tech | Purpose | Agent Action |
|-----------|------|---------|--------------|
| **Firewall** | firewalld | Access control | `firewall.{add_rule,del_rule}` |
| **Fail2Ban** | Fail2Ban | Brute force protection | `security.{enable_fail2ban,ban_ip}` |
| **ModSecurity** | ModSecurity v3 | WAF rules | `waf.{enable,disable,update_rules}` |
| **cgroups v2** | systemd | Resource limits | `system.set_resource_limits` |
| **AppArmor** | AppArmor profiles | Capability restrictions | `security.enable_apparmor` |

---

## 🔄 AGENT ACTION MAPPING

### Email System
```go
// Email Management
email.create(username, domain, password)      // Create mailbox
email.delete(username, domain)                // Remove mailbox
email.set_quota(username, domain, quota_mb)  // Disk limit
email.add_dkim(domain)                        // Add DKIM record
email.add_spf(domain, spf_record)            // Add SPF
email.add_dmarc(domain, dmarc_policy)        // Add DMARC
email.get_logs(username, domain, hours)      // Dovecot logs

// Roundcube Webmail
webmail.enable(domain)                        // Enable webmail
webmail.disable(domain)                       // Disable webmail
webmail.configure_plugins()                   // Configure extensions
webmail.backup_settings()                     // Backup config

// Anti-Spam / Anti-Virus
spam.train_ham(email_id)                     // Train as ham
spam.train_spam(email_id)                    // Train as spam
antivirus.update_definitions()                // Update ClamAV
antivirus.scan_maildir(path)                 // Scan mailbox
```

### DNS Management
```go
// PowerDNS Zone Management
dns.create_zone(domain, type)                 // Create zone (native/slave)
dns.delete_zone(domain)                       // Delete zone
dns.add_record(zone, name, type, content)    // Add DNS record
dns.update_record(zone, id, content)         // Update record
dns.delete_record(zone, id)                  // Delete record
dns.list_records(zone)                        // List all records
dns.add_reverse_zone(ip_range)               // rDNS zone
dns.enable_dnssec(zone)                      // Enable DNSSEC
dns.rotate_dnssec_keys(zone)                 // Key rotation
dns.add_secondary_ns(zone, ns_ip)            // Add secondary NS
```

### SSL/TLS Management
```go
// Let's Encrypt Integration
ssl.request_certificate(domain, sans)         // Request cert
ssl.renew_certificate(domain)                 // Renew cert
ssl.list_certificates(domain)                 // Show certs
ssl.install_certificate(domain, cert, key)   // Install custom cert
ssl.enable_auto_renewal(domain)               // Enable auto-renew
ssl.generate_selfsigned(domain)               // Generate self-signed
ssl.backup_certificate(domain)                // Backup cert
ssl.delete_certificate(domain)                // Delete cert

// Nginx SSL Configuration
nginx.add_ssl_vhost(domain, cert, key)       // Add SSL vhost
nginx.reload_ssl_config()                     // Reload Nginx
```

### Domain Management
```go
// Domain Creation (Full Stack)
domain.create(name, package, username)        // 1. Create database entry
  ├─> dns.create_zone(name)                   // 2. Add DNS zone
  ├─> ssl.request_certificate(name)           // 3. Request SSL
  ├─> nginx.add_vhost(name, username)         // 4. Add Nginx vhost
  ├─> user.add_to_group(username, domain)     // 5. Set ownership
  └─> logs.initialize(name)                   // 6. Initialize logs

domain.delete(name)                           // Reverse all above
domain.suspend(name)                          // Disable vhost + DNS
domain.unsuspend(name)                        // Re-enable
```

### Database Management
```go
// MySQL/MariaDB
database.create_database(name, user, pass)    // Create DB + user
database.delete_database(name)                // Delete DB
database.set_privileges(db, user, privs)     // Grant privileges
database.backup_database(name)                // Backup DB
database.restore_database(name, backup_file) // Restore from backup
database.optimize_database(name)              // OPTIMIZE TABLE
database.get_size(name)                       // Get DB size
database.list_tables(name)                    // Show tables
database.create_user(name, pass)              // Create DB user
database.delete_user(name)                    // Delete DB user
```

### File Management
```go
// Filesystem Operations
files.create_directory(path, owner, perms)    // Create dir
files.delete_directory(path)                  // Delete dir
files.set_permissions(path, perms)            // chmod
files.set_owner(path, user, group)            // chown
files.upload_file(path, content)              // Upload file
files.download_file(path)                     // Download file
files.list_directory(path)                    // List contents
files.create_backup(path)                     // Backup before modify
```

### Backup & Migration
```go
// Backup Operations
backup.schedule_backup(domain, frequency)    // Schedule backup
backup.run_backup_now(domain)                // Immediate backup
backup.restore_backup(domain, backup_id)    // Restore from backup
backup.list_backups(domain)                  // List available backups
backup.delete_backup(domain, backup_id)     // Delete old backup

// cPanel Migration
migration.scan_cpanel_server(host, user, pass)  // Scan cPanel
migration.sync_account(cpanel_user, npanel_user) // Sync data
migration.verify_migration(npanel_user)         // Verify integrity
migration.activate_migration(npanel_user)       // Switch DNS
migration.rollback_migration(npanel_user)       // Revert if needed

// rsync Integration
rsync.sync_files(source, dest, options)      // Sync files
rsync.sync_database(source, dest)            // Sync DB
rsync.sync_email(source, dest)               // Sync mailboxes
rsync.verify_sync(source, dest)              // Verify completion
```

### Web Server Management
```go
// Nginx Management
nginx.create_vhost(domain, user, doc_root)  // Create vhost
nginx.delete_vhost(domain)                  // Delete vhost
nginx.set_php_handler(vhost, php_version)   // Set PHP version
nginx.enable_gzip(vhost)                    // Enable compression
nginx.enable_caching(vhost)                 // Enable caching
nginx.set_limit_rate(vhost, limit)          // Bandwidth limit
nginx.add_redirect(from_domain, to_domain)  // Redirect
nginx.test_config()                         // Verify syntax
nginx.reload()                              // Reload config
nginx.get_vhost_log(domain, lines)          // Get vhost logs

// Apache Alternative
apache.create_vhost(domain, user, doc_root) // Create vhost
apache.enable_module(module_name)           // Enable mod
apache.set_htaccess_rules(domain, rules)    // Set .htaccess
apache.reload()                             // Reload config
```

### System & Security
```go
// System Monitoring
system.get_cpu_usage()                      // CPU %
system.get_memory_usage()                   // RAM %
system.get_disk_usage()                     // Disk %
system.get_uptime()                         // Uptime
system.get_load_average()                   // Load avg
system.set_resource_limits(service, limits) // Set cgroups

// User Management
user.create_system_user(username, shell)    // Create Unix user
user.delete_system_user(username)           // Delete user
user.set_password(username, password)       // Change password
user.add_to_group(username, group)          // Add group
user.remove_from_group(username, group)     // Remove group
user.get_user_info(username)                // User details

// Security
security.enable_fail2ban()                  // Enable brute-force protection
security.ban_ip(ip_address)                 // Ban IP
security.unban_ip(ip_address)               // Unban IP
security.get_banned_ips()                   // List banned IPs
security.enable_apparmor()                  // Enable AppArmor
firewall.add_rule(port, protocol, action)   // Add firewall rule
firewall.delete_rule(port, protocol)        // Delete rule
firewall.list_rules()                       // List rules
```

### Logging & Metrics
```go
// Logs
logs.get_nginx_access(domain, lines)        // Nginx access log
logs.get_nginx_error(domain, lines)         // Nginx error log
logs.get_exim_log(lines)                    // Exim log
logs.get_dovecot_log(lines)                 // Dovecot log
logs.get_system_log(service, lines)         // System log
logs.search_logs(service, pattern)          // Search logs
logs.clear_logs(service)                    // Clear logs

// Metrics
metrics.get_service_status(service)         // Service status
metrics.get_bandwidth_usage(domain, period) // Bandwidth stats
metrics.get_email_stats(domain)             // Email metrics
metrics.get_database_stats(database)        // DB metrics
metrics.export_prometheus()                 // Prometheus format
```

---

## 📦 INSTALLATION & CONFIGURATION STRATEGY

### Phase 1: Core Services (Week 1)
```
1. nPanel API + Agent (installer deploys these first)
2. Nginx + PHP-FPM (web server stack)
3. MariaDB (primary database)
4. Redis (job queue + caching)
5. PowerDNS (DNS server)
```

### Phase 2: Email System (Week 2)
```
1. Exim (mail transport)
2. Dovecot (IMAP/POP3 + storage)
3. SpamAssassin + ClamAV (filtering)
4. Roundcube (webmail UI)
5. DKIM/SPF/DMARC setup
```

### Phase 3: Security & SSL (Week 3)
```
1. Let's Encrypt integration (certbot)
2. Auto-renewal hooks
3. firewalld configuration
4. Fail2Ban deployment
5. ModSecurity WAF rules
```

### Phase 4: Monitoring & Backup (Week 4)
```
1. Prometheus metrics
2. Grafana dashboards
3. rsyslog → Loki
4. Bacula backup system
5. Automated restoration testing
```

### Phase 5: Migration Tools (Week 5)
```
1. cPanel scanner
2. rsync migration engine
3. DNS cutover automation
4. Data verification
5. Rollback capability
```

---

## 🔐 SECURITY INTEGRATION

### Agent Allow-List Updates
Each component gets dedicated allow-list actions:

```go
// Email System Actions (allow-listed)
AllowedActions: [
    "email.create",
    "email.delete",
    "email.set_quota",
    "email.add_dkim",
    "email.add_spf",
    "email.add_dmarc",
    "webmail.enable",
    "antivirus.update_definitions",
]

// DNS System Actions (allow-listed)
AllowedActions: [
    "dns.create_zone",
    "dns.add_record",
    "dns.delete_record",
    "dns.enable_dnssec",
]

// SSL Actions (allow-listed)
AllowedActions: [
    "ssl.request_certificate",
    "ssl.renew_certificate",
    "ssl.install_certificate",
    "ssl.enable_auto_renewal",
]

// Security Actions (allow-listed)
AllowedActions: [
    "security.enable_fail2ban",
    "security.ban_ip",
    "firewall.add_rule",
    "firewall.delete_rule",
]
```

### Privilege Isolation
- ✅ API never directly executes commands
- ✅ Agent only runs allow-listed actions
- ✅ All commands logged + audited
- ✅ No shell parameter injection possible
- ✅ File ownership properly enforced
- ✅ Resource limits via cgroups v2

---

## 📊 DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] Review all agent actions for security
- [ ] Audit allow-lists for completeness
- [ ] Test each component in isolation
- [ ] Create rollback procedures
- [ ] Document all integration points

### Installation
- [ ] Installer validates OS + dependencies
- [ ] All packages installed from official repos
- [ ] Services configured with systemd
- [ ] Firewall rules applied
- [ ] Let's Encrypt initial cert generated
- [ ] Admin account created with strong password

### Post-Installation
- [ ] Run smoke tests for all services
- [ ] Verify email delivery (send + receive)
- [ ] Test DNS zone management
- [ ] Verify SSL auto-renewal scheduling
- [ ] Confirm backup runs successfully
- [ ] Test cPanel migration tools

### Production Hardening
- [ ] Enable AppArmor profiles
- [ ] Configure ModSecurity rules
- [ ] Enable seccomp restrictions
- [ ] Set up monitoring alerts
- [ ] Configure log rotation
- [ ] Enable audit logging

---

## 🎯 NEXT STEPS

1. **Update Installer** to handle all these components
2. **Expand Agent** with all action implementations
3. **Create Systemd Units** for each service
4. **Build Integration Layer** (API → Agent → Services)
5. **Implement cPanel Migration** engine
6. **Add Monitoring** dashboard
7. **Security Hardening** implementation

**Status: Technology Stack Finalized ✅ Ready for Implementation**

This is a production-grade hosting control panel stack comparable to cPanel/WHM but with modern, secure architecture.
