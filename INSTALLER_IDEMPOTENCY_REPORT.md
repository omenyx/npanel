# INSTALLER IDEMPOTENCY AUDIT REPORT

**Date**: January 22, 2026  
**Audit Scope**: `install_npanel.sh` v2.52 idempotency and state detection  
**Status**: ⚠️ CRITICAL ISSUES FOUND

---

## EXECUTIVE SUMMARY

The installer **CAN be run multiple times**, but has **significant idempotency and state detection gaps** that could cause:

- Silent configuration overwrites on re-run
- Users/groups silently created when already exist (harmless but bad practice)
- Conflicting systemd services on update
- No explicit state machine (fresh vs existing vs broken)

**Verdict**: **PASS with RESERVATIONS** - Works but not production-grade

---

## STATE DETECTION CAPABILITY

### Current State Machine (IMPLICIT)

```
Fresh Install:
  - NPANEL_DIR not found → Clone from git
  - No systemd services → Create new
  - No nginx config → Write new

Existing Install:
  - NPANEL_DIR/.git exists → git pull + rebuild
  - Systemd services exist → Restart existing
  - Nginx config exists → Keep existing (SKIP REWRITE)

Partial/Broken:
  - No explicit detection
  - Will attempt recovery (best-effort)
```

### Problem: State Detection is IMPLICIT

The installer does NOT explicitly log/verify its own state. Instead:
1. It checks conditions (git dir exists, config exists)
2. Assumes the rest is correct
3. Proceeds with repairs if needed

**Risk**: Operator can't tell what mode installer is in until it's done.

---

## IDEMPOTENCY ANALYSIS

### ✅ GOOD: Nginx Configuration (SAFE RE-RUN)

**Location**: Lines 1590-1875

**Behavior**:
```bash
if [[ -f "$conf" ]]; then
  return
fi
# Only write config if missing
```

**Status**: ✅ **SAFE**
- Existing nginx config is **never overwritten**
- Multiple runs will skip nginx config regeneration
- Idempotent for config layer

**Risk**: Old configuration from previous version persists on update

---

### ✅ GOOD: Git Repository (DETERMINISTIC)

**Location**: Lines 1018-1043

**Behavior**:
```bash
if [[ -d "$dest/.git" ]]; then
  git fetch --tags origin
  git checkout -f "$NPANEL_BRANCH"
  git reset --hard "origin/$NPANEL_BRANCH"
  git clean -fd
fi
```

**Status**: ✅ **SAFE**
- `git reset --hard` is deterministic
- `git clean -fd` removes local modifications
- Multiple runs converge to same state
- No merge/pull conflicts possible

**Benefit**: Update mode is guaranteed to be repeatable

---

### ✅ GOOD: Systemd Services (SAFE CREATE)

**Location**: Lines 1880-1945

**Behavior**:
```bash
cat > /etc/systemd/system/npanel-backend.service <<UNIT
# File write (overwrite if exists)
UNIT

systemctl daemon-reload
systemctl enable npanel-backend.service npanel-frontend.service || true
```

**Status**: ✅ **SAFE**
- Services are written fresh each time (overwrites are idempotent)
- `systemctl daemon-reload` picks up changes
- `|| true` prevents failure if service already enabled
- Multiple runs produce same result

---

### ⚠️ PROBLEM: User/Group Creation (NO DUPLICATE DETECTION)

**Location**: Lines 1389-1401

**Current Code**:
```bash
if ! getent group vmail >/dev/null 2>&1; then
  groupadd -g 5000 vmail >/dev/null 2>&1 || groupadd vmail || true
fi
if ! id -u vmail >/dev/null 2>&1; then
  useradd -u 5000 -g vmail -d /var/mail/vhosts -s /usr/sbin/nologin vmail >/dev/null 2>&1 || true
fi
```

**Status**: ✅ **SAFE (but not explicit)**
- Checks if group exists before creating ✓
- Checks if user exists before creating ✓
- Uses fallback if UID/GID taken ✓
- Multiple runs safe ✓

**But**: Silent fallback if UID already taken

**Improvement Needed**:
```bash
if getent group vmail >/dev/null 2>&1; then
  log "✓ vmail group already exists"
else
  log "Creating vmail group..."
  groupadd -g 5000 vmail || groupadd vmail || die "Failed to create vmail group"
fi

if id -u vmail >/dev/null 2>&1; then
  log "✓ vmail user already exists"
else
  log "Creating vmail user..."
  useradd -u 5000 -g vmail -d /var/mail/vhosts -s /usr/sbin/nologin vmail || die "Failed to create vmail user"
fi
```

---

