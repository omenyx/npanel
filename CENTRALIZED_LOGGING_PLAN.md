# CENTRALIZED LOGGING PLAN

**Date**: January 23, 2026  
**Phase**: 3 Task 3.2  
**Purpose**: Define logging strategy for production scale  
**Status**: COMPLETE

---

## EXECUTIVE SUMMARY

**Recommendation**: Deploy **Grafana Loki** as primary log aggregation platform.

**Why Loki**:
- ✅ Lightweight (no indexing overhead like ELK)
- ✅ Great for high-cardinality labels (tenant_id, service, operation)
- ✅ Cheap storage (compressed by default)
- ✅ Native Grafana integration (visualization)
- ✅ Perfect for structured logs from multiple services
- ✅ Low operational complexity

**Architecture**:
```
NPanel Backend (structured logs)
         ↓
  Promtail (log collector)
         ↓
  Loki (log aggregator + storage)
         ↓
  Grafana (dashboard + alerting)
```

**Cost**: ~$50-100/month for small deployments (managed), ~$5/month self-hosted

---

## 1. LOGGING PRINCIPLES

### 1.1 Structured Logging Standard

All logs must follow this JSON structure:

```json
{
  "timestamp": "2026-01-23T10:30:45.123Z",
  "level": "error",
  "service": "migration-service",
  "message": "SSH connection failed",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "correlation_id": "550e8400-e29b-41d4-a716-446655440001",
  "request_id": "550e8400-e29b-41d4-a716-446655440002",
  "tenant_id": "customer-123",
  "operation": "ssh_connect",
  "actor_id": "admin-1",
  "actor_role": "ADMIN",
  "duration_ms": 2500,
  "status": "failed",
  "error_code": "SSH_CONNECTION_REFUSED",
  "error_message": "Connection refused",
  "context": {
    "host": "192.168.1.100",
    "port": 22,
    "ssh_user": "root",
    "attempts": 3
  },
  "tags": ["ssh", "migration", "critical"]
}
```

### 1.2 Log Levels

| Level | When to use | Examples |
|-------|------------|----------|
| **ERROR** | Operation failed, needs intervention | SSH connection failed, database error, validation failed |
| **WARN** | Degraded mode, recovered automatically | Retry attempt #2, fallback to secondary DNS |
| **INFO** | Normal operations, state changes | Job completed, migration started, service deployed |
| **DEBUG** | Detailed flow for troubleshooting | Request body, response headers, SQL queries |

**Production rule**: Minimum level = INFO (DEBUG disabled by default)

### 1.3 Cardinality Limits

**Required labels** (low cardinality):
- `service`: migration, hosting, dns, mail, iam, health (~10 values)
- `level`: error, warn, info, debug (4 values)
- `operation`: user_login, job_start, ssh_connect, etc. (~50 values)
- `status`: success, failed, timeout, retrying (5 values)

**High-cardinality fields** (put in context JSON, not labels):
- `trace_id` - unique per request
- `tenant_id` - one per customer
- `user_id` - one per user
- `host` - IP address

**Why**: Loki stores labels in memory. Too many unique values = memory explosion.

---

## 2. CORRELATION IDS

### 2.1 Three-Tier ID System

**1. Trace ID** (request-level)
- Generated at entry point (middleware)
- Stays same across all services called in one request
- Used for root-cause analysis

**2. Correlation ID** (business-level)
- Generated for multi-step operations (migrations, workflows)
- Spans multiple requests
- Used to follow a business transaction

**3. Request ID** (implementation-level)
- Unique per HTTP request
- Helps debug individual requests
- Short-lived

**Example flow**:
```
User initiates migration
  → trace_id = UUID-1
  → correlation_id = UUID-2

Request 1: POST /v1/migrations/start
  → request_id = UUID-3
  → trace_id = UUID-1, correlation_id = UUID-2

Background job processes
  → request_id = UUID-4 (internal)
  → trace_id = UUID-1, correlation_id = UUID-2

Admin queries logs
  → Filters: correlation_id = UUID-2
  → Sees all related entries across all services
```

### 2.2 Implementation

**Generate IDs at middleware** (frontend + backend):

