# PHASE 2 GITHUB DEPLOYMENT INTEGRATION CHECKLIST

**Date:** January 25, 2026  
**Status:** ✅ Ready for Implementation  

---

## Pre-Deployment Checklist

### GitHub Setup

- [ ] Create GitHub personal access token
  ```bash
  # Go to https://github.com/settings/tokens
  # Create token with 'repo' scope only
  # Copy token to secure location
  ```

- [ ] Configure repository access
  ```bash
  git clone https://github.com/owner/npanel.git /opt/npanel/repo
  cd /opt/npanel/repo
  git config user.email "deploy@npanel.local"
  git config user.name "nPanel Deployment"
  ```

- [ ] Verify branch protection
  - Main branch should require pull request reviews
  - Status checks should pass before merge
  - Dismisses stale pull request approvals

### Deployment Structure

- [ ] Create directories
  ```bash
  mkdir -p /opt/npanel/updates/{pending,applied,rollback}
  mkdir -p /opt/npanel/config
  mkdir -p /opt/npanel/logs
  mkdir -p /opt/npanel/bin
  ```

- [ ] Set permissions
  ```bash
  chmod 700 /opt/npanel/config
  chmod 755 /opt/npanel/updates
  chmod 755 /opt/npanel/bin
  chmod 755 /opt/npanel/logs
  ```

- [ ] Create .version files
  ```bash
  echo "2.1.0" > /opt/npanel/installer/.version
  echo "2.1.0" > /opt/npanel/agent/.version
  ```

### Configuration Files

- [ ] Create github-config.json
  ```bash
  cat > /opt/npanel/config/github-config.json << 'EOF'
  {
    "github_repo": "owner/npanel",
    "github_token": "YOUR_TOKEN_HERE",
    "branch": "main",
    "update_url": "https://raw.githubusercontent.com/owner/npanel/main",
    "auto_apply": false,
    "check_interval": 60
  }
  EOF
  chmod 600 /opt/npanel/config/github-config.json
  ```

- [ ] Create initial deployment-state.json
  ```bash
  cat > /opt/npanel/config/deployment-state.json << 'EOF'
  {
    "version": "2.1.0",
    "last_update": "2026-01-25T00:00:00Z",
    "last_commit": "initial",
    "update_status": "idle",
    "applied_patches": []
  }
  EOF
  chmod 644 /opt/npanel/config/deployment-state.json
  ```

### Code Integration

- [ ] Compile update-manager
  ```bash
  go build -o /opt/npanel/installer/update-manager \
    /opt/npanel/installer/update-manager.go
  
  go build -o /opt/npanel/agent/update-manager \
    /opt/npanel/agent/update-manager.go
  
  chmod +x /opt/npanel/installer/update-manager
  chmod +x /opt/npanel/agent/update-manager
  ```

- [ ] Install deployment script
  ```bash
  cp /opt/npanel/bin/deploy-update.sh /opt/npanel/bin/
  chmod +x /opt/npanel/bin/deploy-update.sh
  ```

### Systemd Configuration

- [ ] Install update check service
  ```bash
  sudo cp /etc/systemd/system/npanel-update-check.service \
    /etc/systemd/system/
  
  sudo cp /etc/systemd/system/npanel-update-check.timer \
    /etc/systemd/system/
  
  sudo systemctl daemon-reload
  ```

- [ ] Enable auto-update timer (optional)
  ```bash
  # Disable auto-apply initially
  # Enable only after manual testing
  # sudo systemctl enable npanel-update-check.timer
  ```

---

## Manual Testing

### Test 1: Check for Updates

```bash
/opt/npanel/installer/update-manager check installer
# Expected: "Already on latest version" or "New version available"
```

### Test 2: Download Updates

```bash
# Create a test update file manually
touch /opt/npanel/updates/pending/installer.go.test

# Verify it exists
ls -la /opt/npanel/updates/pending/
```

### Test 3: Check Status

```bash
/opt/npanel/installer/update-manager status
# Expected: JSON output with deployment state
```

### Test 4: Create Rollback Point

```bash
# Test rollback backup creation
/opt/npanel/installer/update-manager rollback installer
# Expected: Backup file created in /opt/npanel/updates/rollback/
```

---

## Operational Procedures

### Daily Operations

**Morning Check:**
```bash
# Check for pending updates
/opt/npanel/installer/update-manager status
/opt/npanel/agent/update-manager status

# View logs from overnight
tail -50 /opt/npanel/logs/update.log
```

**Weekly Update:**
```bash
# Run full deployment cycle
/opt/npanel/bin/deploy-update.sh
```

### Emergency Procedures

**Immediate Rollback:**
```bash
# If something goes wrong
/opt/npanel/installer/update-manager rollback installer
/opt/npanel/agent/update-manager rollback agent

# Restart services
sudo systemctl restart npanel-installer
sudo systemctl restart npanel-agent
```

**Manual Update:**
```bash
# If automated update fails
cd /opt/npanel/repo
git pull origin main
/opt/npanel/installer/update-manager apply installer
/opt/npanel/agent/update-manager apply agent
```

---

## GitHub Workflow Integration

### Commit & Push Workflow

```bash
# 1. Make changes to code
vim /opt/npanel/installer/installer.go

# 2. Create backup
cp /opt/npanel/installer/installer /opt/npanel/installer/installer.bak

# 3. Recompile
go build -o /opt/npanel/installer/installer \
  /opt/npanel/installer/installer.go

# 4. Test locally
/opt/npanel/installer/installer --version

# 5. Commit and push
/opt/npanel/installer/update-manager push installer \
  "Update installer with security patches ($(date +'%Y-%m-%d'))"
```