### ✅ GOOD: Service Stop/Restart (SAFE)

**Location**: Lines 1572-1587, 1940-1949

**Behavior**:
```bash
stop_npanel_services() {
  systemctl stop npanel-backend.service npanel-frontend.service 2>/dev/null || true
  lsof -ti :3000 | xargs kill 2>/dev/null || true
  lsof -ti :3001 | xargs kill 2>/dev/null || true
  pkill -f "npanel-backend" || true
  pkill -f "npanel-frontend" || true
}
```

**Status**: ✅ **SAFE**
- Multiple layers of stopping (systemd + process kill + port kill)
- All failures masked with `|| true`
- Safe to run multiple times (stopping stopped service is safe)

---

### ⚠️ PROBLEM: Installation Lock (NOT PERSISTENT)

**Location**: Lines 80-100

**Current Code**:
```bash
acquire_lock() {
  exec 9>"${LOCKFILE}"
  if ! flock -n 9; then
    die "Another Npanel install/update is already running"
  fi
}
```

**Status**: ⚠️ **GOOD BUT FILE-BASED**
- Prevents concurrent runs ✓
- Lock released on exit ✓
- But: No persistent record of last install

**Improvement Needed**: Write `last_install.log` with state

---

### ⚠️ PROBLEM: No Explicit "Previous State" Logging

**Location**: Throughout installer

**Current Code**: None - no state file written

**Status**: ⚠️ **MISSING**
- No record of: previous install status, previous version, when last succeeded
- Operator can't verify if partial install exists
- On failure, unclear what state system is in

**Needed**:
```bash
NPANEL_STATE_FILE="/etc/npanel/installer-state.json"

# Write state at start
write_install_state() {
  cat > "$NPANEL_STATE_FILE" <<EOF
{
  "mode": "$MODE",
  "start_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "previous_version": "$NPANEL_PREV_COMMIT",
  "target_version": "$NPANEL_TARGET_COMMIT",
  "installer_version": "2.52"
}
EOF
}

# Update state on success
write_install_success() {
  jq '.end_time = now | .status = "success"' "$NPANEL_STATE_FILE" > /tmp/state.tmp && mv /tmp/state.tmp "$NPANEL_STATE_FILE"
}
```

---

### ✅ GOOD: Build Atomicity (ROLLBACK ON FAIL)

**Location**: Lines 2080-2089

**Current Code**:
```bash
if ! install_npanel_dependencies; then
  err "Build failed; reverting to previous commit: ${NPANEL_PREV_COMMIT}"
  cd "$NPANEL_DIR" && git reset --hard "$NPANEL_PREV_COMMIT"
  die "Aborting update due to build failure"
fi
```

**Status**: ✅ **SAFE**
- If build fails, reverts to previous commit
- No half-built state left behind
- Atomic: either succeeds fully or fails completely

---

### ✅ GOOD: Nginx Config Validation (FAIL FAST)

**Location**: Lines 1863-1864

**Current Code**:
```bash
nginx -t || die "Nginx configuration syntax error!"
```

**Status**: ✅ **SAFE**
- Validates before restart
- Fails early if config bad
- Prevents invalid nginx from starting

---

## EXPLICIT STATE MACHINE (MISSING)

The installer should output an **explicit state machine** showing where it is:

### Current (Implicit, No Output)
```
$ sudo ./install_npanel.sh
[INFO] Installer running...
[INFO] Services configured...
[INFO] Done!

→ Operator doesn't know:
  - Was this fresh or update?
  - What was previous state?
  - Did all services start?
  - What ports are listening?
```

### Proposed (Explicit State Output)

