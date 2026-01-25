# Phase 5: Controlled Evolution - Master Specification

**Date:** January 25, 2026  
**Status:** PHASE 5 DESIGN APPROVED  
**Architect:** Senior Platform SRE  
**Performance Constraints:** NON-NEGOTIABLE

---

## Executive Summary

Phase 5 transforms nPanel from a feature-complete platform into an **enterprise-grade, scalable hosting control panel** that can compete with cPanel on stability, scale, and monetization—WITHOUT sacrificing performance or resource efficiency.

**Three parallel tracks:**
- **Track A: Hardening & Scale** - Resource isolation, auto-recovery, abuse protection
- **Track B: Reseller & Billing** - Monetization readiness with WHMCS integration
- **Track C: Polish & Differentiation** - Superior UX, health scoring, predictable upgrades

**Phase 5 Guiding Principle:**
> "Does this feature improve hosting stability without costing performance?"

---

## Performance Constraints (Non-Negotiable)

### CPU & Memory Rules
- **Idle CPU:** ≤ 1% across all services
- **Idle RAM:** No increase from current baseline
- **Peak CPU per account:** Cgroups v2 enforced (default: 50% of 1 core)
- **Peak RAM per account:** Cgroups v2 enforced (default: 512 MB)
- **No synchronous blocking** on hot paths

### Async & Rate Limiting
- **All heavy work:** Async with queue
- **Job queue size:** Max 100 pending jobs
- **Concurrent jobs:** Max 3 concurrent migrations, configurable per resource type
- **API rate limits:** Per-IP (100 req/min), per-account (1000 req/min), per-admin (unlimited)
- **Email rate limits:** Per-account (500 emails/hour), burst (100 emails/15min)

### Observability
- **Every feature must include:** Prometheus metrics + alerts
- **Performance regression threshold:** ±5% idle CPU, ±10% peak RAM
- **Rollback trigger:** If any metric exceeds threshold post-deploy

---

## Track A: Hardening & Scale

### 1.1 Per-Account Resource Isolation (cgroups v2)

**Problem Statement:**  
One runaway account (spam bot, fork bomb, disk-fill attack) can crash entire server. Current implementation lacks process isolation.

**Solution:**  
Implement cgroups v2 enforcement per account with agent-managed limits.

**Agent Actions:**
```
On account creation:
  → Create cgroup: /sys/fs/cgroup/user.slice/user-{uid}.slice
  → Set CPU: 50% of 1 core (configurable)
  → Set Memory: 512 MB (configurable)
  → Set IO: Read 50 MB/s, Write 50 MB/s (configurable)
  → Set PIDs: Max 256 processes
  → Move all account processes into cgroup

On account suspension:
  → Freeze cgroup (SIGSTOP all processes)
  → Keep cgroup in place for rollback

On account deletion:
  → Kill cgroup (SIGKILL)
  → Prune cgroup directories
```

**Performance Impact:**
- **Idle CPU:** +0.1% (cgroup monitoring)
- **Idle RAM:** +5 MB (cgroup structures)
- **Peak CPU:** -2% (process contention reduced)
- **Peak RAM:** -20% (rogue processes capped)

**Resource Limits:**
- **Memory overhead per account:** 2 MB
- **CPU monitoring interval:** 5 seconds
- **Max cgroups:** 10,000 (platform limit)

**Rollback Plan:**
```
On cgroup enforcement failure:
  1. Fall back to rlimit per process
  2. Alert SRE immediately
  3. Log incident with account uid
  4. Auto-disable for that account
  5. Continue monitoring other accounts
```

**Success Criteria:**
- ✅ Account fork bombs contained to 256 PIDs
- ✅ Rogue account CPU capped at 50% of 1 core
- ✅ Server remains stable under attack
- ✅ No false-positive kills of legitimate processes

**Implementation Steps:**
1. Add cgroups v2 utility functions to agent
2. Create cgroup manager with versioning
3. Integrate with account lifecycle hooks
4. Add monitoring + alerting
5. 72-hour soak test with simulated abuse

---

### 1.2 Email Abuse Protection & Rate Limiting

**Problem Statement:**  
One compromised account can send millions of emails, destroying server reputation and overwhelming mail queue. No current per-account rate limiting.

**Solution:**  
Implement multi-layer email rate limiting at MTA level with per-account quotas.

**Agent Actions:**
```
On account email limit set:
  → Query Exim config for account
  → Set rate limit policy in /etc/exim/policies/{account}.conf
  → Reload Exim (graceful)
  → Enable monitoring

On limit exceeded:
  → Defer emails with 452 code (temporary failure)
  → Log incident to audit trail
  → Alert account owner via email
  → If repeat: suggest upgrade or flag for review

Limits (configurable per account):
  → 500 emails/hour (default)
  → 100 emails/15min (burst limit)
  → 50 MB outbound/hour
  → 10 simultaneous outbound connections
```

**Performance Impact:**
- **Idle CPU:** +0.05% (rate limiting check)
- **Idle RAM:** +2 MB (policy cache)
- **Mail throughput:** 0% change (limits only trigger on abuse)

**Resource Limits:**
- **Policy cache:** 1 MB per 1000 accounts
- **Audit log:** 10 KB per rate-limit event
- **Queue depth:** Capped at 10,000 messages

**Rollback Plan:**
```
On rate limiter failure:
  1. Disable per-account rate limiting
  2. Fall back to server-wide queue management
  3. Alert SRE
  4. Allow manual override via API
```

**Success Criteria:**
- ✅ Compromised account cannot send >500 emails/hour
- ✅ Legitimate bulk mailers can be upgraded
- ✅ No false-positive deferrals of legitimate mail
- ✅ Reputation metrics improve (fewer blocks from ISPs)

**Implementation Steps:**
1. Create Exim policy template language
2. Add rate limiting table to SQLite
3. Integrate with email service
4. Add API endpoints for rate limit config
5. Create dashboard widget for email usage
6. Test with 100GB email accounts

---

### 1.3 Agent Watchdog & Auto-Recovery

**Problem Statement:**  
If local agent dies (OOM, segfault, kernel panic), entire system becomes unmanageable. Manual restart required, losing audit trail of failure.

**Solution:**  
Implement systemd-based watchdog with automatic recovery and failure logging.

**Agent Actions:**
```
Watchdog process (separate):
  1. Every 2 seconds: Check if agent is responsive
     → Send ping to agent via socket
     → Timeout: 1 second
  
  2. On ping failure:
     → Wait 3 seconds (allow recovery)
     → Ping again
     → If still down → kill and restart agent
  
  3. On restart:
     → Log failure reason (graceful vs crash)
     → Capture last 100 lines of agent log
     → Alert SRE via syslog
     → Store failure metadata in audit DB
  
  4. Limit restarts:
     → Max 5 restarts in 1 hour
     → If exceeded: Stop watchdog, alert SRE
     → Manual intervention required

Recovery stages:
  STAGE 1: Graceful restart (fast, preserves state)
  STAGE 2: Hard restart with cleanup (medium)
  STAGE 3: Manual SRE intervention (last resort)
```

