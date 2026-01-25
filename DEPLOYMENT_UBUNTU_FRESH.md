# Ubuntu Fresh Deployment Guide - Phase 5 Week 1

**Target:** Fresh Ubuntu container/VM  
**Duration:** ~30 minutes (excluding soak tests)  
**Prerequisites Check:** Automated with validation script  

---

## Pre-Deployment Checklist

### 1. Run Validation Script (MANDATORY)
```bash
# Make script executable
chmod +x scripts/check_prerequisites.sh

# Run validation
sudo bash scripts/check_prerequisites.sh
```

**Script will check:**
- ✅ Go 1.23+ installed
- ✅ Node.js 18+ installed
- ✅ SQLite3 available
- ✅ systemd running
- ✅ cgroups v2 support
- ✅ Sufficient disk (≥10 GB)
- ✅ Sufficient memory (≥4 GB)
- ✅ Network connectivity
- ✅ All required binaries (top, free, iostat, bc, curl, rsync, etc.)

**Output:**
- ✅ GREEN: Ready to deploy
- ❌ RED: Missing critical packages
- ⚠️ YELLOW: Optional but recommended

### 2. If Validation Fails

The script provides distro-specific install commands:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y golang-1.23 nodejs npm sqlite3 git
sudo apt-get install -y procps sysstat curl bc
sudo apt-get install -y exim4 rsync build-essential
```

**CentOS/RHEL/Fedora:**
```bash
sudo dnf install -y golang nodejs npm sqlite git
sudo dnf install -y procps-ng sysstat curl bc
sudo dnf install -y exim rsync gcc make
```

**Alpine:**
```bash
apk add go nodejs npm sqlite git
apk add procps sysstat curl bc
apk add exim rsync
```

---

## Full Deployment Steps

### Step 1: System Preparation (5 min)

```bash
# 1.1 Update system
sudo apt-get update && sudo apt-get upgrade -y

# 1.2 Clone repository
cd /opt
sudo git clone https://github.com/omenyx/npanel.git
cd npanel

# 1.3 Run validation script
sudo bash scripts/check_prerequisites.sh

# Expected output:
# ✓ Passed: 25+
# ✗ Failed: 0
# ⚠ Warnings: 0-2 (acceptable)
```

### Step 2: Database Setup (3 min)

```bash
# 2.1 Create database directory
sudo mkdir -p /opt/npanel/data
sudo chown nobody:nogroup /opt/npanel/data
sudo chmod 755 /opt/npanel/data

# 2.2 Initialize database
sudo sqlite3 /opt/npanel/data/npanel.db < backend/migrations/005_cgroups_v2.sql

# 2.3 Verify tables created
sudo sqlite3 /opt/npanel/data/npanel.db ".tables"
# Should show: accounts cgroup_configs cgroup_events feature_flags ...
```

### Step 3: Install Watchdog Service (2 min)

```bash
# 3.1 Install systemd service
sudo cp etc/systemd/system/npanel-watchdog.service /etc/systemd/system/

# 3.2 Reload systemd
sudo systemctl daemon-reload

# 3.3 Enable watchdog (auto-start on boot)
sudo systemctl enable npanel-watchdog

# 3.4 Start watchdog service
sudo systemctl start npanel-watchdog

# 3.5 Verify running
sudo systemctl status npanel-watchdog
# Should show: active (running)
```

### Step 4: Configure Prometheus (3 min)

```bash
# 4.1 Create Prometheus config directory
sudo mkdir -p /etc/prometheus

# 4.2 Copy nPanel Prometheus config
sudo cp config/prometheus_phase5.yml /etc/prometheus/npanel-phase5.yml

# 4.3 Update main Prometheus config to include:
# global:
#   scrape_interval: 15s
# scrape_configs:
#   - job_name: 'npanel'
#     static_configs:
#       - targets: ['localhost:9090']

# 4.4 Reload Prometheus
sudo systemctl restart prometheus

# 4.5 Verify metrics
curl http://localhost:9090/api/v1/query?query=up
```

### Step 5: Build Backend (5 min)

```bash
# 5.1 Navigate to backend
cd backend

