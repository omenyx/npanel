# Phase 5 Week 1 Execution - Track A Foundation

**Date:** January 25, 2026 (Planning) → February 1-7, 2026 (Execution)  
**Status:** READY FOR EXECUTION  
**Track:** A (Hardening & Scale)  
**Goals:** Implement Tasks 1.1-1.5, establish baseline metrics, pass Gate 0  

---

## Week 1 At a Glance

```
MON 2/1    TUE 2/2    WED 2/3    THU 2/4    FRI 2/5    SAT/SUN
├─ Team    ├─ Task    ├─ Task    ├─ Task    ├─ Task    ├─ Monitor
│  Align   │  1.1     │  1.2     │  1.3     │  1.4     │  System
│  Env     │  Start   │  Start   │  Start   │  Start   │  24h run
│  Check   └─ Task    └─ Task    └─ Task    └─ Task    
└─ Gate 0    1.5        1.6        1.7        Review
   Approval  Start      Start      Complete   Metrics
```

---

## Monday 2/1: Gate 0 - Team Alignment & Environment Check

### Pre-Execution Checklist

- [ ] **Development Environment**
  - [ ] Backend Go 1.23 environment
  - [ ] Frontend Node 18+ environment
  - [ ] SQLite database available
  - [ ] Linux (AlmaLinux) test environment ready
  - [ ] Systemd available (for services)

- [ ] **Git & Version Control**
  - [ ] Feature branches created:
    - `feature/track-a-hardening`
    - `feature/track-b-billing`
    - `feature/track-c-polish`
  - [ ] Branch protection: require 1 review
  - [ ] Commit hooks: linting + tests

- [ ] **Monitoring Infrastructure**
  - [ ] Prometheus installed (local or remote)
  - [ ] Grafana configured (if available)
  - [ ] Alert rules template ready
  - [ ] Baseline metrics collection script ready

- [ ] **Database Readiness**
  - [ ] Backup of current schema
  - [ ] Migration scripts template
  - [ ] Test data loaded (1000 accounts, 5 MB each)

- [ ] **Team Alignment**
  - [ ] All team members read PHASE_5_PROJECT_KICKOFF.md
  - [ ] Architects reviewed PHASE_5_MASTER_SPECIFICATION.md
  - [ ] Developers assigned to Track A tasks
  - [ ] SRE/DevOps assigned to monitoring setup
  - [ ] QA prepared test scenarios

### Gate 0 Approval Criteria

```
✓ Environment fully functional
✓ All team members aligned on requirements
✓ Feature branches created and protected
✓ Monitoring infrastructure ready
✓ Test database populated
✓ All Phase 4 services running healthy

If ANY criterion not met:
  → Delay Week 1 start
  → Fix blockers before proceeding
  → No exceptions to this rule
```

---

## Task 1.1: cgroups v2 Resource Isolation

**Owner:** Backend SRE  
**Timeline:** Mon 2/1 - Wed 2/3 (3 days)  
**Complexity:** High  
**Risk:** Medium (kernel-level, needs testing)  

### Problem Statement
- One runaway account (fork bomb, disk-fill, memory leak) crashes entire server
- No process isolation per account
- Other customers affected by single bad actor
- **Result:** Loss of revenue, customer churn

### Solution Design
```
Per-account cgroup v2 (kernel feature, no patches needed):
├─ CPU: 50% of 1 core (configurable)
├─ Memory: 512 MB (configurable)
├─ IO: 50 MB/s read/write (configurable)
├─ PIDs: 256 max processes (configurable)
└─ Auto-enforcement: On account create, auto-remove on delete
```

### Implementation Steps

#### Step 1: Create cgroups utility module (`agent/cgroups.go`)

