# OBSERVABILITY METRICS & HEALTH SIGNALS

**Date**: January 23, 2026  
**Phase**: 3 Task 3.3  
**Purpose**: Define metrics, health checks, and alert thresholds  
**Status**: COMPLETE

---

## EXECUTIVE SUMMARY

NPanel requires **3 types of metrics**:

1. **RED Metrics** (Request/Error/Duration) - Request-level performance
2. **System Metrics** (CPU, Memory, Disk) - Infrastructure health
3. **Business Metrics** (Migration success, customer accounts) - Operations health

**Implementation**: Prometheus + custom instrumentations in NestJS

**Priority**: Deploy RED metrics first (fastest ROI), then system metrics

---

## 1. RED METRICS (Request/Error/Duration)

### 1.1 What to Measure

**Rate**: Requests per second
- Per endpoint
- Per operation type
- Overall

**Errors**: Request failures
- Per endpoint
- By error type
- By response code

**Duration**: Request latency
- Per endpoint
- P50, P95, P99 percentiles
- Min, max, average

### 1.2 HTTP Endpoints - RED Metrics

| Endpoint | Critical? | SLO | Alert |
|----------|-----------|-----|-------|
| **POST /v1/auth/login** | YES | <200ms p95 | >500ms p95 for 5min |
| **GET /v1/auth/me** | YES | <100ms p95 | >300ms p95 for 5min |
| **POST /v1/migrations/start** | YES | <1s p95 | >3s p95 for 5min |
| **GET /v1/migrations/:id** | YES | <500ms p95 | >1.5s p95 for 5min |
| **POST /v1/hosting/dns/create** | YES | <2s p95 | >5s p95 for 5min |
| **GET /v1/system/health** | YES | <100ms p95 | >300ms p95 for 5min |
| **POST /auth/impersonation/start** | YES | <500ms p95 | >1s p95 for 5min |
| **GET /v1/hosting/services** | NO | <1s p95 | - |

### 1.3 NestJS Instrumentation

**Package**: `@nestjs/common` + `prom-client`

```typescript
// backend/src/common/metrics.interceptor.ts (NEW)

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as promClient from 'prom-client';

// Create metrics
export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
});

export const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestErrors = new promClient.Counter({
  name: 'http_request_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['method', 'route', 'status_code', 'error_type'],
});

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: any): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method } = request;
    const route = request.route?.path || request.path;

    const start = Date.now();

    return next.handle().pipe(
      tap(
        () => {
          const duration = Date.now() - start;
          const status = context.switchToHttp().getResponse().statusCode;

          httpRequestDuration
            .labels(method, route, status)
            .observe(duration);
          httpRequestTotal.labels(method, route, status).inc();
        },
        (error) => {
          const duration = Date.now() - start;
          const status = error.status || 500;
          const errorType = error.name || 'UnknownError';

          httpRequestDuration
            .labels(method, route, status)
            .observe(duration);
          httpRequestErrors
            .labels(method, route, status, errorType)
            .inc();
          httpRequestTotal.labels(method, route, status).inc();
        }
      )
    );
  }
}
```

**Register in app.module.ts**:

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from './common/metrics.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
```

**Export metrics endpoint**:

```typescript
// backend/src/system/health.controller.ts (add metrics endpoint)

import * as promClient from 'prom-client';

@Controller()
export class HealthController {
  @Get('/metrics')
  @HttpCode(200)
  async metrics() {
    return promClient.register.metrics();
  }
}
```

---

## 2. OPERATION-SPECIFIC METRICS

### 2.1 Migration Operations

Track per-job:

```typescript
// backend/src/migration/migration-metrics.ts (NEW)

import * as promClient from 'prom-client';

export const migrationJobsTotal = new promClient.Counter({
  name: 'migration_jobs_total',
  help: 'Total migration jobs started',
  labelNames: ['source_type'],  // cPanel, DirectAdmin, etc.
});

export const migrationJobsCompleted = new promClient.Counter({
  name: 'migration_jobs_completed_total',
  help: 'Completed migration jobs',
  labelNames: ['status'],  // success, failed, partial
});