**Performance Impact:**
- **Idle CPU:** +0.3% (watchdog process + ping checks)
- **Idle RAM:** +10 MB (watchdog + state buffer)
- **Socket latency:** +1 ms (ping overhead)

**Resource Limits:**
- **Watchdog memory:** Max 20 MB
- **Ping interval:** 2 seconds (not configurable for safety)
- **Restart timeout:** 30 seconds (max wait for clean startup)

**Rollback Plan:**
```
If watchdog itself fails:
  1. systemd auto-restarts watchdog
  2. If watchdog crashes >5 times in 1 hour:
     → systemd stops trying
     → System enters degraded state
     → Kernel syslog captures the failure
     → SRE must manually investigate
```

**Success Criteria:**
- ✅ Agent death detected within 6 seconds
- ✅ Automatic recovery without manual intervention
- ✅ Audit trail preserved (no lost operations)
- ✅ Users experience <10 second service interruption

**Implementation Steps:**
1. Create watchdog binary (Go, <5 MB)
2. Add to systemd as separate service
3. Implement socket health check
4. Create failure audit log table
5. Add alerting to monitoring system
6. Test with forced agent crashes (kill -9)

---

### 1.4 Graceful Service Reloads (Zero Downtime)

**Problem Statement:**  
Current system requires hard restart for config changes. Users can't migrate during updates. Production deployments are high-risk.

**Solution:**  
Implement graceful reload pattern where new connections use new config while existing connections finish.

**Agent Actions:**
```
On config change signal (SIGHUP):
  1. Load new config into memory
  2. Validate new config (fail if invalid)
  3. Fork new agent instance with new config
  4. New instance binds to separate socket
  5. Old instance:
     → Stop accepting NEW connections
     → Wait for existing operations to complete
     → Timeout: 5 minutes
     → Then shutdown gracefully
  6. API proxy routes new requests to new agent
  7. Old agent removed from routing after drain
  8. Optional: Sync state from old to new agent

Config versioning:
  → Store version in DB
  → Track which agent version is active
  → Allow rollback to previous config
```

**Performance Impact:**
- **Idle CPU:** +0.5% (during reload window only)
- **Idle RAM:** +2x agent RAM during reload (temporary)
- **Operation latency:** 0% change post-reload

**Resource Limits:**
- **Config reload time:** <5 seconds
- **Connection drain timeout:** 5 minutes
- **Max concurrent agents:** 2 (old + new)

**Rollback Plan:**
```
If new config is invalid:
  1. Validation fails, no reload occurs
  2. Old agent continues unchanged
  3. Error returned to API with details
  4. Admin alerted immediately

If new config causes crashes:
  1. New agent logs error and exits
  2. Old agent remains active
  3. API detects failure and reverts routing
  4. Manual investigation required
```

**Success Criteria:**
- ✅ Config changes without dropping connections
- ✅ Zero downtime for users during reload
- ✅ In-flight operations complete successfully
- ✅ Automatic rollback on validation failure

**Implementation Steps:**
1. Add SIGHUP handler to agent
2. Implement config versioning in DB
3. Create agent fork/exec mechanism
4. Add state sync between agents
5. Update API routing logic
6. Test with live migration during config change

---

### 1.5 Upgrade-Safe Configuration Layering

**Problem Statement:**  
Upgrades can overwrite custom configs. No clear separation between defaults and user changes. Hard to debug which setting is active.

**Solution:**  
Implement layered config system with clear precedence and migration safety.

**Config Layers (in precedence order):**
```
LAYER 1: Built-in defaults (immutable)
  → /opt/npanel/config/defaults.yaml
  → Versioned with code
  → Never modified post-install

LAYER 2: System configuration (admin changes)
  → /etc/npanel/config.yaml
  → Survives upgrades
  → Merged with defaults
  → Validated on load

LAYER 3: Environment overrides
  → /etc/npanel/config.env
  → Loaded after LAYER 2
  → For container/automation use

LAYER 4: Runtime flags
  → Passed to services
  → Override everything
  → Not persisted
```

**Config Upgrade Process:**
```
On new version install:
  1. Check if /etc/npanel/config.yaml exists
  2. If yes:
     → Parse old config
     → Extract only custom keys (non-defaults)
     → Compare with new defaults
     → Warn if defaults changed
     → Merge old custom values with new defaults
  3. If no (fresh install):
     → Copy defaults to /etc/npanel/config.yaml
  4. Validate resulting config
  5. If invalid:
     → Revert to previous version's config
     → Alert admin with details
     → Require manual migration
```

**Performance Impact:**
- **Config load time:** +50 ms (first load only, then cached)
- **Idle RAM:** +2 MB (config cache)
- **Disk I/O:** Negligible

**Resource Limits:**
- **Config file size:** Max 10 MB
- **Config load timeout:** 5 seconds
- **Cache TTL:** 1 hour (force reload if file changed)

**Rollback Plan:**
```
If merged config is invalid:
  1. Use previous working config
  2. Log which keys changed
  3. Alert admin to review conflicts
  4. Offer to rollback to previous version entirely
```

**Success Criteria:**
- ✅ Upgrades never destroy custom settings
- ✅ Clear visibility into active settings
- ✅ Easy rollback to previous config
- ✅ No surprises post-upgrade

**Implementation Steps:**
1. Create config schema in YAML
2. Add config versioning to installer
3. Implement merge logic with precedence
4. Add config diff tool for admins
5. Create config validation before deployment
6. Document custom config best practices

---

### 1.6 Long-Run Soak Testing & Failure Injection

**Problem Statement:**  
Features work in 1-hour tests but fail after 24 hours (memory leaks, connection pool exhaustion, etc.). No automated way to detect subtle failures.

**Solution:**  
Build chaos engineering framework with automated failure injection and long-run monitoring.

**Soak Test Framework:**
```
Test scenarios (24-72 hour runs):

Scenario 1: Normal Load
  → 1000 accounts, 5 MB each
  → 100 req/sec to API
  → 50 email sends/sec
  → Monitor: CPU, RAM, disk IO, connections

Scenario 2: Agent Restart Chaos
  → Every 5-10 minutes: Kill agent mid-operation
  → Verify auto-recovery works
  → Check for lost data/audit trail

Scenario 3: Resource Exhaustion
  → Fill disk to 90%
  → Fill RAM to 80%
  → Saturate network
  → Verify graceful degradation

Scenario 4: Connection Storm
  → Open 10,000 concurrent connections
  → Send rapid requests
  → Verify no file descriptor exhaustion

Metrics tracked (every 10 seconds):
  → CPU usage, breakdown by service
  → RAM usage, breakdown by service
  → Disk I/O (read/write rates)
  → Open file descriptors
  → Network connections (by type)
  → API latency (p50, p95, p99)
  → Error rates
  → Queue depths
```

