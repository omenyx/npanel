# Migration Test Scenario - Phase 1

**Purpose**: Validate Phase 1 migration implementation through a complete end-to-end test  
**Date**: January 22, 2026  
**Status**: Ready for Execution

---

## Test Objective

Prove that a migrated account is **functionally indistinguishable** from a natively created account.

---

## Test Setup

### Prerequisites
- ✅ Backend service running
- ✅ Frontend accessible
- ✅ Database initialized
- ✅ SSH access to source cPanel system configured
- ✅ Source account prepared with sample data

### Source Account Setup (cPanel)
```
Username: testuser
Domain: testmig.example.com
Databases: 2 (testuser_wp, testuser_forum)
Mailboxes: 3 (info@testmig.example.com, support@testmig.example.com, admin@testmig.example.com)
FTP Account: testuser
Files: ~50MB public_html
```

### Target Account Setup (NPanel)
- Admin creates customer: `Test Migration Customer`
- Assigns plan: Basic (100GB disk, 10 DBs, 50 mailboxes)
- Prepares for migration

---

## Test Execution

### PHASE 1: Service Identity Mapping

**Test 1.1.1 - Deterministic Mapping**
```
Execute:
1. Call mapSourceUserToService("testuser", "testmig.example.com")
2. Note generated systemUsername (e.g., "np_abc12345")
3. Call again with same inputs

Expected:
- Second call returns same systemUsername
- mysqlUsername is deterministic
- No errors on collision check

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.1.2 - No Collisions**
```
Execute:
1. Create 10 test accounts
2. Generate service IDs for each
3. Check for duplicate systemUsernames

Expected:
- All systemUsernames are unique
- No collisions detected

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.1.3 - Idempotent Service Lookup**
```
Execute:
1. Create service with systemUsername "np_test0001"
2. Call mapSourceUserToService() for same source user again
3. Verify returns existing service instead of creating new

Expected:
- Method returns existing service
- No duplicate service created
- Metadata shows "found existing service"

Verify: ✅ PASS / ❌ FAIL
```

---

### PHASE 2: Filesystem Migration

**Test 1.2.1 - Pre-Migration Analysis**
```
Execute:
1. getSourceFilesystemStats() for testuser
2. Verify it returns file count, size, subdirectory info

Expected:
- totalFiles > 0
- totalSizeBytes > 0
- publicHtmlSizeBytes populated
- No errors on remote SSH

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.2.2 - Dry-Run Rsync**
```
Execute:
1. Create migration job with dryRun: true
2. Execute handleRsyncHome step
3. Verify no files actually transferred

Expected:
- rsync runs with --dry-run flag
- Output shows what WOULD be transferred
- Target directory unchanged
- No step marked complete (still pending)

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.2.3 - Live File Transfer**
```
Execute:
1. Create migration job with dryRun: false
2. Execute handleRsyncHome step
3. Verify files appear in target

Expected:
- Files transferred to /home/np_*/
- Ownership set correctly
- Permissions preserved (755 for directories, 644 for files)
- Step marked complete
- Metadata includes file count

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.2.4 - Checksum Verification**
```
Execute:
1. Get sample file list from target
2. Get checksums from source via SSH
3. Compare checksums

Expected:
- All sample files match source
- No corruption detected
- Report shows files checked

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.2.5 - Filesystem Validation Post-Migration**
```
Execute:
1. validateFilesystemMigration(serviceId)
2. Verify target structure

Expected:
- public_html directory exists
- logs directory exists
- Ownership matches service systemUsername
- No issues reported

Verify: ✅ PASS / ❌ FAIL
```

---

### PHASE 3: Database Migration

**Test 1.3.1 - Database List Retrieval**
```
Execute:
1. getSourceDatabaseList(config, "testuser")
2. Verify lists testuser_wp, testuser_forum

Expected:
- Returns array of databases
- Each has name, table count, size
- Names match expected DBs

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.3.2 - Pre-Migration Validation**
```
Execute:
1. validateDatabaseMigration(targetServiceId)
2. Check credentials and privileges

Expected:
- MySQL password set
- MySQL username set
- Can connect to MySQL (verified: true)
- No issues reported

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.3.3 - Dump & Import (Dry-Run)**
```
Execute:
1. Create migration job with dryRun: true
2. Execute handleImportDatabases step
3. Verify databases NOT created

Expected:
- mysqldump command shown
- import NOT executed
- Target databases don't exist

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.3.4 - Live Database Import**
```
Execute:
1. Create migration job with dryRun: false
2. Execute handleImportDatabases step
3. Verify databases created and populated

