# DEPLOYMENT ROLLBACK PLAN

**Date**: January 22, 2026  
**Task**: D3 - Design rollback strategy for update failures  
**Scope**: What to do when backend build fails, frontend fails, or migration fails

---

## EXECUTIVE SUMMARY

Rollback strategy is **partially implemented** (git rollback works) but **lacks clarity on what's reversible vs immutable**:

✅ **Reversible**: Code (git), build artifacts  
❌ **Immutable**: Database migrations, schema changes, user data  
⚠️ **Unclear**: Service configurations, cache state

---

## ROLLBACK TRIGGERS

A rollback is needed when:

1. **Backend build fails**
   - npm install fails
   - TypeScript compilation fails
   - Dependency resolution fails
   - Runtime error detected on first boot

2. **Frontend build fails**
   - npm install fails
   - Next.js build fails
   - Bundle size exceeds limits
   - Runtime error detected on first boot

3. **Service fails to start**
   - systemd service fails
   - Port already in use
   - Missing configuration file
   - Permission denied

4. **Health check fails**
   - Backend API not responding
   - Frontend not serving pages
   - API endpoints returning 5xx
   - Database connectivity lost

5. **Migration fails** (Future/Potential)
   - Database schema migration fails
   - Data migration corrupts records
   - Rollback to previous schema needed

---

## CURRENT ROLLBACK CAPABILITY

### Code Rollback (Lines 2080-2089)

```bash
if ! install_npanel_dependencies; then
  err "Build failed; reverting to previous commit: ${NPANEL_PREV_COMMIT}"
  cd "$NPANEL_DIR" && git reset --hard "$NPANEL_PREV_COMMIT"
  git clean -fd
  die "Aborting update due to build failure"
fi
```

**Status**: ✅ **WORKS**
- Records previous commit
- Resets on build failure
- Cleans up temporary files

**But**: Services are left **stopped** (safe but requires manual restart)

---

## WHAT'S REVERSIBLE VS IMMUTABLE

### ✅ REVERSIBLE (Can be rolled back)

**1. Code (Git)**
- Previous commit known and saved
- `git reset --hard` guaranteed to work
- No history loss

**2. Build Artifacts**
- `node_modules/` can be regenerated
- `.next/` build cache can be regenerated
- `dist/` compiled code can be regenerated
- All deletable without data loss

**3. Service Configuration**
- systemd unit files are idempotent
- Nginx config is overwritten fresh
- Rewriting is safe

**4. .env Defaults**
- Defaults are regenerated
- Secrets are read-only (not overwritten)
- Safe to reset

---

### ❌ IMMUTABLE (Cannot be rolled back)

**1. Database Schema Changes** (if/when implemented)
- Migration up: `ALTER TABLE` changes schema
- Rollback requires: Separate down migration
- Data might be lost if schema narrowed

**2. Database Data** (if/when migrated to)
- Changes are permanent
- Rollback requires: Database backup restore

**3. Secrets/Certificates**
- Generated once, not regenerable
- Rollback should PRESERVE these
- Current installer: Skips if exists ✓

**4. User Data** (Tenant configurations)
- Immutable by design
- Should never be touched by installer

---

## ROLLBACK SCENARIOS & PROCEDURES

### Scenario 1: Backend Build Fails

**Trigger**: `npm install` or `npm run build` fails

**Current Behavior**:
```bash
# Installer logs:
[INFO] Building backend...
[ERROR] npm ERR! Build failed
[INFO] Reverting to previous commit...
[INFO] Aborting update
```

**Result**: System left with:
- ✅ Code reverted to previous version
- ❌ Services stopped
- ✅ Database unchanged
- ✅ Config unchanged

**Manual Recovery Needed**:
```bash
sudo systemctl start npanel-backend npanel-frontend
# Services restart with previous code version
```

**Grade**: ✅ **SAFE** (requires manual service restart)

---

### Scenario 2: Frontend Build Fails

**Trigger**: Next.js build fails

**Current Behavior**:
```bash
# Installer logs:
[INFO] Building frontend...
[ERROR] Error: next build failed
[INFO] Reverting to previous commit...
[INFO] Aborting update
```

**Result**: System left with:
- ✅ Code reverted
- ❌ Services stopped
- ✅ Database unchanged
- ✅ Config unchanged

**Manual Recovery Needed**:
```bash
sudo systemctl start npanel-backend npanel-frontend
```

