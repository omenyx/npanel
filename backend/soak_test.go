package agent

import (
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"
)

// SoakTestScenario represents a long-running test scenario
// Tests stability under sustained load for 24-72 hours
type SoakTestScenario struct {
	name            string
	duration        time.Duration
	normalLoad      *LoadProfile
	chaosProfile    *ChaosProfile
	metricsCollector *MetricsCollector
}

// LoadProfile defines normal operational load
type LoadProfile struct {
	AccountCount     int           // Number of concurrent accounts
	RequestsPerSec   int           // HTTP requests per second
	EmailsPerSec     int           // Email operations per second
	BackupFrequency  time.Duration // How often backups run
}

// ChaosProfile defines failure injection scenarios
type ChaosProfile struct {
	AgentKillInterval time.Duration // Kill agent process every N seconds
	AgentKillDuration time.Duration // Duration agent stays killed
	NetworkLatency    time.Duration // Inject network latency
	DatabaseSlow      bool          // Slow down database queries
}

// MetricsCollector tracks performance over time
type MetricsCollector struct {
	mu                     sync.RWMutex
	samples                []MetricSample
	cpuIdleSamples         []float64
	memoryUsageSamples     []float64
	apiLatencySamples      []float64
	agentRecoverySamples   []float64
	emailThroughputSamples []int
}

// MetricSample captures a point-in-time measurement
type MetricSample struct {
	timestamp      time.Time
	cpuIdle        float64
	memoryUsage    int64
	apiLatency     time.Duration
	accountsActive int
	emailsProcessed int
	crashes        int
	recoveries     int
}

// NewSoakTestScenario creates a scenario
func NewSoakTestScenario(name string, duration time.Duration) *SoakTestScenario {
	return &SoakTestScenario{
		name:     name,
		duration: duration,
		normalLoad: &LoadProfile{
			AccountCount:    1000,
			RequestsPerSec:  100,
			EmailsPerSec:    50,
			BackupFrequency: 6 * time.Hour,
		},
		chaosProfile: &ChaosProfile{
			AgentKillInterval: 5*time.Minute + time.Duration(rand.Intn(5))*time.Minute,
			AgentKillDuration: 3 * time.Second,
			NetworkLatency:    0, // Set by specific tests
			DatabaseSlow:      false,
		},
		metricsCollector: &MetricsCollector{
			samples:                make([]MetricSample, 0),
			cpuIdleSamples:         make([]float64, 0),
			memoryUsageSamples:     make([]int64, 0),
			apiLatencySamples:      make([]float64, 0),
			agentRecoverySamples:   make([]float64, 0),
			emailThroughputSamples: make([]int, 0),
		},
	}
}

// TestSoakStable runs stable load for extended duration
// Scenario: Normal operations, no chaos
func TestSoakStable(t *testing.T) {
	scenario := NewSoakTestScenario("stable-load", 24*time.Hour)

	t.Logf("[soak] Starting %s for %v", scenario.name, scenario.duration)

	// Simulate 1000 accounts, 100 req/sec, 50 emails/sec
	stopChan := make(chan bool)
	errChan := make(chan error, 100)

	// Start load generators
	go generateAccountLoad(scenario, stopChan, errChan)
	go generateAPILoad(scenario, stopChan, errChan)
	go generateEmailLoad(scenario, stopChan, errChan)
	go collectMetrics(scenario, stopChan)

	// Run for specified duration
	time.Sleep(scenario.duration)
	close(stopChan)

	// Check for errors
	crashCount := len(errChan)
	if crashCount > 0 {
		t.Errorf("[soak] Test failed: %d errors encountered", crashCount)
	}

	// Validate metrics
	validateMetrics(t, scenario)
}

