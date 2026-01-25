# Phase 5 Implementation Execution Guide

**Status:** READY FOR EXECUTION  
**Date:** January 25, 2026  
**Target Completion:** 8 weeks

---

## Pre-Implementation Checklist

- [ ] Team alignment on design system
- [ ] Development environment set up
- [ ] Staging database seeded with test data
- [ ] Performance baseline established
- [ ] Security audit framework ready
- [ ] Monitoring/alerting configured

---

## Week 1-2: Track A Hardening (Foundation)

### Task 1.1: cgroups v2 Implementation

**Objective:** Enable per-account resource isolation

```bash
# Verification
cat /sys/fs/cgroup/cgroup.controllers
# Should output: cpuset memory io pids
```

**Implementation Steps:**

1. **Add cgroups v2 utility to agent** (agent/cgroups.go)
   ```go
   package agent

   type CgroupManager struct {
       basePath string
       version  int
   }

   func (cm *CgroupManager) CreateAccountCgroup(accountID string) error {
       // 1. Create cgroup directory
       // 2. Set CPU limits
       // 3. Set memory limits
       // 4. Set IO limits
       // 5. Set PID limits
       // 6. Move account processes into cgroup
   }

   func (cm *CgroupManager) SetCPULimit(accountID string, percent int) error {
       // Set CPU.max = {percent}% of 1 core
   }

   func (cm *CgroupManager) SetMemoryLimit(accountID string, bytes int64) error {
       // Set memory.max
   }

   func (cm *CgroupManager) SetIOLimit(accountID string, readMBps, writeMBps int) error {
       // Set io.max with weighted rate limiting
   }
   ```

2. **Add cgroups configuration file**
   ```yaml
   # /etc/npanel/cgroups-defaults.yaml
   cgroups:
     enabled: true
     version: 2
     defaults:
       cpu: "50%"
       memory: "512 MB"
       io_read: "50 MB/s"
       io_write: "50 MB/s"
   ```

3. **Integrate with account creation**
   ```go
   // In API handler
   func (h *AccountHandler) CreateAccount(req *CreateAccountRequest) error {
       // ... existing code ...
       
       // New: Create cgroup for account
       cgroupMgr := NewCgroupManager()
       if err := cgroupMgr.CreateAccountCgroup(account.ID); err != nil {
           // Log error, continue (graceful degradation)
       }
   }
   ```

4. **Add monitoring**
   - Prometheus metric: `account_cgroup_cpu_usage_percent`
   - Prometheus metric: `account_cgroup_memory_usage_bytes`
   - Alert if usage >90% of limit for >5 min

5. **Security audit** (50+ vectors)
   - Test cgroup bypass attempts
   - Test privilege escalation via cgroups
   - Test resource limit enforcement under load
   - Test recovery after cgroup removal

**Success Criteria:**
- ✅ Account processes stay within CPU limit
- ✅ Account processes stay within memory limit
- ✅ Fork bomb contained to PID limit
- ✅ Performance overhead <0.1%

**Rollback Plan:**
```
If cgroups breaks:
  1. Add feature flag: CGROUPS_ENABLED=false
  2. Fall back to rlimit per-process
  3. Alert SRE
```

---

### Task 1.2: Email Rate Limiting

**Objective:** Prevent spam relay abuse

**Implementation Steps:**

1. **Create Exim rate limiting policy**
   ```
   # /etc/exim/policies/ratelimit.conf
   
   # Per-account limits
   # 500 emails/hour = 1 per 7.2 seconds
   # 100 emails/15min = 1 per 9 seconds (burst)
   
   check_mail:
     ratelimit = 500 / 3600 / ${local_part}@${domain}
     # If limit exceeded, return 452 (temporary failure)
   ```

2. **Add rate limit table to SQLite**
   ```sql
   CREATE TABLE email_rate_limits (
     id INTEGER PRIMARY KEY,
     account_id TEXT NOT NULL,
     limit_emails_per_hour INTEGER DEFAULT 500,
     limit_emails_per_15min INTEGER DEFAULT 100,
     limit_mb_per_hour INTEGER DEFAULT 50,
     enabled BOOLEAN DEFAULT 1,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (account_id) REFERENCES accounts(id)
   );
   ```

