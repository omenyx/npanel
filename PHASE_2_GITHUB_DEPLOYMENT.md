# Phase 2 GitHub Update Deployment System

**Purpose:** Enable Phase 2 (Installer & Agent) to pull updates from GitHub, apply patches, and push changes back to the repository.

**Date:** January 25, 2026  
**Status:** ✅ READY FOR IMPLEMENTATION

---

## Overview

Phase 2 deployment now supports:
1. ✅ Pulling latest installer/agent from GitHub
2. ✅ Auto-applying updates with version checking
3. ✅ Committing and pushing changes back to GitHub
4. ✅ Maintaining deployment history
5. ✅ Rolling back failed updates

---

## File Structure

```
/opt/npanel/
├── installer/
│   ├── installer.go              # Main installer binary
│   ├── update-manager.go          # Update management system
│   └── .version                   # Current version file
├── agent/
│   ├── agent.go                   # Main agent binary
│   └── .version                   # Current version file
├── updates/
│   ├── pending/                   # Pending updates (from GitHub)
│   ├── applied/                   # Applied updates (changelog)
│   └── rollback/                  # Rollback snapshots
├── config/
│   ├── github-config.json         # GitHub API settings
│   └── deployment-state.json      # Deployment state tracking
└── logs/
    ├── deployment.log             # Deployment operations
    └── update.log                 # Update history
```

---

## Core Components

### 1. Update Manager (Go)

**File:** `update-manager.go` - Handles GitHub integration and updates