```bash
detect_install_state() {
  if [[ ! -d "$NPANEL_DIR/.git" ]]; then
    echo "FRESH_INSTALL"
    return
  fi
  
  if systemctl is-active npanel-backend >/dev/null 2>&1; then
    echo "EXISTING_RUNNING"
    return
  fi
  
  if [[ -f "$NPANEL_DIR/package.json" ]]; then
    echo "EXISTING_INSTALLED"
    return
  fi
  
  echo "EXISTING_BROKEN"
}

# Output at start
INSTALL_STATE="$(detect_install_state)"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Install State: $INSTALL_STATE"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

---

## IDEMPOTENCY VERDICT

| Component | Idempotent | Safe Re-run | Evidence |
|-----------|-----------|-----------|----------|
| **Git repo convergence** | ✅ YES | ✅ YES | `git reset --hard` |
| **Nginx config** | ✅ YES | ✅ YES | Skips if exists |
| **Systemd services** | ✅ YES | ✅ YES | Overwrites idempotently |
| **User/group creation** | ✅ YES | ⚠️ SILENT | Checks exist, no log |
| **Build/rebuild** | ✅ YES | ✅ YES | Rollback on fail |
| **State detection** | ❌ NO | ⚠️ IMPLICIT | No explicit checks |
| **Lock file** | ✅ YES | ✅ YES | Prevents concurrent runs |
| **Install state logging** | ❌ NO | ❌ NO | No state file |

**Overall Verdict**: ✅ **IDEMPOTENT BUT NOT EXPLICIT**

---

## CRITICAL ISSUES FOUND

### Issue #1: No Explicit State File

**Severity**: MEDIUM  
**Impact**: Operator can't verify installation state

**Root Cause**: Installer only checks conditions in-memory

**Fix**: Write `/etc/npanel/installer-state.json` at start/end

---

### Issue #2: Silent User Creation Fallback

**Severity**: LOW  
**Impact**: Operator doesn't know if UID conflict occurred

**Root Cause**: Error messages redirected to `/dev/null`

**Fix**: Add explicit logging for user/group creation

---

### Issue #3: No "Already Installed" Detection

**Severity**: MEDIUM  
**Impact**: Can't distinguish fresh vs existing install

**Root Cause**: No explicit state machine

**Fix**: Implement `detect_install_state()` function

---

### Issue #4: Old Nginx Config Persists on Update

**Severity**: MEDIUM  
**Impact**: If nginx config changes, old version stays (e.g., old port config)

**Root Cause**: Installer skips nginx rewrite if config exists

**Fix**: Option to force nginx rewrite with `--nginx-update`

---

## RECOMMENDATIONS

### Priority 1 (MUST)
1. Add explicit state file: `/etc/npanel/installer-state.json`
2. Add state detection function: `detect_install_state()`
3. Add explicit logging for user/group creation
4. Add `--force-nginx` flag to rewrite config on update

### Priority 2 (SHOULD)
1. Add pre-install validation checklist
2. Add post-install verification checklist
3. Add rollback procedure documentation
4. Add state recovery for broken installs

### Priority 3 (NICE TO HAVE)
1. Add telemetry to track install success rates
2. Add dry-run mode (`--dry-run`)
3. Add installer version check

---

## STATE MACHINE IMPLEMENTATION

The installer should implement this explicit state machine:

```
┌─────────────────────────────────────────┐
│      Installer Start                    │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │ Detect State   │
         └───────┬────────┘
                 │
     ┌───────────┼───────────┐
     │           │           │
  FRESH      EXISTING     BROKEN
     │           │           │
     ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌──────────┐
│ Clone  │ │ Update │ │ Recover  │
│ Build  │ │ Build  │ │ Validate │
│ Start  │ │ Restart│ │ Rebuild  │
└───┬────┘ └───┬────┘ └────┬─────┘
    │          │           │
    └──────────┼───────────┘
               │
         ┌─────▼──────┐
         │ Verify All │
         │ Services   │
         └─────┬──────┘
               │
         ┌─────▼──────────┐
         │ Write State    │
         │ Log Success    │
         └─────┬──────────┘
               │
         ┌─────▼──────┐
         │   Done     │
         └────────────┘
```

---

## TESTING MATRIX

To verify idempotency, run these tests:

### Test 1: Fresh Install is Repeatable
```bash
# Clean system
sudo rm -rf /opt/npanel

# Run installer twice
sudo ./install_npanel.sh
sudo ./install_npanel.sh

# Verify: Same result both times
# - Same services running
# - Same users created (no duplication)
# - Same ports listening
```

### Test 2: Update is Repeatable
```bash
# After fresh install
sudo ./install_npanel.sh --update
sudo ./install_npanel.sh --update

# Verify: Services restart cleanly
# - No zombie processes
# - Logs show clean restart
# - No build errors
```

### Test 3: Partial Install Recovery
```bash
# Start install, kill midway
timeout 10 sudo ./install_npanel.sh &
sleep 5 && kill $!

# Try again
sudo ./install_npanel.sh

# Verify: Completes successfully
# - No duplicate users
# - No broken services
# - System operational
```

---

## CONCLUSION

**Idempotency Status**: ✅ **FUNCTIONALLY SAFE**

The installer CAN be run multiple times and converges to a consistent state. However:

- State detection is **implicit** (not explicit)
- User/group creation is **silent** (no logging)
- No **state file** for operational verification
- Old **nginx config persists** on updates

**Recommendation**: Implement Priority 1 fixes before production deployment

---

**Audit Completed**: January 22, 2026  
**Auditor**: Principal Platform Engineer  
**Next Task**: Implement fixes and re-test
