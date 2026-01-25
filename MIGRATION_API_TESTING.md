# Migration API Testing Examples

## Complete Migration Workflow Examples

### Example 1: Full Account Migration (Step-by-Step)

This example shows a complete WHM/cPanel account migration into nPanel.

#### Step 1: Pre-Flight Validation

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "backup_path": "/var/backups/migrations/cpmove-johnsmith.tar.gz",
    "target_user": "johnsmith"
  }'
```

**Response (Success):**
```json
{
  "success": true,
  "valid": true,
  "backup_format": "cpmove-tar.gz",
  "backup_size": 25600000000,
  "disk_available": 1099511627776,
  "message": "Backup is valid and ready for migration"
}
```

**Response (Failure - User Exists):**
```json
{
  "success": false,
  "valid": false,
  "message": "Validation failed: target user already exists: johnsmith",
  "errors": [
    "target user already exists: johnsmith"
  ]
}
```

**Response (Failure - Insufficient Disk):**
```json
{
  "success": false,
  "valid": false,
  "message": "Validation failed: insufficient disk space: need 51200000000 bytes, have 10737418240 bytes",
  "errors": [
    "insufficient disk space"
  ]
}
```

---

#### Step 2: Analyze Backup (Async)

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "backup_path": "/var/backups/migrations/cpmove-johnsmith.tar.gz",
    "target_user": "johnsmith"
  }'
```

**Response:**
```json
{
  "success": true,
  "job_id": 12345,
  "status": "analyzing",
  "message": "Backup analysis in progress",
  "check_progress": "/api/migration/job/12345/status"
}
```

Now poll for completion:

```bash
curl -X GET "http://localhost:8080/api/migration/job/12345/status" \
  -H "Authorization: Bearer admin_token"
```

**Progress Response (In Progress):**
```json
{
  "success": true,
  "job_id": 12345,
  "status": "extracting",
  "progress": 30,
  "current_step": "Analyzing metadata",
  "timeline": {
    "started_at": "2026-01-15T10:35:00Z",
    "estimated_completion": "2026-01-15T10:40:00Z",
    "elapsed_seconds": 120
  }
}
```

**Completion Response:**
```json
{
  "success": true,
  "job_id": 12345,
  "status": "complete",
  "progress": 100,
  "current_step": "Analysis complete",
  "timeline": {
    "started_at": "2026-01-15T10:35:00Z",
    "estimated_completion": "2026-01-15T10:36:30Z",
    "elapsed_seconds": 150
  }
}
```

---

#### Step 3: Get Migration Plan

**Request:**
```bash
curl -X GET "http://localhost:8080/api/migration/plan?job_id=12345" \
  -H "Authorization: Bearer admin_token"
```

**Response:**
```json
{
  "success": true,
  "plan": {
    "target_user": "johnsmith",
    "backup_format": "cpmove-tar.gz",
    "backup_date": "2026-01-15T10:30:00Z",
    "total_size": 25600000000,
    
    "domains_count": 5,
    "domains": [
      {
        "domain_name": "johnsmith.com",
        "is_addon": false,
        "size": 5120000000,
        "has_ssl": true,
        "web_root": "/home/johnsmith/public_html"
      },
      {
        "domain_name": "portfolio.johnsmith.com",
        "is_addon": true,
        "size": 512000000,
        "has_ssl": false,
        "web_root": "/home/johnsmith/public_html/portfolio"
      }
    ],
    
    "email_count": 25,
    "email_accounts": [
      {
        "email": "john@johnsmith.com",
        "domain": "johnsmith.com",
        "maildir_size": 102400000,
        "forwarding": ["john@gmail.com"]
      },
      {
        "email": "support@johnsmith.com",
        "domain": "johnsmith.com",
        "maildir_size": 51200000,
        "forwarding": []
      }
    ],
    
    "database_count": 3,
    "databases": [
      {
        "db_name": "johnsmith_wordpress",
        "db_type": "mysql",
        "db_user": "johnsmith_wp",
        "db_size": 10240000,
        "table_count": 45
      }
    ],
    
    "dns_zones_count": 1,
    "ssl_certs_count": 1,
    
    "warnings": [
      "Email account 'noreply@johnsmith.com' has 0 size (disabled)",
      "Database 'johnsmith_test' appears unused (0 tables)"
    ],
    
    "conflicts": [],
    "skip_reasons": {}
  },
  
  "mapping": {
    "cpanel_user": "johnsmith",
    "npanel_user": "johnsmith",
    "structure": {
      "addon_domains": "mapped_to_npanel_domains",
      "databases": "mapped_to_npanel_databases"
    }
  }
}
```