3. **Create API endpoint for rate limit config**
   ```
   PATCH /api/accounts/{id}/email-limits
   {
     "limit_emails_per_hour": 500,
     "limit_emails_per_15min": 100,
     "enabled": true
   }
   ```

4. **Add monitoring**
   - Metric: `email_rate_limit_violations_total`
   - Alert if >100 violations/hour for same account

5. **Test scenarios**
   - Send 600 emails in 1 hour → should defer after 500
   - Send 110 emails in 15 min → should defer after 100
   - Legitimate bulk mailers can be upgraded

**Success Criteria:**
- ✅ Compromised account can't send >500 emails/hour
- ✅ No false deferrals of legitimate mail
- ✅ Reputation metrics improve

---

### Task 1.3: Agent Watchdog & Auto-Recovery

**Objective:** Detect and recover from agent failures automatically

**Implementation Steps:**

1. **Create watchdog service** (agent/watchdog.go)
   ```go
   package agent

   type Watchdog struct {
       agentSocket string
       logFile     string
       maxRestarts int
       restartTimeout time.Duration
   }

   func (w *Watchdog) Start() {
       ticker := time.NewTicker(2 * time.Second)
       for {
           select {
           case <-ticker.C:
               if !w.isAgentHealthy() {
                   w.attemptRecover()
               }
           }
       }
   }

   func (w *Watchdog) isAgentHealthy() bool {
       // Ping agent via socket, timeout 1 second
       ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
       defer cancel()
       // Send: {"action": "ping"}
       // Expect: {"status": "pong"}
   }

   func (w *Watchdog) attemptRecover() {
       w.logFailure("agent_unresponsive")
       time.Sleep(3 * time.Second)
       
       if !w.isAgentHealthy() {
           if w.restartCount < w.maxRestarts {
               w.restartAgent()
           } else {
               w.emergencyAlert()
           }
       }
   }
   ```

2. **Create systemd service for watchdog**
   ```ini
   # /etc/systemd/system/npanel-watchdog.service
   [Unit]
   Description=nPanel Agent Watchdog
   After=npanel-agent.service
   Wants=npanel-agent.service

   [Service]
   Type=simple
   ExecStart=/usr/local/bin/npanel-watchdog
   Restart=always
   RestartSec=5
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   ```

3. **Add failure audit table**
   ```sql
   CREATE TABLE agent_failures (
     id INTEGER PRIMARY KEY,
     failure_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     failure_type TEXT,      -- graceful | crash
     restart_count INTEGER,
     last_log_lines TEXT,    -- JSON array
     resolved BOOLEAN DEFAULT 0
   );
   ```

4. **Add alerting**
   - Alert if restart count >5 in 1 hour
   - Alert if agent down for >2 minutes
   - Send to ops@hosting.com

**Success Criteria:**
- ✅ Agent death detected within 6 seconds
- ✅ Automatic recovery works >100 times
- ✅ No audit trail loss

---

### Task 1.4: Long-Run Soak Testing

**Objective:** Verify stability over 24-72 hours

**Implementation Steps:**

1. **Create test harness** (tests/soak_test.go)
   ```go
   package tests

   type SoakTest struct {
       duration time.Duration
       scenarios []Scenario
       metrics  *MetricsCollector
   }

   func (st *SoakTest) RunNormalLoad() {
       // 1000 accounts
       // 5 MB each
       // 100 req/sec
       // Monitor for 24h
   }

   func (st *SoakTest) RunChaos() {
       // Every 5-10 min: Kill agent mid-operation
       // Verify recovery
       // Check for lost data
   }
   ```