export const migrationAccountsTotal = new promClient.Gauge({
  name: 'migration_accounts_total',
  help: 'Total accounts being migrated',
  labelNames: ['job_id', 'status'],  // pending, syncing, complete, error
});

export const migrationDuration = new promClient.Histogram({
  name: 'migration_job_duration_seconds',
  help: 'Migration job duration in seconds',
  labelNames: ['source_type', 'account_count_bucket'],  // <10, 10-50, 50-100, >100
  buckets: [60, 300, 600, 1800, 3600, 7200],
});

export const migrationSSHErrors = new promClient.Counter({
  name: 'migration_ssh_errors_total',
  help: 'SSH connection errors during migration',
  labelNames: ['error_type'],  // timeout, refused, auth_failed, etc.
});
```

**Record in migration service**:

```typescript
// When job starts
migrationJobsTotal.labels(sourceType).inc();

// When job completes
migrationJobsCompleted.labels(status).inc();
migrationDuration.labels(sourceType, accountBucket).observe(durationSeconds);

// When SSH fails
migrationSSHErrors.labels(errorType).inc();
```

### 2.2 Hosting Operations

Track per-adapter:

```typescript
// backend/src/hosting/hosting-metrics.ts (NEW)

export const hostingOperationsTotal = new promClient.Counter({
  name: 'hosting_operations_total',
  help: 'Total hosting operations',
  labelNames: ['adapter', 'operation', 'status'],  // dns, create, success|failed
});

export const hostingOperationDuration = new promClient.Histogram({
  name: 'hosting_operation_duration_ms',
  help: 'Duration of hosting operations in ms',
  labelNames: ['adapter', 'operation'],
  buckets: [100, 500, 1000, 2000, 5000, 10000],
});

export const hostingServiceHealth = new promClient.Gauge({
  name: 'hosting_service_health',
  help: 'Health status of hosting services',
  labelNames: ['adapter'],  // 1=healthy, 0=unhealthy
});
```

### 2.3 Authentication Metrics

```typescript
export const authLoginAttempts = new promClient.Counter({
  name: 'auth_login_attempts_total',
  help: 'Login attempts',
  labelNames: ['status'],  // success, invalid_credentials, account_locked
});

export const authLoginDuration = new promClient.Histogram({
  name: 'auth_login_duration_ms',
  help: 'Login operation duration',
  buckets: [10, 50, 100, 200, 500, 1000],
});

export const authImpersonationActive = new promClient.Gauge({
  name: 'auth_impersonation_active',
  help: 'Currently active impersonation sessions',
});
```

---

## 3. SYSTEM HEALTH CHECKS

### 3.1 Health Endpoint

**Current**: `GET /health` (basic)

```json
{
  "status": "ok",
  "timestamp": "2026-01-23T10:30:45Z"
}
```

**Enhanced**: Comprehensive health signals

```typescript
// backend/src/system/health.service.ts (NEW)

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export interface HealthSignal {
  name: string;
  status: 'UP' | 'DEGRADED' | 'DOWN';
  details?: Record<string, any>;
  responseTime?: number;
}