### Pull Request Workflow

```bash
# 1. Create feature branch locally
cd /opt/npanel/repo
git checkout -b feature/security-update

# 2. Make changes
vim installer/installer.go

# 3. Commit locally
git commit -m "Security update for installer"

# 4. Push to feature branch
git push origin feature/security-update

# 5. Create pull request on GitHub
# Visit: https://github.com/owner/npanel/pull/new/feature/security-update

# 6. After approval and merge, pull back
git checkout main
git pull origin main
```

---

## Monitoring & Logging

### Key Log Files

- `/opt/npanel/logs/update.log` - Update operations
- `/opt/npanel/logs/deployment.log` - Deployment script runs
- `/var/log/npanel-api.log` - API server logs
- `/var/log/npanel-agent.log` - Agent logs

### Monitoring Commands

```bash
# Watch for updates in real-time
tail -f /opt/npanel/logs/update.log

# Check deployment state
cat /opt/npanel/config/deployment-state.json | jq .

# List applied patches
jq '.applied_patches' /opt/npanel/config/deployment-state.json

# Check rollback availability
ls -lh /opt/npanel/updates/rollback/
```

### Alerting Setup

Add to your monitoring system (Prometheus/Grafana):

```prometheus
# Alert if no updates for 7 days
alert: nPanelNoRecentUpdates
expr: (time() - npanel_last_update_timestamp) > 604800
for: 1h
annotations:
  summary: "nPanel has not checked for updates in 7 days"
```

---

## Security Considerations

### Access Control

```bash
# Restrict access to update tools
sudo chown deploy:deploy /opt/npanel/installer/update-manager
sudo chmod 750 /opt/npanel/installer/update-manager

# Token security
sudo chown deploy:deploy /opt/npanel/config/github-config.json
sudo chmod 600 /opt/npanel/config/github-config.json

# Verify no one else can read token
sudo -u root cat /opt/npanel/config/github-config.json
# Expected: Permission denied
```

### Token Rotation

Schedule monthly token rotation:

```bash
# 1. Generate new token on GitHub
# 2. Update config file
vi /opt/npanel/config/github-config.json

# 3. Verify new token works
/opt/npanel/installer/update-manager check installer

# 4. Delete old token from GitHub
```

### Signed Commits

Configure signed commits:

```bash
# Generate GPG key (if not exists)
gpg --gen-key

# Configure Git to sign commits
git config --global commit.gpgsign true
git config --global user.signingkey ABCD1234

# Now all commits will be signed
/opt/npanel/installer/update-manager push installer "Signed update"
```

---

## Troubleshooting

### Problem: "Authentication failed"

**Cause:** Invalid GitHub token  
**Solution:**
```bash
# Check token validity
curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/user

# If 401, regenerate token and update config
vi /opt/npanel/config/github-config.json
```

### Problem: "Failed to apply update"

**Cause:** Compilation error  
**Solution:**
```bash
# Check logs
tail -100 /opt/npanel/logs/update.log

# Rollback to previous version
/opt/npanel/installer/update-manager rollback installer

# Fix compilation error and retry
```

### Problem: "Failed to push to GitHub"

**Cause:** Network issue or permission denied  
**Solution:**
```bash
# Check network connectivity
ping github.com

# Verify SSH key / token access
ssh -T git@github.com

# Manually retry push
git -C /opt/npanel/repo push origin main
```

### Problem: Update never completes

**Cause:** Infinite loop or hanging process  
**Solution:**
```bash
# Kill hanging process
ps aux | grep update-manager
kill -9 <PID>

# Check system resources
top

# Restart service
sudo systemctl restart npanel-installer
```

---

## Verification Checklist

### Before Deployment

- [ ] GitHub token created and tested
- [ ] Repository cloned and configured
- [ ] Directories created with correct permissions
- [ ] Configuration files in place
- [ ] update-manager compiled successfully
- [ ] Deployment script is executable
- [ ] Systemd service files copied
- [ ] Manual tests pass (all 4 tests above)

### After Deployment

- [ ] Services running without errors
- [ ] Update check completes without hanging
- [ ] Status command returns valid JSON
- [ ] Logs are being written
- [ ] Rollback mechanism works
- [ ] Git integration functional
- [ ] Health checks passing

---

## Rollout Plan

### Phase 1: Manual Operation (Week 1)

- [ ] Deploy update manager
- [ ] Test all manual commands
- [ ] Perform 2-3 manual updates
- [ ] Verify rollback works
- [ ] Document any issues

### Phase 2: Scheduled Updates (Week 2)

- [ ] Enable scheduled update checks (timer)
- [ ] Run updates on fixed schedule (e.g., Tuesday 2 AM)
- [ ] Monitor logs closely
- [ ] Implement alerting

### Phase 3: Auto-Apply (Week 3+)

- [ ] Enable auto-apply only for non-critical patches
- [ ] Keep manual review for major versions
- [ ] Implement comprehensive monitoring
- [ ] Document all procedures

---

## Success Metrics

Track these metrics to measure success:

- ✅ Update time: < 5 minutes
- ✅ Success rate: > 99%
- ✅ Time to rollback: < 1 minute
- ✅ Zero data loss on rollback
- ✅ All changes tracked in Git
- ✅ All operations logged

---

**Status:** ✅ Phase 2 GitHub Deployment Integration Complete

**Next Steps:**
1. Review this checklist with your ops team
2. Prepare GitHub repository for deployment
3. Execute pre-deployment checklist
4. Run manual tests
5. Enable automated updates

---

**Document Created:** January 25, 2026  
**Phase 2 GitHub Deployment Ready:** YES ✅
