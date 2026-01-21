# LOGGING ARCHITECTURE REVIEW

**Date**: January 23, 2026  
**Phase**: 3 Task 3.1  
**Purpose**: Audit current logging, identify gaps, plan observability  
**Status**: COMPLETE

---

## EXECUTIVE SUMMARY

NPanel has **3 distinct logging systems**:
1. ✅ **Migration Logs** (database) - Per-job detailed audit trail
2. ✅ **Hosting Operation Logs** (database) - Per-service infrastructure operations
3. ⚠️ **Governance/Audit Logs** (database) - Administrative actions (requires review)
4. ❌ **Application Logs** (missing centralized collection)
5. ❌ **System Logs** (file-based, no aggregation)

### Current State
- **Logs stored in**: MySQL/MariaDB (3 tables) + filesystem (per-service logs)
- **Log retention**: Database relies on admin cleanup (no automatic retention)
- **Log aggregation**: None (logs must be queried from DB directly)
- **Log security**: Not redacted in database (contains sensitive details)
- **Correlation**: No trace IDs or request IDs across services

### Critical Gaps
1. ❌ No centralized log collection (must query multiple tables)
2. ❌ No real-time log streaming
3. ❌ No log retention policy (database bloat risk)
4. ❌ No structured error context across microservices
5. ❌ No performance metrics in logs (latency, throughput)
6. ❌ Logs not survive admin account deletion (foreign key refs)

### Recommendations for Phase 3
- Implement correlation IDs across all logs
- Add automatic log retention (archive after 30 days, delete after 90)
- Plan for centralized log aggregation (Loki or ELK Stack)
- Add application health metrics to logs
- Redact sensitive fields (passwords, keys, tokens)

---

## 1. MIGRATION LOGGING SYSTEM

### 1.1 Database Schema

**Table**: `migration_logs`  
**Entity**: [MigrationLog](backend/src/migration/migration-log.entity.ts)

```typescript
@Entity({ name: 'migration_logs' })
export class MigrationLog {
  id: string;                    // UUID
  job: MigrationJob;             // FK reference
  account: MigrationAccount;     // FK reference (nullable)
  level: 'info' | 'warning' | 'error';
  message: string;
  context: Record<string, any>;  // JSON - can contain sensitive data
  createdAt: Date;               // Auto-timestamp
}
```

### 1.2 What Gets Logged