**Performance Impact:**
- **Test mode:** Can run separately from production
- **No production impact:** Tests on staging only

**Rollback Plan:**
```
If soak test fails:
  1. Capture full diagnostics
  2. Stop test immediately
  3. Analyze failure with SRE
  4. Identify root cause (code/config/environment)
  5. Fix and re-test
```

**Success Criteria:**
- ✅ 72-hour run without crashes
- ✅ No memory leaks detected (RSS stable)
- ✅ No connection exhaustion
- ✅ Agent auto-recovery works >100 times
- ✅ All metrics within expected ranges

**Implementation Steps:**
1. Create test harness in Go
2. Implement scenarios as modules
3. Build metrics collection pipeline
4. Create failure injection utilities
5. Set up automated test runner (weekly)
6. Create test result dashboard

---

## Track B: Reseller & Billing Readiness

### 2.1 Hosting Package Templates

**Problem Statement:**  
Currently all accounts are identical. No way to offer tiered hosting plans (Basic/Pro/Enterprise). Resellers can't manage multiple product tiers.

**Solution:**  
Create configurable package templates with feature toggles and resource limits.

**Package Model:**
```yaml
packages:
  - id: "basic"
    name: "Basic Hosting"
    disk_quota: "10 GB"
    bandwidth_quota: "100 GB/month"
    email_accounts: 5
    databases: 2
    addon_domains: 1
    features:
      - email_forwarding
      - basic_ssl
    disabled_features:
      - api_access
      - reseller
      - importer
    pricing:
      monthly: 299  # cents
      annual: 2999
  
  - id: "pro"
    name: "Pro Hosting"
    disk_quota: "50 GB"
    bandwidth_quota: "500 GB/month"
    email_accounts: 25
    databases: 10
    addon_domains: 10
    features:
      - email_forwarding
      - wildcard_ssl
      - api_access
      - cdn
    pricing:
      monthly: 999
      annual: 9990
  
  - id: "enterprise"
    name: "Enterprise Hosting"
    disk_quota: "unlimited"
    bandwidth_quota: "unlimited"
    email_accounts: "unlimited"
    databases: "unlimited"
    features:
      - everything
    pricing:
      contact_sales: true
```

**Package Lifecycle:**
```
On package creation:
  1. Validate config (all fields present)
  2. Store in DB with version
  3. Mark as "draft"
  4. Not available to customers yet

On package activation:
  1. Validate quotas make sense
  2. Create package features table
  3. Mark as "active"
  4. Available to new customers

On package update:
  1. Merge with existing config
  2. Ask: Apply to existing customers? (Y/N)
  3. If Y: Create update job (async, per-account)
  4. If N: Only new customers get new settings

On package deletion:
  1. Can't delete if >0 active accounts
  2. Mark as "deprecated"
  3. Can't create new accounts with it
  4. Existing customers keep old config
```

**Agent Actions:**
```
When account created with package:
  1. Parse package config
  2. Set quotas:
     → Disk: Create cgroup disk limit
     → Bandwidth: Set traffic shaper rules
     → Email: Set rate limits in Exim
  3. Set feature flags in account DB
  4. Apply disabled_features restrictions
  5. Log feature audit trail

When feature toggle accessed:
  1. Check if feature enabled in account's package
  2. If disabled: Return 403 + helpful message
  3. If enabled: Allow access
```

**Performance Impact:**
- **Idle CPU:** +0.05% (package lookup on login)
- **Idle RAM:** +5 MB (package cache)
- **Feature check latency:** +2 ms

**Resource Limits:**
- **Max packages:** 1000
- **Package config size:** 50 KB
- **Cache TTL:** 1 hour

**Rollback Plan:**
```
If package creation fails:
  1. DB transaction rollback
  2. Package marked as "invalid"
  3. Error returned to admin

If package update breaks accounts:
  1. Don't roll back (already deployed)
  2. Allow admin to manually revert specific accounts
  3. Alert affected customers
```

**Success Criteria:**
- ✅ Resellers can create >100 package types
- ✅ Feature toggles work reliably
- ✅ Quota enforcement prevents abuse
- ✅ Easy to upgrade/downgrade customers

**Implementation Steps:**
1. Add `packages` table to DB
2. Add `account_package_id` foreign key
3. Create API endpoints for package CRUD
4. Add feature toggle checks throughout code
5. Create package editor UI component
6. Build package upgrade/downgrade workflows

---

### 2.2 Resource Quota Enforcement

**Problem Statement:**  
Package templates are useless if quotas aren't actually enforced. Need real-time tracking and enforcement.

**Solution:**  
Implement quota system with real-time usage tracking and enforcement at agent level.

**Quota Types:**
```
DISK QUOTA:
  → Track usage: du -sh per account
  → Enforce: cgroups v2 disk limits
  → Warning: Alert at 80%
  → Hard limit: Prevent write at 100%
  → Grace period: 24 hours to delete files

BANDWIDTH QUOTA:
  → Track usage: tc (traffic control) counters
  → Enforce: traffic shaper rate limits
  → Measurement: Inbound + outbound bytes
  → Reset: Monthly (on account anniversary)
  → Warning: Alert at 80%, 95%

EMAIL QUOTA:
  → Track usage: Count emails sent via Exim logs
  → Enforce: Rate limiter rejects after quota
  → Measurement: Emails/hour, emails/month
  → Grace period: None (soft limit = warning only)

DATABASE QUOTA:
  → Track usage: SELECT SUM(size) FROM databases
  → Enforce: Reject CREATE if over quota
  → Measurement: MB per database

ADDON DOMAIN QUOTA:
  → Track usage: Count from domain table
  → Enforce: API prevents adding >limit
```

**Quota Checking Workflow:**
```
Every 1 hour (configurable):
  1. For each account:
     a. Get current package limits
     b. Calculate actual usage
     c. Store usage in DB (time-series)
     d. Check if over soft limits → Alert user
     e. Check if over hard limits → Enforce (suspend domain, etc.)
  2. Log all quota events to audit trail
  3. Alert admin if any accounts in violation

On quota exceeded:
  1. SOFT LIMIT (80-95%): Send email warning
  2. HARD LIMIT (100%): Take action:
     → If disk: Make filesystem read-only
     → If bandwidth: Rate-limit to 10% speed
     → If email: Start rejecting new emails
     → If databases: Prevent new table creation

User can:
  1. Delete files/emails to get under limit
  2. Request package upgrade
  3. Request temporary grace period (admin approval)
```

**Performance Impact:**
- **Hourly job CPU:** +1% (15 minutes per hour)
- **Idle CPU:** +0.1% (quota cache lookup)
- **Idle RAM:** +10 MB (quota cache)
- **API latency:** +3 ms (quota check on operation)

