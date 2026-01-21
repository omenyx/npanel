# OPERATIONS RUNBOOK

**Date**: January 23, 2026  
**Phase**: 3 Task 3.4  
**Purpose**: Operator guide for production troubleshooting and recovery  
**Status**: COMPLETE

---

## QUICK START

**For on-call operators**: Use this guide when alerts fire or users report issues.

**Always**:
1. Check health dashboard first → `/health`
2. Look at recent logs → Grafana logs UI
3. Check metrics → Grafana main dashboard
4. Use this runbook for specific scenarios
5. Document your actions → Incident log

**Never**:
1. Delete data without backup
2. Restart services without draining connections
3. Assume frontend is the problem (check backend first)
4. Skip the 5-minute investigation before escalating

---

## 1. EMERGENCY PROCEDURES

### 1.1 System Completely Down

**Symptoms**: No response on any port, no logs, application crashed

**Steps**:

```bash
# 1. Check if service is running
systemctl status npanel
ps aux | grep npanel

# 2. Check recent logs
journalctl -u npanel -n 50 --no-pager

# 3. Check if ports are listening
netstat -tlnp | grep 3000

# 4. Try restart
systemctl restart npanel

# 5. Watch startup logs
journalctl -u npanel -f

# 6. Verify health
curl -s http://localhost:3000/health | jq .

# 7. If still down, check:
# - Disk space: df -h
# - Memory: free -h
# - Database connectivity: mysql -u npanel -p
```

**Recovery**:
- Restart service
- If restart fails → Check disk/memory → Free up space → Restart
- If database unreachable → Check MySQL service → Restart MySQL → Restart NPanel
- If all services up but no response → Check logs for errors → Fix application issue

**Escalation**: If still down after 10 minutes → Page backend team

---

### 1.2 Database Connection Failure

**Symptoms**: Health check shows database=DOWN, logs show "Cannot connect to database"

**Steps**:

```bash
# 1. Check MySQL status
systemctl status mysql
# or
systemctl status mariadb

# 2. Try to connect manually
mysql -u npanel -p -h localhost npanel

# 3. If connection refused:
# - Service not running? → systemctl start mysql
# - Port not listening? → netstat -tlnp | grep 3306
# - Crashed? → Check /var/log/mysql/error.log

# 4. Check MySQL error log
tail -f /var/log/mysql/error.log

# 5. If database corrupted:
mysqlcheck -u root -p --repair --all-databases

# 6. Restart MySQL
systemctl restart mysql

# 7. Restart NPanel
systemctl restart npanel
```

**Prevention**:
- Check disk space daily (database bloat = slow queries)
- Monitor MySQL memory usage
- Set up MySQL backups

---

### 1.3 High CPU Usage

**Symptoms**: CPU spike in metrics, slow requests, timeouts

**Steps**:

```bash
# 1. Check which process is consuming CPU
top -b -n 1 | head -20
# or
ps aux --sort=-%cpu | head -10

# 2. If NPanel is consuming >80% CPU:
# Check what queries are running
mysql> SHOW PROCESSLIST;

# 3. Check for long-running queries
mysql> SHOW FULL PROCESSLIST WHERE TIME > 30;

# 4. Kill slow query if needed
mysql> KILL <process_id>;

# 5. Check NPanel logs for errors
tail -f /var/log/npanel.log | grep ERROR

# 6. If migration job causing spike:
# - Check /health endpoint
# - Monitor metrics dashboard
# - Wait for job to complete or kill migration job
```

**Recovery**:
- Identify long-running query → Kill it → Monitor
- If still high after 5 min → Restart NPanel
- If still high after restart → Check database size (df -h) → May need archival

---

### 1.4 High Memory Usage

**Symptoms**: OOM killer messages, memory alert firing, slow service

**Steps**:

```bash
# 1. Check memory usage
free -h
ps aux --sort=-%mem | head -10

# 2. If NPanel using >2GB:
# - It may be memory leak
# - Or processing large dataset

# 3. Check Node.js heap
curl http://localhost:3000/metrics | grep heap_used

# 4. If memory growing linearly:
# - Likely memory leak
# - Restart service to clear

systemctl restart npanel

# 5. Monitor memory after restart
watch -n 1 'free -h | grep Mem'

# 6. If immediately starts growing again:
# - Check recent code changes
# - Enable debug logging
# - Escalate to backend team
```

---

### 1.5 Disk Space Full

**Symptoms**: Disk usage = 100%, new log writes fail, database writes fail

**Steps**:

```bash
# 1. Check disk usage
df -h
du -sh /* | sort -rh

# 2. Find large files
find /var/log -type f -size +100M -exec ls -lh {} \;

# 3. Clean up options:
# - Archive old logs: see Task 3.2 for log cleanup
# - Delete old database records: see log retention
# - Remove old backups: rm -f /var/backups/npanel-*.sql.gz

# 4. Emergency cleanup (if critical):
# - Clear Docker cache: docker system prune -a
# - Clear package cache: apt-get clean
# - Truncate old log files (but keep recent): logrotate -f /etc/logrotate.conf

# 5. After cleanup, verify free space
df -h

# 6. Set up automatic cleanup
# See Task 3.2 for log retention job
```

**Prevention**:
- Monitor `disk_percent` metric (alert at 80%, critical at 90%)
- Set up log rotation (logrotate)
- Set up database archival (log cleanup job)
- Monitor backup size

---

## 2. COMMON FAILURE SCENARIOS

### 2.1 Slow Login Response

**Symptom**: Users report login taking 5-10 seconds, metric shows p95 > 500ms

**Root causes**:
1. Database slow query
2. Authentication service overloaded
3. Network latency to identity provider (if external)

**Debug**:

```bash
# 1. Check recent auth logs
curl -s 'http://localhost:3000/api/logs?service=iam&level=error' | jq .

# 2. Check metrics dashboard → Login endpoint latency
# Query: histogram_quantile(0.95, rate(http_request_duration_ms_bucket{route="/v1/auth/login"}[5m]))

# 3. Check if bcrypt cost is too high
# Look for: "password validation took Xms"
tail -f /var/log/npanel.log | grep -i bcrypt

# 4. Check database connection pool
# If all connections used up, new requests wait
mysql> SHOW STATUS WHERE variable_name = 'Threads_connected';

# 5. Check system load
uptime
# If load > number of CPU cores, system is overloaded
```

**Fixes**:

| Issue | Fix |
|-------|-----|
| **Slow query** | Kill long query, check query plan, add index |
| **Connection pool depleted** | Increase pool size in `.env`, restart service |
| **Overload** | Scale horizontally (load balance), or optimize code |
| **High bcrypt cost** | Cost is hardcoded at 12 (appropriate), not tunable |

---

### 2.2 Migration Job Failing

**Symptom**: Migration job stuck, status = ERROR, SSH errors in logs

**Types**:

**Type A: SSH Connection Failure**
```
Error: SSH connection refused on 192.168.1.100:22
```

**Debug**:
```bash
# 1. Check if target SSH server is up
ping 192.168.1.100
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/192.168.1.100/22' && echo "Port open" || echo "Port closed"

# 2. Check if IP is correct
curl -s http://localhost:3000/api/migrations/<job-id> | jq '.source_host'

# 3. Check NPanel SSH key
ls -la ~/.ssh/
# Should have: id_rsa, id_rsa.pub

# 4. Check firewall from NPanel → target
iptables -L -n | grep 192.168.1.100

# 5. Check NPanel logs for auth errors
tail -f /var/log/npanel-migration.log | grep SSH
```

**Fix**:
- Wrong IP? → Update customer account → Retry migration
- Network down? → Wait for network recovery → Retry
- SSH key invalid? → Re-provision SSH key → Retry
- Firewall blocking? → Add firewall rule → Retry

**Type B: Database Sync Failure**
```
Error: Failed to read database from source: Connection timeout
```

**Debug**:
```bash
# 1. Check if database port is reachable
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/192.168.1.100/3306' && echo "Port open" || echo "Port closed"

# 2. Check database credentials
curl -s http://localhost:3000/api/migrations/<job-id> | jq '.database_credentials'

# 3. Try manual connection
mysql -h 192.168.1.100 -u root -p'<password>' -e 'SELECT VERSION();'

# 4. Check NPanel logs for database errors
tail -f /var/log/npanel-migration.log | grep DATABASE
```

**Fix**:
- Connection timeout? → Check network/firewall
- Authentication failed? → Verify credentials → Update account
- Database too large? → Increase timeout → Increase bandwidth

**Type C: Email Configuration Issue**
```
Error: Failed to verify MX records for example.com
```

**Debug**:
```bash
# 1. Check DNS resolution
nslookup example.com
dig example.com MX

# 2. Check NPanel DNS config
curl -s http://localhost:3000/health | jq '.signals[] | select(.name=="dns")'

# 3. Check Loki logs for DNS errors
# Query: {service="hosting", adapter="dns", status="failed"}
```

**Fix**:
- MX records missing? → Customer must update DNS first
- DNS timeout? → Wait for DNS propagation
- Check firewall rules on cPanel/DirectAdmin side

---

### 2.3 Hosting Operation Timeout