---

#### Step 4: Preview Migration (Dry-Run)

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "job_id": 12345
  }'
```

**Response:**
```json
{
  "success": true,
  "dry_run": true,
  "simulation": {
    "would_create": {
      "users": 1,
      "domains": 5,
      "subdomains": 12,
      "email_accounts": 25,
      "databases": 3,
      "dns_zones": 1,
      "ssl_certificates": 1,
      "cron_jobs": 3
    },
    "would_modify": {
      "existing_users": 0,
      "existing_domains": 0
    },
    "would_skip": {
      "disabled_email_accounts": 1,
      "test_databases": 1
    },
    "disk_impact": {
      "homedir": 19200000000,
      "databases": 1024000000,
      "email": 5120000000,
      "total": 25344000000
    }
  },
  "next_action": "Call migration_apply with job_id=12345 and approval_token to proceed",
  "message": "No changes have been made. This is a preview."
}
```

---

#### Step 5: Generate Approval Token (Frontend)

The UI generates a CSRF token for the migration:

```javascript
// Frontend code to generate approval
const approvalData = {
  jobId: 12345,
  targetUser: 'johnsmith',
  adminEmail: 'admin@nPanel.local',
  confirmAt: new Date().toISOString(),
  hash: generateSHA256('12345johnsmith' + csrfToken)
};

const approvalToken = btoa(JSON.stringify(approvalData));
```

---

#### Step 6: Apply Migration

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/apply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "job_id": 12345,
    "approval_token": "eyJqb2JJZCI6IDEyMzQ1LCAidGFyZ2V0VXNlciI6ICJqb2huc21pdGgiLCAiY29uZmlybUF0IjogIjIwMjYtMDEtMTVUMTA6NDA6MDBaIn0="
  }'
```

**Response:**
```json
{
  "success": true,
  "apply_job_id": 13345,
  "status": "applying",
  "message": "Migration in progress",
  "check_progress": "/api/migration/job/13345/status",
  "cancel_endpoint": "/api/migration/job/13345/cancel"
}
```

Now monitor progress:

```bash
curl -X GET "http://localhost:8080/api/migration/job/13345/status" \
  -H "Authorization: Bearer admin_token"
```

**Progress Response (Step 1 - User Creation):**
```json
{
  "success": true,
  "job_id": 13345,
  "status": "applying",
  "progress": 12,
  "current_step": "Create nPanel User",
  "target_user": "johnsmith",
  "timeline": {
    "started_at": "2026-01-15T10:42:00Z",
    "estimated_completion": "2026-01-15T10:52:00Z",
    "elapsed_seconds": 30
  }
}
```

**Progress Response (Step 3 - Home Directory):**
```json
{
  "success": true,
  "job_id": 13345,
  "status": "applying",
  "progress": 45,
  "current_step": "Restore Home Directory",
  "target_user": "johnsmith",
  "timeline": {
    "started_at": "2026-01-15T10:42:00Z",
    "estimated_completion": "2026-01-15T10:52:00Z",
    "elapsed_seconds": 240
  }
}
```

**Progress Response (Completion):**
```json
{
  "success": true,
  "job_id": 13345,
  "status": "complete",
  "progress": 100,
  "current_step": "Migration complete",
  "target_user": "johnsmith",
  "timeline": {
    "started_at": "2026-01-15T10:42:00Z",
    "estimated_completion": "2026-01-15T10:52:30Z",
    "elapsed_seconds": 630
  }
}
```

---

#### Step 7: Validate Migration

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "target_user": "johnsmith",
    "job_id": 13345
  }'