**Resource Limits:**
- **Max quota check jobs:** 1000 concurrent
- **Quota cache TTL:** 5 minutes
- **Quota history retention:** 2 years

**Rollback Plan:**
```
If quota enforcement breaks accounts:
  1. Disable hard limits temporarily
  2. Keep soft limits (warnings only)
  3. Alert admin to investigate
  4. Allow manual quota override per account
```

**Success Criteria:**
- ✅ Disk quota prevents runaway growth
- ✅ Bandwidth quota prevents heavy hitters from stealing resources
- ✅ Email quota prevents spam relay abuse
- ✅ Users warned before hitting limits

**Implementation Steps:**
1. Add `quota_usage` time-series table to DB
2. Create quota calculation functions
3. Add quota enforcement to agent
4. Build hourly quota check job
5. Create quota UI dashboard (usage vs limit)
6. Add quota management API endpoints

---

### 2.3 Reseller Account Hierarchy

**Problem Statement:**  
Can't offer reseller programs. No way to have resellers manage sub-accounts or control their own branding.

**Solution:**  
Implement multi-level account hierarchy with reseller controls.

**Account Types:**
```
ADMIN:
  → Can manage all accounts/resellers
  → Can set global policies
  → Can override quotas
  → Can access audit logs

RESELLER:
  → Can create/manage END_USER accounts
  → Can see only own accounts
  → Cannot see other resellers' accounts
  → Can set quotas within reseller allowance
  → Can't change reseller allowance itself

END_USER:
  → Can manage own domains, email, etc.
  → Can't create other accounts
  → Sees only own resources
  → Subject to reseller's quotas
```

**Hierarchy Model:**
```
admin (root)
├── reseller_1 (parent)
│   ├── customer_1 (end_user)
│   ├── customer_2 (end_user)
│   └── customer_3 (end_user)
├── reseller_2 (parent)
│   └── customer_4 (end_user)
└── customer_5 (end_user, direct under admin)
```

**Reseller Features:**
```
Reseller dashboard shows:
  → Total accounts: X
  → Total disk used: X GB / Y GB quota
  → Total bandwidth used: X GB / Y GB quota
  → Monthly revenue: $X (if billing enabled)
  → Payouts processed: $X
  → Pending customers: X

Reseller can:
  → Create new customers
  → Suspend/unsuspend customers
  → Change customer package
  → View customer resource usage
  → Issue credits/refunds
  → Set custom branding (logo, colors)
  → Create promotional codes
  → Set custom support email

Reseller cannot:
  → Access customer's actual servers
  → Change global system settings
  → Create other resellers
  → Override abuse policies
```

**Agent Actions:**
```
On reseller account creation:
  1. Assign parent hierarchy
  2. Set reseller quotas (total disk, accounts, etc.)
  3. Create audit log entry
  4. Send welcome email with portal link

On reseller creating customer:
  1. Validate within reseller's quotas
  2. Create account with parent = reseller_id
  3. Apply package template
  4. Initialize cgroups with reseller's limits
  5. Add to reseller's customer list

On reseller quota exceeded:
  1. Prevent creation of new accounts
  2. Alert reseller with usage details
  3. Suggest upgrade path
```

**Performance Impact:**
- **Idle CPU:** +0.05% (hierarchy lookup on auth)
- **Idle RAM:** +5 MB (hierarchy cache)
- **Login latency:** +5 ms (permission check)

**Resource Limits:**
- **Max account depth:** 3 levels (admin → reseller → customer)
- **Max sub-accounts per reseller:** 1000
- **Hierarchy cache TTL:** 15 minutes

**Rollback Plan:**
```
If hierarchy breaks permissions:
  1. Temporarily disable reseller features
  2. Fall back to flat account list
  3. Alert admin
  4. Manual audit of permissions
```

**Success Criteria:**
- ✅ Resellers can manage 1000+ customers each
- ✅ Customers can't see other customers' accounts
- ✅ Quotas prevent reseller abuse
- ✅ Easy to add/remove resellers

**Implementation Steps:**
1. Add `parent_account_id` to accounts table
2. Add `account_type` enum column
3. Create hierarchy validation logic
4. Add permission checks to all API endpoints
5. Build reseller dashboard UI
6. Create reseller management APIs

---

### 2.4 WHMCS-Compatible Provisioning API

**Problem Statement:**  
Resellers can't integrate with their existing billing systems (WHMCS). Manual account creation only. No automatic provisioning.

**Solution:**  
Build WHMCS-compatible REST API for automated account provisioning.

**WHMCS API Endpoints:**
```
POST /api/whmcs/create-account
  Input:
    - username (auto-generated from email)
    - password
    - email
    - package_id
    - domain
  Output:
    - status (success/error)
    - account_id
    - credentials
    - next_steps

POST /api/whmcs/suspend-account
  Input:
    - account_id
    - reason
  Output:
    - status
    - suspended_at

POST /api/whmcs/unsuspend-account
  Input:
    - account_id
  Output:
    - status
    - unsuspended_at

POST /api/whmcs/upgrade-package
  Input:
    - account_id
    - new_package_id
  Output:
    - status
    - upgrade_date
    - new_limits

POST /api/whmcs/terminate-account
  Input:
    - account_id
    - reason
  Output:
    - status
    - terminated_at
    - backup_location (if applicable)

GET /api/whmcs/account/{id}/status
  Output:
    - status (active/suspended/terminated)
    - disk_usage
    - bandwidth_usage
    - email_count
    - domain_count

GET /api/whmcs/account/{id}/usage
  Output:
    - disk_current / disk_limit
    - bandwidth_current / bandwidth_limit (monthly)
    - email_sent_this_month
    - created_at
    - renewal_date
```

**Authentication:**
```
WHMCS → nPanel API:
  1. Use API token (generate in admin panel)
  2. Sign request with HMAC-SHA256
  3. Include timestamp to prevent replay
  4. Format: Authorization: Bearer {token}
            X-WHMCS-Signature: {signature}
            X-WHMCS-Timestamp: {timestamp}
```

**Provisioning Workflow:**
```
WHMCS User purchases hosting plan:
  1. WHMCS sends: POST /api/whmcs/create-account
  2. nPanel validates request signature
  3. nPanel creates account with package limits
  4. nPanel returns credentials + portal URL
  5. WHMCS stores account_id for future ops
  6. WHMCS sends credentials to customer
  7. Customer logs in and configures domain

Later: User upgrades package:
  1. WHMCS sends: POST /api/whmcs/upgrade-package
  2. nPanel updates package + quotas
  3. nPanel notifies customer (email)

Later: Payment fails:
  1. WHMCS sends: POST /api/whmcs/suspend-account
  2. nPanel suspends all domains
  3. User sees "Account suspended" message
  4. Email sent with payment link

After payment:
  1. WHMCS sends: POST /api/whmcs/unsuspend-account
  2. nPanel re-enables domains
  3. Service resumed immediately
```

