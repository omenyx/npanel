# MIGRATION PARITY VALIDATION CHECKLIST

**Purpose**: Verify that migrated accounts behave identically to natively-created accounts

**Status**: Template - To be executed after migration implementation

---

## PRE-MIGRATION CHECKLIST

### Source System Verification
- [ ] Source system accessible via SSH
- [ ] SSH key authentication working
- [ ] Source system type confirmed (cPanel/WHM version noted)
- [ ] Required commands available (rsync, mysqldump, etc.)
- [ ] Storage space sufficient on target
- [ ] Network bandwidth adequate for data transfer

### Target System Verification  
- [ ] NPanel backend running
- [ ] NPanel database responsive
- [ ] Hosting service user exists
- [ ] MySQL service running and accessible
- [ ] Nginx/web server configured for target domains
- [ ] Disk space verified (same as source + 20% buffer)

### Credential Verification
- [ ] Source SSH credentials valid
- [ ] Source MySQL root access confirmed
- [ ] Source mail admin credentials working
- [ ] NPanel service account created with proper permissions
- [ ] NPanel MySQL account has privilege to create databases

---

## MIGRATION-SPECIFIC VALIDATION

### Create Parallel Test Services (Before Migration)

```bash
# Create native test account
npanel-admin create-service \
  --domain test-native.example.com \
  --plan basic \
  --owner test-owner

# This will generate baseline for comparison
```

### Execute Migration
```bash
# Run migration with dry-run first
npanel-admin migrate-start \
  --source-host source.example.com \
  --source-user cpanel_user \
  --target-domain example.com \
  --dry-run
  
# If dry-run succeeds, execute
npanel-admin migrate-confirm \
  --job-id <job_id>
```

---

## FILESYSTEM PARITY VALIDATION

After migration, verify:

### File Ownership & Permissions
```bash
# Migrated account
ls -la /home/[migrated_service]/public_html/
# Expected: Owner should be [service_user]
# Expected: Permissions should match native pattern

# Compare with native account
ls -la /home/[native_service]/public_html/
# Should be identical structure
```

**Checks**:
- [ ] File ownership matches service account
- [ ] Directory permissions 0755 for web
- [ ] No world-writable directories except temp
- [ ] Symlinks resolve correctly
- [ ] No broken symlinks

### Directory Structure Integrity
```bash
# Compare directory tree
find /home/[migrated_service] -type d | sort
find /home/[native_service] -type d | sort
# Should be identical (minus content timestamps)
```

**Checks**:
- [ ] public_html exists
- [ ] cgi-bin exists (if used)
- [ ] logs directory exists with correct perms
- [ ] tmp directory accessible
- [ ] Private dir structure intact

### Webroot Content Validation
```bash
# Check file counts match
find /home/[migrated_service]/public_html -type f | wc -l
find /home/[source]/public_html -type f | wc -l
# Should match (within 1-2 files for metadata)

# Spot-check file integrity
sha256sum /home/[migrated_service]/public_html/index.php
sha256sum /home/[source]/public_html/index.php
# Should match exactly
```

**Checks**:
- [ ] File count matches source
- [ ] Critical files present (index.html, etc)
- [ ] Checksums match sample files
- [ ] .htaccess preserved (if exists)
- [ ] Image files not corrupted
- [ ] Executable permissions preserved

### Backup Directory Validation
```bash
# If backups migrated
ls -la /home/[migrated_service]/backups/
# Should contain expected backup files
```

**Checks**:
- [ ] Backups directory exists
- [ ] Backup files readable
- [ ] Backup timestamps reasonable
- [ ] No backup corruption

---

## DATABASE PARITY VALIDATION

### Database Existence & Access
```bash
# List databases for migrated account
mysql -u [migrated_db_user] -p[password] -e "SHOW DATABASES;"
# Should show: [service]_*

# Compare with native account created earlier
mysql -u [native_db_user] -p[password] -e "SHOW DATABASES;"
# Should have same structure (but different names)
```

**Checks**:
- [ ] Primary database exists
- [ ] Additional databases present (if created)
- [ ] User can list databases
- [ ] User can select each database
- [ ] User has expected privileges

### Database Content Integrity
```bash
# Dump migrated database
mysqldump -u [migrated_db_user] -p [database] > /tmp/migrated.sql

# Spot-check table structure
mysql -u [migrated_db_user] -p [database] -e "SHOW TABLES;"
mysql -u [migrated_db_user] -p [database] -e "DESCRIBE [table_name];"

# Verify row counts
mysql -u [migrated_db_user] -p [database] -e "SELECT COUNT(*) FROM [table_name];"
```

**Checks**:
- [ ] All tables present
- [ ] Table structures match source
- [ ] Row counts match source (within 1-2 rows for metadata)
- [ ] Indexes present
- [ ] No error messages on SELECT
- [ ] Foreign key constraints intact

### Database Access Performance
```bash
# Test query performance
mysql -u [migrated_db_user] -p [database] -e "SELECT * FROM users LIMIT 10;" 
# Should return quickly (< 100ms)

time mysql -u [migrated_db_user] -p [database] -e "SELECT COUNT(*) FROM [large_table];"
# Should be < 1 second for 100K rows
```

