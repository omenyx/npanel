# UPDATE FLOW DIAGRAM & SAFE PULL STRATEGY

**Date**: January 22, 2026  
**Task**: D2 - Verify and enforce safe update & pull strategy (cPanel-style)  
**Status**: ⚠️ ISSUES FOUND

---

## EXECUTIVE SUMMARY

The update flow is **mostly safe** but has **gaps in local change detection and build verification**:

✅ **Good**: Git reset is deterministic, services stopped before rebuild  
❌ **Bad**: No pre-update sanity check, weak local change detection  
⚠️ **Missing**: Rollback on build failure not fully tested  

---

## CURRENT UPDATE FLOW (FROM INSTALLER)

### Flow Diagram

```
START (sudo ./install_npanel.sh --update)
  │
  ├─► Acquire lock (prevent concurrent runs)
  │
  ├─► Detect OS
  │
  ├─► Stop services (CRITICAL: before any code change)
  │   ├─► systemctl stop npanel-backend
  │   ├─► systemctl stop npanel-frontend
  │   └─► pkill -f npm (fallback)
  │
  ├─► Fetch & reset git repo (ensure_repo)
  │   ├─► git fetch --tags origin
  │   ├─► git checkout -f "$BRANCH"
  │   ├─► git reset --hard "origin/$BRANCH"
  │   ├─► git clean -fd (remove local files)
  │   └─► Record: PREV_COMMIT, TARGET_COMMIT
  │
  ├─► Write .env (ensure_env_defaults)
  │
  ├─► Check if rebuild needed
  │   └─► IF PREV_COMMIT == TARGET_COMMIT → Skip rebuild
  │       ELSE → Proceed to build
  │
  ├─► Build backend (npm install + build)
  │   └─► IF FAIL → 
  │       ├─► git reset --hard "$PREV_COMMIT"
  │       ├─► git clean -fd
  │       └─► DIE (abort update)
  │
  ├─► Build frontend (npm install + build)
  │   └─► IF FAIL →
  │       ├─► git reset --hard "$PREV_COMMIT"
  │       ├─► git clean -fd
  │       └─► DIE (abort update)
  │
  ├─► Configure nginx (only if missing)
  │
  ├─► Setup systemd services
  │
  ├─► Start services
  │   ├─► systemctl restart npanel-backend
  │   ├─► systemctl restart npanel-frontend
  │   └─► Wait for health checks
  │
  ├─► Verify deployment (curl health endpoints)
  │   └─► IF FAIL → dump debug logs, DIE
  │
  └─► SUCCESS
```

---

## PULL STRATEGY ANALYSIS

### Location in Code: Lines 2050-2100

```bash
stop_npanel_services

ensure_repo() {
  if [[ -d "$dest/.git" ]]; then
    git fetch --tags origin
    git checkout -f "$NPANEL_BRANCH"
    git reset --hard "origin/$NPANEL_BRANCH"
    git clean -fd
    return
  fi
  # Clone if first time
}

install_npanel_dependencies()
  # npm install + build
  
setup_services()
  # systemd config + start
```

---

## ISSUE #1: No Local Change Detection (PRE-FLIGHT)

**Severity**: MEDIUM  
**Location**: Lines 2050-2070

**Current Behavior**:
```bash
# No check for local changes before pulling
git fetch --tags origin
git checkout -f "$NPANEL_BRANCH"
git reset --hard "origin/$NPANEL_BRANCH"
git clean -fd  # ← This silently DELETES all local changes
```

**Problem**: 
- If operator edited `.env` locally, `git reset` loses it
- No warning before destructive operations
- `git clean -fd` removes ALL untracked files

**Example Failure**:
```bash
# Operator adds local config
echo "DEBUG=true" >> /opt/npanel/.env

# Runs update
sudo ./install_npanel.sh --update

# Local changes LOST (git reset + clean overwrites)
cat /opt/npanel/.env  # ← Lost local changes
```

**Fix Required**:
```bash
detect_local_changes() {
  local changes
  changes="$(git status --porcelain)"
  if [[ -n "$changes" ]]; then
    echo "$changes"
    return 0  # Has changes
  fi
  return 1  # No changes
}

ensure_repo() {
  cd "$dest"
  
  # BEFORE PULLING: Check for local changes
  if detect_local_changes >/dev/null; then
    log "⚠️  WARNING: Local changes detected in $dest"
    log "Local changes will be LOST by update:"
    detect_local_changes | sed 's/^/  /'
    
    read -p "Continue and lose local changes? (y/N): " confirm
    if [[ "$confirm" != "y" ]]; then
      die "Update aborted. Stash your changes with: git stash"
    fi
  fi
  
  git fetch --tags origin
  git checkout -f "$NPANEL_BRANCH"
  git reset --hard "origin/$NPANEL_BRANCH"
  git clean -fd
}
```