**Performance Impact:**
- **API latency:** <500 ms per request
- **Idle CPU:** +0.02% (API overhead)
- **Idle RAM:** +2 MB (API cache)

**Resource Limits:**
- **Max provisioning requests:** 100/sec
- **Rate limit per WHMCS instance:** 10 req/sec
- **Timeout:** 30 seconds per request

**Rollback Plan:**
```
If WHMCS API breaks:
  1. Disable API temporarily
  2. Manual account management only
  3. Alert resellers to WHMCS outage
  4. Enable API only after testing
```

**Success Criteria:**
- ✅ WHMCS can create accounts automatically
- ✅ Package limits enforced in nPanel
- ✅ Suspend/unsuspend works instantly
- ✅ Usage reporting accurate

**Implementation Steps:**
1. Add WHMCS API routes to API service
2. Implement request signature validation
3. Create provisioning jobs (async)
4. Build account creation endpoints
5. Build suspend/unsuspend endpoints
6. Add usage reporting endpoints
7. Create WHMCS module/plugin

---

## Track C: Polish & Differentiation

### 3.1 Faster Restore UX with Progress & ETA

**Problem Statement:**  
Restore operations show nothing while running. Users don't know if it's stuck or progressing. Takes 10 minutes for 50 GB account—seems forever.

**Solution:**  
Real-time progress tracking with accurate ETA and visual feedback.

**Progress Tracking:**
```
Restore job structure:
  - id: uuid
  - status: pending/extracting/validating/restoring/complete
  - progress_percent: 0-100
  - current_stage: (name of current step)
  - bytes_processed: X / Y
  - eta_seconds: X
  - started_at: timestamp
  - current_time: timestamp
  - speed_mbps: X

Stages with progress bars:
  1. Extracting (0-20%)
     → Show: "Extracting files from backup..."
     → Subprogress: X of Y files extracted
     → Speed: X MB/s

  2. Validating (20-30%)
     → Show: "Validating account structure..."
     → Subprogress: X of Y validations passed
  
  3. Creating accounts (30-50%)
     → Show: "Creating email accounts..."
     → Subprogress: X of Y accounts created
  
  4. Restoring data (50-90%)
     → Show: "Restoring files..."
     → Subprogress: X of Y GB restored
     → Speed: X MB/s
     → ETA: X minutes remaining
  
  5. Finalizing (90-100%)
     → Show: "Finalizing restoration..."
```

**API Endpoint (Real-Time):**
```
GET /api/restore/{job_id}/progress

Response:
{
  "id": "abc123",
  "status": "restoring",
  "progress_percent": 45,
  "current_stage": "restoring_data",
  "bytes_total": 53687091200,
  "bytes_processed": 24159383552,
  "speed_mbps": 125.5,
  "eta_seconds": 250,
  "log_tail": [
    "Restored /home/account/.bashrc (2 KB)",
    "Restored /home/account/public_html/index.html (5 KB)",
    ...
  ]
}
```

**WebSocket (Live Updates):**
```
Connect to: ws://api.npanel.local/api/restore/{job_id}/live

Sends updates every 1 second:
{
  "type": "progress",
  "progress_percent": 45,
  "eta_seconds": 250,
  "speed_mbps": 125.5
}

On completion:
{
  "type": "complete",
  "success": true,
  "summary": {
    "total_time": 1250,
    "data_restored": 53.6,
    "accounts_created": 15
  }
}
```

**UI Component (React):**
```jsx
<RestoreProgress jobId={jobId}>
  {({ progress, eta, stage, speed, log }) => (
    <div>
      <ProgressBar value={progress} max={100} />
      <div>
        {stage} · {progress}% · {speed} MB/s
      </div>
      <ETA seconds={eta} />
      <LogTail lines={log} />
    </div>
  )}
</RestoreProgress>
```

**Performance Impact:**
- **Idle CPU:** +0.1% (progress tracking)
- **Idle RAM:** +5 MB (progress cache)
- **WebSocket connections:** Max 1000
- **Progress updates:** 1/second per job

**Resource Limits:**
- **Max concurrent restore jobs:** 3
- **Max log lines kept:** 100 per job
- **Progress history retention:** Until job complete

**Rollback Plan:**
```
If progress tracking breaks:
  1. Restore still works (progress is cosmetic)
  2. API returns null/error for progress
  3. UI shows "Progress unavailable"
  4. Restore continues in background
```

**Success Criteria:**
- ✅ Progress updates every 1 second
- ✅ ETA within ±10% of actual time
- ✅ Users see what's happening
- ✅ No performance impact on restore speed

**Implementation Steps:**
1. Add progress tracking to restore agent code
2. Store progress in time-series DB
3. Create WebSocket endpoint for live updates
4. Build progress React component
5. Add ETA calculation algorithm
6. Test with various backup sizes

---

### 3.2 Migration Health Scoring

**Problem Statement:**  
Migrations succeed but accounts are broken (missing files, wrong permissions, broken email). No way to detect without manual testing. Customers discover problems weeks later.

**Solution:**  
Automated health scoring post-migration with detailed diagnostics.

**Health Check Categories:**
```
FILESYSTEM (0-25 points):
  ✓ Home directory exists and is readable: 5 pts
  ✓ All expected directories present: 5 pts
  ✓ File permissions reasonable (no 777 everywhere): 5 pts
  ✓ No broken symlinks: 5 pts
  ✓ Disk usage matches source: 5 pts

EMAIL (0-25 points):
  ✓ All source email accounts created: 5 pts
  ✓ Mailbox folders present: 5 pts
  ✓ Can send test email: 5 pts
  ✓ Can receive test email: 5 pts
  ✓ Autoresponders configured: 5 pts

DATABASES (0-20 points):
  ✓ All source DBs created: 5 pts
  ✓ All source tables present: 5 pts
  ✓ Data integrity check (row counts match): 5 pts
  ✓ Can connect to DB: 5 pts

DOMAINS (0-15 points):
  ✓ All source domains created: 5 pts
  ✓ DNS resolves correctly: 5 pts
  ✓ SSL certificate installed: 5 pts

USERS & PERMISSIONS (0-15 points):
  ✓ FTP users can login: 5 pts
  ✓ Shell user can SSH: 5 pts
  ✓ Sudo permissions correct: 5 pts

SCORE: 0-100
  90-100: Excellent
  75-89: Good
  60-74: Fair (issues found, likely fixable)
  <60: Poor (serious issues, manual intervention needed)
```

**Health Check Workflow:**
```
After migration completes:
  1. Wait 30 seconds (let services settle)
  2. Run async health check job
  3. For each category:
     a. Run diagnostics
     b. Score points
     c. Log any failures
  4. Generate health report
  5. Store score in DB
  6. Alert customer if score < 75
  7. Create ticket if score < 60

Health report includes:
  - Overall score (0-100)
  - Category scores
  - Issues found (with severity)
  - Recommended actions
  - Next steps (if issues found)
```