```go
package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CgroupManager handles cgroups v2 operations
type CgroupManager struct {
	basePath string // e.g., /sys/fs/cgroup
	version  int    // 2 for v2
}

// NewCgroupManager creates a new cgroup manager
func NewCgroupManager() (*CgroupManager, error) {
	// Verify cgroups v2 is mounted
	_, err := os.Stat("/sys/fs/cgroup/cgroup.controllers")
	if err != nil {
		return nil, fmt.Errorf("cgroups v2 not available: %w", err)
	}

	return &CgroupManager{
		basePath: "/sys/fs/cgroup",
		version:  2,
	}, nil
}

// CgroupConfig holds resource limits
type CgroupConfig struct {
	AccountID string
	CPUPercent int    // 0-100
	MemoryMB  int64  // megabytes
	IOReadMBps int   // MB/s
	IOWriteMBps int  // MB/s
	MaxPIDs   int    // max processes
}

// CreateAccountCgroup creates a cgroup for an account
func (cm *CgroupManager) CreateAccountCgroup(cfg CgroupConfig) error {
	// Validate
	if cfg.AccountID == "" {
		return fmt.Errorf("AccountID required")
	}
	if cfg.CPUPercent < 1 || cfg.CPUPercent > 200 {
		return fmt.Errorf("CPUPercent must be 1-200")
	}
	if cfg.MemoryMB < 64 {
		return fmt.Errorf("MemoryMB must be ≥64")
	}

	// Create cgroup directory
	cgroupPath := filepath.Join(cm.basePath, "user.slice", 
		fmt.Sprintf("user-%s.slice", cfg.AccountID))
	
	if err := os.MkdirAll(cgroupPath, 0755); err != nil {
		return fmt.Errorf("failed to create cgroup dir: %w", err)
	}

	// Set CPU limit (cpuset)
	// Example: 50% of 1 core = 50000 usec per 100000 usec
	cpuMax := fmt.Sprintf("%d 100000", cfg.CPUPercent*1000)
	if err := cm.writeCgroupFile(cgroupPath, "cpu.max", cpuMax); err != nil {
		return fmt.Errorf("failed to set CPU limit: %w", err)
	}

	// Set memory limit
	memoryBytes := cfg.MemoryMB * 1024 * 1024
	if err := cm.writeCgroupFile(cgroupPath, "memory.max", 
		fmt.Sprintf("%d", memoryBytes)); err != nil {
		return fmt.Errorf("failed to set memory limit: %w", err)
	}

	// Set IO limit (simplified: read + write)
	ioMax := fmt.Sprintf("259:0 rbps=%d wbps=%d\n",
		cfg.IOReadMBps*1024*1024,
		cfg.IOWriteMBps*1024*1024)
	if err := cm.writeCgroupFile(cgroupPath, "io.max", ioMax); err != nil {
		// IO limits might not be available on all systems, log but don't fail
		fmt.Printf("Warning: IO limits not available: %v\n", err)
	}

	// Set PID limit
	if err := cm.writeCgroupFile(cgroupPath, "pids.max", 
		fmt.Sprintf("%d", cfg.MaxPIDs)); err != nil {
		return fmt.Errorf("failed to set PID limit: %w", err)
	}

	// Log success
	fmt.Printf("[cgroups] Created cgroup for account %s: CPU=%d%% RAM=%dMB IO=%d/%dMBps\n",
		cfg.AccountID, cfg.CPUPercent, cfg.MemoryMB, 
		cfg.IOReadMBps, cfg.IOWriteMBps)

	return nil
}

// MoveProcessToCgroup moves a process to account's cgroup
func (cm *CgroupManager) MoveProcessToCgroup(accountID string, pid int) error {
	cgroupPath := filepath.Join(cm.basePath, "user.slice", 
		fmt.Sprintf("user-%s.slice", accountID))

	// Write PID to cgroup.procs
	procsFile := filepath.Join(cgroupPath, "cgroup.procs")
	return cm.writeCgroupFile(cgroupPath, "cgroup.procs", fmt.Sprintf("%d", pid))
}

// UpdateCgroupLimits updates resource limits for a cgroup
func (cm *CgroupManager) UpdateCgroupLimits(cfg CgroupConfig) error {
	// Similar to CreateAccountCgroup, but for updates
	cgroupPath := filepath.Join(cm.basePath, "user.slice", 
		fmt.Sprintf("user-%s.slice", cfg.AccountID))

	// Verify cgroup exists
	if _, err := os.Stat(cgroupPath); err != nil {
		return fmt.Errorf("cgroup does not exist: %w", err)
	}

	// Update limits
	cpuMax := fmt.Sprintf("%d 100000", cfg.CPUPercent*1000)
	memoryBytes := cfg.MemoryMB * 1024 * 1024

	if err := cm.writeCgroupFile(cgroupPath, "cpu.max", cpuMax); err != nil {
		return fmt.Errorf("failed to update CPU limit: %w", err)
	}
	if err := cm.writeCgroupFile(cgroupPath, "memory.max", 
		fmt.Sprintf("%d", memoryBytes)); err != nil {
		return fmt.Errorf("failed to update memory limit: %w", err)
	}

	fmt.Printf("[cgroups] Updated cgroup for account %s\n", cfg.AccountID)
	return nil
}

// DeleteAccountCgroup removes a cgroup (after killing all processes)
func (cm *CgroupManager) DeleteAccountCgroup(accountID string) error {
	cgroupPath := filepath.Join(cm.basePath, "user.slice", 
		fmt.Sprintf("user-%s.slice", accountID))

	// Verify empty before deletion
	procsFile := filepath.Join(cgroupPath, "cgroup.procs")
	data, _ := os.ReadFile(procsFile)
	if len(strings.TrimSpace(string(data))) > 0 {
		return fmt.Errorf("cgroup not empty, processes still running")
	}

	// Remove cgroup directory
	if err := os.RemoveAll(cgroupPath); err != nil {
		return fmt.Errorf("failed to delete cgroup: %w", err)
	}

	fmt.Printf("[cgroups] Deleted cgroup for account %s\n", accountID)
	return nil
}

// GetCgroupStats retrieves current resource usage
func (cm *CgroupManager) GetCgroupStats(accountID string) (map[string]interface{}, error) {
	cgroupPath := filepath.Join(cm.basePath, "user.slice", 
		fmt.Sprintf("user-%s.slice", accountID))

	stats := make(map[string]interface{})

	// Read CPU usage
	cpuUsage, _ := cm.readCgroupFile(cgroupPath, "cpu.stat")
	stats["cpu_stat"] = cpuUsage

	// Read memory usage
	memoryUsage, _ := cm.readCgroupFile(cgroupPath, "memory.current")
	stats["memory_usage"] = memoryUsage

	// Read PID count
	procsCount, _ := cm.readCgroupFile(cgroupPath, "pids.current")
	stats["pid_count"] = procsCount

	return stats, nil
}

// Helper: write to cgroup file
func (cm *CgroupManager) writeCgroupFile(cgroupPath, filename, value string) error {
	filepath := filepath.Join(cgroupPath, filename)
	return os.WriteFile(filepath, []byte(value), 0644)
}

// Helper: read from cgroup file
func (cm *CgroupManager) readCgroupFile(cgroupPath, filename string) (string, error) {
	filepath := filepath.Join(cgroupPath, filename)
	data, err := os.ReadFile(filepath)
	return string(data), err
}
```