**Source**: [MigrationService.appendLog()](backend/src/migration/migration.service.ts#L1272)

```typescript
async appendLog(
  job: MigrationJob,
  account: MigrationAccount | null,
  level: 'info' | 'warning' | 'error',
  message: string,
  context?: Record<string, any>,
): Promise<MigrationLog>
```

**Events logged**:
- ✅ Job start/completion
- ✅ Per-account progress (connected, syncing, completed, failed)
- ✅ SSH connection attempts
- ✅ Database sync status
- ✅ Email configuration
- ✅ DNS verification
- ✅ Errors with full stack traces

**Example entry**:
```json
{
  "level": "error",
  "message": "SSH connection failed for account customer-1",
  "context": {
    "accountId": "uuid-123",
    "email": "customer@example.com",
    "sshError": "Connection refused on 192.168.1.100:22",
    "returnCode": 255
  },
  "createdAt": "2026-01-23T10:30:45Z"
}
```

### 1.3 Retention & Cleanup

**Current behavior**:
- ❌ No automatic cleanup
- ❌ No retention policy
- ❌ Logs accumulate indefinitely
- ❌ No archival process

**Risk**: Database table grows unbounded, query performance degrades

**Frontend access**: [Admin Metrics Page](frontend/src/app/admin/metrics/page.tsx) + [Customer Migrations Page](frontend/src/app/customer/migrations/page.tsx)

---

## 2. HOSTING OPERATION LOGGING SYSTEM

### 2.1 Database Schema

**Table**: `host_logs`  
**Entity**: [HostingLog](backend/src/hosting/hosting-log.entity.ts)

```typescript
@Entity({ name: 'host_logs' })
export class HostingLog {
  id: string;                          // UUID
  serviceId: string;                   // Hosting service
  adapter: string;                     // DNS, Mail, Web Server, etc.
  operation: string;                   // create, update, delete, read
  targetKind: string;                  // domain, mailbox, record, etc.
  targetKey: string;                   // identifier
  success: boolean;                    // operation result
  dryRun: boolean;                     // was this a dry run?
  details: Record<string, unknown>;    // JSON - operation details
  errorMessage: string | null;         // if failed
  createdAt: Date;                     // Auto-timestamp
}
```

### 2.2 What Gets Logged

**Logged by**: [HostingService](backend/src/hosting/hosting.service.ts) via adapter callbacks

**Operations tracked**:
- ✅ DNS records (create, update, delete, sync)
- ✅ Mail accounts (create, update, delete)
- ✅ Email routing (add, remove, verify)
- ✅ Web server config (create, update, delete, reload)
- ✅ SSL certificates (request, renew, deploy)
- ✅ Service health checks
- ✅ Dry-run validations

**Example entry**:
```json
{
  "adapter": "dns",
  "operation": "create_record",
  "targetKind": "dns_record",
  "targetKey": "example.com:A",
  "success": true,
  "dryRun": false,
  "details": {
    "record_type": "A",
    "value": "192.0.2.1",
    "ttl": 3600
  },
  "createdAt": "2026-01-23T10:30:45Z"
}
```

### 2.3 Retention & Cleanup

**Current behavior**:
- ❌ No automatic cleanup
- ❌ No retention policy
- ⚠️ Logs tied to customer via service reference (deleting customer can orphan logs)

**Risk**: 
- Database bloat over time
- Orphaned records if customers deleted
- No audit trail after deletion (security issue)

**Frontend access**: [Admin Logs Page](frontend/src/app/admin/logs/page.tsx)

---

## 3. GOVERNANCE/AUDIT LOGGING SYSTEM

### 3.1 Database Schema

**Table**: `action_intents` + `audit_logs`  
**Service**: [GovernanceService](backend/src/governance/governance.service.ts)

```typescript
// Administrative action intentions
@Entity({ name: 'action_intents' })
export class ActionIntentEntity {
  id: string;                      // UUID
  module: string;                  // iam, hosting, dns, etc.
  action: string;                  // logout_all, restart_service, etc.
  targetKind: string;              // user, service, config
  targetKey: string;               // identifier
  risk: 'Low' | 'Medium' | 'High';
  reversibility: string;           // reversible, requires_restore, irreversible
  payload: string;                 // Encrypted JSON
  actor: GovernanceActor;          // Who initiated
  expiresAt: Date;                 // Confirmation window
  status: 'PENDING' | 'CONFIRMED' | 'EXECUTED' | 'CANCELLED';
  createdAt: Date;
}

// Audit trail of confirmations
@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  id: string;                      // UUID
  intent: ActionIntentEntity;      // FK reference
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  steps: ActionStep[];             // Execution steps
  actor: GovernanceActor;          // Who confirmed
  result: string;                  // Encrypted JSON result
  errorMessage: string | null;
  executedAt: Date;
}
```

### 3.2 What Gets Logged

**Critical administrative actions**:
- ✅ User logout (all sessions)
- ✅ Password changes
- ✅ Service restarts
- ✅ System configuration changes
- ✅ Account deletions (with multi-step confirmation)
- ✅ Emergency procedures

**Example entry**:
```json
{
  "module": "iam",
  "action": "logout_all",
  "targetKind": "user",
  "targetKey": "admin-uuid-1",
  "risk": "Medium",
  "actor": {
    "actorId": "admin-1",
    "actorRole": "ADMIN",
    "reason": "Security incident response"
  },
  "status": "EXECUTED",
  "executedAt": "2026-01-23T10:30:45Z"
}
```

### 3.3 Retention & Cleanup

**Current behavior**:
- ✅ Records are encrypted (security)
- ⚠️ No automatic cleanup
- ⚠️ Deleting associated entity cascades to logs (audit trail loss)

**Risk**:
- Audit trail deleted when user deleted (compliance violation)
- No long-term retention for forensics

---

## 4. APPLICATION LOGS (SYSTEM)

### 4.1 Current State

**Backend logging**:
- ✅ NestJS Logger available in all services
- ⚠️ Some services use `console.error/warn/log` instead of Logger
- ❌ No centralized collection
- ❌ No correlation IDs

**Locations**:
- Standard output (stdout/stderr)
- Docker container logs
- Optionally: `/var/log/npanel.log` (if configured)

**Frontend logging**:
- Browser DevTools console (development)
- No persistent application logs
- Error boundary logs to console (Next.js standard)

### 4.2 Console Logging Issues (From Phase 2)

**Currently using console.* instead of Logger**:

1. **tools.controller.ts** (Line 133)
   - `console.error('Failed to get disk usage', e)`
   - Status: ⚠️ Needs migration to Logger

2. **migration.service.ts** (Line 473)
   - `console.error('Background migration failed', err)`
   - Status: ⚠️ Needs migration to Logger

3. **hosting.service.ts** (Line 2032)
   - `console.log(JSON.stringify(payload))`
   - Status: ⚠️ Debug flag, needs migration to Logger.debug()

4. **hosting.service.ts** (Line 2117)
   - `console.warn('Failed to read /proc/mounts', e)`
   - Status: ⚠️ Needs migration to Logger

5. **dns.controller.ts** (Line 45)
   - `console.log('[DNS] operation result')`
   - Status: ⚠️ Needs migration to Logger.debug()

### 4.3 Main Entry Point

**File**: [backend/src/main.ts](backend/src/main.ts)

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ... setup ...
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void (async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error('Bootstrap error:', error);  // ⚠️ Should use Logger
    process.exit(1);
  }
})();
```

---

## 5. LOG ACCESS & VISIBILITY

### 5.1 Admin UI

**Migration logs**: [Admin Metrics Page](frontend/src/app/admin/metrics/page.tsx)
- Shows migration_logs table
- Displays: timestamp, level, message
- Sortable by time and level

**Hosting logs**: [Admin Logs Page](frontend/src/app/admin/logs/page.tsx)
- Shows host_logs table
- Displays: timestamp, adapter, operation, target, success/error
- Can select from available log files

**Features**:
- ✅ Real-time querying
- ⚠️ No filtering by severity
- ⚠️ No search capability
- ⚠️ No export functionality
- ❌ No log aggregation across tables

### 5.2 Log File Access

**Endpoint**: [GET /system/tools/logs/files](backend/src/system/tools.controller.ts#L339)

```typescript
async getLogFiles() {
  const candidates = [
    '/var/log/npanel.log',
    '/var/log/npanel-dns.log',
    '/var/log/npanel-mail.log',
  ];
  // Returns list of available files
}
```

**Status**:
- ⚠️ Hardcoded paths (not configurable)
- ⚠️ No rotation policy
- ❌ No aggregation endpoint

---

## 6. SENSITIVE DATA IN LOGS

### 6.1 Risk Assessment

**Potentially logged secrets**:

| Data Type | Current State | Risk |
|-----------|---|---|
| **Passwords** | ❌ Logged in migration context | HIGH |
| **SSH keys** | ⚠️ May appear in error messages | MEDIUM |
| **API tokens** | ⚠️ May appear in config context | MEDIUM |
| **Database passwords** | ⚠️ May appear in connection errors | MEDIUM |
| **Email credentials** | ✅ Sanitized in MigrationService | LOW |
| **Customer data** | ⚠️ Email addresses logged | LOW |
| **Admin actions** | ✅ Encrypted in audit logs | LOW |

### 6.2 Mitigation: Sanitization

**MigrationService.sanitizeLogContext()**:

```typescript
private sanitizeLogContext(context: any): any {
  if (!context) return null;
  
  // Remove sensitive fields
  const sanitized = { ...context };
  const sensitiveKeys = [
    'password', 'passwordHash', 'token', 'apiKey',
    'secret', 'privateKey', 'credentials', 'auth'
  ];
  
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}
```

**Status**: 
- ✅ Applied to migration logs
- ❌ Not applied to hosting operation logs
- ❌ Not applied to console output

---

## 7. CRITICAL GAPS & RISKS

### 7.1 No Log Retention Policy

**Current state**:
- ✅ Logs persist forever
- ❌ No automatic cleanup
- ❌ No archival

**Risk**: Database bloat after 1-2 years
- `migration_logs`: ~10KB per job × 1000 jobs/month = 120 MB/year
- `host_logs`: ~2KB per operation × 10000 ops/day = 7.3 GB/year

**Impact**: Query performance degradation, increased backup size

### 7.2 Logs Deleted with Customers

**Foreign key structure**:
```
migration_logs.job → migration_jobs.id
  migration_jobs.account → migration_accounts.id
    migration_accounts.customer → customers.id