# 5.2 Download dependencies
go mod download

# 5.3 Build binary
go build -o npanel-api .

# 5.4 Verify binary
./npanel-api --version

# 5.5 Copy to /opt/npanel/bin
sudo mkdir -p /opt/npanel/bin
sudo cp npanel-api /opt/npanel/bin/
sudo chmod +x /opt/npanel/bin/npanel-api
```

### Step 6: Build Frontend (5 min)

```bash
# 6.1 Navigate to frontend
cd ../frontend

# 6.2 Install Node dependencies
npm install

# 6.3 Build React app
npm run build

# 6.4 Copy to /opt/npanel/public
sudo mkdir -p /opt/npanel/public
sudo cp -r build/* /opt/npanel/public/
```

### Step 7: Build Agent (3 min)

```bash
# 7.1 Navigate to agent
cd ../agent

# 7.2 Build agent binary
go build -o npanel-agent .

# 7.3 Install as root-owned service
sudo cp npanel-agent /opt/npanel/bin/
sudo chmod +x /opt/npanel/bin/npanel-agent
sudo chmod 4755 /opt/npanel/bin/npanel-agent  # SUID for root operations
```

### Step 8: Record Performance Baseline (5 min)

```bash
# 8.1 Make baseline script executable
chmod +x scripts/measure_baseline.sh

# 8.2 Run baseline measurement
sudo bash scripts/measure_baseline.sh

# Expected output:
# ========== PERFORMANCE BASELINE ==========
# CPU Idle:           98.5%
# CPU Used:           1.5%
# nPanel Memory RSS:  128MB
# System Memory:      45%
# API Latency:        45ms
# ...
# ==========================================

# 8.3 Verify JSON export
cat /opt/npanel/config/baseline-metrics.json

# 8.4 Verify database entries
sudo sqlite3 /opt/npanel/data/npanel.db "SELECT * FROM performance_baseline;"
```

### Step 9: Start Services (2 min)

```bash
# 9.1 Start agent (must run as root)
sudo /opt/npanel/bin/npanel-agent &

# 9.2 Start API server
/opt/npanel/bin/npanel-api &

# 9.3 Start frontend (optional, usually behind nginx)
# cd /opt/npanel/public && python -m http.server 3000

# 9.4 Verify all running
ps aux | grep npanel
# Should show: npanel-agent, npanel-api, node (if applicable)
```

### Step 10: Start Soak Tests (5+ hours)

```bash
# 10.1 Navigate to backend
cd backend

# 10.2 Run all soak test scenarios
# Test 1: Stable load for 24 hours
go test -run TestSoakStable -timeout 24h -v ./...

# Test 2: Agent failures (parallel)
go test -run TestSoakWithAgentFailures -timeout 24h -v ./... &

# Test 3: High load (parallel)
go test -run TestSoakWithHighLoad -timeout 24h -v ./... &

# Test 4: cgroups stress (parallel)
go test -run TestSoakCgroupsStress -timeout 24h -v ./... &

# 10.3 Monitor metrics during soak
watch -n 10 'curl -s http://localhost:9090/api/v1/query?query=npanel_cpu_idle_percent | jq .'
```

---

## Validation at Each Step

| Step | Command | Expected |
|------|---------|----------|
| 1 | `scripts/check_prerequisites.sh` | All green ✅ |
| 2 | `sqlite3 /opt/npanel/data/npanel.db ".tables"` | Shows tables |
| 3 | `systemctl status npanel-watchdog` | active (running) |
| 4 | `curl http://localhost:9090/api/v1/query?query=up` | Returns 1 |
| 5 | `/opt/npanel/bin/npanel-api --version` | Shows version |
| 6 | `ls /opt/npanel/public/index.html` | File exists |
| 7 | `ls -la /opt/npanel/bin/npanel-agent` | executable |
| 8 | `cat /opt/npanel/config/baseline-metrics.json` | Valid JSON |
| 9 | `ps aux \| grep npanel` | 2-3 processes |
| 10 | Monitor Prometheus dashboard | Metrics stable |

---

## Troubleshooting

### Missing Packages
```bash
# Re-run validation script to identify missing packages
sudo bash scripts/check_prerequisites.sh

# Install missing (Ubuntu example)
sudo apt-get install -y [package-name]

# Re-run validation to confirm
sudo bash scripts/check_prerequisites.sh
```

### cgroups v2 Not Available
```bash
# Check cgroups version
cat /proc/cgroups | head -1

# If cgroups v1 (not v2):
# - cgroups_isolation feature will be disabled
# - Still works, just without resource isolation
# - All other Week 1 features still operational
```

### Service Fails to Start
```bash
# Check logs
sudo journalctl -u npanel-agent -n 50
sudo journalctl -u npanel-watchdog -n 50

# Verify permissions
ls -la /opt/npanel/bin/npanel-agent
# Should show: -rwsr-xr-x (with SUID bit)

# If permission denied:
sudo chmod 4755 /opt/npanel/bin/npanel-agent
```

### Database Error
```bash
# Verify database exists
ls -la /opt/npanel/data/npanel.db

# Check database integrity
sudo sqlite3 /opt/npanel/data/npanel.db "PRAGMA integrity_check;"
# Should return: ok

# If corrupted, restore from backup:
sudo sqlite3 /opt/npanel/data/npanel.db < backend/migrations/005_cgroups_v2.sql
```

---

## Post-Deployment Verification

### 1. All Services Running
```bash
ps aux | grep -E 'npanel-agent|npanel-api|node|prometheus'
# Should show 3+ processes
```

### 2. Database Verified
```bash
sudo sqlite3 /opt/npanel/data/npanel.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
# Should show: 25+ tables (Phase 4 + Phase 5)
```

### 3. Metrics Collecting
```bash
curl -s http://localhost:9090/api/v1/query?query=npanel_cpu_idle_percent | jq .
# Should return: metric values
```

### 4. Watchdog Running
```bash
sudo systemctl status npanel-watchdog
# Should show: active (running)
```

### 5. Baseline Recorded
```bash
sudo sqlite3 /opt/npanel/data/npanel.db "SELECT COUNT(*) FROM performance_baseline;"
# Should show: 10+ baseline metrics
```

---

## Gate 0 Approval Checklist

Before marking deployment complete:

- [ ] Validation script: 0 failures
- [ ] Database: All tables created
- [ ] Services: All running (3+ processes)
- [ ] Metrics: Prometheus collecting data
- [ ] Watchdog: Active and healthy
- [ ] Baseline: Recorded in database
- [ ] Soak tests: Running without crashes
- [ ] CPU: ≥96% idle (≤4% used)
- [ ] Memory: Stable (no leaks)
- [ ] API: Responding to health checks
- [ ] Phase 4 features: Still working

**Gate 0 Approved When:** All 11 items checked ✅

---

## Rollback (If Needed)

```bash
# Quick disable (keep database)
sudo systemctl stop npanel-watchdog
sudo systemctl stop npanel-agent
sudo systemctl stop npanel-api

# Full cleanup (remove Phase 5)
sudo rm -rf /opt/npanel/data/cgroup_configs
sudo rm -rf /opt/npanel/data/cgroup_events
sudo sqlite3 /opt/npanel/data/npanel.db "DROP TABLE IF EXISTS cgroup_configs; DROP TABLE IF EXISTS cgroup_events;"

# Revert code
git revert ff43d0d8

# Restart with Phase 4 only
sudo systemctl start npanel-agent
sudo systemctl start npanel-api
```

---

## Support

**Issues during deployment:**
1. Run: `sudo bash scripts/check_prerequisites.sh`
2. Install any missing packages
3. Re-run failing step
4. If still broken: Check `/var/log/syslog` or `journalctl`

**Documentation:**
- Detailed architecture: `PHASE_5_MASTER_SPECIFICATION.md`
- Implementation details: `PHASE_5_WEEK_1_CODE_READY.md`
- Execution guide: `PHASE_5_WEEK_1_EXECUTION.md`

---

**Estimated Total Deployment Time: 30 minutes (excluding soak tests)**

**Status: READY FOR DEPLOYMENT ✅**
