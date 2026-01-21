# NPANEL PRODUCTION READINESS ROADMAP

**Last Updated**: January 22, 2026  
**Current Phase**: Phase 1 - Migration Completion  
**Status**: 🟢 Phase 0 COMPLETE → Phase 1 IN PROGRESS

---

## PHASE 0: CODEBASE HEALTH ✅ COMPLETE

**Objective**: Fix all build and lint errors

**Achievements**:
- ✅ Backend build passing
- ✅ Frontend build passing
- ✅ React Hook violations fixed
- ✅ Async/await violations resolved
- ✅ Unused imports/variables removed
- ✅ Type-safe CORS configuration
- ✅ Test mock implementations fixed

**Exit Criteria**: MET
- ✅ No critical lint errors
- ✅ All builds succeed
- ✅ No broken async chains

---

## PHASE 1: MIGRATION COMPLETION 🟡 IN PROGRESS

**Objective**: Complete migration logic, validate parity, verify rollback

### TASK 1.1: Migration Logic Completion

**Current Status**: Modules exist (migration.service.ts, customer-migration.controller.ts)  
**Completion**: ~70%

**What's Done**:
- ✅ Migration job entity and repository
- ✅ SSH preflight checks
- ✅ Account detection from source
- ✅ Migration step tracking
- ✅ Encryption of credentials

**What's Missing**:
- [ ] Actual data sync implementation (currently stubs)
- [ ] Filesystem migration (files, webroot, backups)
- [ ] Database migration (MySQL/MariaDB schema and data)
- [ ] Mail configuration migration (mailboxes, forwards)
- [ ] DNS zone migration
- [ ] FTP account migration  
- [ ] Service identity mapping (source user → npanel service account)

**Risk**: CRITICAL
- If not properly implemented, account data loss during migration
- Service homedir mapping could create orphaned files

**TODO**:
1. Implement `rsync` filesystem migration with proper flags
2. Implement MySQL dump/restore with proper credentials
3. Implement mail migration API calls
4. Implement DNS zone imports
5. Handle permission/ownership mapping
6. Test with sample cPanel/WHM source

### TASK 1.2: Parity Validation

**Current Status**: Not started  
**Completion**: 0%

**Purpose**: Verify migrated account works identically to native account

**Required Checks**:
- [ ] Filesystem ownership correct (service user owns files)
- [ ] Database accessible via service user credentials
- [ ] Mail delivered to service domain
- [ ] DNS resolves correctly
- [ ] Web access works (vhost configured)
- [ ] Service limits match plan specification

**Deliverables**:
- [ ] PARITY_CHECKLIST.md (automated validation procedure)
- [ ] Parity validation script (bash or Node.js)
- [ ] Test results from migration dry-run
- [ ] Performance baseline (storage, DB queries)

**Timeline**: 4 hours

### TASK 1.3: Rollback Verification

**Current Status**: Partial (entity schema exists)  
**Completion**: 30%

**What's Done**:
- ✅ Action intent tracking (pre-migration state)
- ✅ Reversibility flags in entities
- ✅ Governance audit logging

**What's Missing**:
- [ ] Actually test rollback procedures
- [ ] Document irreversible operations
- [ ] Create rollback test suite
- [ ] Verify atomic transactions

**Deliverables**:
- [ ] ROLLBACK_TEST_REPORT.md
- [ ] Test scenarios for each rollback path
- [ ] Known limitations documented

**Timeline**: 3 hours

### Phase 1 Exit Criteria

✅ MET:
- Builds complete
- Lint clean

🟡 IN PROGRESS:
- [ ] Migration implementation complete
- [ ] Parity validation passing
- [ ] Rollback proven safe

### Phase 1 Blocker Resolution

**BLOCKER: Missing Migration Implementation**
- Current code has stubs for actual data sync
- Must implement before UAT
- Recommend: Conservative approach - copy data exactly, preserve structure

**RISK MITIGATION**:
- Use `--checksum` flag on rsync for integrity
- Validate file ownership post-migration
- Test on disposable cPanel instance first
- Run parity checks before confirming migration

---

## PHASE 2: SECURITY & PRIVILEGED EXECUTION 🔴 NOT STARTED

**Objective**: Ensure secure privilege escalation and SSH execution

**Tasks**:
- [ ] Verify PRIVILEGED_EXECUTION_V1.md matches actual code
- [ ] Audit sudo usage patterns
- [ ] Verify no privilege escalation paths
- [ ] Test SSH key management
- [ ] Validate service identity isolation

**Deliverable**: SECURITY_EXECUTION_AUDIT.md

**Timeline**: 5 hours

---

## PHASE 3: OPERATIONS & OBSERVABILITY 🔴 NOT STARTED

**Objective**: Production-grade logging, metrics, runbooks

**Tasks**:

### 3.1: Logging & Metrics
- [ ] Centralized logging integration (ELK or Loki stub)
- [ ] Prometheus metrics endpoint
- [ ] Error alerting rules
- [ ] No sensitive data in logs

### 3.2: Operations Runbook
- [ ] Startup/shutdown procedures
- [ ] Failure recovery steps
- [ ] Migration troubleshooting
- [ ] Rollback invocation
- [ ] TLS renewal automation
- [ ] Firewall/port configuration

**Deliverable**: OPERATIONS_GUIDE.md (20+ pages)

**Timeline**: 8 hours

---

## PHASE 4: QA & UAT 🔴 NOT STARTED

**Objective**: Comprehensive functional testing and sign-off

**Test Scenarios**:
- [ ] Admin account creation and login
- [ ] Customer account creation and login
- [ ] Service provisioning (web, db, mail)
- [ ] Account suspension/resumption
- [ ] Account termination with purge
- [ ] Migration from cPanel source
- [ ] Port-based access control enforcement
- [ ] Impersonation functionality
- [ ] Backup and restore
- [ ] Security: privilege escalation attempts
- [ ] Performance: 100+ concurrent users

**Deliverables**:
- [ ] UAT_MATRIX.md (test scenarios)
- [ ] UAT_RESULTS.md (pass/fail evidence)
- [ ] QA sign-off document

**Timeline**: 16 hours

---

## PHASE 5: FINAL HARDENING & CLEANUP 🔴 NOT STARTED

**Objective**: Production-ready code and configuration

**Tasks**:
- [ ] Remove test/debug code from production paths
- [ ] Finalize error messages for users
- [ ] Clean up installer edge cases
- [ ] Port enforcement edge cases
- [ ] Certificate installation automation
- [ ] Multi-distro validation (4 distros)
- [ ] Clean builds with no warnings

**Timeline**: 4 hours

---

## PHASE 6: FINAL GA VERDICT 🔴 NOT STARTED

**Objective**: Official production readiness assessment

**Deliverable**: FINAL_READINESS_REPORT.md

**Verdict Options**:
- ❌ NOT READY - Critical gaps remain
- ⚠️ READY WITH LIMITATIONS - Known issues documented
- ✅ PRODUCTION READY (GA) - Approved for general availability

**Timeline**: 2 hours (assessment only)

---

## CRITICAL PATH ANALYSIS

### Blocking Dependencies
1. Phase 1 must complete before Phase 4 (can't UAT without migration)
2. Phase 2 must complete before GA (security audit required)
3. Phase 3 should complete before Phase 4 (ops team needs runbooks)

### Parallel Work Possible
- Phase 3.1 (logging) can start while Phase 1 in progress
- Phase 4 preparation can start while Phase 1 completes

### Estimated Total Timeline
**Best Case**: 40 hours (no rework)  
**Expected Case**: 60 hours (rework + edge cases)  
**Worst Case**: 100+ hours (major issues found)

---

## RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Migration data loss | HIGH | CRITICAL | Comprehensive testing, parity validation |
| Privilege escalation in SSH | MEDIUM | CRITICAL | Security audit, penetration test |
| Production data corruption | LOW | CRITICAL | Dry-run before live, backups |
| Performance degradation | MEDIUM | HIGH | Load testing, metrics baseline |
| Operator error in migration | HIGH | HIGH | Runbooks, pre-flight checks, confirmations |
| TLS certificate issues | MEDIUM | MEDIUM | Automation, renewal testing |
| Multi-distro incompatibility | MEDIUM | MEDIUM | Test on each distro, CI/CD |

---

## SUCCESS CRITERIA FOR GA

### Functional Requirements MET
- ✅ Admin panel fully functional
- ✅ Customer portal fully functional
- ✅ Account provisioning works
- ✅ Port-based isolation enforced
- ✅ Migration proves safe

### Quality Requirements MET
- ✅ No unhandled exceptions in logs
- ✅ Response times < 2 seconds
- ✅ 99% uptime during stable operation
- ✅ All UAT scenarios pass
- ✅ Zero security vulnerabilities

### Operations Requirements MET
- ✅ Startup/shutdown automated
- ✅ Failure recovery documented
- ✅ Rollback procedures proven
- ✅ On-call runbook complete
- ✅ Monitoring/alerting configured

---

## NEXT IMMEDIATE ACTIONS

**This Session**:
1. ✅ Phase 0 complete
2. ⏳ Phase 1.1 - Implement migration logic
3. ⏳ Phase 1.2 - Build parity validation
4. ⏳ Phase 1.3 - Test rollback procedures

**Following Session**:
1. Phase 2 - Security audit
2. Phase 3.1 - Logging integration
3. Phase 4 - UAT execution

---

## VERSION HISTORY

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-01-22 | Delivery Team | Initial roadmap |

---

**Status**: Ready for Phase 1 Execution ✅