```typescript
// backend/src/middleware/logging.middleware.ts (NEW)

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      correlationId?: string;
      requestId?: string;
    }
  }
}

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Preserve trace ID if it came from frontend
    req.traceId = req.get('x-trace-id') || uuid();
    
    // Preserve correlation ID if it exists
    req.correlationId = req.get('x-correlation-id');
    
    // Always generate request ID
    req.requestId = uuid();
    
    // Set response headers for client
    res.setHeader('x-trace-id', req.traceId);
    if (req.correlationId) {
      res.setHeader('x-correlation-id', req.correlationId);
    }
    
    next();
  }
}
```

**Pass IDs to logger** (in all services):

```typescript
// Example: iam.service.ts

import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class IamService {
  private readonly logger = new Logger(IamService.name);
  
  async login(email: string, password: string, req?: Request) {
    const traceId = req?.traceId;
    const requestId = req?.requestId;
    
    this.logger.debug(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'debug',
        service: 'iam-service',
        operation: 'login_attempt',
        trace_id: traceId,
        request_id: requestId,
        message: `Login attempt for ${email}`,
        actor_id: email,
      })
    );
    
    // ... validation ...
    
    if (!user) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'iam-service',
          operation: 'login_attempt',
          trace_id: traceId,
          request_id: requestId,
          status: 'failed',
          error_code: 'INVALID_CREDENTIALS',
          message: `Failed login attempt for ${email}`,
        })
      );
    }
  }
}
```

---

## 3. REQUIRED LOG FIELDS

### 3.1 Mandatory Fields (always include)

```json
{
  "timestamp": "ISO 8601 datetime with milliseconds",
  "level": "error | warn | info | debug",
  "service": "service name",
  "operation": "action being performed",
  "trace_id": "UUID - unique per request",
  "message": "human-readable message"
}
```

### 3.2 Context Fields (when applicable)

```json
{
  "correlation_id": "UUID - for multi-step operations",
  "request_id": "UUID - unique per HTTP request",
  "tenant_id": "customer UUID",
  "user_id": "admin/user UUID",
  "actor_id": "who initiated the action",
  "actor_role": "ADMIN | CUSTOMER | SUPPORT",
  "duration_ms": "execution time in milliseconds",
  "status": "success | failed | timeout | partial",
  "error_code": "semantic error identifier",
  "error_message": "error details",
  "tags": ["string array for categorization"]
}
```

### 3.3 Context Details (flexible JSON)

```json
{
  "context": {
    "ssh_host": "192.168.1.100",
    "ssh_port": 22,
    "ssh_user": "root",
    "ssh_key_fingerprint": "[REDACTED]",
    "database_host": "[REDACTED]",
    "connection_attempts": 3,
    "retry_delay_ms": 5000,
    "account_email": "customer@example.com"
  }
}
```

**Rule**: Never log unencrypted passwords, API keys, or tokens. Use `[REDACTED]` instead.

---

## 4. LOG AGGREGATION: LOKI SETUP

### 4.1 Architecture

```
┌─────────────────────────────────────────────────┐
│ NPanel Application                              │
├─────────────────────────────────────────────────┤
│ • Backend (NestJS) - logs to stdout/file       │
│ • Migration Service - structured JSON logs     │
│ • Hosting Service - operation logs             │
└─────────────┬───────────────────────────────────┘
              │ (JSON lines)
              ↓
┌─────────────────────────────────────────────────┐
│ Promtail (Log Collector)                        │
├─────────────────────────────────────────────────┤
│ • Reads log files or stdout                    │
│ • Parses JSON structure                        │
│ • Extracts labels (service, level, operation) │
│ • Sends to Loki                                │
└─────────────┬───────────────────────────────────┘
              │ (HTTP)
              ↓
┌─────────────────────────────────────────────────┐
│ Loki (Log Aggregator)                           │
├─────────────────────────────────────────────────┤
│ • Stores compressed logs                       │
│ • Indexes by labels (fast queries)             │
│ • API for log retrieval                        │
│ • 30-day retention (configurable)              │
└─────────────┬───────────────────────────────────┘
              │ (gRPC)
              ↓
┌─────────────────────────────────────────────────┐
│ Grafana                                         │
├─────────────────────────────────────────────────┤
│ • Dashboard: real-time log streams             │
│ • Alerting: rules on error patterns            │
│ • Logs UI: search, filter, drill-down          │
└─────────────────────────────────────────────────┘
```