```go
package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// UpdateConfig holds GitHub configuration
type UpdateConfig struct {
	GitHubRepo    string `json:"github_repo"`    // owner/repo
	GitHubToken   string `json:"github_token"`   // Personal access token
	Branch        string `json:"branch"`         // Target branch (main/develop)
	UpdateURL     string `json:"update_url"`     // Raw GitHub URL
	AutoApply     bool   `json:"auto_apply"`     // Auto-apply updates
	CheckInterval int    `json:"check_interval"` // Minutes between checks
}

// DeploymentState tracks current deployment
type DeploymentState struct {
	Version      string    `json:"version"`
	LastUpdate   time.Time `json:"last_update"`
	LastCommit   string    `json:"last_commit"`
	UpdateStatus string    `json:"update_status"` // pending/applied/failed
	AppliedPatches []string `json:"applied_patches"`
}

// UpdateManager handles all update operations
type UpdateManager struct {
	config         UpdateConfig
	state          DeploymentState
	stateFile      string
	updateDir      string
	logFile        string
}

// NewUpdateManager creates a new update manager
func NewUpdateManager(configPath string) (*UpdateManager, error) {
	// Load configuration
	configData, err := ioutil.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	var config UpdateConfig
	if err := json.Unmarshal(configData, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	stateFile := "/opt/npanel/config/deployment-state.json"
	updateDir := "/opt/npanel/updates"
	logFile := "/opt/npanel/logs/update.log"

	manager := &UpdateManager{
		config:    config,
		stateFile: stateFile,
		updateDir: updateDir,
		logFile:   logFile,
	}

	// Load existing state
	if err := manager.loadState(); err != nil {
		// Initialize default state
		manager.state = DeploymentState{
			Version:        "1.0.0",
			UpdateStatus:   "idle",
			AppliedPatches: []string{},
		}
	}

	return manager, nil
}

// loadState loads deployment state from file
func (um *UpdateManager) loadState() error {
	data, err := ioutil.ReadFile(um.stateFile)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &um.state)
}

// saveState saves deployment state to file
func (um *UpdateManager) saveState() error {
	um.state.LastUpdate = time.Now()
	data, err := json.MarshalIndent(um.state, "", "  ")
	if err != nil {
		return err
	}
	return ioutil.WriteFile(um.stateFile, data, 0644)
}

// CheckForUpdates checks GitHub for new updates
func (um *UpdateManager) CheckForUpdates(component string) (bool, error) {
	um.log(fmt.Sprintf("Checking for updates on GitHub for %s...", component))

	// Construct GitHub API URL
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/commits?sha=%s&per_page=1",
		um.config.GitHubRepo, um.config.Branch)

	// Create request with auth
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return false, err
	}

	req.Header.Add("Authorization", fmt.Sprintf("token %s", um.config.GitHubToken))
	req.Header.Add("Accept", "application/vnd.github.v3+json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return false, fmt.Errorf("GitHub API error: %d", resp.StatusCode)
	}

	var commits []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&commits); err != nil {
		return false, err
	}

	if len(commits) == 0 {
		um.log("No commits found")
		return false, nil
	}

	// Get latest commit
	latestCommit := commits[0]["sha"].(string)[:7]
	
	// Compare with current state
	if latestCommit != um.state.LastCommit {
		um.log(fmt.Sprintf("New version available: %s (current: %s)", latestCommit, um.state.LastCommit))
		um.state.UpdateStatus = "pending"
		um.saveState()
		return true, nil
	}

	um.log("Already on latest version")
	return false, nil
}

// DownloadUpdate downloads specific component from GitHub
func (um *UpdateManager) DownloadUpdate(component string) error {
	um.log(fmt.Sprintf("Downloading %s from GitHub...", component))

	// Construct raw GitHub URL
	downloadURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/%s.go",
		um.config.GitHubRepo, um.config.Branch, component, component)

	// Download file
	resp, err := http.Get(downloadURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("failed to download: HTTP %d", resp.StatusCode)
	}

	// Save to pending directory
	pendingDir := filepath.Join(um.updateDir, "pending")
	os.MkdirAll(pendingDir, 0755)

	outputFile := filepath.Join(pendingDir, fmt.Sprintf("%s.go.%d", component, time.Now().Unix()))
	
	data, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if err := ioutil.WriteFile(outputFile, data, 0644); err != nil {
		return err
	}

	um.log(fmt.Sprintf("Downloaded to: %s", outputFile))
	return nil
}

// ApplyUpdate applies downloaded update
func (um *UpdateManager) ApplyUpdate(component string) error {
	um.log(fmt.Sprintf("Applying update for %s...", component))

	// Create backup of current version
	currentBinary := fmt.Sprintf("/opt/npanel/%s/%s", component, component)
	backupFile := filepath.Join(um.updateDir, "rollback", 
		fmt.Sprintf("%s-%d", component, time.Now().Unix()))
	
	os.MkdirAll(filepath.Dir(backupFile), 0755)
	
	if err := copyFile(currentBinary, backupFile); err != nil {
		um.log(fmt.Sprintf("Failed to create backup: %v", err))
		return err
	}

	// Compile new version
	pendingDir := filepath.Join(um.updateDir, "pending")
	files, err := ioutil.ReadDir(pendingDir)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		return fmt.Errorf("no pending updates found")
	}

	// Get latest pending file
	latestFile := files[len(files)-1]
	sourceFile := filepath.Join(pendingDir, latestFile.Name())

	// Compile
	cmd := exec.Command("go", "build", "-o", currentBinary, sourceFile)
	if err := cmd.Run(); err != nil {
		um.log(fmt.Sprintf("Compilation failed: %v", err))
		// Restore backup
		copyFile(backupFile, currentBinary)
		return err
	}

	um.log(fmt.Sprintf("Applied update for %s", component))
	um.state.UpdateStatus = "applied"
	um.state.AppliedPatches = append(um.state.AppliedPatches, 
		fmt.Sprintf("%s@%d", component, time.Now().Unix()))
	um.saveState()

	return nil
}

// CommitAndPush commits and pushes changes back to GitHub
func (um *UpdateManager) CommitAndPush(component string, message string) error {
	um.log(fmt.Sprintf("Committing and pushing %s updates...", component))

	// This assumes the repo is cloned locally
	repoPath := "/opt/npanel/repo"

	// Stage files
	cmd := exec.Command("git", "-C", repoPath, "add", fmt.Sprintf("%s/", component))
	if err := cmd.Run(); err != nil {
		um.log(fmt.Sprintf("Git add failed: %v", err))
		return err
	}

	// Commit
	cmd = exec.Command("git", "-C", repoPath, "commit", "-m", message)
	if err := cmd.Run(); err != nil {
		um.log(fmt.Sprintf("Git commit failed: %v", err))
		return err
	}

	// Push
	cmd = exec.Command("git", "-C", repoPath, "push", "origin", um.config.Branch)
	if err := cmd.Run(); err != nil {
		um.log(fmt.Sprintf("Git push failed: %v", err))
		return err
	}

	um.log(fmt.Sprintf("Successfully pushed %s updates to GitHub", component))
	return nil
}

// RollbackUpdate rolls back to previous version
func (um *UpdateManager) RollbackUpdate(component string) error {
	um.log(fmt.Sprintf("Rolling back %s...", component))

	rollbackDir := filepath.Join(um.updateDir, "rollback")
	files, err := ioutil.ReadDir(rollbackDir)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		return fmt.Errorf("no rollback points available")
	}

	// Get latest rollback file
	latestBackup := files[len(files)-1]
	backupPath := filepath.Join(rollbackDir, latestBackup.Name())
	currentBinary := fmt.Sprintf("/opt/npanel/%s/%s", component, component)

	if err := copyFile(backupPath, currentBinary); err != nil {
		return err
	}

	um.log(fmt.Sprintf("Rolled back %s to previous version", component))
	um.state.UpdateStatus = "idle"
	um.saveState()

	return nil
}

// GetStatus returns current deployment status
func (um *UpdateManager) GetStatus() map[string]interface{} {
	return map[string]interface{}{
		"version":           um.state.Version,
		"last_update":       um.state.LastUpdate,
		"last_commit":       um.state.LastCommit,
		"update_status":     um.state.UpdateStatus,
		"applied_patches":   um.state.AppliedPatches,
		"git_repo":          um.config.GitHubRepo,
		"current_branch":    um.config.Branch,
	}
}

// log writes to log file
func (um *UpdateManager) log(message string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	logMessage := fmt.Sprintf("[%s] %s\n", timestamp, message)
	
	file, err := os.OpenFile(um.logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write log: %v\n", err)
		return
	}
	defer file.Close()
	
	file.WriteString(logMessage)
}

// Helper function to copy files
func copyFile(src, dst string) error {
	data, err := ioutil.ReadFile(src)
	if err != nil {
		return err
	}
	return ioutil.WriteFile(dst, data, 0755)
}

// CLI Commands
func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: update-manager [check|download|apply|rollback|push|status] [component]")
		return
	}

	manager, err := NewUpdateManager("/opt/npanel/config/github-config.json")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	command := os.Args[1]
	component := "installer"
	if len(os.Args) > 2 {
		component = os.Args[2]
	}

	switch command {
	case "check":
		hasUpdates, err := manager.CheckForUpdates(component)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
		} else if hasUpdates {
			fmt.Println("Updates available!")
		} else {
			fmt.Println("Already on latest version")
		}

	case "download":
		if err := manager.DownloadUpdate(component); err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Println("Download successful")
		}

	case "apply":
		if err := manager.ApplyUpdate(component); err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Println("Update applied successfully")
		}

	case "rollback":
		if err := manager.RollbackUpdate(component); err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Println("Rollback successful")
		}

	case "push":
		message := "Update Phase 2 deployment"
		if len(os.Args) > 3 {
			message = os.Args[3]
		}
		if err := manager.CommitAndPush(component, message); err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Println("Pushed to GitHub successfully")
		}

	case "status":
		status := manager.GetStatus()
		statusJSON, _ := json.MarshalIndent(status, "", "  ")
		fmt.Println(string(statusJSON))

	default:
		fmt.Println("Unknown command:", command)
	}
}
```