**Checks**:
- [ ] Queries respond < 1 second
- [ ] Connection pooling works
- [ ] No "too many connections" errors
- [ ] Slow query log empty (for expected queries)

---

## MAIL PARITY VALIDATION

### Mail Account Existence
```bash
# Check migrated mail accounts
npanel-mail list-accounts [migrated_domain]
# Should show all migrated mailboxes

# Compare with native domain
npanel-mail list-accounts [native_domain]
# Should have similar structure
```

**Checks**:
- [ ] All mailboxes present
- [ ] Mailbox quotas match source
- [ ] Aliases configured
- [ ] Forwarders present (if used)
- [ ] AutoResponders work

### Mail Delivery Test
```bash
# Send test email to migrated account
echo "Test message" | mail -s "Parity Test" user@migrated.example.com

# Check delivery
npanel-mail check-new migrated_domain user
# Should see the test message
```

**Checks**:
- [ ] Inbound SMTP accepts mail
- [ ] Mail delivered to user
- [ ] User can retrieve (IMAP/POP3)
- [ ] Quota enforcement works
- [ ] Spam filtering active

### Mail Credentials Validation
```bash
# Test IMAP access
imaptest -testproto="imap4" -ssl host=migrated.example.com \
         user=user@migrated.example.com password=[password]
# Should authenticate successfully

# Test POP3 access
openssl s_client -connect migrated.example.com:995 <<< "USER user@migrated.example.com"
# Should respond with +OK
```

**Checks**:
- [ ] IMAP login works
- [ ] POP3 login works
- [ ] Mailbox list accessible
- [ ] Message download works
- [ ] SSL/TLS working

---

## DNS PARITY VALIDATION

### Zone File Presence
```bash
# Check zone exists
dig @localhost migrated.example.com

# Compare with native zone
dig @localhost native.example.com
# Should have similar records
```

**Checks**:
- [ ] A record present and correct IP
- [ ] MX records present
- [ ] NS records correct
- [ ] SOA record present
- [ ] DNSSEC (if used)

### DNS Resolution Testing
```bash
# Test from external resolver
dig migrated.example.com @8.8.8.8 +short
# Should return IP address

# Test subdomains if migrated
dig www.migrated.example.com @8.8.8.8
dig mail.migrated.example.com @8.8.8.8
# Should resolve correctly
```

**Checks**:
- [ ] A records resolve to correct IPs
- [ ] CNAME records point to correct targets
- [ ] MX records precedence correct
- [ ] TTL appropriate (3600 or as configured)
- [ ] No NXDOMAIN for expected records

### Mail DNS Validation
```bash
# Verify SPF record
dig migrated.example.com TXT | grep v=spf
# Should be present

# Verify DKIM (if configured)
dig default._domainkey.migrated.example.com TXT
# Should contain public key
```

**Checks**:
- [ ] SPF record present
- [ ] DKIM record present (if used)
- [ ] DMARC record present (if used)
- [ ] Records match source exactly

---

## WEB ACCESS PARITY VALIDATION

### HTTP/HTTPS Connectivity
```bash
# Test HTTP access
curl -i http://migrated.example.com/
# Should return 200 OK

# Test HTTPS access
curl -i https://migrated.example.com/
# Should return 200 OK (cert validation may fail for self-signed)
```

**Checks**:
- [ ] HTTP accessible on port 80
- [ ] HTTPS accessible on port 443
- [ ] SSL certificate valid (or self-signed expected)
- [ ] Redirects work correctly
- [ ] No mixed-content warnings

### Vhost Configuration
```bash
# Check Nginx vhost
grep -A 20 "migrated.example.com" /etc/nginx/sites-enabled/npanel.conf
# Should have proper server block

# Check PHP-FPM pool
grep -A 10 "\[migrated_service\]" /etc/php-fpm.d/npanel-pools.conf
# Should exist and be active
```

**Checks**:
- [ ] Vhost configured for both HTTP and HTTPS
- [ ] Root document correctly points to public_html
- [ ] PHP-FPM pool exists
- [ ] Process limits appropriate
- [ ] Access/error logs routing correct

### Web Application Functionality
```bash
# Test PHP execution
curl https://migrated.example.com/info.php 
# Should display PHP info (if file exists)

# Test dynamic content
curl https://migrated.example.com/app/api/health
# Should return 200 with expected JSON
```

**Checks**:
- [ ] PHP executes correctly
- [ ] Database connections work
- [ ] Session handling works
- [ ] File uploads work
- [ ] Cache functions (if used)

---

## FTP PARITY VALIDATION

### FTP Account Access
```bash
# Test FTP login
ftp -n migrated.example.com <<EOF
user [ftp_user] [password]
pwd
quit
EOF
# Should authenticate and show current directory
```

**Checks**:
- [ ] FTP login succeeds
- [ ] Home directory correct (/home/[service])
- [ ] File listing works
- [ ] Cannot access parent directories
- [ ] Upload/download permissions correct