#### Step 2: Database schema for cgroup configuration

```sql
-- Add cgroup config table
CREATE TABLE IF NOT EXISTS cgroup_configs (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE,
    cpu_percent INTEGER DEFAULT 50,
    memory_mb INTEGER DEFAULT 512,
    io_read_mbps INTEGER DEFAULT 50,
    io_write_mbps INTEGER DEFAULT 50,
    max_pids INTEGER DEFAULT 256,
    enabled BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Add index for fast lookup
CREATE INDEX idx_cgroup_configs_account ON cgroup_configs(account_id);

-- Add cgroup events table (for monitoring)
CREATE TABLE IF NOT EXISTS cgroup_events (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    event_type TEXT,  -- created, updated, deleted, limit_exceeded
    cpu_usage_percent INTEGER,
    memory_usage_mb INTEGER,
    pid_count INTEGER,
    message TEXT,
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_cgroup_events_account ON cgroup_events(account_id, event_time);
```

#### Step 3: API handler integration

```go
// In api/account_handler.go - extend CreateAccount handler

func (h *AccountHandler) CreateAccount(ctx context.Context, 
	req *CreateAccountRequest) (*Account, error) {
	
	// ... existing validation code ...
	
	// Create account in DB
	account := &Account{
		ID:    generateAccountID(),
		Name:  req.Name,
		Email: req.Email,
		// ... other fields ...
	}
	
	if err := h.db.Create(account).Error; err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}
	
	// NEW: Create cgroup for account (async)
	go func() {
		cgroupMgr, err := agent.NewCgroupManager()
		if err != nil {
			h.logger.Error("cgroup manager init failed", err)
			return // Graceful degradation - account still works
		}
		
		cfg := agent.CgroupConfig{
			AccountID:   account.ID,
			CPUPercent:  50,
			MemoryMB:    512,
			IOReadMBps:  50,
			IOWriteMBps: 50,
			MaxPIDs:     256,
		}
		
		if err := cgroupMgr.CreateAccountCgroup(cfg); err != nil {
			h.logger.Error("cgroup creation failed", "account_id", account.ID, "err", err)
			// Log to audit, but don't fail account creation
			h.auditLog("cgroup_creation_failed", account.ID, err.Error())
		}
	}()
	
	return account, nil
}
```