**API Endpoint:**
```
GET /api/migration/{job_id}/health

Response:
{
  "score": 87,
  "grade": "Good",
  "checked_at": "2026-01-25T10:30:00Z",
  "categories": {
    "filesystem": {
      "score": 25,
      "status": "pass",
      "checks": [
        { "name": "home_dir_exists", "passed": true },
        { "name": "permissions_reasonable", "passed": true }
      ]
    },
    "email": {
      "score": 23,
      "status": "warning",
      "checks": [
        { "name": "accounts_created", "passed": true },
        { "name": "can_send_email", "passed": false, "message": "Port 587 blocked" }
      ]
    }
  },
  "issues": [
    { "severity": "warning", "category": "email", "message": "SMTP test failed" },
    { "severity": "info", "category": "domains", "message": "1 domain still using old IP" }
  ],
  "next_steps": [
    "Update DNS records for domain.com",
    "Test SMTP connectivity"
  ]
}
```

**Performance Impact:**
- **Health check duration:** 2-5 minutes
- **CPU during check:** +20% (temporary)
- **Idle CPU:** +0.05% (caching results)
- **Idle RAM:** +5 MB (report cache)

**Resource Limits:**
- **Max concurrent health checks:** 5
- **Health check timeout:** 10 minutes
- **Report retention:** 30 days per migration

**Rollback Plan:**
```
If health check breaks:
  1. Health check disabled
  2. Migrations still work
  3. Manual health check available
  4. Alert SRE to investigate
```

**Success Criteria:**
- ✅ Health score within ±5 points of actual state
- ✅ Issues detected automatically
- ✅ Guides customer to fixing problems
- ✅ No false alarms (false positive rate <5%)

**Implementation Steps:**
1. Create health check module in agent
2. Implement each category check function
3. Add scoring algorithm
4. Create health report storage
5. Add API endpoint for health results
6. Build health UI component with issues list
7. Test with known-broken migrations

---

### 3.3 Clearer Audit & Action Logs

**Problem Statement:**  
Audit logs exist but are hard to read. No clear narrative of what happened when. Hard to debug issues or investigate security incidents.

**Solution:**  
Structured, searchable audit logs with clear cause-and-effect relationships.

**Log Entry Structure:**
```json
{
  "id": "uuid",
  "timestamp": "2026-01-25T10:30:00Z",
  "account": "customer123",
  "admin": "admin@hosting.com",
  "action": "domain_created",
  "resource": {
    "type": "domain",
    "id": "example.com",
    "name": "example.com"
  },
  "changes": {
    "before": null,
    "after": {
      "domain": "example.com",
      "owner": "customer123",
      "status": "active"
    }
  },
  "result": "success",
  "duration_ms": 125,
  "source": {
    "ip": "192.168.1.1",
    "user_agent": "Mozilla/5.0...",
    "method": "API",
    "endpoint": "/api/domains"
  },
  "related_logs": ["uuid-2", "uuid-3"],  // parent/child actions
  "impact": {
    "accounts_affected": ["customer123"],
    "resources_changed": 1,
    "estimated_downtime_seconds": 0
  }
}
```

**Log Categories:**
```
ACCOUNT MANAGEMENT:
  - account_created
  - account_deleted
  - account_suspended
  - account_unsuspended
  - package_changed

DOMAIN MANAGEMENT:
  - domain_created
  - domain_deleted
  - domain_updated
  - dns_zone_updated

EMAIL MANAGEMENT:
  - email_account_created
  - email_account_deleted
  - email_forwarding_created

DATABASE MANAGEMENT:
  - database_created
  - database_deleted
  - database_user_created

SYSTEM ACTIONS:
  - backup_created
  - restore_started
  - restore_completed
  - migration_started
  - service_restarted

SECURITY ACTIONS:
  - password_changed
  - 2fa_enabled
  - api_key_created
  - permission_changed

ADMIN ACTIONS:
  - config_changed
  - user_created
  - user_deleted
  - feature_enabled
  - feature_disabled
```

**Audit Log UI:**
```
Filters:
  - Date range
  - Action type
  - Account
  - Admin user
  - Result (success/failure)
  - Resource type

View modes:
  1. Timeline (chronological list)
  2. Narrative (grouped by action with related logs)
  3. CSV export (for compliance)
  4. JSON API (for external audit systems)

Example log entry display:
┌─────────────────────────────────────────┐
│ Domain Created                          │
│ 2026-01-25 10:30:00                     │
├─────────────────────────────────────────┤
│ Admin: admin@hosting.com                │
│ Account: customer123                    │
│ Resource: example.com                   │
│ Result: Success (125 ms)                │
│ Details:                                │
│   • MX records configured               │
│   • SSL certificate ordered             │
│   • DNS zone created                    │
│ Related Actions:                        │
│   > SSL cert issued (uuid-2)            │
│   > Email account created (uuid-3)      │
└─────────────────────────────────────────┘
```

**Performance Impact:**
- **Log storage:** ~2 KB per entry
- **Log write:** <5 ms (async)
- **Log search:** <500 ms for 1 year of logs
- **Idle CPU:** +0.02% (log rotation)
- **Idle RAM:** +5 MB (search cache)

**Resource Limits:**
- **Log retention:** 2 years (configurable)
- **Log entries per day:** ~10,000 (scaling beyond = archive)
- **Search time limit:** 60 seconds
- **Export size limit:** 100 MB

**Rollback Plan:**
```
If audit logging breaks:
  1. Logs stop being written
  2. System continues operating
  3. Alert admin immediately
  4. Manual investigation of failure
  5. Re-enable logging after fixing
```

**Success Criteria:**
- ✅ Every action logged with full context
- ✅ Can search logs by any field
- ✅ Related actions clearly linked
- ✅ Export for compliance/audit

**Implementation Steps:**
1. Update audit log schema
2. Add structured log entries
3. Create audit log search API
4. Build audit log UI component
5. Add log export functionality
6. Create log rotation + archival
7. Test with 1 year of sample data

---

### 3.4 Smarter Defaults (Security & Performance)

**Problem Statement:**  
New customers make bad security choices (weak passwords, open SSH, world-readable files). System doesn't guide them toward safer defaults. Performance suffers from bad config.

**Solution:**  
Opinionated, secure defaults with education and easy override.