### FTP Chroot Validation
```bash
# Verify chroot jail
ftp -n migrated.example.com <<EOF
user [ftp_user] [password]
pwd
cd ..
quit
EOF
# Should fail to go above service home
```

**Checks**:
- [ ] FTP user confined to service directory
- [ ] Cannot access other service files
- [ ] Cannot access system files
- [ ] Quota enforced

---

## ACCOUNT LIMITS VALIDATION

### Service Plan Limits
```bash
# Check limits in database
mysql npanel -e "SELECT * FROM hosting_service WHERE primary_domain='migrated.example.com';"
# Should show all limit fields

# Compare with native account
mysql npanel -e "SELECT * FROM hosting_service WHERE primary_domain='native.example.com';"
# Should match the migration source plan
```

**Checks**:
- [ ] Storage limit correct
- [ ] Bandwidth limit set (if used)
- [ ] Max databases correct
- [ ] Max email accounts correct
- [ ] Max subdomains correct
- [ ] Max FTP accounts correct

### Enforcement
```bash
# Try to exceed storage (if easy way exists)
# Create very large file, should hit quota

# Try to create extra database (if max=1)
# Should fail with appropriate error
```

**Checks**:
- [ ] Quotas enforced at filesystem
- [ ] Database limit enforced
- [ ] Mail quota enforced
- [ ] Error messages clear

---

## COMPARATIVE TESTING

### Side-by-Side Functional Test
Create identical workflows on both migrated and native accounts:

**Scenario 1: Upload & Execute PHP**
```bash
# Upload test.php to both accounts
curl -F "file=@test.php" -u user:pass ftp://migrated.example.com/public_html/
curl -F "file=@test.php" -u user:pass ftp://native.example.com/public_html/

# Execute both
curl https://migrated.example.com/test.php
curl https://native.example.com/test.php
# Output should be identical
```

**Scenario 2: Database Query**
```bash
# Run same query on both databases
mysql -u migrated_user -p [migrated_db] -e "SELECT VERSION();"
mysql -u native_user -p [native_db] -e "SELECT VERSION();"
# Should return same MySQL version
```

**Scenario 3: Email Send**
```bash
# Both accounts send email from same address
# Compare in mail logs - should show identical handling
tail -f /var/log/mail.log
# Look for successful delivery
```

**Checks**:
- [ ] Both behave identically
- [ ] Performance similar
- [ ] Error handling same
- [ ] Limits enforced equally

---

## VALIDATION REPORT TEMPLATE

**Date**: [YYYY-MM-DD]  
**Migration Job ID**: [job_id]  
**Source Domain**: [source]  
**Target Domain**: [target]  
**Validator**: [name]

### Summary
- Total Checks: [N]
- Passed: [N]
- Failed: [N]
- Warnings: [N]

### Critical Issues Found
[List any blockers]

### Minor Issues
[List non-blocking issues]

### Recommendation
- [ ] PASS - Account ready for production use
- [ ] PASS WITH CAVEATS - See issues above
- [ ] FAIL - Do not activate; rollback required

### Sign-Off
- Validator: [name] [date]
- Reviewed By: [manager] [date]

---

## AUTOMATED VALIDATION SCRIPT

```bash
#!/bin/bash
# run-migration-parity-check.sh

set -e
MIGRATED_DOMAIN=$1
NATIVE_DOMAIN=$2

echo "=== Migration Parity Validation ==="
echo "Migrated: $MIGRATED_DOMAIN"
echo "Native: $NATIVE_DOMAIN"
echo ""

# Filesystem checks
echo "Filesystem Validation..."
MIGRATED_FILES=$(find /home/[migrated_service] -type f | wc -l)
NATIVE_FILES=$(find /home/[native_service] -type f | wc -l)
if [ "$MIGRATED_FILES" == "$NATIVE_FILES" ]; then
  echo "✓ File count matches: $MIGRATED_FILES"
else
  echo "✗ File count mismatch: $MIGRATED_FILES vs $NATIVE_FILES"
fi

# Database checks
echo "Database Validation..."
mysql -u [migrated_user] -p [migrated_db] -e "SELECT COUNT(*) as count FROM information_schema.TABLES;" 

# DNS checks
echo "DNS Validation..."
dig $MIGRATED_DOMAIN +short
dig $NATIVE_DOMAIN +short

echo ""
echo "=== Validation Complete ==="
```

---

## SUCCESS CRITERIA

Migration parity validated when:
- ✅ All filesystem checks pass
- ✅ All database checks pass
- ✅ All mail checks pass
- ✅ All DNS checks pass
- ✅ All web checks pass
- ✅ All FTP checks pass (if used)
- ✅ Limits properly enforced
- ✅ Comparative tests identical
- ✅ Validator sign-off obtained

---

## NOTES

- This checklist is comprehensive but can be reduced for small migrations
- Automate as much as possible (especially file/DB checksums)
- Save all test results for audit trail
- Consider performance baseline (response times) for future reference