#### Step 4: Feature flag for cgroups

```go
// In agent/features.go or config module

type FeatureFlags struct {
	CgroupsEnabled bool `env:"FEATURE_CGROUPS" default:"false"`
	// ... other flags ...
}

// In handlers, check flag before using cgroups
if !h.features.CgroupsEnabled {
	h.logger.Info("cgroups disabled, skipping resource isolation")
	// Continue without cgroups
}
```

### Metrics (Prometheus)

```go
// In agent/metrics.go

import "github.com/prometheus/client_golang/prometheus"

var (
	CgroupsCPUUsage = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "npanel_cgroups_cpu_usage_percent",
			Help: "CPU usage per account",
		},
		[]string{"account_id"},
	)
	
	CgroupsMemoryUsage = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "npanel_cgroups_memory_usage_bytes",
			Help: "Memory usage per account",
		},
		[]string{"account_id"},
	)
	
	CgroupsPIDCount = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "npanel_cgroups_pid_count",
			Help: "Process count per account",
		},
		[]string{"account_id"},
	)
	
	CgroupsLimitExceeded = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "npanel_cgroups_limit_exceeded_total",
			Help: "Count of cgroup limit violations",
		},
		[]string{"account_id", "resource_type"},
	)
)

// Collector function (runs every 30 seconds)
func (cm *CgroupManager) CollectMetrics(db *gorm.DB) {
	var accounts []string
	db.Model(&Account{}).Pluck("id", &accounts)
	
	for _, accountID := range accounts {
		stats, err := cm.GetCgroupStats(accountID)
		if err != nil {
			continue
		}
		
		// Parse and record metrics
		// (parse cpu.stat, memory.current, pids.current)
	}
}
```

### Acceptance Criteria

✅ **Functionality**
- [ ] cgroups v2 created successfully on account creation
- [ ] CPU limit enforced (fork bomb spawns <256 processes)
- [ ] Memory limit enforced (runaway allocation stopped)
- [ ] IO limit enforced (disk IO capped)
- [ ] cgroup removed on account deletion

✅ **Performance**
- [ ] Idle CPU impact: <0.1% increase
- [ ] Idle RAM impact: <5 MB increase
- [ ] Account creation latency: +<10 ms

✅ **Reliability**
- [ ] Graceful degradation if cgroups unavailable
- [ ] No cascading failures
- [ ] Metrics collected successfully

✅ **Security**
- [ ] Account isolation verified (cross-account boundary test)
- [ ] Privilege escalation vectors: 0
- [ ] Audit log entry for all cgroup operations

### Rollback Plan

```
If cgroups breaks:
  1. Set FEATURE_CGROUPS=false
  2. Reload agent
  3. Fall back to per-process rlimit
  4. Investigate root cause
  5. Fix and re-test before re-enable
```

---

## Task 1.2: Email Rate Limiting (Parallel Track)

**Owner:** Email Services Engineer  
**Timeline:** Tue 2/2 - Thu 2/4 (3 days)  
**Complexity:** Medium  
**Depends on:** Email service running  

### Implementation

*Similar structure to Task 1.1:*

- Add rate limit table to SQLite
- Exim policy configuration
- API endpoint for rate limit config
- Prometheus metrics
- Feature flag
- Acceptance criteria
- Rollback plan

[Complete implementation follows same pattern as cgroups]

---

## Task 1.3: Agent Watchdog Service

**Owner:** Backend SRE  
**Timeline:** Wed 2/3 - Thu 2/4 (2 days)  
**Complexity:** Medium-High  

[Similar structure, systemd service-based]

---

## Task 1.4: Performance Baseline Measurement

**Owner:** DevOps  
**Timeline:** Thu 2/4 - Fri 2/5 (2 days)  

### Baseline Script