**Security Defaults:**
```
NEW ACCOUNT GETS:
  ✓ Strong password requirement (12+ chars, mixed case)
  ✓ SSH key-only login (password disabled by default)
  ✓ Firewall rules: SSH from admin IP only, HTTP/HTTPS open
  ✓ Fail2ban enabled (monitor logs, auto-block attackers)
  ✓ SSH key stored in secrets manager (not on disk)
  ✓ File permissions set to 0750 (not 0755)
  ✓ Cron jobs run with minimal privileges
  ✓ PHP: disable_functions = exec, system, shell_exec
  ✓ Database: User can't DROP database
  ✓ Email: No open relay, require authentication

SMARTER DEFAULTS FOR PERFORMANCE:
  ✓ OPcache enabled (PHP, 256 MB)
  ✓ Redis caching enabled (if available)
  ✓ Gzip compression enabled
  ✓ HTTP/2 enabled
  ✓ Keep-alive connections: 60 seconds
  ✓ PHP workers: 4 (scaled to CPU cores)
  ✓ MySQL max_connections: 50 (per account)
  ✓ Email queue cleanup: Daily
  ✓ Log rotation: Weekly
```

**New User Onboarding:**
```
After account created, show guide:

Step 1: Secure Your Account
  [ ] Set up SSH key (recommended)
  [ ] Enable 2FA (recommended)
  [ ] Download credentials backup
  (Skip button available)

Step 2: Configure Your Website
  [ ] Upload files via SFTP
  [ ] Configure DNS records
  [ ] Install SSL certificate
  (Wizard available)

Step 3: Verify Everything Works
  [ ] Test website: https://example.com
  [ ] Test email: admin@example.com
  [ ] Test database: (connection test)
  (All green = ready to use)
```

**Admin Override:**
```
Admins can override defaults per account:
  POST /api/accounts/{id}/security-policy
  {
    "policy": "custom",
    "settings": {
      "password_min_length": 8,
      "ssh_key_required": false,
      "file_permissions_default": "0755"
    }
  }

Audit trail logs all overrides:
  "Admin changed security policy for customer123"
  "Reason: Legacy app compatibility"
  "Changed: ssh_key_required (true → false)"
```

**Performance Impact:**
- **Account creation time:** +5 seconds (extra setup)
- **Idle CPU:** 0% change
- **Idle RAM:** 0% change
- **API performance:** +0% (settings cached)

**Resource Limits:**
- **Max accounts with custom defaults:** All
- **Policy evaluation time:** <100 ms
- **Cache TTL:** 1 hour

**Rollback Plan:**
```
If defaults break compatibility:
  1. Admin can override per account
  2. Create compatibility policy templates
  3. Educate customer on risks
  4. Document workaround
```

**Success Criteria:**
- ✅ New accounts secure by default
- ✅ Performance optimized by default
- ✅ Easy for customers to verify setup
- ✅ Admin can override if needed

**Implementation Steps:**
1. Create security policy schema
2. Update account creation flow
3. Add security defaults to provisioning
4. Build onboarding wizard component
5. Add policy override API
6. Create policy templates (strict/moderate/legacy)
7. Document each default choice

---

### 3.5 Predictable Upgrades (No Surprises)

**Problem Statement:**  
Upgrades break things unpredictably. Config changes silently. Services restart with downtime. Customers angry.

**Solution:**  
Transparent upgrade process with pre-flight checks, staged rollout, and automatic rollback on failure.

**Upgrade Workflow:**
```
STAGE 1: Preparation (Admin initiates)
  1. Admin decides to upgrade to v5.2.1
  2. System pre-downloads package
  3. System validates package signature (security)
  4. System checks: "Any breaking changes?"
     → Review CHANGELOG
     → Run compatibility checks
     → Alert admin if risky
  5. System schedules upgrade window (or immediate)

STAGE 2: Pre-Flight Checks (Automated)
  1. Backup current database ✓
  2. Backup current config ✓
  3. Test config parsing with new version ✓
  4. Check disk space (need 2x current size) ✓
  5. Verify all services can restart ✓
  6. Run smoke tests (login, create domain, etc.) ✓
  7. Report: "Safe to upgrade" or "Not recommended"
  
  If ANY check fails:
    → Abort upgrade
    → Alert admin with reason
    → Suggest fixes
    → Retry when ready

STAGE 3: Staged Deployment (Canary)
  Option A: Full upgrade (if not risky)
    1. Stop services gracefully
    2. Install new binaries
    3. Run database migrations
    4. Verify migrations complete successfully
    5. Start services
    6. Run post-upgrade checks
  
  Option B: Canary upgrade (if risky)
    1. Route 5% of traffic to new version
    2. Monitor metrics (errors, latency)
    3. Wait 30 minutes
    4. If all good: Route 50%, then 100%
    5. If error spike: Automatic rollback

STAGE 4: Validation (Post-Upgrade)
  1. All services healthy? ✓
  2. All accounts accessible? ✓
  3. No error logs spike? ✓
  4. Performance metrics normal? ✓
  5. No new security alerts? ✓
  
  If all checks pass:
    → Upgrade complete, keep backup for 7 days
    → Send customer notification
    → Log success in audit trail
  
  If any check fails:
    → Automatic rollback to previous version
    → Alert admin immediately
    → Keep new version for debugging
    → Suggest filing bug report

STAGE 5: Rollback (If Needed)
  1. Stop new version services
  2. Restore database from backup
  3. Restore config from backup
  4. Start old version services
  5. Verify all checks pass with old version
  6. Alert admin with issue details
  7. Create incident ticket
```

**Customer Communication:**
```
Email to customer (24h before):
  Subject: nPanel will upgrade tomorrow 2AM-3AM EST
  
  Hi customer,
  
  We're upgrading nPanel to v5.2.1 which includes:
  • 15% faster domain operations
  • Bug fixes for email forwarding
  • Better mobile UI
  
  Upgrade scheduled: Jan 26 2-3 AM EST
  Expected downtime: <5 minutes
  
  You can postpone upgrade: https://panel.npanel.local/...
  
  Questions? Reply to this email.

Email to customer (after upgrade):
  Subject: nPanel upgrade complete!
  
  Hi customer,
  
  Your nPanel control panel has been upgraded to v5.2.1.
  Everything is working normally.
  
  New features available in Settings > Preferences.
  
  Changelog: https://...
  
  Questions? reply to this email.

If upgrade failed:
  Subject: nPanel upgrade rolled back (we fixed the issue)
  
  Hi customer,
  
  During tonight's upgrade, we encountered an issue
  and automatically rolled back to the previous version.
  Everything is working normally.
  
  We're investigating and will retry in 24 hours.
  
  We apologize for the inconvenience.
```

**Performance Impact:**
- **Upgrade duration:** 5-30 minutes (depending on complexity)
- **Upgrade frequency:** Weekly security patches, monthly features
- **Zero downtime option:** Available (costs +20% CPU during dual-run)

**Resource Limits:**
- **Backup storage:** 2x system size (7 days retention)
- **Canary traffic:** 5%→50%→100% (configurable)
- **Rollback window:** Unlimited (kept until manual cleanup)

**Rollback Plan:**
```
If rollback fails:
  1. Partial rollback: Restore only affected components
  2. Manual recovery: SRE intervention
  3. From backup: 72-hour backup available
```