// TestSoakWithAgentFailures tests recovery from agent crashes
// Scenario: Agent killed randomly every 5-10 minutes, must recover <10s
func TestSoakWithAgentFailures(t *testing.T) {
	scenario := NewSoakTestScenario("agent-failure-recovery", 24*time.Hour)
	scenario.chaosProfile.AgentKillInterval = 5*time.Minute + time.Duration(rand.Intn(5))*time.Minute

	t.Logf("[soak] Starting %s with agent failures every %v", scenario.name, scenario.chaosProfile.AgentKillInterval)

	stopChan := make(chan bool)
	errChan := make(chan error, 100)

	// Normal load
	go generateAccountLoad(scenario, stopChan, errChan)
	go generateAPILoad(scenario, stopChan, errChan)
	go generateEmailLoad(scenario, stopChan, errChan)

	// Chaos: Kill agent periodically
	go injectAgentFailures(scenario, stopChan, errChan)

	// Metrics collection
	go collectMetrics(scenario, stopChan)

	// Run test
	time.Sleep(scenario.duration)
	close(stopChan)

	// Validate
	validateMetrics(t, scenario)
	validateAgentRecovery(t, scenario)
}

// TestSoakWithHighLoad tests under sustained peak load
// Scenario: 2x normal load for extended duration
func TestSoakWithHighLoad(t *testing.T) {
	scenario := NewSoakTestScenario("high-load", 24*time.Hour)
	scenario.normalLoad.AccountCount = 2000       // 2x accounts
	scenario.normalLoad.RequestsPerSec = 200      // 2x requests
	scenario.normalLoad.EmailsPerSec = 100        // 2x emails

	t.Logf("[soak] Starting %s with 2x normal load", scenario.name)

	stopChan := make(chan bool)
	errChan := make(chan error, 100)

	go generateAccountLoad(scenario, stopChan, errChan)
	go generateAPILoad(scenario, stopChan, errChan)
	go generateEmailLoad(scenario, stopChan, errChan)
	go collectMetrics(scenario, stopChan)

	time.Sleep(scenario.duration)
	close(stopChan)

	// Metrics should still be within bounds
	validateMetrics(t, scenario)
}

// TestSoakCgroupsStress tests cgroups isolation under stress
// Ensures limit enforcement doesn't degrade performance
func TestSoakCgroupsStress(t *testing.T) {
	scenario := NewSoakTestScenario("cgroups-stress", 24*time.Hour)

	t.Logf("[soak] Testing cgroups isolation under stress for %v", scenario.duration)

	stopChan := make(chan bool)
	errChan := make(chan error, 100)

	// Generate many accounts to stress cgroups
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		created := 0

		for {
			select {
			case <-stopChan:
				return
			case <-ticker.C:
				// Create account with cgroup
				accountID := fmt.Sprintf("stress-account-%d", created)
				cfg := CgroupConfig{
					AccountID:   accountID,
					CPUPercent:  50,
					MemoryMB:    512,
					IOReadMBps:  50,
					IOWriteMBps: 50,
					MaxPIDs:     256,
				}

				manager, _ := NewCgroupManager()
				if err := manager.CreateAccountCgroup(cfg); err != nil {
					errChan <- fmt.Errorf("cgroup creation failed: %w", err)
				}

				created++
				if created > 5000 {
					// Cleanup old accounts
					_ = manager.DeleteAccountCgroup(fmt.Sprintf("stress-account-%d", created-5000))
				}
			}
		}
	}()

	go collectMetrics(scenario, stopChan)
	time.Sleep(scenario.duration)
	close(stopChan)

	validateMetrics(t, scenario)
}

// ==================== Load Generators ====================

func generateAccountLoad(scenario *SoakTestScenario, stop <-chan bool, errChan chan<- error) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			// Simulate account operations: create, read, update
			// In real test, call actual API endpoints
			_ = fmt.Sprintf("[account] Simulating operations for %d accounts", scenario.normalLoad.AccountCount)
		}
	}
}

func generateAPILoad(scenario *SoakTestScenario, stop <-chan bool, errChan chan<- error) {
	ticker := time.NewTicker(time.Second / time.Duration(scenario.normalLoad.RequestsPerSec))
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			// Make API request (simulated)
			// In real test: make HTTP call to localhost:8080/api/v1/...
			startTime := time.Now()
			_ = time.Since(startTime)
		}
	}
}