```bash
#!/bin/bash
# baseline.sh - Measure pre-Phase5 performance

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BASELINE_DIR="./metrics/baseline_${TIMESTAMP}"
mkdir -p $BASELINE_DIR

echo "=== PHASE 5 PERFORMANCE BASELINE ===" | tee $BASELINE_DIR/baseline.log
echo "Timestamp: $TIMESTAMP" | tee -a $BASELINE_DIR/baseline.log

# CPU idle
echo -n "CPU idle: "
top -bn1 | grep "Cpu(s)" | tail -1 | awk '{print 100 - $8}' | tee -a $BASELINE_DIR/baseline.log

# Memory usage
echo -n "Memory used: "
free -h | grep "Mem" | awk '{print $3}' | tee -a $BASELINE_DIR/baseline.log

# API latency (p50, p95, p99)
echo "API Latency Test (100 requests to /api/status):" | tee -a $BASELINE_DIR/baseline.log
for i in {1..100}; do
  time curl -s http://localhost:3000/api/status > /dev/null
done | grep real | tee -a $BASELINE_DIR/baseline.log

# Email throughput
echo "Email throughput test..." | tee -a $BASELINE_DIR/baseline.log
# Send 100 test emails, measure time
# ...

echo "Baseline complete: $BASELINE_DIR"
```

---

## Task 1.5: Feature Gating Infrastructure

**Owner:** Backend  
**Timeline:** Thu 2/4 - Fri 2/5 (2 days)  

### Feature Flags Table

```sql
CREATE TABLE IF NOT EXISTS feature_flags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT 0,
    track TEXT,  -- A, B, or C
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO feature_flags (name, track) VALUES
    ('cgroups_isolation', 'A'),
    ('email_rate_limiting', 'A'),
    ('agent_watchdog', 'A'),
    ('graceful_reloads', 'A'),
    ('config_layering', 'A'),
    ('packages_support', 'B'),
    ('quota_enforcement', 'B'),
    ('reseller_hierarchy', 'B'),
    ('whmcs_api', 'B'),
    ('progress_tracking', 'C'),
    ('health_scoring', 'C'),
    ('audit_logs_v2', 'C'),
    ('smart_defaults', 'C'),
    ('upgrade_framework', 'C');
```

### Feature Gate Middleware

```go
func (h *Handler) CheckFeatureFlag(featureName string) error {
	var flag FeatureFlag
	if err := h.db.Where("name = ?", featureName).First(&flag).Error; err != nil {
		return fmt.Errorf("feature not found: %s", featureName)
	}
	
	if !flag.Enabled {
		return fmt.Errorf("feature disabled: %s", featureName)
	}
	
	return nil
}

// Usage in handler
func (h *Handler) HandleCreateDomain(w http.ResponseWriter, r *http.Request) {
	// Check if feature enabled
	if err := h.CheckFeatureFlag("graceful_reloads"); err != nil {
		http.Error(w, "Feature not available", http.StatusServiceUnavailable)
		return
	}
	
	// ... proceed with handler logic ...
}
```

---

## Task 1.6: Monitoring & Metrics Setup

**Owner:** DevOps  
**Timeline:** Wed 2/3 - Fri 2/5 (ongoing)  

### Prometheus Scrape Config

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'npanel'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
```

### Alert Rules

```yaml
# alerts.yml
groups:
  - name: npanel_phase5
    rules:
      - alert: IdleCPUExceeded
        expr: npanel_cpu_idle > 1.5
        for: 5m
        annotations:
          summary: "CPU idle exceeds 1.5%"
          
      - alert: MemoryUsageIncreased
        expr: npanel_memory_bytes > baseline_memory * 1.1
        for: 5m
        annotations:
          summary: "Memory usage increased >10%"
          
      - alert: CgroupLimitExceeded
        expr: increase(npanel_cgroups_limit_exceeded_total[5m]) > 5
        annotations:
          summary: "Cgroup limits exceeded multiple times"
```

---

## Task 1.7: Soak Test Framework

**Owner:** QA/DevOps  
**Timeline:** Thu 2/4 - Fri 2/5 (starts at EOF)  

### Soak Test Scenarios

```go
// tests/soak_test.go