**Success Criteria:**
- ✅ Upgrades never crash production
- ✅ Breaking changes detected before deploy
- ✅ Automatic rollback on failure
- ✅ Customers understand what's happening
- ✅ <1% actual downtime across all upgrades

**Implementation Steps:**
1. Create upgrade state machine
2. Implement pre-flight check framework
3. Build upgrade validation system
4. Add automatic rollback logic
5. Create canary deployment controller
6. Build upgrade UI component
7. Test upgrades with live data

---

## Implementation Roadmap

### Phase 5 Timeline (8 weeks)

**Week 1-2: Track A Hardening (Critical Path)**
- [ ] cgroups v2 implementation (agent)
- [ ] Email rate limiting (Exim)
- [ ] Agent watchdog (separate service)
- [ ] Security audit: cgroups isolation

**Week 2-3: Track A Continuation**
- [ ] Graceful reloads (agent + API)
- [ ] Config layering (defaults + overrides)
- [ ] 24-hour soak test (basic scenarios)
- [ ] Performance validation

**Week 3-4: Track B Billing Basics**
- [ ] Package templates (schema + API)
- [ ] Feature toggles (enforcement)
- [ ] Quota enforcement (agent + API)
- [ ] WHMCS API (basic endpoints)

**Week 4-5: Track B Reseller**
- [ ] Account hierarchy (schema + auth)
- [ ] Reseller dashboard (UI)
- [ ] Quota management (reseller controls)
- [ ] Testing: Multi-level hierarchy

**Week 5-6: Track C Polish**
- [ ] Progress tracking (restore UX)
- [ ] Health scoring (post-migration)
- [ ] Audit logs (searchable + narrative)
- [ ] Smart defaults (security)

**Week 6-7: Track C Upgrades**
- [ ] Upgrade framework (pre-flight + rollback)
- [ ] Canary deployment (5%→50%→100%)
- [ ] Customer communication (email templates)
- [ ] Testing: Real upgrade scenarios

**Week 7-8: Integration & Testing**
- [ ] Cross-track testing (all features together)
- [ ] 72-hour soak test (all chaos scenarios)
- [ ] Performance regression testing
- [ ] Security audit (all new features)
- [ ] Documentation + runbooks

**Week 8: Launch Prep**
- [ ] Feature gating (all disabled by default)
- [ ] Metrics + alerts (monitoring ready)
- [ ] Operator training
- [ ] Staged rollout plan (Track A → B → C)

---

## Success Metrics

### Performance (Non-Negotiable)
- [ ] Idle CPU: ≤1% (current baseline + Track A overhead)
- [ ] Idle RAM: No increase >2% from baseline
- [ ] API latency: p99 <200 ms (no change from Phase 4)
- [ ] Email throughput: >100 emails/sec (no degradation)

### Reliability
- [ ] Uptime: 99.95%+ (over 30 days)
- [ ] Recovery time: <10 minutes from failure
- [ ] Rollback success rate: 100%
- [ ] False-positive alerts: <1%

### Scalability
- [ ] Support 10,000+ accounts per server
- [ ] Handle 1000 concurrent users
- [ ] Support 5 concurrent migrations
- [ ] Support 10+ reseller hierarchies

### Business
- [ ] WHMCS integration: 90%+ of provisioning automated
- [ ] Package system: >100 template types supported
- [ ] Quota enforcement: 100% of customers within limits
- [ ] Upgrade success rate: >99% (no production issues)

---

## Risk Mitigation

| Risk | Mitigation | Owner |
|------|-----------|-------|
| cgroups v2 breaks on older kernels | Only deploy on kernel 5.3+ | Infrastructure |
| WHMCS API inconsistency | Build adapter layer + comprehensive tests | API Team |
| Upgrade breaks production | Mandatory pre-flight checks + canary | SRE |
| Reseller quota bypass | Enforce at agent level (not just API) | Security |
| Progress tracking causes lag | Async progress updates, no blocking | Backend |

---

## Decision Gates (Checkpoint Reviews)

**Gate 1 (End of Week 2):**  
- [ ] cgroups v2 stable under abuse (24h test passed)
- [ ] Email rate limiting doesn't false-positive
- [ ] Agent watchdog auto-recovery working
- **Decision:** Proceed to graceful reloads or pause for fixes?

**Gate 2 (End of Week 4):**
- [ ] Package templates schema complete
- [ ] WHMCS API basic endpoints functional
- [ ] Quota enforcement working
- **Decision:** Proceed to reseller features or refocus?

**Gate 3 (End of Week 6):**
- [ ] Progress tracking UX validated by customers
- [ ] Health scoring accuracy >90%
- [ ] Audit logs searchable + performant
- **Decision:** Proceed to upgrade framework or iterate?

**Gate 4 (End of Week 8):**
- [ ] 72-hour soak test passed (all chaos scenarios)
- [ ] Performance regression <5%
- [ ] Security audit: 0 new vulnerabilities
- **Decision:** Full rollout or staged deployment?

---

## Appendix: Configuration Examples

### Example: cgroups v2 Resource Limits

```yaml
# /etc/npanel/cgroups-defaults.yaml
cgroups:
  enabled: true
  version: 2
  
  # Default limits per account
  defaults:
    cpu:
      cpuset: "50%"  # 50% of 1 core
      weight: 256  # 0-10000 scale
    memory:
      limit: "512 MB"
      swap_limit: "128 MB"
    io:
      read: "50 MB/s"
      write: "50 MB/s"
    pids:
      limit: 256

  # Package overrides
  packages:
    basic:
      cpu: "25%"
      memory: "256 MB"
    pro:
      cpu: "100%"  # Full 1 core
      memory: "1 GB"
    enterprise:
      cpu: "200%"  # 2 cores
      memory: "2 GB"
```

### Example: Package Template

```yaml
# /etc/npanel/packages/pro.yaml
name: "Professional Hosting"
description: "For growing websites"

# Resource quotas
quotas:
  disk: "50 GB"
  bandwidth_monthly: "500 GB"
  email_accounts: 25
  databases: 10
  addon_domains: 10

# Feature toggles
features:
  dns_management: true
  ssl_certificates: true
  email_forwarding: true
  api_access: true
  ssh_access: true
  cron_jobs: true
  cdn_integration: true

disabled_features:
  reseller_accounts: true

# Security settings
security:
  password_min_length: 12
  ssh_key_required: false
  two_factor_optional: true

# Pricing (optional, for WHMCS)
pricing:
  monthly_cents: 999
  annual_cents: 9990
```

---

## Document Version

- **Phase:** 5 (Controlled Evolution)
- **Status:** DESIGN APPROVED
- **Last Updated:** 2026-01-25
- **Approved By:** Senior Platform Architect
- **Next Review:** Upon Track A completion (Week 2)