2. **Create CI/CD pipeline for soak tests**
   ```yaml
   # .github/workflows/soak-test.yml
   name: Weekly Soak Test
   on:
     schedule:
       - cron: '0 2 * * 0'  # Sunday 2 AM
   jobs:
     soak:
       runs-on: self-hosted
       steps:
         - uses: actions/checkout@v3
         - name: Run 72-hour soak test
           run: |
             go test -timeout 72h -run TestSoak ./tests
         - name: Upload metrics
           run: |
             # Upload to monitoring system
   ```

3. **Metrics to collect**
   - CPU, RAM, disk IO per 10 seconds
   - API latency (p50, p95, p99)
   - Error rates
   - Connection counts
   - Queue depths

**Success Criteria:**
- ✅ 72-hour run without crashes
- ✅ No memory leaks
- ✅ Metrics stable throughout

---

### Task 1.5: Graceful Service Reloads

**Objective:** Deploy config changes without downtime

**Implementation Steps:**

1. **Add SIGHUP handler to agent**
   ```go
   func (a *Agent) setupSignalHandlers() {
       sigChan := make(chan os.Signal, 1)
       signal.Notify(sigChan, syscall.SIGHUP)
       
       go func() {
           for range sigChan {
               a.gracefulReload()
           }
       }()
   }

   func (a *Agent) gracefulReload() {
       // 1. Load new config
       newConfig, err := loadConfig()
       if err != nil {
           a.log("Config load failed", err)
           return // Old agent keeps running
       }
       
       // 2. Validate new config
       if err := newConfig.Validate(); err != nil {
           a.log("Config validation failed", err)
           return
       }
       
       // 3. Fork new agent with new config
       newAgent := a.fork(newConfig)
       
       // 4. Old agent stops accepting NEW connections
       a.closeListener()
       
       // 5. Wait for existing operations to complete (5 min timeout)
       a.waitForCompletion(5 * time.Minute)
       
       // 6. Shutdown old agent
       a.shutdown()
   }
   ```

2. **Update API routing**
   ```go
   // During reload, route new requests to new agent
   type AgentRouter struct {
       primary   *Agent
       secondary *Agent  // New agent during reload
   }

   func (ar *AgentRouter) Route(req *Request) (*Response, error) {
       agent := ar.primary
       if ar.secondary != nil && ar.secondary.isHealthy() {
           agent = ar.secondary
       }
       return agent.Execute(req)
   }
   ```

3. **Add config versioning**
   ```sql
   CREATE TABLE config_versions (
     id INTEGER PRIMARY KEY,
     version INTEGER NOT NULL,
     config_json TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     deployed_at TIMESTAMP,
     rolled_back_at TIMESTAMP
   );
   ```

**Success Criteria:**
- ✅ Config changes without dropping connections
- ✅ Zero downtime
- ✅ Automatic rollback on validation failure

---

## Week 2-3: Track A Continuation & Performance Validation

### Task 1.6: Configuration Layering

- Implement layered config system
- Create config merge logic
- Add config versioning to installer
- Test with multi-version upgrades

### Task 1.7: Performance Baseline

- Measure idle CPU, RAM, disk IO
- Measure API latencies under load
- Baseline email throughput
- Document baseline for regression detection

---

## Week 3-4: Track B - Billing Basics

### Task 2.1: Package Templates

- Add `packages` table
- Create API CRUD endpoints
- Add feature toggle enforcement
- Build package selector UI

### Task 2.2: Resource Quota Enforcement

- Create `quota_usage` time-series table
- Implement quota calculation functions
- Add hourly quota check job
- Build quota UI dashboard

---

## Week 4-5: Track B - Reseller Hierarchy

### Task 2.3: Account Hierarchy

- Add `parent_account_id` column
- Add `account_type` enum
- Create hierarchy validation
- Add permission checks to API

### Task 2.4: WHMCS API

- Create provisioning endpoints
- Implement HMAC-SHA256 signing
- Build account lifecycle hooks
- Test with WHMCS module

---

## Week 5-6: Track C - Polish & Differentiation

### Task 3.1: Progress Tracking

- Add progress tracking to restore agent code
- Create WebSocket endpoint
- Build progress React component
- Calculate ETA algorithm

### Task 3.2: Health Scoring