**Symptom**: DNS record creation fails with timeout, metric p95 > 5000ms

**Debug**:

```bash
# 1. Check target service status
# For cPanel:
curl -s https://<host>:2083/json-api/server/dns | jq .status

# For DirectAdmin:
curl -s -u admin:pass http://<host>:2222/api/?list=dns | jq .

# 2. Check if target service is responding
timeout 10 curl -v https://<host>:2083/

# 3. Check NPanel hosting logs
# Query: {service="hosting", operation="dns_create"} | json | duration_ms > 5000

# 4. Check network latency
ping -c 5 <target-host>

# 5. Check if target is under load
ssh admin@<host> 'uptime'
```

**Fix**:
- Service overloaded? → Wait, then retry
- Network latency high? → Check network path, may need VPN/direct connection
- Timeout too short? → Increase timeout in config (currently 30s)
- Service crashed? → Restart service on target, then retry

---

### 2.4 Customer Deleted but Logs Missing

**Symptom**: Customer account deleted, historical logs missing (compliance issue)

**Root cause**: Foreign key cascade delete

**Recovery**:

```bash
# 1. Check backups
ls -la /var/backups/npanel-*.sql.gz | tail -5

# 2. Find backup from before deletion
# Look for timestamp before customer deletion

# 3. Extract customer logs from backup
# Restore to temp database and export:
mysql --user=npanel -p npanel < backup-<date>.sql

# 4. Query customer logs
mysql -u npanel -p -e "
  SELECT * FROM migration_logs 
  WHERE account_id IN (
    SELECT id FROM migration_accounts 
    WHERE customer_id = '<customer-uuid>'
  );
" > customer-logs.csv

# 5. Archive to long-term storage (S3, cold storage, etc.)
gzip customer-logs.csv
# Upload to archive system
```

**Prevention**:
- See Task 3.1 section 6.2 for cascade delete fix
- Archive logs before customer deletion
- Keep 90-day retention of all logs

---

## 3. MAINTENANCE PROCEDURES

### 3.1 Weekly Checks

**Monday morning checklist**:

```bash
#!/bin/bash
echo "=== NPanel Weekly Maintenance ==="

# 1. Check backup status
ls -la /var/backups/ | tail -10
# Should have: daily backup from yesterday, weekly backup from last week

# 2. Check disk space
df -h / | awk 'NR==2 {print $5 " used, " $4 " available"}'
# Alert if > 80% used

# 3. Check database size
mysql -u npanel -p -e "SELECT ROUND(SUM(data_length+index_length)/1024/1024/1024,2) as 'DB Size (GB)' FROM information_schema.tables WHERE table_schema='npanel';"

# 4. Check log retention (old logs still archived?)
find /var/backups -name "*.csv.gz" -mtime +30 -exec du -sh {} \;

# 5. Verify metrics are being collected
curl -s http://localhost:3000/metrics | grep http_requests_total | head -1

# 6. Check for alerts
# Login to Grafana → Alerting → Check for any firing alerts

# 7. Review error logs from past week
journalctl -u npanel --since "1 week ago" | grep ERROR | wc -l
# Should be < 50 errors per week
```

### 3.2 Monthly Checks

**First Friday of month**:

```bash
#!/bin/bash
echo "=== NPanel Monthly Maintenance ==="

# 1. Update packages
apt-get update
apt-get upgrade -y

# 2. Verify TLS certificates (see section 4 below)
./check-certs.sh

# 3. Run database maintenance
mysql -u npanel -p -e "OPTIMIZE TABLE migration_logs; OPTIMIZE TABLE host_logs;"

# 4. Generate monthly report
# Login to Grafana → Create report of:
# - Total migrations
# - Success rate
# - Error trends
# - Performance trends

# 5. Clean old backups (keep 90 days)
find /var/backups -name "*.sql.gz" -mtime +90 -delete

# 6. Check certificate renewal status (see section 4)
certbot renew --dry-run
```

### 3.3 Quarterly Review

**Every 3 months**:

```bash
1. Capacity planning
   - Current disk usage trend
   - Current database size trend
   - Estimate when storage will fill up
   
2. Security audit
   - Check for failed login attempts
   - Check for unusual API patterns
   - Review audit logs
   
3. Performance optimization
   - Identify slow endpoints (from metrics)
   - Identify slow queries (from database logs)
   - Plan optimization work
   
4. Documentation review
   - Update runbook with new scenarios
   - Document new alert patterns
   - Share learnings with team
```

---

## 4. TLS CERTIFICATE RENEWAL

### 4.1 Certificate Status Check