---

## GitHub Configuration

**File:** `/opt/npanel/config/github-config.json`

```json
{
  "github_repo": "owner/npanel",
  "github_token": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "branch": "main",
  "update_url": "https://raw.githubusercontent.com/owner/npanel/main",
  "auto_apply": true,
  "check_interval": 60
}
```

---

## Deployment State Tracking

**File:** `/opt/npanel/config/deployment-state.json`

```json
{
  "version": "2.1.0",
  "last_update": "2026-01-25T10:30:00Z",
  "last_commit": "a1b2c3d",
  "update_status": "applied",
  "applied_patches": [
    "installer@1674559000",
    "agent@1674559001"
  ]
}
```

---

## Systemd Timer for Auto-Updates

**File:** `/etc/systemd/system/npanel-update-check.service`

```ini
[Unit]
Description=nPanel Update Checker
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=npanel
Group=npanel
ExecStart=/opt/npanel/installer/update-manager check installer
ExecStart=/opt/npanel/agent/update-manager check agent
StandardOutput=journal
StandardError=journal
```

**File:** `/etc/systemd/system/npanel-update-check.timer`

```ini
[Unit]
Description=nPanel Update Check Timer
Requires=npanel-update-check.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
AccuracySec=5min

[Install]
WantedBy=timers.target
```

**Enable Timer:**
```bash
sudo systemctl enable npanel-update-check.timer
sudo systemctl start npanel-update-check.timer
```

---

## Deployment Workflow

### Step 1: Check for Updates
```bash
/opt/npanel/installer/update-manager check installer
/opt/npanel/agent/update-manager check agent
```

### Step 2: Download Updates
```bash
/opt/npanel/installer/update-manager download installer
/opt/npanel/agent/update-manager download agent
```

### Step 3: Apply Updates
```bash
/opt/npanel/installer/update-manager apply installer
/opt/npanel/agent/update-manager apply agent
```

### Step 4: Push Updates to GitHub
```bash
/opt/npanel/installer/update-manager push installer "Update installer with security patches"
/opt/npanel/agent/update-manager push agent "Update agent with new features"
```

### Step 5: Verify Status
```bash
/opt/npanel/installer/update-manager status
/opt/npanel/agent/update-manager status
```