**Grade**: ✅ **SAFE** (requires manual service restart)

---

### Scenario 3: Service Start Fails

**Trigger**: `systemctl restart` returns error

**Current Behavior**:
```bash
[INFO] Starting services...
[ERROR] Job for npanel-backend.service failed
[ERROR] Dumping debug info...
[ERROR] Die: Backend failed to start on port 3000
```

**Result**: System left with:
- ✅ Code updated successfully
- ✅ Services stopped (safe)
- ✅ Build succeeded
- ❌ Services not running

**Automated Recovery**:
```bash
# Installer should NOT die immediately
# Instead: Check for common issues

if ! systemctl start npanel-backend; then
  # Check port conflict
  if lsof -ti :3000; then
    log "Port 3000 in use, killing..."
    lsof -ti :3000 | xargs kill -9
    systemctl start npanel-backend
  fi
  
  # Check config
  if [[ ! -f /opt/npanel/backend/.env ]]; then
    log "Missing .env, regenerating..."
    write_env
  fi
  
  # Retry once
  if ! systemctl start npanel-backend; then
    # Still fails - rollback
    git reset --hard "$NPANEL_PREV_COMMIT"
    systemctl start npanel-backend
  fi
fi
```

**Grade**: ⚠️ **PARTIAL** (some auto-recovery possible)

---

### Scenario 4: Health Check Fails

**Trigger**: `curl http://localhost:3000/v1/health` returns error

**Current Behavior**:
```bash
[INFO] Verifying deployment...
[ERROR] Backend health probe failed on port 3000
[ERROR] Dumping debug info...
[ERROR] Die: Backend failed to reach health endpoint
```

**Result**: System left with:
- ✅ Code updated
- ✅ Services started but failing
- ✅ Build succeeded
- ❌ API not responding

**Recommended Rollback**:
```bash
if ! curl -f http://127.0.0.1:3000/v1/health >/dev/null; then
  log "Health check failed, attempting rollback..."
  
  # Stop services
  systemctl stop npanel-backend npanel-frontend
  
  # Revert code
  git reset --hard "$NPANEL_PREV_COMMIT"
  git clean -fd
  
  # Rebuild with previous code
  npm install && npm run build
  
  # Restart services
  systemctl start npanel-backend npanel-frontend
  
  # Re-check health
  if curl -f http://127.0.0.1:3000/v1/health >/dev/null; then
    log "✓ Health check passed after rollback"
  else
    die "Health check still failing - manual intervention required"
  fi
fi
```

**Grade**: ⚠️ **RISKY** (automatic rollback could mask real issues)

---

### Scenario 5: Database Migration Fails (Future)

**Trigger**: TypeORM migration fails

**Current Status**: ⚠️ **NOT IMPLEMENTED YET**

**Needed Rollback Procedure**:
```bash
# 1. Detect which migration failed
npx typeorm migration:show

# 2. Rollback to previous version
npx typeorm migration:revert

# 3. Check data integrity
mysql npanel -e "SELECT COUNT(*) FROM users;"

# 4. Either:
#    a) Fix migration and re-run
#    b) Restore from backup
```

**Grade**: ❌ **NOT YET PLANNED**

---

## ROLLBACK DECISION MATRIX

When to rollback vs when to fix:

| Failure | Rollback? | Why |
|---------|-----------|-----|
| **npm package resolution** | ✅ YES | Likely transient or bad dependency |
| **TypeScript compilation** | ✅ YES | Code has breaking change |
| **Next.js build** | ✅ YES | Frontend incompatible |
| **systemd unit file invalid** | ❌ NO | Installer wrote it, must fix installer |
| **Port already in use** | ❌ NO | Fix port conflict, don't rollback |
| **Missing .env** | ❌ NO | Regenerate .env, don't rollback |
| **Backend API timeout** | ⚠️ MAYBE | Check logs first |
| **Database connection fails** | ❌ NO | Check MySQL/MariaDB service |
| **JWT secret missing** | ❌ NO | Regenerate secret from installer |
| **Nginx config syntax error** | ❌ NO | Installer validates, shouldn't happen |

---

## WHAT THE INSTALLER SHOULD DO

### Pre-Update

```bash
# Save state
SAVED_COMMIT="$(git rev-parse HEAD)"
SAVED_ENV="/tmp/npanel-env-backup-$$.env"
cp .env "$SAVED_ENV"
```