```

**Response (All Checks Passed):**
```json
{
  "success": true,
  "checks": {
    "user_exists": true,
    "home_dir_exists": true,
    "home_dir_owned": true,
    "permissions_correct": true,
    "databases_accessible": true,
    "database_users_can_authenticate": true,
    "email_mailboxes_exist": true,
    "dovecot_quota_configured": true,
    "dns_zones_resolve": true,
    "dns_serial_correct": true,
    "ssl_certificate_valid": true,
    "ssl_private_key_permissions": true,
    "web_root_accessible": true,
    "all_checks_passed": true
  },
  "summary": "Migration validation complete. All checks passed.",
  "issues": []
}
```

---

### Example 2: Selective Restore (Databases Only)

**Scenario:** Account already exists in nPanel, but databases need to be migrated separately.

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/selective-restore \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "backup_path": "/var/backups/migrations/cpmove-johnsmith.tar.gz",
    "target_user": "johnsmith",
    "components": {
      "files": false,
      "databases": true,
      "email": false,
      "dns": false,
      "ssl": false
    },
    "mode": "merge"
  }'
```

**Response:**
```json
{
  "success": true,
  "job_id": 12346,
  "status": "queued",
  "message": "Selective restore in progress (mode: merge)",
  "check_progress": "/api/migration/job/12346/status"
}
```

---

### Example 3: Overwrite Mode with Confirmation

**Scenario:** Rebuilding an account, need to overwrite existing data.

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/selective-restore \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "backup_path": "/var/backups/migrations/cpmove-johnsmith.tar.gz",
    "target_user": "johnsmith",
    "components": {
      "files": true,
      "databases": true,
      "email": true,
      "dns": true,
      "ssl": true
    },
    "mode": "overwrite",
    "confirmation": "I understand this will replace all existing data for johnsmith"
  }'
```

**Response:**
```json
{
  "success": true,
  "job_id": 12347,
  "status": "queued",
  "message": "Full account overwrite in progress (mode: overwrite)",
  "warning": "All existing data for johnsmith will be replaced",
  "check_progress": "/api/migration/job/12347/status"
}
```

---

### Example 4: Migration Failure & Rollback

**Request (Apply failed due to corrupt database):**
```bash
curl -X GET "http://localhost:8080/api/migration/job/13348/status" \
  -H "Authorization: Bearer admin_token"
```

**Response (Failure State):**
```json
{
  "success": true,
  "job_id": 13348,
  "status": "failed",
  "progress": 65,
  "current_step": "Restore Databases",
  "target_user": "johnsmith",
  "error_message": "Failed at step 'Restore Databases': Duplicate key entry 'john@example.com' in databases",
  "timeline": {
    "started_at": "2026-01-15T10:42:00Z",
    "estimated_completion": "2026-01-15T10:52:00Z",
    "elapsed_seconds": 450
  }
}
```

**Automatic Rollback Already Attempted:**
The system automatically attempted rollback when the error occurred.

**Manual Rollback Request (if needed):**
```bash
curl -X POST http://localhost:8080/api/migration/rollback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "job_id": 13348
  }'
```

**Rollback Response:**
```json
{
  "success": true,
  "target_user": "johnsmith",
  "message": "Migration rolled back successfully",
  "cleanup_status": {
    "user_removed": true,
    "databases_removed": true,
    "files_removed": true,
    "email_cleaned": true,
    "dns_cleaned": true
  },
  "backup_location": "/var/backups/migrations/cpmove-johnsmith.tar.gz",
  "backup_status": "intact"
}
```

---

### Example 5: Get Migration Logs

**Request:**
```bash
curl -X GET "http://localhost:8080/api/migration/job/13345/logs" \
  -H "Authorization: Bearer admin_token"
```

**Response (Text Log File):**
```
=== Migration Job #13345 Started ===
Time: 2026-01-15 10:42:00 UTC
Target User: johnsmith
Source: /var/backups/migrations/cpmove-johnsmith.tar.gz
Admin: admin@nPanel.local