@Injectable()
export class HealthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    // Inject all dependencies needed for checks
  ) {}

  async getFullHealth(): Promise<{
    status: 'UP' | 'DEGRADED' | 'DOWN';
    timestamp: string;
    uptime: number;
    signals: HealthSignal[];
  }> {
    const signals: HealthSignal[] = [];
    
    // 1. Database
    signals.push(await this.checkDatabase());
    
    // 2. Redis (if used)
    signals.push(await this.checkRedis());
    
    // 3. Disk space
    signals.push(await this.checkDiskSpace());
    
    // 4. Memory
    signals.push(await this.checkMemory());
    
    // 5. SSH connectivity (sample host)
    signals.push(await this.checkSSH());
    
    // 6. DNS resolver
    signals.push(await this.checkDNS());
    
    // Overall status
    const hasDown = signals.some(s => s.status === 'DOWN');
    const hasDegraded = signals.some(s => s.status === 'DEGRADED');
    const status = hasDown ? 'DOWN' : hasDegraded ? 'DEGRADED' : 'UP';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      signals,
    };
  }

  private async checkDatabase(): Promise<HealthSignal> {
    const start = Date.now();
    try {
      await this.users.query('SELECT 1');
      return {
        name: 'database',
        status: 'UP',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'DOWN',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async checkDiskSpace(): Promise<HealthSignal> {
    try {
      const { statvfs } = await import('fs/promises');
      const stats = await statvfs('/');
      const usedPercent = ((stats.blocks - stats.bfree) / stats.blocks) * 100;
      
      return {
        name: 'disk',
        status: usedPercent > 90 ? 'DOWN' : usedPercent > 80 ? 'DEGRADED' : 'UP',
        details: {
          used_percent: usedPercent.toFixed(1),
          total_gb: (stats.blocks * stats.frsize / 1e9).toFixed(1),
          free_gb: (stats.bfree * stats.frsize / 1e9).toFixed(1),
        },
      };
    } catch (error) {
      return {
        name: 'disk',
        status: 'DOWN',
        details: { error: 'Cannot read disk stats' },
      };
    }
  }

  private async checkMemory(): Promise<HealthSignal> {
    const used = process.memoryUsage().heapUsed;
    const limit = process.memoryUsage().heapTotal;
    const percent = (used / limit) * 100;
    
    return {
      name: 'memory',
      status: percent > 90 ? 'DOWN' : percent > 80 ? 'DEGRADED' : 'UP',
      details: {
        heap_used_mb: (used / 1024 / 1024).toFixed(1),
        heap_total_mb: (limit / 1024 / 1024).toFixed(1),
        heap_percent: percent.toFixed(1),
      },
    };
  }

  private async checkSSH(): Promise<HealthSignal> {
    // Try to connect to localhost:22 (or skip if no SSH)
    try {
      const net = require('net');
      const socket = new net.Socket();
      
      const start = Date.now();
      await new Promise((resolve, reject) => {
        socket.setTimeout(5000);
        socket.once('error', reject);
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error('SSH timeout'));
        });
        socket.connect(22, 'localhost', resolve);
      });
      
      socket.destroy();
      return {
        name: 'ssh',
        status: 'UP',
        responseTime: Date.now() - start,
      };
    } catch {
      return {
        name: 'ssh',
        status: 'DEGRADED',
        details: { note: 'SSH not available (may be normal)' },
      };
    }
  }

  private async checkDNS(): Promise<HealthSignal> {
    try {
      const { resolve4 } = require('dns').promises;
      const start = Date.now();
      
      // Try to resolve a local domain or 8.8.8.8 for Google
      await resolve4('8.8.8.8');
      
      return {
        name: 'dns',
        status: 'UP',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'dns',
        status: 'DEGRADED',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
```

**Export endpoint**:

```typescript
@Get('/health')
@HttpCode(HttpStatus.OK)
async health() {
  return this.healthService.getFullHealth();
}

@Get('/health/quick')
@HttpCode(HttpStatus.OK)
async healthQuick() {
  // Fast check (database only)
  try {
    await this.healthService.checkDatabase();
    return { status: 'UP' };
  } catch {
    return { status: 'DOWN' };
  }
}
```

---

## 4. PROMETHEUS CONFIGURATION

### 4.1 Scrape Config

**File**: `prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'npanel'

scrape_configs:
  - job_name: 'npanel-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 10s
    scrape_timeout: 5s

  - job_name: 'npanel-health'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/health'
    scrape_interval: 30s
    scrape_timeout: 10s
```

### 4.2 Alert Rules

**File**: `prometheus-rules.yml`

```yaml
groups:
  - name: npanel-slos
    interval: 1m
    rules:
      # SLO: Login endpoint < 200ms p95
      - alert: AuthLoginSloBreach
        expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket{route="/v1/auth/login"}[5m])) > 200
        for: 5m
        annotations:
          summary: "Login endpoint SLO breach"
          severity: "page"

      # SLO: Migration start < 1s p95
      - alert: MigrationStartSloBreach
        expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket{route="/v1/migrations/start"}[5m])) > 1000
        for: 5m
        annotations:
          summary: "Migration start SLO breach"
          severity: "page"

      # Health: Database down
      - alert: DatabaseDown
        expr: up{job="npanel-health"} == 0
        for: 2m
        annotations:
          summary: "Database health check failed"
          severity: "critical"

      # Health: Memory pressure
      - alert: HighMemoryUsage
        expr: 'mem_percent > 85'
        for: 5m
        annotations:
          summary: "Memory usage above 85%"
          severity: "warning"

      # Health: Disk space
      - alert: LowDiskSpace
        expr: 'disk_percent > 90'
        for: 5m
        annotations:
          summary: "Disk usage above 90%"
          severity: "critical"

      # Operations: High error rate
      - alert: HighErrorRate
        expr: 'rate(http_requests_total{status_code=~"5.."}[5m]) > 0.05'
        for: 5m
        annotations:
          summary: "Error rate > 5%"
          severity: "page"

      # Migration: High SSH error rate
      - alert: MigrationSSHErrors
        expr: 'rate(migration_ssh_errors_total[5m]) > 0.1'
        for: 5m
        annotations:
          summary: "SSH errors during migration"
          severity: "warning"