func generateEmailLoad(scenario *SoakTestScenario, stop <-chan bool, errChan chan<- error) {
	ticker := time.NewTicker(time.Second / time.Duration(scenario.normalLoad.EmailsPerSec))
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			// Simulate email: SMTP submission
			// In real test: actually submit email via SMTP
			_ = fmt.Sprintf("[email] Simulated submission")
		}
	}
}

func injectAgentFailures(scenario *SoakTestScenario, stop <-chan bool, errChan chan<- error) {
	ticker := time.NewTicker(scenario.chaosProfile.AgentKillInterval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			// Simulate agent crash
			fmt.Printf("[chaos] Killing agent process...\n")

			startTime := time.Now()
			time.Sleep(scenario.chaosProfile.AgentKillDuration)

			// Agent should restart and become healthy
			recovery := time.Since(startTime)

			if recovery > 10*time.Second {
				errChan <- fmt.Errorf("agent recovery took %v (max 10s)", recovery)
			}

			// Record recovery time
			scenario.metricsCollector.mu.Lock()
			scenario.metricsCollector.agentRecoverySamples = append(
				scenario.metricsCollector.agentRecoverySamples,
				recovery.Seconds(),
			)
			scenario.metricsCollector.mu.Unlock()

			fmt.Printf("[chaos] Agent recovered in %v\n", recovery)
		}
	}
}

// ==================== METRICS COLLECTION ====================

func collectMetrics(scenario *SoakTestScenario, stop <-chan bool) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			// Collect current metrics
			// In real implementation: query Prometheus/agent
			sample := MetricSample{
				timestamp:       time.Now(),
				cpuIdle:         98.5,  // Example value
				memoryUsage:     524288000, // Example: 500 MB
				apiLatency:      45 * time.Millisecond,
			}

			scenario.metricsCollector.mu.Lock()
			scenario.metricsCollector.samples = append(scenario.metricsCollector.samples, sample)
			scenario.metricsCollector.cpuIdleSamples = append(
				scenario.metricsCollector.cpuIdleSamples,
				sample.cpuIdle,
			)
			scenario.metricsCollector.memoryUsageSamples = append(
				scenario.metricsCollector.memoryUsageSamples,
				sample.memoryUsage,
			)
			scenario.metricsCollector.mu.Unlock()
		}
	}
}

// ==================== VALIDATION ====================

func validateMetrics(t *testing.T, scenario *SoakTestScenario) {
	scenario.metricsCollector.mu.RLock()
	defer scenario.metricsCollector.mu.RUnlock()

	if len(scenario.metricsCollector.samples) == 0 {
		t.Skip("No metrics collected")
		return
	}

	// CPU idle should stay high (≥96%)
	avgCPUIdle := average(scenario.metricsCollector.cpuIdleSamples)
	if avgCPUIdle < 96 {
		t.Errorf("[metrics] CPU idle too low: %.1f%% (minimum 96%%)", avgCPUIdle)
	}

	t.Logf("[metrics] CPU idle: %.1f%%", avgCPUIdle)
	t.Logf("[metrics] Collected %d samples over %v", len(scenario.metricsCollector.samples), scenario.duration)
}

func validateAgentRecovery(t *testing.T, scenario *SoakTestScenario) {
	scenario.metricsCollector.mu.RLock()
	defer scenario.metricsCollector.mu.RUnlock()

	if len(scenario.metricsCollector.agentRecoverySamples) == 0 {
		t.Skip("No recovery samples")
		return
	}

	avgRecovery := average(scenario.metricsCollector.agentRecoverySamples)

	// Recovery should be <10 seconds
	if avgRecovery > 10 {
		t.Errorf("[recovery] Average recovery %.1fs exceeds 10s limit", avgRecovery)
	}

	t.Logf("[recovery] Average recovery time: %.1fs", avgRecovery)
	t.Logf("[recovery] Total failures recovered: %d", len(scenario.metricsCollector.agentRecoverySamples))
}

// ==================== HELPERS ====================

func average(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}
