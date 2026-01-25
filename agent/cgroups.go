package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// CgroupManager v2 handles resource isolation per account
// No kernel patches required - uses built-in cgroups v2
type CgroupManager struct {
	basePath string // /sys/fs/cgroup
	version  int    // 2
	enabled  bool
}

// NewCgroupManager initializes cgroups v2 manager
// Returns error if cgroups v2 not available
func NewCgroupManager() (*CgroupManager, error) {
	// Verify cgroups v2 is mounted and active
	controllersPath := "/sys/fs/cgroup/cgroup.controllers"
	controllers, err := os.ReadFile(controllersPath)
	if err != nil {
		return nil, fmt.Errorf("cgroups v2 unavailable: %w", err)
	}

	// Verify required controllers are available
	controllerStr := string(controllers)
	requiredControllers := []string{"cpu", "memory", "pids"}
	for _, controller := range requiredControllers {
		if !strings.Contains(controllerStr, controller) {
			return nil, fmt.Errorf("cgroups v2 missing controller: %s", controller)
		}
	}

	return &CgroupManager{
		basePath: "/sys/fs/cgroup",
		version:  2,
		enabled:  true,
	}, nil
}

// CgroupConfig holds per-account resource limits
type CgroupConfig struct {
	AccountID   string
	CPUPercent  int   // 1-200 (50 = 50% of 1 core)
	MemoryMB    int64 // minimum 64 MB
	IOReadMBps  int   // MB/s, 0 = unlimited
	IOWriteMBps int   // MB/s, 0 = unlimited
	MaxPIDs     int   // maximum processes
}

// CreateAccountCgroup creates resource-isolated cgroup for account
func (cm *CgroupManager) CreateAccountCgroup(cfg CgroupConfig) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	// Validate config
	if err := validateCgroupConfig(cfg); err != nil {
		return err
	}

	// Create cgroup directory under user.slice
	cgroupPath := cm.getAccountCgroupPath(cfg.AccountID)
	if err := os.MkdirAll(cgroupPath, 0755); err != nil {
		return fmt.Errorf("failed to create cgroup directory: %w", err)
	}

	// Set CPU limit using cpu.max format: "<usec> <period>"
	// Example: 50% of 1 core = 50000 usec per 100000 usec
	cpuUsec := cfg.CPUPercent * 1000 // Convert percentage to usec
	cpuMax := fmt.Sprintf("%d 100000", cpuUsec)
	if err := cm.writeCgroupFile(cgroupPath, "cpu.max", cpuMax); err != nil {
		cm.deleteAccountCgroupCleanup(cgroupPath) // Rollback
		return fmt.Errorf("failed to set CPU limit: %w", err)
	}

	// Set memory limit
	memoryBytes := cfg.MemoryMB * 1024 * 1024
	if err := cm.writeCgroupFile(cgroupPath, "memory.max", fmt.Sprintf("%d", memoryBytes)); err != nil {
		cm.deleteAccountCgroupCleanup(cgroupPath)
		return fmt.Errorf("failed to set memory limit: %w", err)
	}

	// Set memory swap limit to prevent swap abuse
	if err := cm.writeCgroupFile(cgroupPath, "memory.swap.max", fmt.Sprintf("%d", memoryBytes/2)); err != nil {
		// Swap limit might not be available, log but don't fail
		fmt.Printf("[cgroups] Warning: memory.swap.max not available\n")
	}

	// Set PID limit
	if err := cm.writeCgroupFile(cgroupPath, "pids.max", fmt.Sprintf("%d", cfg.MaxPIDs)); err != nil {
		cm.deleteAccountCgroupCleanup(cgroupPath)
		return fmt.Errorf("failed to set PID limit: %w", err)
	}

	// IO limits (optional - may not work on all systems)
	if cfg.IOReadMBps > 0 || cfg.IOWriteMBps > 0 {
		ioMax := fmt.Sprintf("259:0 rbps=%d wbps=%d\n",
			cfg.IOReadMBps*1024*1024,
			cfg.IOWriteMBps*1024*1024)
		if err := cm.writeCgroupFile(cgroupPath, "io.max", ioMax); err != nil {
			fmt.Printf("[cgroups] Warning: IO limits not available: %v\n", err)
			// Continue anyway - IO limits are optional
		}
	}

	fmt.Printf("[cgroups] Created: account=%s cpu=%d%% mem=%dMB pid=%d\n",
		cfg.AccountID, cfg.CPUPercent, cfg.MemoryMB, cfg.MaxPIDs)

	return nil
}