--- Step 1: Create nPanel User ---
[10:42:05] Creating system user 'johnsmith'...
[10:42:06] UID: 1001, GID: 1001
[10:42:06] Shell: /bin/bash
[10:42:06] ✓ User created successfully

--- Step 2: Create Directories ---
[10:42:07] Creating /home/johnsmith...
[10:42:07] Creating /home/johnsmith/public_html...
[10:42:08] Creating /home/johnsmith/mail...
[10:42:08] Creating /home/johnsmith/tmp...
[10:42:08] ✓ All directories created

--- Step 3: Restore Home Directory ---
[10:42:09] Extracting home directory from backup...
[10:42:15] Extracted 1,234 files (5.1 GB)
[10:42:45] Setting permissions...
[10:42:46] ✓ Home directory restored

--- Step 4: Restore Databases ---
[10:42:47] Creating database 'johnsmith_wordpress'...
[10:42:48] Creating database user 'johnsmith_wp'...
[10:42:49] Restoring SQL data (10.2 MB)...
[10:42:52] ✓ Database restored

--- Step 5: Restore Email Accounts ---
[10:42:53] Creating 25 mailboxes...
[10:43:10] Setting Dovecot quotas...
[10:43:12] ✓ Email accounts restored

--- Step 6: Restore DNS Zones ---
[10:43:13] Creating DNS zone 'johnsmith.com'...
[10:43:14] Importing 15 DNS records...
[10:43:15] ✓ DNS zones restored

--- Step 7: Restore SSL Certificates ---
[10:43:16] Importing SSL certificate for 'johnsmith.com'...
[10:43:17] Setting up auto-renewal...
[10:43:18] ✓ SSL certificates restored

--- Step 8: Post-Migration Validation ---
[10:43:19] Verifying user exists...
[10:43:20] Verifying home directory...
[10:43:21] Verifying databases...
[10:43:22] Verifying email...
[10:43:23] Verifying DNS...
[10:43:24] Verifying SSL...
[10:43:25] ✓ All validations passed

=== Migration Job #13345 Completed ===
Duration: 10 minutes 25 seconds
Status: SUCCESS
Total Resources Migrated: 44 (5 domains, 25 emails, 3 databases, 1 DNS zone, 1 SSL cert)
Total Data: 25.3 GB
```

---

## Error Scenarios and Responses

### Scenario 1: Insufficient Permissions

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_token" \
  -d '{...}'
```

**Response:**
```json
{
  "success": false,
  "message": "Unauthorized: Insufficient permissions for migration operations",
  "error": "admin_role_required"
}
```

---

### Scenario 2: Invalid Approval Token

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/apply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin_token" \
  -d '{
    "job_id": 12345,
    "approval_token": "invalid_token_12345"
  }'
```

**Response:**
```json
{
  "success": false,
  "message": "Failed to apply migration",
  "error": "invalid approval token"
}
```

---

### Scenario 3: Corrupt Backup File

**Request:**
```bash
curl -X POST http://localhost:8080/api/migration/validate \
  -H "Content-Type: application/json" \
  -d '{
    "backup_path": "/var/backups/corrupt.tar.gz",
    "target_user": "testuser"
  }'
```

**Response:**
```json
{
  "success": false,
  "valid": false,
  "message": "Validation failed: corrupt or invalid archive header",
  "errors": [
    "corrupt or invalid archive header"
  ]
}
```

---

## Performance Benchmarks

### Small Account (1 GB)
```
Validation:     2 seconds
Analysis:       15 seconds
Planning:       3 seconds
Dry-run:        1 second
Migration:      35 seconds
Validation:     5 seconds
Total:          ~1 minute
```

### Medium Account (25 GB)
```
Validation:     3 seconds
Analysis:       45 seconds
Planning:       5 seconds
Dry-run:        2 seconds
Migration:      5 minutes 30 seconds
Validation:     15 seconds
Total:          ~6-7 minutes
```

### Large Account (100+ GB)
```
Validation:     5 seconds
Analysis:       3 minutes
Planning:       10 seconds
Dry-run:        3 seconds
Migration:      20-30 minutes (depends on IO speed)
Validation:     30 seconds
Total:          ~25-35 minutes
```