---

## ISSUE #2: No Pre-Update Sanity Check

**Severity**: MEDIUM  
**Location**: Missing

**Current Behavior**:
- Update starts immediately
- No verification of current state
- No check if services are healthy before update

**Problem**:
- Can't tell if system is broken BEFORE update
- If update fails, unclear what baseline was

**Fix Required**:
```bash
pre_update_checks() {
  log "Running pre-update sanity checks..."
  
  # 1. Is git repo valid?
  if ! cd "$NPANEL_DIR" 2>/dev/null; then
    die "Npanel directory not found at $NPANEL_DIR"
  fi
  if [[ ! -d ".git" ]]; then
    die "Not a git repository: $NPANEL_DIR"
  fi
  
  # 2. Are services currently running?
  if systemctl is-active npanel-backend >/dev/null 2>&1; then
    log "✓ Backend is running"
  else
    warn "⚠️  Backend is NOT running (will be started after update)"
  fi
  
  # 3. Is disk space sufficient?
  local free_kb
  free_kb=$(df / | awk 'NR==2 {print $4}')
  if [[ $free_kb -lt 1000000 ]]; then  # < 1 GB
    die "Insufficient disk space: $(( free_kb / 1024 )) MB free"
  fi
  
  # 4. Can we read .env?
  if [[ ! -f .env ]]; then
    warn "No .env found (will be created)"
  else
    log "✓ .env exists"
  fi
  
  log "✓ Pre-update checks passed"
}
```

---

## ISSUE #3: Build Failure Rollback Not Atomic

**Severity**: HIGH  
**Location**: Lines 2080-2089

**Current Behavior**:
```bash
if ! install_npanel_dependencies; then
  err "Build failed; reverting to previous commit"
  git reset --hard "$NPANEL_PREV_COMMIT"
  die "Aborting update due to build failure"
fi
```

**Problem**:
- If backend build fails midway, partial files remain
- If frontend build fails AFTER backend succeeded, frontend out of sync
- No cleanup of `node_modules`

**Example Failure**:
```
Build backend: SUCCESS (npm built, old version)
Build frontend: FAIL (npm error)
→ Revert to previous commit
→ But node_modules still has new version partial install
→ Restart services with mismatched builds
```

**Fix Required**:
```bash
atomic_build() {
  local commit_before
  commit_before="$(git rev-parse HEAD)"
  
  # Build backend in isolated subshell
  if ! (cd "$NPANEL_DIR/backend" && npm install && npm run build); then
    log "Backend build FAILED, rolling back..."
    git reset --hard "$commit_before"
    git clean -fd
    die "Backend build failed - reverted to previous state"
  fi
  
  # Build frontend in isolated subshell
  if ! (cd "$NPANEL_DIR/frontend" && npm install && npm run build); then
    log "Frontend build FAILED, rolling back entire update..."
    git reset --hard "$commit_before"
    git clean -fd
    die "Frontend build failed - reverted to previous state"
  fi
  
  log "✓ Both backend and frontend built successfully"
}
```

---

## ISSUE #4: Services Not Stopped Before Rebuild

**Status**: ✅ ACTUALLY GOOD

**Location**: Line 2068

```bash
# Always stop services before any code changes or builds
stop_npanel_services
```

**Verified**: ✅ Services ARE stopped before rebuild

**This is correct cPanel behavior**: Never compile while old code is running

---

## ISSUE #5: No Build Verification Post-Completion

**Severity**: MEDIUM  
**Location**: Lines 2100-2120

**Current Behavior**:
```bash
systemctl restart npanel-backend.service npanel-frontend.service
# Then verify via curl...
```

**Problem**:
- Services might start but API not responding
- Frontend might not be connecting to backend
- No check for build artifacts

**Fix Required**:
```bash
verify_build_artifacts() {
  log "Verifying build artifacts..."
  
  # Check backend build
  if [[ ! -f "$NPANEL_DIR/backend/dist/main.js" ]]; then
    die "Backend build missing: dist/main.js not found"
  fi
  log "✓ Backend build artifact exists"
  
  # Check frontend build
  if [[ ! -d "$NPANEL_DIR/frontend/.next" ]]; then
    die "Frontend build missing: .next directory not found"
  fi
  log "✓ Frontend build artifact exists"
}

verify_build_artifacts  # Call after build, before restart
```

---

## ISSUE #6: No Clean Build Flag

**Severity**: LOW  
**Location**: Missing

**Problem**:
- Can't force clean rebuild from cache
- npm cache might cause issues
- No way to do `npm ci` (clean install)