```bash
#!/bin/bash
# check-certs.sh

CERT_DIR="/etc/ssl/certs/npanel"
DOMAIN="panel.example.com"
ALERT_DAYS=30

# 1. Check certificate expiration
expiry_date=$(openssl x509 -enddate -noout -in "$CERT_DIR/cert.pem" | cut -d= -f2)
expiry_epoch=$(date -d "$expiry_date" +%s)
now_epoch=$(date +%s)
days_left=$(( ($expiry_epoch - $now_epoch) / 86400 ))

echo "Certificate expires: $expiry_date ($days_left days)"

# 2. Alert if expiring soon
if [ $days_left -lt $ALERT_DAYS ]; then
  echo "WARNING: Certificate expires in $days_left days!"
  # Send alert
  curl -X POST https://your-alerting/api/alert \
    -d "Certificate expires in $days_left days for $DOMAIN"
fi

# 3. Check certificate validity
openssl x509 -in "$CERT_DIR/cert.pem" -text -noout | grep -A 2 "Subject:"

# 4. Verify key matches certificate
cert_modulus=$(openssl x509 -noout -modulus -in "$CERT_DIR/cert.pem" | openssl md5)
key_modulus=$(openssl rsa -noout -modulus -in "$CERT_DIR/key.pem" | openssl md5)

if [ "$cert_modulus" = "$key_modulus" ]; then
  echo "✓ Certificate and key match"
else
  echo "✗ Certificate and key do NOT match (CRITICAL!)"
fi
```

### 4.2 Manual Renewal (Let's Encrypt)

```bash
# If using certbot + Let's Encrypt:

# 1. Test renewal (dry-run)
certbot renew --dry-run

# 2. If test passes, run actual renewal
certbot renew

# 3. Verify new certificate
check-certs.sh

# 4. If certbot can't auto-renew, manual renewal:
certbot certonly --manual -d panel.example.com

# Follow prompts to verify domain ownership
```

### 4.3 Certificate Renewal Failure

**Symptom**: Certificate expires in 10 days, renewal fails, HTTPS error

**Debug**:

```bash
# 1. Check certbot status
systemctl status certbot.timer

# 2. Check renewal logs
journalctl -u certbot -n 50

# 3. Try manual renewal with debug
certbot renew --verbose

# 4. Common issues:
# - DNS validation failing → Check DNS records
# - Port 80/443 blocked → Check firewall
# - Let's Encrypt rate limit hit → Try with different domain

# 5. If Let's Encrypt fails, use self-signed cert temporarily
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes

# 6. Deploy temporary cert
cp cert.pem /etc/ssl/certs/npanel/
cp key.pem /etc/ssl/private/npanel/
systemctl restart nginx

# 7. Escalate to DevOps for permanent fix
```

---

## 5. MIGRATION FAILURE RECOVERY

### 5.1 Partial Migration (Some Accounts Failed)

**Scenario**: Migration job processed 500 accounts, 450 succeeded, 50 failed

**Steps**:

```bash
# 1. Query failed accounts
curl -s 'http://localhost:3000/api/migrations/<job-id>/accounts?status=failed' | jq '.items[] | {email: .email, error: .error_message}'

# 2. Analyze failure pattern
# - All same error? → Single issue affecting all
# - Various errors? → Multiple issues

# 3. For retriable errors (network timeouts, transient failures):
curl -X POST http://localhost:3000/api/migrations/<job-id>/retry \
  -H "Content-Type: application/json" \
  -d '{"statuses": ["failed"]}'

# 4. For permanent errors (wrong credentials, unsupported source):
# - Notify customer to fix issue
# - Provide manual recovery steps
# - Document for post-migration support

# 5. Monitor retry progress
watch -n 5 'curl -s http://localhost:3000/api/migrations/<job-id> | jq "{status: .status, completed: .completed_count, failed: .failed_count}"'
```

### 5.2 Rollback a Migration

**Scenario**: Migration completed but customer reports missing data, needs rollback

**Important**: Rollback is NOT automated. This is a manual process.

```bash
# 1. Assess damage
# - What's missing?
# - How many accounts affected?
# - Can we selectively restore, or full rollback?

# 2. Notify customer
# - "We detected an issue, investigating"
# - Commit to timeline (typically 1-2 hours)

# 3. Stop new operations on affected accounts
# - Disable customer portal access (temporary)
# - Prevent further changes on cPanel/DirectAdmin

# 4. Restore from backup
# - Pre-migration backup should exist
# - Restore to temporary/staging system first
# - Verify data is intact

# 5. Manually re-apply valid changes
# - Identify changes made after migration
# - Selectively re-apply to restored environment
# - Test thoroughly

# 6. Cut over to restored state
# - Update DNS (if applicable)
# - Restore customer portal access
# - Monitor for issues

# 7. Post-incident analysis
# - Why did migration fail?
# - How do we prevent this?
# - Update runbook
```

