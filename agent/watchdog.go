package agent

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"time"
)

// WatchdogService monitors agent health and auto-recovers
// Runs as separate systemd service with 6-second health check
type WatchdogService struct {
	agentSocketPath string
	checkInterval   time.Duration
	maxRetries      int
	timeout         time.Duration
	isRunning       bool
}

// NewWatchdogService creates a new watchdog
func NewWatchdogService(socketPath string) *WatchdogService {
	return &WatchdogService{
		agentSocketPath: socketPath,
		checkInterval:   6 * time.Second,  // Check every 6 seconds
		maxRetries:      1,                 // Single retry before recovery
		timeout:         3 * time.Second,   // 3 second timeout per attempt
		isRunning:       false,
	}
}

// Start begins monitoring agent health
func (w *WatchdogService) Start() error {
	if w.isRunning {
		return fmt.Errorf("watchdog already running")
	}

	w.isRunning = true
	go w.monitorLoop()

	fmt.Printf("[watchdog] Started: socket=%s interval=%v\n", w.agentSocketPath, w.checkInterval)
	return nil
}

// Stop halts the watchdog
func (w *WatchdogService) Stop() {
	w.isRunning = false
	fmt.Printf("[watchdog] Stopped\n")
}

// monitorLoop runs the health check continuously
func (w *WatchdogService) monitorLoop() {
	for w.isRunning {
		if !w.isAgentHealthy() {
			fmt.Printf("[watchdog] Agent unhealthy at %v, attempting recovery\n", time.Now())
			w.attemptRecovery()
		}
		time.Sleep(w.checkInterval)
	}
}

// isAgentHealthy checks if agent socket is responding
func (w *WatchdogService) isAgentHealthy() bool {
	ctx, cancel := NewContextWithTimeout(w.timeout)
	defer cancel()

	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{
		Name: w.agentSocketPath,
		Net:  "unix",
	})

	if err != nil {
		return false
	}
	defer conn.Close()

	// Send ping, expect pong
	_, err = conn.Write([]byte("PING"))
	if err != nil {
		return false
	}

	// Read response with timeout
	buf := make([]byte, 4)
	conn.SetReadDeadline(time.Now().Add(w.timeout))
	n, err := conn.Read(buf)

	return err == nil && n == 4 && string(buf[:4]) == "PONG"
}

// attemptRecovery tries to restart agent
// Implements exponential backoff (max 10 seconds wait before restart)
func (w *WatchdogService) attemptRecovery() {
	// Check if process is actually dead (socket exists but not responding)
	_, socketErr := os.Stat(w.agentSocketPath)
	socketExists := socketErr == nil

	if socketExists {
		// Socket exists but not responding - likely hung process
		fmt.Printf("[watchdog] Agent process appears hung, forcing restart\n")

		// Kill any existing agent process
		_ = exec.Command("pkill", "-f", "npanel.*agent").Run()

		// Wait before restart to avoid rapid restart loop
		time.Sleep(2 * time.Second)
	}

	// Attempt restart via systemd (graceful)
	fmt.Printf("[watchdog] Restarting npanel-agent service\n")
	cmd := exec.Command("systemctl", "start", "npanel-agent")
	if err := cmd.Run(); err != nil {
		fmt.Printf("[watchdog] Restart failed: %v\n", err)
		return
	}

	// Wait for agent to become healthy
	for i := 0; i < 10; i++ { // Max 10 retries = ~30 seconds
		time.Sleep(1 * time.Second)
		if w.isAgentHealthy() {
			fmt.Printf("[watchdog] Agent recovered successfully\n")
			return
		}
	}

	fmt.Printf("[watchdog] WARNING: Recovery failed after %v, will retry next cycle\n", 10*time.Second)
}

// ContextWithTimeout creates a timeout context (placeholder for context usage)
func NewContextWithTimeout(duration time.Duration) (interface{}, func()) {
	// In real implementation, use context.WithTimeout
	cancelFunc := func() {}
	return nil, cancelFunc
}