**Fix Required**:
```bash
# Add command-line option
--clean-build     Clean node_modules and npm cache before rebuild
--npm-ci          Use npm ci instead of npm install

# Then in build:
if [[ "$CLEAN_BUILD" -eq 1 ]]; then
  rm -rf "$NPANEL_DIR/backend/node_modules"
  rm -rf "$NPANEL_DIR/frontend/node_modules"
fi

if [[ "$USE_NPM_CI" -eq 1 ]]; then
  npm ci  # Reproducible install
else
  npm install  # Allow updates
fi
```

---

## ISSUE #7: No Build Log Rotation

**Severity**: LOW  
**Location**: Missing

**Problem**:
- `/var/log/npanel-*.log` can grow huge
- Build logs not captured separately
- No log retention policy

**Fix Required**:
```bash
# Save build logs separately
BUILD_LOG="/var/log/npanel-build-$(date +%Y%m%d-%H%M%S).log"

(cd "$NPANEL_DIR/backend" && npm run build) | tee -a "$BUILD_LOG" || die "Backend build failed (see $BUILD_LOG)"
(cd "$NPANEL_DIR/frontend" && npm run build) | tee -a "$BUILD_LOG" || die "Frontend build failed (see $BUILD_LOG)"

log "Build log saved to: $BUILD_LOG"
```

---

## FAILURE HANDLING MATRIX

| Scenario | Current Behavior | Outcome | Grade |
|----------|-----------------|---------|-------|
| **Network error during git fetch** | `git fetch` fails, install aborts | ✅ Safe (services unchanged) | ✅ GOOD |
| **Git checkout fails** | Aborts, repo in unknown state | ⚠️ Might be mid-reset | ⚠️ RISKY |
| **Backend build fails** | Revert commit, abort | ✅ Rollback works | ✅ GOOD |
| **Frontend build fails** | Revert commit, abort | ✅ Rollback works | ✅ GOOD |
| **Service start fails** | `systemctl restart` fails, DIE | ✅ Services stay stopped (safe) | ✅ GOOD |
| **Health check fails** | Dumps debug, DIE | ✅ No services running (safe) | ✅ GOOD |
| **Local changes exist** | Silently lost | ❌ Data loss | ❌ CRITICAL |
| **Disk space full mid-build** | Partial files remain | ⚠️ Inconsistent state | ⚠️ RISKY |
| **.env missing** | Services start without config | ⚠️ Might work, might fail | ⚠️ RISKY |
| **Nginx config corrupted** | Old config (skipped rewrite) | ✅ Continues working | ✅ GOOD |

---

## SAFE PULL STRATEGY - RECOMMENDED IMPLEMENTATION

### Pull with Safety Checks

```bash
safe_update_flow() {
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Starting SAFE UPDATE"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # PRE-FLIGHT CHECKS
  pre_update_checks
  
  # DETECT CURRENT STATE
  local before_version
  before_version="$(get_current_version)"
  log "Current version: $before_version"
  
  # DETECT LOCAL CHANGES
  if detect_local_changes >/dev/null; then
    log "⚠️  WARNING: Local changes will be lost"
    prompt_confirm_or_abort "Continue and lose local changes?"
  fi
  
  # STOP SERVICES
  stop_npanel_services
  
  # PULL CODE
  ensure_repo
  
  # VERIFY PULL SUCCESS
  verify_pull_result
  
  # ATOMIC BUILD
  atomic_build
  
  # VERIFY ARTIFACTS
  verify_build_artifacts
  
  # CONFIGURE SERVICES
  setup_services
  
  # START SERVICES
  verify_deployment
  
  # POST-UPDATE CHECKS
  post_update_checks
  
  # VERIFY NEW STATE
  local after_version
  after_version="$(get_current_version)"
  log "✓ Update complete: $before_version → $after_version"
}
```

---

## VERDICT

| Aspect | Status | Grade | Notes |
|--------|--------|-------|-------|
| **Services stopped before rebuild** | ✅ Implemented | ✅ A+ | Correct |
| **Git reset deterministic** | ✅ Implemented | ✅ A+ | Correct |
| **Local change detection** | ❌ Missing | ❌ F | Critical gap |
| **Pre-update validation** | ⚠️ Partial | ⚠️ C | Some checks only |
| **Build failure rollback** | ✅ Implemented | ⚠️ B- | Not fully atomic |
| **Build artifact verification** | ❌ Missing | ❌ F | Critical gap |
| **Health check after start** | ✅ Implemented | ✅ A | Comprehensive |
| **Log preservation** | ✅ Implemented | ✅ A | Logs updated correctly |

**Overall Update Safety**: ⚠️ **PASS with MAJOR ISSUES**

Safe but needs fixes before production.

---

**Audit Completed**: January 22, 2026  
**Next Task**: Implement fixes in installer script