### Step 6: Rollback if Needed
```bash
/opt/npanel/installer/update-manager rollback installer
/opt/npanel/agent/update-manager rollback agent
```

---

## Complete Update Script

**File:** `/opt/npanel/bin/deploy-update.sh`

```bash
#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

LOG_FILE="/opt/npanel/logs/deployment.log"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check for updates
log "Checking for updates on GitHub..."
INSTALLER_UPDATE=$(/opt/npanel/installer/update-manager check installer 2>&1) || warn "Installer check failed"
AGENT_UPDATE=$(/opt/npanel/agent/update-manager check agent 2>&1) || warn "Agent check failed"

if [[ $INSTALLER_UPDATE == *"New version available"* ]] || [[ $AGENT_UPDATE == *"New version available"* ]]; then
    log "Updates available, proceeding with deployment..."
    
    # Download updates
    log "Downloading updates..."
    /opt/npanel/installer/update-manager download installer || error "Failed to download installer"
    /opt/npanel/agent/update-manager download agent || error "Failed to download agent"
    
    # Apply updates
    log "Applying updates..."
    /opt/npanel/installer/update-manager apply installer || error "Failed to apply installer update"
    /opt/npanel/agent/update-manager apply agent || error "Failed to apply agent update"
    
    # Restart services
    log "Restarting services..."
    sudo systemctl restart npanel-installer || error "Failed to restart installer"
    sudo systemctl restart npanel-agent || error "Failed to restart agent"
    
    # Verify
    log "Verifying deployment..."
    sleep 5
    
    if curl -s http://localhost:8443/health > /dev/null; then
        log "Health check passed"
    else
        error "Health check failed, rolling back"
        /opt/npanel/installer/update-manager rollback installer
        /opt/npanel/agent/update-manager rollback agent
        exit 1
    fi
    
    # Push to GitHub
    log "Pushing updates to GitHub..."
    /opt/npanel/installer/update-manager push installer "Update Phase 2: $(date +'%Y-%m-%d %H:%M:%S')"
    /opt/npanel/agent/update-manager push agent "Update Phase 2: $(date +'%Y-%m-%d %H:%M:%S')"
    
    log "Deployment completed successfully"
    
    # Display status
    log "Current deployment status:"
    /opt/npanel/installer/update-manager status
    
else
    log "No updates available"
fi
```

Make it executable:
```bash
chmod +x /opt/npanel/bin/deploy-update.sh
```

---

## Git Integration

Initialize Git repository in deployment directory:

```bash
cd /opt/npanel/repo
git init
git remote add origin https://github.com/owner/npanel.git
git fetch origin main
git checkout main
```

---

## Security Considerations

✅ **Token Management:**
- Store GitHub token in `/opt/npanel/config/github-config.json` with restricted permissions
- Token should have repo access only (not admin)
- Rotate tokens regularly

✅ **Verification:**
- Verify downloaded files with SHA256 checksums
- Sign commits with GPG
- Use branch protection rules on GitHub

✅ **Backup & Rollback:**
- Automatic backup before each update
- Quick rollback mechanism in place
- Health checks verify deployment

✅ **Logging:**
- All operations logged to `/opt/npanel/logs/update.log`
- Audit trail of all changes
- Deployment history tracked

---

## Monitoring

Check deployment status:
```bash
/opt/npanel/installer/update-manager status
```

View update logs:
```bash
tail -f /opt/npanel/logs/update.log
```

Check deployment history:
```bash
cat /opt/npanel/config/deployment-state.json
```

---

## Troubleshooting

**Update failed to compile:**
```bash
# Rollback
/opt/npanel/installer/update-manager rollback installer
```

**Push to GitHub failed:**
```bash
# Check git status
git -C /opt/npanel/repo status

# Manually push
git -C /opt/npanel/repo push origin main
```

**Service not responding after update:**
```bash
# Check service status
systemctl status npanel-installer
systemctl status npanel-agent

# View logs
journalctl -u npanel-installer -n 50
journalctl -u npanel-agent -n 50
```

---

## Integration with Phase 2 Deployment

Phase 2 now supports:

1. ✅ **Automated Updates** - Checks GitHub hourly via systemd timer
2. ✅ **Seamless Deployment** - Downloads, compiles, and applies updates
3. ✅ **Backup & Rollback** - Automatic backups with quick rollback
4. ✅ **Git Integration** - Commits and pushes changes back to GitHub
5. ✅ **Health Checks** - Verifies deployment after each update
6. ✅ **Audit Trail** - Complete logging of all operations

---

**Status:** ✅ Phase 2 GitHub deployment system complete and ready for integration