```

**Risk**: Deleting customer cascades to delete all migration history
- **Compliance issue**: GDPR requires audit trail survival
- **Forensic issue**: Cannot investigate post-deletion

**Same for**: `host_logs` → services → customers

### 7.3 No Correlation IDs

**Current state**:
- Each log entry isolated
- ❌ Cannot trace request through system
- ❌ Cannot correlate frontend → backend → database

**Example problem**:
```
User reports: "My migration failed"
Admin checks logs, finds:
  - Migration log: "SSH failed"
  - Hosting log: "Service timeout"
  - Admin log: Missing context
→ Cannot determine root cause without manual correlation
```

### 7.4 No Real-Time Alerting

**Current state**:
- Logs stored in DB
- ❌ No streaming
- ❌ No event bus
- ❌ No alert triggers

**Risk**: Operators must manually poll logs for issues

### 7.5 No Application Health Metrics

**Missing metrics**:
- ❌ Request latency (p50, p95, p99)
- ❌ Error rates by endpoint
- ❌ Throughput (requests/sec)
- ❌ Database query times
- ❌ Memory usage trends
- ❌ Migration success rates

---

## 8. REQUIRED IMPROVEMENTS (PHASE 3)

### 8.1 Immediate Actions

**Before production**:

1. **Add correlation IDs to all logs** (4 hours)
   - Generate UUID per request
   - Include in all database logs
   - Pass through async operations

2. **Implement log retention policy** (3 hours)
   - Archive logs after 30 days
   - Delete after 90 days
   - Make policy configurable

3. **Fix console logging** (2 hours)
   - Replace console.* with Logger service
   - Ensure all logs route to centralized system

4. **Redact sensitive fields** (2 hours)
   - Apply sanitization to hosting logs
   - Add field masking for secrets
   - Document what gets redacted

### 8.2 Short-Term (Week 1)

1. **Preserve logs on account deletion** (6 hours)
   - Remove cascade delete on customer
   - Add "deleted_customer_id" field
   - Keep audit trail intact

2. **Add search/filter to admin UI** (4 hours)
   - Filter by level, adapter, status
   - Search by message text
   - Date range picker

3. **Implement log export** (3 hours)
   - CSV export from admin UI
   - Configurable date range
   - Fields to include

### 8.3 Medium-Term (Week 2-3)

1. **Deploy centralized logging** (16 hours)
   - Loki or ELK Stack deployment
   - Structured log forwarding
   - Real-time dashboard

2. **Add health metrics** (8 hours)
   - Instrument endpoints with timers
   - Track error rates
   - Export to Prometheus

3. **Implement alerting** (8 hours)
   - Alert on error spikes
   - Migration failures
   - Service health degradation

---

## 9. SUMMARY TABLE

| Component | Current | Gap | Priority |
|-----------|---------|-----|----------|
| **Migration Logs** | ✅ DB-based | No retention, no correlation | HIGH |
| **Hosting Logs** | ✅ DB-based | No redaction, no retention | HIGH |
| **Audit Logs** | ✅ Encrypted | No survival on delete | HIGH |
| **App Logs** | ⚠️ Console | No aggregation, mixed logging | MEDIUM |
| **Correlation** | ❌ Missing | No trace IDs | HIGH |
| **Retention** | ❌ None | Infinite growth | HIGH |
| **Alerting** | ❌ Missing | Manual polling | MEDIUM |
| **Metrics** | ❌ Missing | No visibility | MEDIUM |
| **Search/Filter** | ⚠️ Limited | No advanced queries | LOW |
| **Export** | ❌ Missing | No data extraction | LOW |

---

## 10. NEXT STEPS

**Task 3.2**: Define centralized logging strategy
- Log aggregation platform choice
- Required fields and structure
- Retention and archival policy
- Alert rules and thresholds

**Task 3.3**: Metrics and health signals
- Core metrics to collect
- Service uptime checks
- Migration progress indicators
- Performance baselines

**Task 3.4**: Day-2 operations runbook
- Common failure scenarios
- Recovery procedures
- Log query examples
- Troubleshooting guide

---

**Audit Complete**: January 23, 2026  
**Status**: READY FOR CENTRALIZED LOGGING STRATEGY (Task 3.2)  
**Blocker**: None - proceed to next task