---

## 6. INCIDENT RESPONSE

### 6.1 Incident Log Template

**When incident occurs**:

```
=== INCIDENT LOG ===
Start time: 2026-01-23 10:30:00 UTC
Detected by: [alert name] or [user report]
Severity: [SEV1/SEV2/SEV3]

Impact:
- Service affected: [which service]
- Impact radius: [which customers/features]
- Expected impact duration: [estimate]

Timeline:
10:30 - Alert fired: Database connection lost
10:32 - Acknowledged by on-call engineer
10:35 - Root cause identified: MySQL service crashed
10:40 - MySQL restarted
10:42 - Service recovered
10:45 - All checks passing

Root cause: MySQL crashed due to OOM kill (memory pressure)
Fix: Increased memory limit, enabled memory monitor

Prevention: [what we'll do to prevent recurrence]

Post-incident action items:
- [ ] Add memory metric to dashboard
- [ ] Add alert for memory pressure
- [ ] Review database query performance
```

### 6.2 Escalation Path

**On-call hierarchy**:

```
Level 1: On-call Engineer
- Investigate for 10-15 minutes
- Run through runbook
- If unable to resolve → escalate

Level 2: Backend Tech Lead
- Have deeper system knowledge
- Can modify code/config if needed
- Available within 30 min

Level 3: Operations Manager
- Handles customer communication
- Makes business decisions
- Authorizes temporary workarounds

Level 4: VP Engineering (critical only)
- For company-level decisions
- Major customer escalations
- Post-mortem authorization
```

**When to escalate**:
- 15 minutes with no progress → L2
- 30 minutes with no resolution → L3
- Customer data at risk → Immediately L3
- Multiple services down → Immediately L2

---

## 7. USEFUL COMMANDS

### Log Queries (Loki/LogQL)

```bash
# Last 100 errors in migration service
curl -s 'http://localhost:3001/loki/api/v1/query' \
  --data-urlencode 'query={service="migration", level="error"}' \
  --data-urlencode 'limit=100'

# Errors for specific customer (last 24h)
curl -s 'http://localhost:3001/loki/api/v1/query_range' \
  --data-urlencode 'query={tenant_id="<uuid>"} | json | level="error"' \
  --data-urlencode 'start=<24h-ago-epoch>' \
  --data-urlencode 'end=<now-epoch>'

# All logs for trace ID
curl -s 'http://localhost:3001/loki/api/v1/query' \
  --data-urlencode 'query={trace_id="<uuid>"}'
```

### Metrics Queries (Prometheus)

```bash
# Login endpoint p95 latency (last 1 hour)
curl -s 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=histogram_quantile(0.95, rate(http_request_duration_ms_bucket{route="/v1/auth/login"}[1h]))'

# Error rate (last 5 minutes)
curl -s 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=rate(http_requests_total{status_code=~"5.."}[5m])'

# Database connection status
curl -s 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=up{job="npanel-health", instance="localhost:3000"}'
```

### Database Queries

```bash
# Top 10 slowest migrations
SELECT j.id, j.customer_id, COUNT(a.id) as account_count, 
       MAX(a.completed_at) - MIN(a.created_at) as duration
FROM migration_jobs j
JOIN migration_accounts a ON j.id = a.job_id
WHERE j.status = 'complete'
GROUP BY j.id
ORDER BY duration DESC
LIMIT 10;

# Recent failed migrations
SELECT j.id, j.customer_id, j.status, j.error_message, j.created_at
FROM migration_jobs j
WHERE j.status = 'failed'
ORDER BY j.created_at DESC
LIMIT 20;

# Accounts with errors in this migration job
SELECT a.id, a.email, a.status, ml.message, ml.level
FROM migration_accounts a
LEFT JOIN migration_logs ml ON a.id = ml.account_id
WHERE a.job_id = '<job-id>' AND a.status IN ('error', 'failed')
ORDER BY ml.created_at DESC;
```

---

## 8. CONTACT INFORMATION

**On-call rotation**: [Link to PagerDuty/OpsGenie]  
**Slack channel**: #npanel-incidents  
**Email list**: npanel-team@company.com  
**Status page**: https://status.example.com  

**External vendors**:
- Database: Managed by [Provider]
- DNS: [Provider]
- CDN: [Provider]
- Email alerting: [Provider]

---

**Last Updated**: January 23, 2026  
**Next Review**: April 23, 2026  
**Maintainer**: Site Reliability Team