// UpdateCgroupLimits updates resource limits for an existing cgroup
func (cm *CgroupManager) UpdateCgroupLimits(cfg CgroupConfig) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	if err := validateCgroupConfig(cfg); err != nil {
		return err
	}

	cgroupPath := cm.getAccountCgroupPath(cfg.AccountID)

	// Verify cgroup exists
	if _, err := os.Stat(filepath.Join(cgroupPath, "cpu.max")); err != nil {
		return fmt.Errorf("cgroup does not exist for account %s", cfg.AccountID)
	}

	// Update CPU
	cpuUsec := cfg.CPUPercent * 1000
	cpuMax := fmt.Sprintf("%d 100000", cpuUsec)
	if err := cm.writeCgroupFile(cgroupPath, "cpu.max", cpuMax); err != nil {
		return fmt.Errorf("failed to update CPU limit: %w", err)
	}

	// Update memory
	memoryBytes := cfg.MemoryMB * 1024 * 1024
	if err := cm.writeCgroupFile(cgroupPath, "memory.max", fmt.Sprintf("%d", memoryBytes)); err != nil {
		return fmt.Errorf("failed to update memory limit: %w", err)
	}

	// Update PIDs
	if err := cm.writeCgroupFile(cgroupPath, "pids.max", fmt.Sprintf("%d", cfg.MaxPIDs)); err != nil {
		return fmt.Errorf("failed to update PID limit: %w", err)
	}

	fmt.Printf("[cgroups] Updated: account=%s cpu=%d%% mem=%dMB\n",
		cfg.AccountID, cfg.CPUPercent, cfg.MemoryMB)

	return nil
}

// MoveProcessToCgroup moves a process into account's cgroup
// Used when spawning processes (mail daemon, backup, etc.)
func (cm *CgroupManager) MoveProcessToCgroup(accountID string, pid int) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	cgroupPath := cm.getAccountCgroupPath(accountID)
	procsFile := filepath.Join(cgroupPath, "cgroup.procs")

	// Verify cgroup exists
	if _, err := os.Stat(procsFile); err != nil {
		return fmt.Errorf("cgroup does not exist for account %s", accountID)
	}

	// Write PID to cgroup.procs
	return cm.writeCgroupFile(cgroupPath, "cgroup.procs", fmt.Sprintf("%d", pid))
}

// DeleteAccountCgroup removes a cgroup after account deletion
// Only succeeds if cgroup is empty (no processes left)
func (cm *CgroupManager) DeleteAccountCgroup(accountID string) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	cgroupPath := cm.getAccountCgroupPath(accountID)

	// Verify empty (no processes in cgroup)
	procsFile := filepath.Join(cgroupPath, "cgroup.procs")
	data, _ := os.ReadFile(procsFile)
	pidsList := strings.TrimSpace(string(data))

	if len(pidsList) > 0 {
		return fmt.Errorf("cgroup not empty: processes still running in %s", accountID)
	}

	// Remove cgroup directory
	if err := os.RemoveAll(cgroupPath); err != nil {
		return fmt.Errorf("failed to delete cgroup: %w", err)
	}

	fmt.Printf("[cgroups] Deleted: account=%s\n", accountID)
	return nil
}

// GetCgroupStats retrieves current resource usage for monitoring
type CgroupStats struct {
	CPUUsageMicros  int64  // microseconds
	CPUPercent      int    // 0-100
	MemoryBytes     int64  // current memory usage
	MemoryLimitMB   int64  // configured limit
	PIDCount        int    // current process count
	PIDMax          int    // configured limit
}