Expected:
- testuser_wp database created
- testuser_forum database created
- Tables imported
- No import errors
- Step marked complete

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.3.5 - Table Integrity Verification**
```
Execute:
1. verifyTableIntegrity("testuser_wp", expectedTableCount)
2. Query database for table list

Expected:
- Actual table count matches expected
- No corrupt/crashed tables
- All tables accessible
- No issues reported

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.3.6 - Database Access via Service Credentials**
```
Execute:
1. Connect as service user: np_abc12345_db
2. Query testuser_wp database
3. Test SELECT, INSERT, UPDATE

Expected:
- Can connect with service password
- Can SELECT from tables
- Can INSERT new records
- Can UPDATE records
- Can DELETE records

Verify: ✅ PASS / ❌ FAIL
```

---

### PHASE 4: Mail & DNS Migration

**Test 1.4.1 - Mailbox Pre-Migration Check**
```
Execute:
1. validateMailMigration(targetServiceId)
2. Check service status and mail config

Expected:
- Service status is active
- Domain configured
- No issues reported

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.4.2 - Mailbox Creation**
```
Execute:
1. Create mailboxes for test migration
   - info@testmig.example.com
   - support@testmig.example.com
   - admin@testmig.example.com

Expected:
- Mailboxes created successfully
- Quota set correctly (500MB each)
- Credentials generated
- No errors in log

Verify: ✅ PASS / ❌ FAIL
```

**Test 1.4.3 - DNS Zone Migration**
```
Execute:
1. validateDnsMigration(targetServiceId, "testmig.example.com")
2. Check zone configuration

Expected:
- Domain matches service.primaryDomain
- Zone file readable
- No issues reported

Verify: ✅ PASS / ❌ FAIL
```

---

### PHASE 5: Parity Validation

**Test 1.5.1 - Full Parity Check**
```
Execute:
1. runParityValidation(targetServiceId, sourceConfig, metadata)
2. Run all 5 checks

Expected Results:
┌─────────────────────────────────────┬─────────┬──────────────────────┐
│ Check                               │ Status  │ Details              │
├─────────────────────────────────────┼─────────┼──────────────────────┤
│ Web Access (HTTP/HTTPS)             │ PASS ✓  │ Website accessible   │
│ Database Access                     │ PASS ✓  │ Connected successfully│
│ Mail Authentication                 │ PASS ✓  │ Mailboxes accessible │
│ DNS Resolution                      │ PASS ✓  │ Resolves correctly   │
│ File Permissions                    │ PASS ✓  │ Permissions correct  │
└─────────────────────────────────────┴─────────┴──────────────────────┘

Overall Score: 100%

Verify: ✅ PASS (all checks pass)
```

**Test 1.5.2 - Specific Parity Checks**
```
Execute each:
1. Web Test:
   - GET http://testmig.example.com/ → 200 OK
   - GET https://testmig.example.com/ → 200 OK
   - Website loads, database queries work

2. Database Test:
   - Connect: mysql -u np_* -p np_*_db
   - Query: SELECT * FROM wp_posts → Returns rows
   - Database is queryable

3. Mail Test:
   - POP3: Connect, auth as info@testmig.example.com → Success
   - SMTP: Send test email → Delivered
   - Mailbox receives, sends

4. DNS Test:
   - nslookup testmig.example.com → Resolves correctly
   - MX record points to mail server
   - No NXDOMAIN errors

5. File Test:
   - Files in /home/np_*/ owned by np_*:np_*
   - Permissions: 755 dirs, 644 files
   - PHP executes correctly

Expected: All pass

Verify: ✅ ALL PASS
```

---

## Test Failure Procedures

### If Test Fails at Service Mapping (1.1)
```
Action:
1. Check for systemUsername collision
   - Query: SELECT systemUsername FROM hosting_services WHERE systemUsername = 'np_*'
   - If exists, adjust hash algorithm
2. Verify uniqueness in 100-service batch test
3. Check determinism: same source always maps to same ID

Resolution:
- Adjust hash seed/algorithm if needed
- Ensure no collisions before proceeding
```

### If Filesystem Transfer Fails (1.2)
```
Action:
1. Verify SSH connectivity
   - Test: ssh -v sshUser@host "echo test"
2. Verify rsync installed
   - Test: which rsync
3. Check target directory permissions
   - Test: ls -la /home/np_*/
4. Check source home accessibility
   - Test: ssh sshUser@host "ls -la ~/"

Resolution:
- Fix SSH config
- Install rsync if missing
- Adjust directory permissions
- Verify source user permissions
```