### 4.2 Deployment

**Option 1: Self-hosted (Recommended for Phase 3)**

```bash
# docker-compose.yml

services:
  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yml

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - /var/log/npanel:/var/log/npanel
      - ./promtail-config.yml:/etc/promtail/config.yml
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock
    command: -config.file=/etc/promtail/config.yml

  grafana:
    image: grafana/grafana:10.2.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  loki-data:
  grafana-data:
```

**Option 2: Managed (Grafana Cloud)**
- Signup at grafana.com
- Get API endpoint and credentials
- Point Promtail to managed Loki
- Cost: ~$50-100/month for standard tier

### 4.3 Loki Configuration

**File**: `loki-config.yml`

```yaml
auth_enabled: false

ingester:
  chunk_idle_period: 5m
  max_chunk_age: 1h
  chunk_retain_period: 1m

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  ingestion_rate_mb: 100
  ingestion_burst_size_mb: 200

schema_config:
  configs:
    - from: 2026-01-23
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

retention_config:
  enabled: true
  retention_deletes_enabled: true
  retention_period: 720h  # 30 days
```

### 4.4 Promtail Configuration

**File**: `promtail-config.yml`

```yaml
clients:
  - url: http://loki:3100/loki/api/v1/push

positions:
  filename: /tmp/positions.yaml

scrape_configs:
  - job_name: npanel-app
    static_configs:
      - targets:
          - localhost
        labels:
          service: npanel
          job: app
    pipeline_stages:
      - json:
          expressions:
            timestamp: timestamp
            level: level
            service: service
            operation: operation
            trace_id: trace_id
            message: message
      - labels:
          level:
          service:
          operation:
      - timestamp:
          source: timestamp
          format: 2006-01-02T15:04:05.999Z07:00
      - output:
          source: message
```

---

## 5. LOG RETENTION & CLEANUP

### 5.1 Retention Policy

| Log Type | Retention | Archive | Deletion |
|----------|-----------|---------|----------|
| **Migration logs** | 30 days hot | After 30d | After 90d |
| **Hosting logs** | 30 days hot | After 30d | After 90d |
| **Audit logs** | 90 days hot | After 90d | After 365d |
| **Application logs** | 14 days hot | After 14d | After 30d |

### 5.2 Cleanup Job

**Implementation**: Scheduled task in NestJS

```typescript
// backend/src/system/log-cleanup.service.ts (NEW)

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { MigrationLog } from '../migration/migration-log.entity';
import { HostingLog } from '../hosting/hosting-log.entity';
import { AuditLogEntity } from '../governance/audit-log.entity';

@Injectable()
export class LogCleanupService {
  private readonly logger = new Logger(LogCleanupService.name);

  constructor(
    @InjectRepository(MigrationLog)
    private readonly migrationLogs: Repository<MigrationLog>,
    @InjectRepository(HostingLog)
    private readonly hostingLogs: Repository<HostingLog>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldLogs() {
    this.logger.log('Starting daily log cleanup');

    try {
      // Migration logs: delete after 90 days
      const migrationCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const migDeleted = await this.migrationLogs.delete({
        createdAt: LessThan(migrationCutoff),
      });
      this.logger.log(`Deleted ${migDeleted.affected} old migration logs`);

      // Hosting logs: delete after 90 days
      const hostingCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const hostDeleted = await this.hostingLogs.delete({
        createdAt: LessThan(hostingCutoff),
      });
      this.logger.log(`Deleted ${hostDeleted.affected} old hosting logs`);

      // Audit logs: delete after 365 days
      const auditCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const auditDeleted = await this.auditLogs.delete({
        executedAt: LessThan(auditCutoff),
      });
      this.logger.log(`Deleted ${auditDeleted.affected} old audit logs`);
    } catch (error) {
      this.logger.error(
        `Log cleanup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