// GetCgroupStats returns current resource usage stats
func (cm *CgroupManager) GetCgroupStats(accountID string) (*CgroupStats, error) {
	if !cm.enabled {
		return nil, fmt.Errorf("cgroups disabled")
	}

	cgroupPath := cm.getAccountCgroupPath(accountID)

	stats := &CgroupStats{}

	// Read CPU usage
	if cpuStat, err := cm.readCgroupFile(cgroupPath, "cpu.stat"); err == nil {
		// Parse "usage_usec 12345"
		parts := strings.Fields(cpuStat)
		if len(parts) >= 2 {
			if usec, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
				stats.CPUUsageMicros = usec
				stats.CPUPercent = int(usec / 100000) // Rough conversion
			}
		}
	}

	// Read memory usage
	if memCurrent, err := cm.readCgroupFile(cgroupPath, "memory.current"); err == nil {
		if bytes, err := strconv.ParseInt(strings.TrimSpace(memCurrent), 10, 64); err == nil {
			stats.MemoryBytes = bytes
		}
	}

	// Read memory limit
	if memMax, err := cm.readCgroupFile(cgroupPath, "memory.max"); err == nil {
		if bytes, err := strconv.ParseInt(strings.TrimSpace(memMax), 10, 64); err == nil {
			stats.MemoryLimitMB = bytes / (1024 * 1024)
		}
	}

	// Read PID count
	if pidCurrent, err := cm.readCgroupFile(cgroupPath, "pids.current"); err == nil {
		if count, err := strconv.Atoi(strings.TrimSpace(pidCurrent)); err == nil {
			stats.PIDCount = count
		}
	}

	// Read PID limit
	if pidMax, err := cm.readCgroupFile(cgroupPath, "pids.max"); err == nil {
		pidMaxStr := strings.TrimSpace(pidMax)
		if pidMaxStr != "max" {
			if limit, err := strconv.Atoi(pidMaxStr); err == nil {
				stats.PIDMax = limit
			}
		}
	}

	return stats, nil
}

// FreezeAccountCgroup suspends all processes in cgroup (for suspension)
func (cm *CgroupManager) FreezeAccountCgroup(accountID string) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	cgroupPath := cm.getAccountCgroupPath(accountID)
	return cm.writeCgroupFile(cgroupPath, "cgroup.freeze", "1")
}

// ThawAccountCgroup resumes all processes (for unsuspension)
func (cm *CgroupManager) ThawAccountCgroup(accountID string) error {
	if !cm.enabled {
		return fmt.Errorf("cgroups disabled")
	}

	cgroupPath := cm.getAccountCgroupPath(accountID)
	return cm.writeCgroupFile(cgroupPath, "cgroup.freeze", "0")
}

// ==================== Helper Functions ====================

// getAccountCgroupPath returns path to account's cgroup directory
func (cm *CgroupManager) getAccountCgroupPath(accountID string) string {
	// Sanitize account ID to prevent path traversal
	accountID = strings.ReplaceAll(accountID, "/", "_")
	accountID = strings.ReplaceAll(accountID, "..", "__")
	accountID = sanitizeFilename(accountID)

	return filepath.Join(cm.basePath, "user.slice", fmt.Sprintf("user-%s.slice", accountID))
}

// writeCgroupFile safely writes to a cgroup file
func (cm *CgroupManager) writeCgroupFile(cgroupPath, filename, value string) error {
	filepath := filepath.Join(cgroupPath, filename)

	// Verify path doesn't escape base
	if !strings.HasPrefix(filepath, cm.basePath) {
		return fmt.Errorf("path traversal detected: %s", filepath)
	}

	return os.WriteFile(filepath, []byte(value), 0644)
}

// readCgroupFile safely reads from a cgroup file
func (cm *CgroupManager) readCgroupFile(cgroupPath, filename string) (string, error) {
	filepath := filepath.Join(cgroupPath, filename)

	// Verify path doesn't escape base
	if !strings.HasPrefix(filepath, cm.basePath) {
		return "", fmt.Errorf("path traversal detected: %s", filepath)
	}

	data, err := os.ReadFile(filepath)
	return string(data), err
}

// deleteAccountCgroupCleanup is internal cleanup on error
func (cm *CgroupManager) deleteAccountCgroupCleanup(cgroupPath string) {
	_ = os.RemoveAll(cgroupPath)
}

// sanitizeFilename removes dangerous characters
func sanitizeFilename(s string) string {
	re := regexp.MustCompile("[^a-zA-Z0-9._-]")
	return re.ReplaceAllString(s, "_")
}

// validateCgroupConfig validates configuration before applying
func validateCgroupConfig(cfg CgroupConfig) error {
	if cfg.AccountID == "" {
		return fmt.Errorf("AccountID required")
	}

	if cfg.CPUPercent < 1 || cfg.CPUPercent > 200 {
		return fmt.Errorf("CPUPercent must be 1-200 (got %d)", cfg.CPUPercent)
	}

	if cfg.MemoryMB < 64 {
		return fmt.Errorf("MemoryMB must be ≥64 (got %d)", cfg.MemoryMB)
	}

	if cfg.MaxPIDs < 10 {
		return fmt.Errorf("MaxPIDs must be ≥10 (got %d)", cfg.MaxPIDs)
	}

	if cfg.IOReadMBps < 0 || cfg.IOWriteMBps < 0 {
		return fmt.Errorf("IO limits cannot be negative")
	}

	return nil
}
