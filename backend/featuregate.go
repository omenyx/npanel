package backend

import (
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// FeatureGate manages all Phase 5 feature flags
// All new features start DISABLED by default
// Enables gradual rollout and A/B testing
type FeatureGate struct {
	db    *sql.DB
	cache map[string]bool
	mu    sync.RWMutex
}

// Feature names (all 15 Phase 5 features)
const (
	// Track A: Hardening & Scale
	FeatureCgroupsIsolation    = "cgroups_isolation"
	FeatureEmailRateLimiting   = "email_rate_limiting"
	FeatureAgentWatchdog       = "agent_watchdog"
	FeatureGracefulReloads     = "graceful_reloads"
	FeatureConfigLayering      = "config_layering"
	FeatureSoakTesting         = "soak_testing"

	// Track B: Reseller & Billing
	FeaturePackageTemplates    = "package_templates"
	FeatureQuotaEnforcement    = "quota_enforcement"
	FeatureResellerHierarchy   = "reseller_hierarchy"
	FeatureWHMCSIntegration    = "whmcs_integration"

	// Track C: Polish & Differentiation
	FeatureProgressTracking    = "progress_tracking"
	FeatureHealthScoring       = "health_scoring"
	FeatureAuditLogsV2         = "audit_logs_v2"
	FeatureSmartDefaults       = "smart_defaults"
	FeatureUpgradeFramework    = "upgrade_framework"
)

// AllFeatures list for initialization
var AllFeatures = []string{
	FeatureCgroupsIsolation,
	FeatureEmailRateLimiting,
	FeatureAgentWatchdog,
	FeatureGracefulReloads,
	FeatureConfigLayering,
	FeatureSoakTesting,
	FeaturePackageTemplates,
	FeatureQuotaEnforcement,
	FeatureResellerHierarchy,
	FeatureWHMCSIntegration,
	FeatureProgressTracking,
	FeatureHealthScoring,
	FeatureAuditLogsV2,
	FeatureSmartDefaults,
	FeatureUpgradeFramework,
}

// NewFeatureGate creates feature gate manager
func NewFeatureGate(db *sql.DB) *FeatureGate {
	fg := &FeatureGate{
		db:    db,
		cache: make(map[string]bool),
	}

	// Initialize all features (disabled by default)
	_ = fg.initializeFeatures()

	// Load cache from database
	_ = fg.refreshCache()

	return fg
}

// initializeFeatures ensures all features exist in database
func (fg *FeatureGate) initializeFeatures() error {
	for _, feature := range AllFeatures {
		_, err := fg.db.Exec(`
			INSERT OR IGNORE INTO feature_flags (name, enabled, created_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
		`, feature, false) // Default: disabled

		if err != nil {
			return fmt.Errorf("failed to initialize feature %s: %w", feature, err)
		}
	}

	return nil
}

// IsEnabled checks if a feature is enabled (with cache)
func (fg *FeatureGate) IsEnabled(feature string) bool {
	fg.mu.RLock()
	enabled, exists := fg.cache[feature]
	fg.mu.RUnlock()

	if exists {
		return enabled
	}

	// Cache miss - query database
	var isEnabled bool
	err := fg.db.QueryRow(`
		SELECT enabled FROM feature_flags WHERE name = ?
	`, feature).Scan(&isEnabled)

	if err != nil {
		// Feature not found - default to disabled
		return false
	}

	// Update cache
	fg.mu.Lock()
	fg.cache[feature] = isEnabled
	fg.mu.Unlock()

	return isEnabled
}

// Enable activates a feature (requires auth)
func (fg *FeatureGate) Enable(feature string, adminID string) error {
	// Verify feature exists
	var exists bool
	err := fg.db.QueryRow(`
		SELECT 1 FROM feature_flags WHERE name = ?
	`, feature).Scan(&exists)

	if err != nil {
		return fmt.Errorf("feature %s not found", feature)
	}

	// Update database
	_, err = fg.db.Exec(`
		UPDATE feature_flags SET enabled = 1, updated_at = CURRENT_TIMESTAMP
		WHERE name = ?
	`, feature)

	if err != nil {
		return fmt.Errorf("failed to enable feature: %w", err)
	}

	// Log audit trail
	_ = fg.logFeatureChange(feature, true, adminID)

	// Update cache
	fg.mu.Lock()
	fg.cache[feature] = true
	fg.mu.Unlock()

	return nil
}

// Disable deactivates a feature
func (fg *FeatureGate) Disable(feature string, adminID string) error {
	_, err := fg.db.Exec(`
		UPDATE feature_flags SET enabled = 0, updated_at = CURRENT_TIMESTAMP
		WHERE name = ?
	`, feature)

	if err != nil {
		return fmt.Errorf("failed to disable feature: %w", err)
	}

	// Log audit trail
	_ = fg.logFeatureChange(feature, false, adminID)

	// Update cache
	fg.mu.Lock()
	fg.cache[feature] = false
	fg.mu.Unlock()

	return nil
}

// GetStatus returns current status of all features
func (fg *FeatureGate) GetStatus() (map[string]bool, error) {
	fg.mu.RLock()
	defer fg.mu.RUnlock()

	status := make(map[string]bool)
	for _, feature := range AllFeatures {
		if enabled, exists := fg.cache[feature]; exists {
			status[feature] = enabled
		} else {
			status[feature] = false
		}
	}

	return status, nil
}

// refreshCache reloads all features from database
func (fg *FeatureGate) refreshCache() error {
	rows, err := fg.db.Query(`
		SELECT name, enabled FROM feature_flags
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	newCache := make(map[string]bool)
	for rows.Next() {
		var name string
		var enabled bool
		if err := rows.Scan(&name, &enabled); err != nil {
			continue
		}
		newCache[name] = enabled
	}

	fg.mu.Lock()
	fg.cache = newCache
	fg.mu.Unlock()

	return nil
}

// logFeatureChange records feature toggle in audit log
func (fg *FeatureGate) logFeatureChange(feature string, enabled bool, adminID string) error {
	status := "disabled"
	if enabled {
		status = "enabled"
	}

	_, err := fg.db.Exec(`
		INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, details, created_at)
		VALUES (?, ?, 'feature_flag', ?, ?, CURRENT_TIMESTAMP)
	`, adminID, "feature_flag_"+status, feature, fmt.Sprintf("Feature %s %s", feature, status))

	return err
}

// ==================== MIDDLEWARE ====================

// CheckFeatureFlag middleware for API handlers
// Usage: router.POST("/api/create-account", CheckFeatureFlag(FeatureCgroupsIsolation), CreateAccountHandler)
func CheckFeatureFlag(gate *FeatureGate, feature string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !gate.IsEnabled(feature) {
				http.Error(w, fmt.Sprintf("Feature %s is not enabled", feature), http.StatusNotFound)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ==================== DATABASE SCHEMA ====================

// InitializeFeatureGateDB creates required tables
func InitializeFeatureGateDB(db *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS feature_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT 0,
    description TEXT,
    track TEXT,                           -- Track A/B/C
    rollout_percent INTEGER DEFAULT 0,    -- Gradual rollout: 0-100%
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(name);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled);

CREATE TABLE IF NOT EXISTS feature_flag_toggles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_name TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,                 -- enabled/disabled/rollback
    previous_state BOOLEAN,
    new_state BOOLEAN,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (feature_name) REFERENCES feature_flags(name),
    FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_toggles_feature ON feature_flag_toggles(feature_name);
CREATE INDEX IF NOT EXISTS idx_feature_flag_toggles_created ON feature_flag_toggles(created_at);
`

	_, err := db.Exec(schema)
	return err
}