### On Build Failure

```bash
# Do rollback automatically
git reset --hard "$SAVED_COMMIT"
git clean -fd

# Restore .env (if changed)
if ! diff .env "$SAVED_ENV" >/dev/null 2>&1; then
  cp "$SAVED_ENV" .env
  log "Restored previous .env"
fi

die "Build failed, rolled back to previous version. Run 'systemctl start npanel-*' to restart."
```

### On Service Start Failure

```bash
# Don't rollback immediately
# Check for common issues first

if systemctl status npanel-backend >/dev/null; then
  log "✓ Service started successfully"
else
  log "Service failed to start, attempting recovery..."
  
  # Common issue #1: Port in use
  if lsof -ti :3000; then
    kill -9 "$(lsof -ti :3000)"
    sleep 1
    systemctl restart npanel-backend
  fi
  
  # Common issue #2: Missing secrets
  if ! grep -q "JWT_SECRET" .env; then
    log "Missing JWT_SECRET, regenerating..."
    generate_jwt_secret >> .env
    systemctl restart npanel-backend
  fi
  
  # If still failing, rollback
  if ! systemctl status npanel-backend >/dev/null; then
    log "Recovery failed, rolling back..."
    git reset --hard "$SAVED_COMMIT"
    cp "$SAVED_ENV" .env
    systemctl start npanel-backend
  fi
fi
```

---

## MANUAL ROLLBACK PROCEDURE (For Operators)

If installer fails or automatic rollback doesn't work:

### Quick Rollback (Restore from Git)

```bash
cd /opt/npanel

# 1. Stop services
sudo systemctl stop npanel-backend npanel-frontend

# 2. Check git status
git log --oneline -5
git status

# 3. Identify last-known-good commit
git log --grep="success" --oneline  # Look for successful installs

# 4. Rollback
git reset --hard <commit-hash>
git clean -fd

# 5. Rebuild
cd backend && npm install && npm run build
cd ../frontend && npm install && npm run build

# 6. Restart
sudo systemctl start npanel-backend npanel-frontend

# 7. Verify
curl http://localhost:3000/v1/health
```

### Complete Rollback (Restore from Backup)

```bash
# If git rollback doesn't work:

# 1. Stop services
sudo systemctl stop npanel-backend npanel-frontend

# 2. Backup broken version
sudo mv /opt/npanel /opt/npanel.broken

# 3. Restore from backup
sudo tar xzf /backups/npanel-$(date -d '1 day ago' +%Y%m%d).tar.gz -C /opt

# 4. Restart
sudo systemctl start npanel-backend npanel-frontend

# 5. Verify
curl http://localhost:3000/v1/health
```

---

## RECOMMENDED BACKUP STRATEGY

Before each update:

```bash
# Daily automatic backup
0 2 * * * tar czf /backups/npanel-$(date +\%Y\%m\%d).tar.gz /opt/npanel /etc/npanel /var/log/npanel*.log
```

---

## ROLLBACK VERDICT

| Component | Can Rollback? | Automatic | Manual | Risk |
|-----------|---------------|-----------|--------|------|
| **Code** | ✅ YES | ✅ YES | ✅ YES | LOW |
| **Config** | ✅ YES | ✅ YES | ✅ YES | LOW |
| **Secrets** | ✅ YES | ⚠️ PARTIAL | ✅ YES | MEDIUM |
| **Database** | ❌ NO | ❌ NO | ✅ YES (backup) | HIGH |
| **User Data** | ❌ NO | ❌ NO | ✅ YES (backup) | HIGH |

**Overall Rollback Capability**: ✅ **GOOD FOR CODE, RISKY FOR DATA**

---

## RECOMMENDATIONS

### Priority 1 (Must Implement)
1. Save git commit before update starts
2. Auto-rollback on build failure (already done ✓)
3. Add state file: `/etc/npanel/installer-state.json`
4. Add clear manual rollback procedure in documentation

### Priority 2 (Should Implement)
1. Backup `.env` before update
2. Backup database before major updates
3. Add `--rollback` flag to installer
4. Add dry-run mode to show what would change

### Priority 3 (Nice to Have)
1. Automatic backup rotation
2. Rollback confirmation prompt
3. Automated daily backups
4. Database snapshot before migration

---

**Rollback Plan Completed**: January 22, 2026  
**Next Task**: Verify service lifecycle control