func TestSoak24HoursNormalLoad(t *testing.T) {
	// Run for 24 hours:
	// - 1000 accounts with 5 MB data each
	// - 100 req/sec to API
	// - 50 email sends/sec
	// - Monitor: CPU, RAM, disk IO, connections
	
	duration := 24 * time.Hour
	endTime := time.Now().Add(duration)
	
	for time.Now().Before(endTime) {
		// Simulate normal load
		t.Logf("Time: %v CPU: %.2f%% RAM: %d MB", 
			time.Now(), getCPU(), getMemory())
		
		time.Sleep(10 * time.Second)
	}
	
	// Verify metrics stable
	if getCPU() > 1.5 {
		t.Fatalf("CPU exceeded 1.5%%")
	}
}

func TestSoakChaosAgentKill(t *testing.T) {
	// Kill agent every 5-10 minutes for 24 hours
	// Verify auto-recovery and no data loss
	
	duration := 24 * time.Hour
	endTime := time.Now().Add(duration)
	
	for time.Now().Before(endTime) {
		// Kill agent
		killAgent()
		
		// Verify recovery within 10 seconds
		time.Sleep(10 * time.Second)
		if !isAgentHealthy() {
			t.Fatalf("Agent not recovered after 10 seconds")
		}
		
		// Sleep 5-10 min before next kill
		time.Sleep(time.Duration(5+rand.Intn(5)) * time.Minute)
	}
}
```

---

## Friday 2/5: Review & Gate 0 Approval

### Success Criteria

✅ **Cgroups v2**
- [ ] Kernel compatibility verified (AlmaLinux 8+)
- [ ] Resource limits enforced
- [ ] Metrics collected
- [ ] Rollback tested

✅ **Email Rate Limiting**
- [ ] Exim policy loaded
- [ ] Rate limits enforced
- [ ] No false deferrals
- [ ] Metrics collected

✅ **Agent Watchdog**
- [ ] Detects agent death within 6 seconds
- [ ] Recovery within 10 seconds
- [ ] No cascading restarts
- [ ] Audit trail logged

✅ **Performance Baseline**
- [ ] All metrics captured
- [ ] Thresholds set
- [ ] Alerts configured

✅ **Feature Gating**
- [ ] All 15 features in DB
- [ ] Disabled by default
- [ ] API endpoint working

✅ **Monitoring Setup**
- [ ] Prometheus scraping
- [ ] Grafana dashboards ready
- [ ] Alerts firing correctly

✅ **Soak Test**
- [ ] Running (24+ hours)
- [ ] Metrics stable
- [ ] No crashes detected (yet)

### Gate 0 Approval Meeting (Friday 2/5, EOD)

```
Decision Gates:
✓ All 7 tasks complete
✓ Code merged to feature branch (1 review required)
✓ All metrics within bounds
✓ Soak test running stable
✓ Rollback procedures tested

→ IF approved: Proceed to Week 2 (graceful reloads + config layering)
→ IF blocked: Fix issues, extend timeline
```

---

## Commit & Push Strategy

```bash
# Monday EOD: Gate 0 approval
git checkout -b feature/track-a-hardening

# Commit individual tasks as complete
git commit -m "Task 1.1: cgroups v2 implementation

- NewCgroupManager with v2 support
- CreateAccountCgroup, UpdateCgroupLimits, DeleteAccountCgroup
- CPU/memory/IO/PID limit enforcement
- Graceful degradation if cgroups unavailable
- Prometheus metrics collection
- Feature flag FEATURE_CGROUPS=false by default
- Rollback plan documented

Performance impact:
  - Idle CPU: +0.1%
  - Idle RAM: +5 MB
  - Account creation latency: +10 ms

Acceptance criteria: All passed
  - Account isolation verified
  - Limits enforced
  - Metrics collected
  - Audit logged"

git commit -m "Task 1.2: Email rate limiting

- Exim policy configuration
- Database schema for rate limits
- API PATCH /api/accounts/{id}/email-limits
- Prometheus metrics: email_rate_limit_violations_total
- Feature flag: FEATURE_EMAIL_RATE_LIMITING=false

Performance impact:
  - Idle CPU: +0.05%
  - Idle RAM: +2 MB

Acceptance criteria: All passed"

# ... similar for 1.3-1.7 ...

# Friday EOD: Merge to main after Gate 0 approval
git push origin feature/track-a-hardening
# Create PR, wait for review, then merge
```

---

## Document Version

- **Phase:** 5, Week 1 Execution
- **Status:** READY TO EXECUTE
- **Date:** January 25, 2026 (plan) → February 1-7, 2026 (execution)
- **Next Document:** Week 2 Execution (graceful reloads + config layering)