### If Database Import Fails (1.3)
```
Action:
1. Verify MySQL user exists
   - Query: SELECT User FROM mysql.user WHERE User = 'np_*_db'
2. Check privileges
   - Query: SHOW GRANTS FOR 'np_*_db'@'localhost'
3. Verify database was created
   - Query: SHOW DATABASES LIKE 'testuser_%'

Resolution:
- Create user if missing
- Grant ALL privileges
- Create database if missing
```

### If Parity Check Fails (1.5)
```
Action:
1. Check which specific check is failing
2. Debug specific component:
   - Web: curl -v https://testmig.example.com/
   - DB: mysql -u np_* -p -e 'SELECT 1'
   - Mail: telnet localhost 143 / 110
   - DNS: dig testmig.example.com
   - Files: ls -la /home/np_*/

Resolution:
- Fix component
- Re-run parity check
- Document any workarounds
```

---

## Rollback Procedures (TASK 1.6)

### Reversible Operations ✅
- Service creation (DELETE service, drop MySQL user, remove home directory)
- File transfers (rsync delete flag can reverse)
- Database imports (DROP DATABASE)
- Mailbox creation (DELETE mailbox)

### Irreversible Operations ⚠️ (NO ROLLBACK)
- SSH keys stored in migration job (would need manual cleanup)
- Source data modifications (if any were made)
- DNS changes (if NS changed at registrar)

### Full Rollback Procedure

**Step 1: Stop in-progress migration**
```bash
PATCH /migration/jobs/{jobId} { "status": "cancelled" }
```

**Step 2: Delete service (full cleanup)**
```bash
DELETE /hosting/services/{serviceId}
# Triggers:
# - Remove /home/np_*/
# - Drop MySQL user
# - Delete mailboxes
# - Remove DNS zone
```

**Step 3: Verify cleanup**
```bash
GET /migration/jobs/{jobId}/logs → Should show rollback operations
```

**Step 4: Document what failed**
```
Update MigrationJob:
- status: "rolled_back"
- failedStep: "step_name"
- rollbackIssues: ["any_issues"]
```

---

## Success Criteria

**ALL of the following must pass**:
- ✅ Service identity mapping is deterministic and collision-free
- ✅ Files transfer with verified checksums
- ✅ Databases import with correct table counts
- ✅ Mailboxes created and accessible
- ✅ DNS resolves correctly
- ✅ Parity validation passes 5/5 checks
- ✅ Rollback procedure documented and understood

**If ANY fails**:
- 🔴 STOP - Do not proceed to Phase 2
- 📋 Document failure
- 🔧 Fix root cause
- 🔁 Re-run test from failure point

---

## Test Execution Log

**Test Date**: TBD  
**Tester**: TBD  
**System**: TBD  

| # | Test | Status | Notes | Time |
|---|------|--------|-------|------|
| 1.1.1 | Deterministic Mapping | ⏳ PENDING | | |
| 1.1.2 | No Collisions | ⏳ PENDING | | |
| 1.1.3 | Idempotent Lookup | ⏳ PENDING | | |
| 1.2.1 | Pre-Migration Analysis | ⏳ PENDING | | |
| 1.2.2 | Dry-Run Rsync | ⏳ PENDING | | |
| 1.2.3 | Live File Transfer | ⏳ PENDING | | |
| 1.2.4 | Checksum Verification | ⏳ PENDING | | |
| 1.2.5 | Filesystem Validation | ⏳ PENDING | | |
| 1.3.1 | Database List | ⏳ PENDING | | |
| 1.3.2 | Pre-Migration Validation | ⏳ PENDING | | |
| 1.3.3 | Dump & Import Dry-Run | ⏳ PENDING | | |
| 1.3.4 | Live Database Import | ⏳ PENDING | | |
| 1.3.5 | Table Integrity | ⏳ PENDING | | |
| 1.3.6 | Service DB Access | ⏳ PENDING | | |
| 1.4.1 | Mailbox Validation | ⏳ PENDING | | |
| 1.4.2 | Mailbox Creation | ⏳ PENDING | | |
| 1.4.3 | DNS Zone Migration | ⏳ PENDING | | |
| 1.5.1 | Full Parity Check | ⏳ PENDING | | |
| 1.5.2 | Specific Parity Checks | ⏳ PENDING | | |

**Overall Status**: 🔄 Ready for Execution

---

## Notes

- All tests are designed to be repeatable
- Each test is independent (can be run in isolation)
- Dry-run support allows safe testing without data loss
- Parity checks are the final gate before declaring success