- Create health check module
- Implement category checks
- Build health report storage
- Add health UI component

### Task 3.3: Audit Logs

- Update log schema
- Create structured log entries
- Build search API
- Add log export functionality

### Task 3.4: Smart Defaults

- Create security policy schema
- Update account creation flow
- Build onboarding wizard
- Create policy templates

---

## Week 6-7: Track C - Upgrades

### Task 3.5: Predictable Upgrades

- Create upgrade state machine
- Implement pre-flight checks
- Build canary deployment
- Add automatic rollback

---

## Week 7-8: Integration & Testing

### Full System Testing

1. **Performance Regression Testing**
   ```bash
   # Before
   npanel_api_latency_p99 = 150ms
   npanel_cpu_idle = 0.8%
   
   # After (must be ±5%)
   npanel_api_latency_p99 = 157ms  ✓
   npanel_cpu_idle = 0.84%         ✓
   ```

2. **Security Audit**
   - 50+ attack vectors per feature
   - Zero bypass targets
   - Privilege escalation impossible
   - Data isolation verified

3. **Chaos Testing**
   ```
   Scenario: Kill agent every 5 minutes for 24 hours
   Result: All operations complete, no data loss
   
   Scenario: Fill disk to 95% during backup
   Result: Graceful degradation, clear error message
   ```

4. **Cross-Track Integration**
   - Package quotas enforce cgroups limits
   - Reseller hierarchy respects quota bounds
   - Health checks verify migration with quotas
   - Audit logs record all quota changes

---

## Feature Gating (Emergency Kill Switches)

```yaml
features:
  track_a_hardening:
    cgroups_enabled: false      # Enable after Week 1
    email_rate_limiting: false  # Enable after Week 2
    agent_watchdog: false       # Enable after Week 2
    graceful_reloads: false     # Enable after Week 3
    config_layering: false      # Enable after Week 3
  
  track_b_billing:
    packages_enabled: false     # Enable after Week 4
    quotas_enabled: false       # Enable after Week 4
    reseller_hierarchy: false   # Enable after Week 5
    whmcs_api: false            # Enable after Week 5
  
  track_c_polish:
    progress_tracking: false    # Enable after Week 5
    health_scoring: false       # Enable after Week 5
    audit_logs_v2: false        # Enable after Week 6
    smart_defaults: false       # Enable after Week 6
    upgrade_framework: false    # Enable after Week 7
```

**To enable feature:**
```bash
# API call
PATCH /api/admin/features
{
  "feature": "cgroups_enabled",
  "enabled": true
}

# Re-test in production immediately
# Monitor metrics for regressions
# If regression >5%: Disable feature
```

---

## Success Criteria Summary

**Phase 5 is successful only if:**

✅ nPanel remains faster than cPanel  
✅ Resource usage stays predictable  
✅ No new privilege paths introduced  
✅ Hosting providers can trust upgrades  
✅ Monetization possible without coupling  
✅ All 47 Phase 4 requirements still met  
✅ 50+ attack vectors tested per feature  

---

## Gate Approvals

### Gate 1: End of Week 2
- [ ] cgroups stable under abuse
- [ ] Email rate limiting accurate
- [ ] Agent watchdog recovery working
- **Decision:** Proceed to graceful reloads

### Gate 2: End of Week 4
- [ ] Package templates complete
- [ ] WHMCS API functional
- [ ] Quota enforcement working
- **Decision:** Proceed to reseller features

### Gate 3: End of Week 6
- [ ] Progress tracking UX validated
- [ ] Health scoring accuracy >90%
- [ ] Audit logs searchable
- **Decision:** Proceed to upgrade framework

### Gate 4: End of Week 8
- [ ] 72-hour soak passed
- [ ] Performance regression <5%
- [ ] Security audit: 0 new vulnerabilities
- **Decision:** Full rollout approved

---

## Document Version

- **Version:** 1.0
- **Status:** READY FOR EXECUTION
- **Date:** 2026-01-25
- **Next Review:** End of Week 1