```

---

## 5. GRAFANA DASHBOARDS

### 5.1 Main Dashboard

**Panels**:

1. **System Health** (gauge)
   - Query: `up{job="npanel-health"}`
   - Color: Green (UP), Yellow (DEGRADED), Red (DOWN)

2. **Request Rate** (graph)
   - Query: `rate(http_requests_total[5m])`
   - Y-axis: requests/sec

3. **Error Rate** (gauge)
   - Query: `rate(http_requests_total{status_code=~"5.."}[5m])`
   - Unit: %
   - Color: Red if >5%

4. **Latency P95** (graph)
   - Query: `histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))`
   - Y-axis: milliseconds

5. **Database Connection** (stat)
   - Query: `up{job="npanel-health"}`
   - Text: "UP" or "DOWN"

6. **Migration Success Rate** (gauge)
   - Query: `migration_jobs_completed_total{status="success"} / migration_jobs_total`
   - Unit: %

7. **Active Impersonations** (stat)
   - Query: `auth_impersonation_active`
   - Text: number of active sessions

8. **Disk Space** (gauge)
   - Query: Query from health endpoint
   - Unit: %

### 5.2 Operations Dashboard

**For on-call engineers**:

1. **Current Alert Status** (alert list)
   - Shows all firing alerts
   - Color by severity

2. **Migration Activity** (stat)
   - Rate of new jobs
   - Completion rate
   - Success percentage

3. **Hosting Operations** (table)
   - By adapter (DNS, Mail, SSL, etc.)
   - Success vs failed
   - Duration p95

4. **Error breakdown** (pie chart)
   - By error type
   - By endpoint
   - By status code

---

## 6. DEPLOYMENT

### 6.1 Docker Compose

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./prometheus-rules.yml:/etc/prometheus/rules.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--rules.files=/etc/prometheus/rules.yml'

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
      - alertmanager-data:/alertmanager

  grafana:
    image: grafana/grafana:10.2.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
    depends_on:
      - prometheus

volumes:
  prometheus-data:
  alertmanager-data:
  grafana-data:
```

### 6.2 Alerting Setup

**File**: `alertmanager.yml`

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: 'default'
  group_by: ['alertname', 'cluster']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  routes:
    - match:
        severity: critical
      receiver: 'critical'
    - match:
        severity: warning
      receiver: 'default'

receivers:
  - name: 'default'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        channel: '#alerts'

  - name: 'critical'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        channel: '#critical-alerts'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
```

---

## 7. SUCCESS CRITERIA

Phase 3.3 is COMPLETE when:

✅ Prometheus collecting metrics from `/metrics` endpoint  
✅ RED metrics available for all critical endpoints  
✅ Health checks passing/failing appropriately  
✅ Grafana dashboards displaying all key metrics  
✅ Alert rules configured and firing on test patterns  
✅ Slack/PagerDuty notifications working  
✅ Operators can identify bottlenecks from dashboards  
✅ SLO violations clearly visible  

---

**Status**: READY FOR DAY-2 OPERATIONS RUNBOOK (Task 3.4)  
**Blocker**: None