```

### 5.3 Archive Strategy

**For compliance**: Before deletion, archive to cold storage

```typescript
// Pseudocode
@Cron('0 0 1 * *')  // Monthly
async archiveOldLogs() {
  const archiveCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  // Export to CSV/JSON
  const logs = await this.migrationLogs.find({
    where: { createdAt: LessThan(archiveCutoff) }
  });
  
  // Compress
  const csv = this.toCSV(logs);
  const compressed = await gzip(csv);
  
  // Upload to S3/blob storage
  await storage.upload(
    `logs/migration/${archiveCutoff.toISOString()}.csv.gz`,
    compressed
  );
  
  // Cleanup
  await this.migrationLogs.delete({
    createdAt: LessThan(archiveCutoff)
  });
}
```

---

## 6. SEARCH & QUERY EXAMPLES

### 6.1 Loki Query Language (LogQL)

**Find all errors in migration service**:
```
{service="migration", level="error"} 
```

**Find errors for specific customer**:
```
{service="migration"} | json | customer_id="550e8400-e29b-41d4-a716-446655440001"
```

**Find slow operations (>5 seconds)**:
```
{service="hosting", operation="dns_sync"} | json | duration_ms > 5000
```

**Count errors by operation type**:
```
sum by (operation) (count_over_time({level="error"}[5m]))
```

**Find all logs for a trace**:
```
{trace_id="550e8400-e29b-41d4-a716-446655440000"}
```

### 6.2 Admin UI Integration (Grafana)

**Dashboard panels**:

1. **Error Rate** (last 24 hours)
   ```
   rate(count_over_time({level="error"}[1m]))
   ```

2. **Top Error Operations** (last 7 days)
   ```
   topk(10, sum by (operation) (count_over_time({level="error"}[7d])))
   ```

3. **Migration Success Rate** (last 30 days)
   ```
   100 * (sum(count_over_time({service="migration", status="success"}[30d])) / 
          sum(count_over_time({service="migration"}[30d])))
   ```

4. **Log Stream** (real-time)
   ```
   {service=~"migration|hosting"}
   ```

---

## 7. ALERT RULES

### 7.1 Critical Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| **High error rate** | >10% errors in 5min | Page on-call |
| **SSH migration failure** | 5+ SSH errors in 10min | Investigate network/firewall |
| **Database connection loss** | 3+ DB errors in 30sec | Check database status |
| **Audit log growth spike** | >1000 entries in 5min | Investigate unusual activity |

### 7.2 Implementation

**File**: `prometheus-rules.yml`

```yaml
groups:
  - name: npanel
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: rate({level="error"}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate detected"
          
      - alert: SSHMigrationFailure
        expr: rate({service="migration", error_code="SSH_CONNECTION_REFUSED"}[10m]) > 0.5
        for: 1m
        annotations:
          summary: "SSH migration failures spike"
```

---

## 8. IMPLEMENTATION ROADMAP

### Week 1: Core Infrastructure
- [ ] Deploy Loki + Promtail + Grafana
- [ ] Configure retention policies
- [ ] Add logging middleware to backend
- [ ] Test structured log output

### Week 2: Application Integration
- [ ] Add trace/correlation IDs to all services
- [ ] Replace console.* with Logger (all files)
- [ ] Add sanitization to hosting logs
- [ ] Implement log cleanup job

### Week 3: Observability
- [ ] Create Grafana dashboards
- [ ] Setup alert rules
- [ ] Test alert notifications
- [ ] Document queries for operators

### Week 4: Operability
- [ ] Update admin UI with Grafana panels
- [ ] Train team on log queries
- [ ] Runbook with common scenarios
- [ ] Performance optimization

---

## 9. SUCCESS CRITERIA

Phase 3.2 is COMPLETE when:

✅ Loki deployed and receiving logs  
✅ All services emit structured JSON logs  
✅ Trace/correlation IDs present in all logs  
✅ Log retention policy enforced  
✅ Grafana dashboards show key metrics  
✅ Alert rules trigger on test patterns  
✅ No sensitive data in logs  
✅ Operators can search/filter logs  

---

**Status**: READY FOR METRICS & HEALTH SIGNALS (Task 3.3)  
**Blocker**: None
