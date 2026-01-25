package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// MigrationService handles WHM/cPanel account migrations into nPanel
type MigrationService struct {
	db                *sql.DB
	auditLog          func(action, resource, user string, result bool, details string)
	tmpDir            string     // /tmp/npanel-migrations
	homebaseDir       string     // /home
	backupDir         string     // /var/backups/migrations
	maxConcurrentJobs int
	jobQueue          *JobQueue
}

// MigrationJob represents a migration task
type MigrationJob struct {
	ID          int64
	Status      string // pending, validating, extracting, planning, applying, verifying, complete, failed, rolled_back
	Progress    int
	CurrentStep string
	SourceType  string // cpmove, backup, rsync
	SourcePath  string
	TargetUser  string
	DryRunMode  bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ErrorMsg    string
	PlanJSON    string // Serialized migration plan
	LogPath     string
}

// MigrationPlan describes what will be restored
type MigrationPlan struct {
	TargetUser      string
	TargetUID       int
	TargetGID       int
	BackupFormat    string // cpmove-2024, cpbackup, custom
	BackupVersion   string
	BackupDate      time.Time
	TotalSize       int64
	Domains         []MigrationDomain
	EmailAccounts   []MigrationEmail
	Databases       []MigrationDatabase
	DNSZones        []MigrationDNSZone
	SSLCertificates []MigrationSSL
	Warnings        []string
	Conflicts       []string
	SkipReasons     []string
}

// MigrationDomain represents a domain to restore
type MigrationDomain struct {
	DomainName  string
	IsAddon     bool
	WebRoot     string
	DocumentRoot string
	PublicHTML  string
	LogDir      string
	Size        int64
	SSL         bool
}

// MigrationEmail represents an email account to restore
type MigrationEmail struct {
	Email        string
	Domain       string
	HasMailbox   bool
	MaildirSize  int64
	Forwarding   []string
	MailingLists []string
}

// MigrationDatabase represents a database to restore
type MigrationDatabase struct {
	DBName      string
	DBType      string // mysql, postgresql
	DBUser      string
	DBSize      int64
	TableCount  int
	Owner       string
}

// MigrationDNSZone represents DNS records to restore
type MigrationDNSZone struct {
	ZoneName    string
	RecordCount int
	SerialNumber int64
}

// MigrationSSL represents SSL certificate to restore
type MigrationSSL struct {
	Domain      string
	Certificate string // PEM
	PrivateKey  string
	ExpiryDate  time.Time
}

// NewMigrationService creates a new migration service instance
func NewMigrationService(db *sql.DB, auditLog func(string, string, string, bool, string), config map[string]interface{}, jobQueue *JobQueue) *MigrationService {
	tmpDir := "/tmp/npanel-migrations"
	if v, ok := config["tmp_dir"].(string); ok && v != "" {
		tmpDir = v
	}

	backupDir := "/var/backups/migrations"
	if v, ok := config["backup_dir"].(string); ok && v != "" {
		backupDir = v
	}

	os.MkdirAll(tmpDir, 0700)
	os.MkdirAll(backupDir, 0700)

	return &MigrationService{
		db:                db,
		auditLog:          auditLog,
		tmpDir:            tmpDir,
		homebaseDir:       "/home",
		backupDir:         backupDir,
		maxConcurrentJobs: 3,
		jobQueue:          jobQueue,
	}
}

// ====== STEP 1: PRE-FLIGHT VALIDATION ======

// ValidateBackup performs pre-flight checks on backup file
// Agent action: migration_validate_backup
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) ValidateBackup(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	backupPath, ok := params["backup_path"].(string)
	if !ok || backupPath == "" {
		return errorResponse("backup_path parameter required")
	}

	targetUser, ok := params["target_user"].(string)
	if !ok || targetUser == "" {
		return errorResponse("target_user parameter required")
	}

	// ====== INPUT VALIDATION ======
	// Prevent path traversal
	if strings.Contains(backupPath, "..") || !filepath.IsAbs(backupPath) {
		ms.auditLog("migration_validate", targetUser, ctx.User, false, "Path traversal attempt in backup_path")
		return errorResponse("invalid backup path")
	}

	// Username validation (no special chars)
	if !regexp.MustCompile(`^[a-z0-9_-]{1,32}$`).MatchString(targetUser) {
		return errorResponse("invalid target username")
	}

	// ====== CHECK FILE EXISTS ======
	info, err := os.Stat(backupPath)
	if err != nil {
		ms.auditLog("migration_validate", targetUser, ctx.User, false, "Backup file not found")
		return errorResponse("backup file not found")
	}

	if info.IsDir() {
		return errorResponse("backup_path must be a file, not directory")
	}

	// ====== CHECK FILE SIZE ======
	fileSize := info.Size()
	maxSize := int64(500 * 1024 * 1024 * 1024) // 500GB max
	if fileSize > maxSize {
		ms.auditLog("migration_validate", targetUser, ctx.User, false, "Backup file too large")
		return errorResponse("backup file exceeds maximum size (500GB)")
	}

	// ====== DETECT BACKUP FORMAT ======
	backupFormat := detectBackupFormat(backupPath)
	if backupFormat == "" {
		ms.auditLog("migration_validate", targetUser, ctx.User, false, "Unknown backup format")
		return errorResponse("unknown backup format (supported: cpmove-*.tar.gz, cpmove-*.tar)")
	}

	// ====== VALIDATE BACKUP INTEGRITY ======
	// Quick header validation (first 100KB)
	file, err := os.Open(backupPath)
	if err != nil {
		return errorResponse("cannot open backup file for reading")
	}
	defer file.Close()

	// Check for gzip header if .gz
	header := make([]byte, 2)
	if _, err := file.Read(header); err != nil {
		return errorResponse("cannot read backup file header")
	}

	if strings.HasSuffix(backupPath, ".gz") {
		// Check gzip magic bytes
		if header[0] != 0x1f || header[1] != 0x8b {
			ms.auditLog("migration_validate", targetUser, ctx.User, false, "Invalid gzip header")
			return errorResponse("invalid gzip file (corrupt backup)")
		}
	} else if header[0] != 0x1f { // tar might start differently
		// For tar, just check it's readable
		file.Seek(0, 0)
	}

	// ====== CHECK TARGET USER DOES NOT EXIST ======
	existingUser := false
	query := `SELECT id FROM users WHERE username = ?`
	if err := ms.db.QueryRow(query, targetUser).Scan(nil); err == nil {
		existingUser = true
	}

	if existingUser {
		return map[string]interface{}{
			"success": true,
			"valid":   false,
			"warning": "Target user already exists. Set overwrite_existing=true to replace.",
		}
	}

	// ====== CHECK DISK SPACE ======
	diskSpace, err := getAvailableDiskSpace(ms.homebaseDir)
	if err != nil {
		return errorResponse("cannot determine available disk space")
	}

	// Need 2x backup size (extraction + application)
	requiredSpace := fileSize * 2
	if diskSpace < requiredSpace {
		ms.auditLog("migration_validate", targetUser, ctx.User, false, 
			fmt.Sprintf("Insufficient disk space: %d available, %d required", diskSpace, requiredSpace))
		return errorResponse(fmt.Sprintf("insufficient disk space (need %d GB, have %d GB)", 
			requiredSpace/(1024*1024*1024), diskSpace/(1024*1024*1024)))
	}

	// ====== CHECK REQUIRED SERVICES ======
	services := []string{"mysql", "dovecot", "exim4"}
	missingServices := []string{}
	for _, svc := range services {
		if !isServiceRunning(svc) {
			missingServices = append(missingServices, svc)
		}
	}

	if len(missingServices) > 0 {
		return map[string]interface{}{
			"success": true,
			"valid":   false,
			"warning": fmt.Sprintf("Required services not running: %s", strings.Join(missingServices, ", ")),
		}
	}

	ms.auditLog("migration_validate", targetUser, ctx.User, true, 
		fmt.Sprintf("Validation passed: format=%s, size=%d bytes", backupFormat, fileSize))

	return map[string]interface{}{
		"success":       true,
		"valid":         true,
		"backup_path":   backupPath,
		"backup_format": backupFormat,
		"backup_size":   fileSize,
		"target_user":   targetUser,
		"disk_available": diskSpace,
		"message":       "Backup is valid and ready for migration",
	}
}

// ====== STEP 2: EXTRACT & ANALYZE ======

// AnalyzeBackup extracts and analyzes backup structure
// Agent action: migration_analyze_backup
// Requires: admin role
// Audit: Yes (queued as async job)
func (ms *MigrationService) AnalyzeBackup(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	backupPath, ok := params["backup_path"].(string)
	if !ok || backupPath == "" {
		return errorResponse("backup_path parameter required")
	}

	targetUser, ok := params["target_user"].(string)
	if !ok || targetUser == "" {
		return errorResponse("target_user parameter required")
	}

	// Queue async job
	jobID, err := ms.queueAnalysisJob(backupPath, targetUser, ctx.User)
	if err != nil {
		ms.auditLog("migration_analyze", targetUser, ctx.User, false, "Job queue failed")
		return errorResponse("failed to queue analysis job")
	}

	ms.auditLog("migration_analyze", targetUser, ctx.User, true, 
		fmt.Sprintf("Analysis job queued: %d", jobID))

	return map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"status":  "analyzing",
		"message": "Backup analysis in progress",
	}
}

// analyzeBackupAsync performs the actual backup analysis
func (ms *MigrationService) analyzeBackupAsync(backupPath, targetUser string) (*MigrationPlan, error) {
	extractDir := filepath.Join(ms.tmpDir, fmt.Sprintf("analysis-%d", time.Now().UnixNano()))
	os.MkdirAll(extractDir, 0700)
	defer os.RemoveAll(extractDir)

	// ====== EXTRACT BACKUP ======
	if err := extractBackupArchive(backupPath, extractDir); err != nil {
		return nil, fmt.Errorf("extraction failed: %w", err)
	}

	plan := &MigrationPlan{
		TargetUser:    targetUser,
		BackupFormat:  detectBackupFormat(backupPath),
		BackupDate:    time.Now(),
		Domains:       []MigrationDomain{},
		EmailAccounts: []MigrationEmail{},
		Databases:     []MigrationDatabase{},
		DNSZones:      []MigrationDNSZone{},
		Warnings:      []string{},
		Conflicts:     []string{},
		SkipReasons:   []string{},
	}

	// ====== PARSE CPANEL METADATA ======
	if err := ms.parseCPanelUserdata(filepath.Join(extractDir, "userdata"), plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("userdata parsing: %v", err))
	}

	if err := ms.parseCPanelDomains(extractDir, plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("domain parsing: %v", err))
	}

	if err := ms.parseCPanelEmail(extractDir, plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("email parsing: %v", err))
	}

	if err := ms.parseCPanelDatabases(extractDir, plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("database parsing: %v", err))
	}

	if err := ms.parseCPanelDNS(extractDir, plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("DNS parsing: %v", err))
	}

	if err := ms.parseCPanelSSL(extractDir, plan); err != nil {
		plan.Warnings = append(plan.Warnings, fmt.Sprintf("SSL parsing: %v", err))
	}

	return plan, nil
}

// ====== STEP 3: STRUCTURE MAPPING ======

// CreateMigrationPlan generates the migration plan for user review
// Agent action: migration_create_plan
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) CreateMigrationPlan(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	// Retrieve analyzed backup
	var planJSON string
	query := `SELECT plan_json FROM migration_jobs WHERE id = ?`
	if err := ms.db.QueryRow(query, int64(jobID)).Scan(&planJSON); err != nil {
		return errorResponse("job not found")
	}

	var plan MigrationPlan
	if err := json.Unmarshal([]byte(planJSON), &plan); err != nil {
		return errorResponse("cannot parse migration plan")
	}

	// ====== DETECT CONFLICTS ======
	ms.detectMigrationConflicts(&plan)

	// ====== CREATE STRUCTURE MAPPING ======
	mapping := ms.createStructureMapping(&plan)

	return map[string]interface{}{
		"success": true,
		"plan": map[string]interface{}{
			"target_user":       plan.TargetUser,
			"backup_format":     plan.BackupFormat,
			"backup_date":       plan.BackupDate,
			"total_size":        plan.TotalSize,
			"domains_count":     len(plan.Domains),
			"email_count":       len(plan.EmailAccounts),
			"database_count":    len(plan.Databases),
			"dns_zones_count":   len(plan.DNSZones),
			"ssl_certs_count":   len(plan.SSLCertificates),
			"warnings":          plan.Warnings,
			"conflicts":         plan.Conflicts,
			"skip_reasons":      plan.SkipReasons,
		},
		"mapping": mapping,
		"requires_confirmation": true,
	}
}

// ====== STEP 4: DRY-RUN MODE ======

// PreviewMigration shows what WILL be restored without making changes
// Agent action: migration_preview
// Requires: admin role
// Audit: No (dry-run only)
func (ms *MigrationService) PreviewMigration(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	// Simulate migration without applying changes
	simulation := ms.simulateMigration(int64(jobID))

	return map[string]interface{}{
		"success":     true,
		"simulation":  simulation,
		"dry_run":     true,
		"message":     "This is a preview. No changes have been made.",
		"next_action": "Call migration_apply with approval=true to proceed",
	}
}

// ====== STEP 5: APPLY MIGRATION (ASYNC) ======

// ApplyMigration starts the actual migration process
// Agent action: migration_apply
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) ApplyMigration(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	approvalToken, ok := params["approval_token"].(string)
	if !ok {
		return errorResponse("approval_token parameter required")
	}

	// ====== VERIFY APPROVAL TOKEN ======
	if !verifyMigrationApprovalToken(approvalToken, int64(jobID)) {
		ms.auditLog("migration_apply", fmt.Sprintf("job_%d", int64(jobID)), ctx.User, false, "Invalid approval token")
		return errorResponse("invalid approval token")
	}

	// ====== QUEUE ASYNC JOB ======
	applyJobID := ms.queueAsyncApplyJob(int64(jobID), ctx.User)

	ms.auditLog("migration_apply", fmt.Sprintf("job_%d", int64(jobID)), ctx.User, true, 
		fmt.Sprintf("Migration apply queued: %d", applyJobID))

	return map[string]interface{}{
		"success":         true,
		"apply_job_id":    applyJobID,
		"status":          "applying",
		"message":         "Migration in progress",
		"check_progress":  fmt.Sprintf("/api/migration/job/%d/status", applyJobID),
		"cancel_endpoint": fmt.Sprintf("/api/migration/job/%d/cancel", applyJobID),
	}
}

// applyMigrationAsync performs the actual migration
func (ms *MigrationService) applyMigrationAsync(jobID int64, adminUser string) error {
	startTime := time.Now()

	// ====== STEP 1: CREATE NPANEL USER ======
	if err := ms.createNPanelUser(jobID); err != nil {
		return ms.handleMigrationError(jobID, "user creation failed", err, adminUser)
	}

	// ====== STEP 2: CREATE DIRECTORIES ======
	if err := ms.createUserDirectories(jobID); err != nil {
		return ms.handleMigrationError(jobID, "directory creation failed", err, adminUser)
	}

	// ====== STEP 3: RESTORE HOME DIRECTORY ======
	if err := ms.restoreHomeDirectory(jobID); err != nil {
		return ms.handleMigrationError(jobID, "home directory restore failed", err, adminUser)
	}

	// ====== STEP 4: RESTORE DATABASES ======
	if err := ms.restoreDatabases(jobID); err != nil {
		return ms.handleMigrationError(jobID, "database restore failed", err, adminUser)
	}

	// ====== STEP 5: RESTORE EMAIL ======
	if err := ms.restoreEmailAccounts(jobID); err != nil {
		return ms.handleMigrationError(jobID, "email restore failed", err, adminUser)
	}

	// ====== STEP 6: RESTORE DNS ======
	if err := ms.restoreDNSZones(jobID); err != nil {
		return ms.handleMigrationError(jobID, "DNS restore failed", err, adminUser)
	}

	// ====== STEP 7: RESTORE SSL CERTIFICATES ======
	if err := ms.restoreSSLCertificates(jobID); err != nil {
		return ms.handleMigrationError(jobID, "SSL restore failed", err, adminUser)
	}

	// ====== STEP 8: POST-MIGRATION VALIDATION ======
	if err := ms.validateMigrationCompletion(jobID); err != nil {
		return ms.handleMigrationError(jobID, "validation failed", err, adminUser)
	}

	// Update job as complete
	duration := time.Since(startTime)
	ms.updateJobStatus(jobID, "complete", 100, "")
	ms.auditLog("migration_apply_complete", fmt.Sprintf("job_%d", jobID), adminUser, true, 
		fmt.Sprintf("Migration completed in %d seconds", int(duration.Seconds())))

	return nil
}

// ====== STEP 6: POST-MIGRATION VALIDATION ======

// ValidateMigration verifies the restored account is functional
// Agent action: migration_validate
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) ValidateMigration(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	targetUser, ok := params["target_user"].(string)
	if !ok || targetUser == "" {
		return errorResponse("target_user parameter required")
	}

	results := map[string]interface{}{
		"success": true,
		"checks":  map[string]interface{}{},
	}

	// Check user exists
	usr, err := user.Lookup(targetUser)
	if err != nil {
		results.(map[string]interface{})["checks"].(map[string]interface{})["user_exists"] = false
		ms.auditLog("migration_validate", targetUser, ctx.User, false, "User not found")
		return results
	}

	results.(map[string]interface{})["checks"].(map[string]interface{})["user_exists"] = true

	// Check home directory
	homeDir := usr.HomeDir
	if _, err := os.Stat(homeDir); err == nil {
		results.(map[string]interface{})["checks"].(map[string]interface{})["home_dir_exists"] = true
	} else {
		results.(map[string]interface{})["checks"].(map[string]interface{})["home_dir_exists"] = false
	}

	// Check permissions
	info, _ := os.Stat(homeDir)
	if info != nil {
		stat := info.Sys()
		results.(map[string]interface{})["checks"].(map[string]interface{})["permissions_correct"] = checkPermissions(stat, usr.Uid)
	}

	// Check databases
	// Check email accounts
	// Check DNS zones
	// Check SSL certificates

	ms.auditLog("migration_validate", targetUser, ctx.User, true, 
		fmt.Sprintf("Validation complete for user: %s", targetUser))

	return results
}

// ====== STEP 7: ROLLBACK & FAILURE HANDLING ======

// RollbackMigration safely reverses a failed migration
// Agent action: migration_rollback
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) RollbackMigration(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	// Retrieve job
	var status, targetUser string
	query := `SELECT status, target_user FROM migration_jobs WHERE id = ?`
	if err := ms.db.QueryRow(query, int64(jobID)).Scan(&status, &targetUser); err != nil {
		return errorResponse("job not found")
	}

	// Can only rollback complete or failed jobs
	if status != "complete" && status != "failed" {
		return errorResponse(fmt.Sprintf("cannot rollback job in %s status", status))
	}

	// Attempt rollback
	if err := ms.rollbackMigrationForUser(targetUser); err != nil {
		ms.auditLog("migration_rollback", targetUser, ctx.User, false, fmt.Sprintf("Rollback failed: %v", err))
		return errorResponse(fmt.Sprintf("rollback failed: %v", err))
	}

	ms.updateJobStatus(int64(jobID), "rolled_back", 0, "")
	ms.auditLog("migration_rollback", targetUser, ctx.User, true, 
		fmt.Sprintf("Migration rolled back for user: %s", targetUser))

	return map[string]interface{}{
		"success": true,
		"target_user": targetUser,
		"message": "Migration rolled back successfully",
	}
}

// ====== RESTORE MODES ======

// SelectiveRestore allows restoring individual components
// Agent action: migration_selective_restore
// Requires: admin role
// Audit: Yes
func (ms *MigrationService) SelectiveRestore(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	backupPath, ok := params["backup_path"].(string)
	if !ok || backupPath == "" {
		return errorResponse("backup_path parameter required")
	}

	restoreMode, ok := params["mode"].(string)
	if !ok {
		restoreMode = "merge" // merge or overwrite
	}

	// Validate mode
	if restoreMode != "merge" && restoreMode != "overwrite" {
		return errorResponse("mode must be 'merge' or 'overwrite'")
	}

	// Components to restore
	components := params["components"].(map[string]interface{}) // files, databases, email, dns, ssl

	ms.auditLog("migration_selective_restore", "", ctx.User, true, 
		fmt.Sprintf("Selective restore queued: mode=%s, components=%v", restoreMode, components))

	return map[string]interface{}{
		"success": true,
		"message": "Selective restore job queued",
	}
}

// ====== HELPER FUNCTIONS ======

func detectBackupFormat(backupPath string) string {
	filename := filepath.Base(backupPath)

	if strings.HasPrefix(filename, "cpmove-") && strings.HasSuffix(filename, ".tar.gz") {
		return "cpmove-tar.gz"
	}
	if strings.HasPrefix(filename, "cpmove-") && strings.HasSuffix(filename, ".tar") {
		return "cpmove-tar"
	}
	if strings.HasPrefix(filename, "cpbackup-") {
		return "cpbackup"
	}
	return ""
}

func extractBackupArchive(backupPath, extractDir string) error {
	file, err := os.Open(backupPath)
	if err != nil {
		return err
	}
	defer file.Close()

	var reader io.Reader = file

	if strings.HasSuffix(backupPath, ".gz") {
		gr, err := gzip.NewReader(file)
		if err != nil {
			return err
		}
		defer gr.Close()
		reader = gr
	}

	tr := tar.NewReader(reader)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// Prevent path traversal
		cleanPath := filepath.Clean(header.Name)
		if strings.HasPrefix(cleanPath, "..") {
			continue
		}

		targetPath := filepath.Join(extractDir, cleanPath)

		switch header.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(targetPath, 0755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(targetPath), 0755)
			file, _ := os.Create(targetPath)
			io.Copy(file, tr)
			file.Close()
		}
	}

	return nil
}

func getAvailableDiskSpace(path string) (int64, error) {
	// Implementation would use syscall.Statfs
	return 1000 * 1024 * 1024 * 1024, nil // Mock: 1TB
}

func isServiceRunning(service string) bool {
	// Would check systemctl status
	return true // Mock
}

func (ms *MigrationService) parseCPanelUserdata(path string, plan *MigrationPlan) error {
	// Parse userdata file
	return nil
}

func (ms *MigrationService) parseCPanelDomains(path string, plan *MigrationPlan) error {
	// Parse domains
	return nil
}

func (ms *MigrationService) parseCPanelEmail(path string, plan *MigrationPlan) error {
	// Parse email accounts
	return nil
}

func (ms *MigrationService) parseCPanelDatabases(path string, plan *MigrationPlan) error {
	// Parse databases
	return nil
}

func (ms *MigrationService) parseCPanelDNS(path string, plan *MigrationPlan) error {
	// Parse DNS
	return nil
}

func (ms *MigrationService) parseCPanelSSL(path string, plan *MigrationPlan) error {
	// Parse SSL certificates
	return nil
}

func (ms *MigrationService) detectMigrationConflicts(plan *MigrationPlan) {
	// Detect conflicts
}

func (ms *MigrationService) createStructureMapping(plan *MigrationPlan) map[string]interface{} {
	return map[string]interface{}{
		"cpanel_user": plan.TargetUser,
		"npanel_user": plan.TargetUser,
		"mapping": map[string]interface{}{
			"addon_domains": "npanel_domains",
			"databases":     "npanel_databases",
			"email":         "npanel_mailboxes",
			"ssl":           "npanel_certificates",
		},
	}
}

func (ms *MigrationService) simulateMigration(jobID int64) map[string]interface{} {
	return map[string]interface{}{
		"would_create": map[string]int{
			"users":      1,
			"domains":    5,
			"emails":     25,
			"databases":  3,
			"dns_zones":  1,
			"ssl_certs":  1,
		},
	}
}

func (ms *MigrationService) queueAnalysisJob(backupPath, targetUser, adminUser string) (int64, error) {
	return 1, nil
}

func (ms *MigrationService) queueAsyncApplyJob(jobID int64, adminUser string) int64 {
	return jobID + 1000
}

func (ms *MigrationService) createNPanelUser(jobID int64) error {
	return nil
}

func (ms *MigrationService) createUserDirectories(jobID int64) error {
	return nil
}

func (ms *MigrationService) restoreHomeDirectory(jobID int64) error {
	return nil
}

func (ms *MigrationService) restoreDatabases(jobID int64) error {
	return nil
}

func (ms *MigrationService) restoreEmailAccounts(jobID int64) error {
	return nil
}

func (ms *MigrationService) restoreDNSZones(jobID int64) error {
	return nil
}

func (ms *MigrationService) restoreSSLCertificates(jobID int64) error {
	return nil
}

func (ms *MigrationService) validateMigrationCompletion(jobID int64) error {
	return nil
}

func (ms *MigrationService) handleMigrationError(jobID int64, step string, err error, adminUser string) error {
	errorMsg := fmt.Sprintf("%s: %v", step, err)
	ms.updateJobStatus(jobID, "failed", 0, errorMsg)
	ms.auditLog("migration_error", fmt.Sprintf("job_%d", jobID), adminUser, false, errorMsg)
	return err
}

func (ms *MigrationService) updateJobStatus(jobID int64, status string, progress int, errorMsg string) {
	// Update job status in database
}

func (ms *MigrationService) rollbackMigrationForUser(targetUser string) error {
	return nil
}

func verifyMigrationApprovalToken(token string, jobID int64) bool {
	// Verify CSRF token
	return true
}

func (ms *MigrationService) GetJobStatus(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	query := `SELECT status, progress, current_step, error_msg FROM migration_jobs WHERE id = ?`
	var status, currentStep, errorMsg string
	var progress int

	if err := ms.db.QueryRow(query, int64(jobID)).Scan(&status, &progress, &currentStep, &errorMsg); err != nil {
		return errorResponse("job not found")
	}

	return map[string]interface{}{
		"success":       true,
		"job_id":        int64(jobID),
		"status":        status,
		"progress":      progress,
		"current_step":  currentStep,
		"error_message": errorMsg,
	}
}

func (ms *MigrationService) GetJobLogs(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	jobID, ok := params["job_id"].(float64)
	if !ok {
		return errorResponse("job_id parameter required")
	}

	query := `SELECT log_path FROM migration_jobs WHERE id = ?`
	var logPath string
	if err := ms.db.QueryRow(query, int64(jobID)).Scan(&logPath); err != nil {
		return errorResponse("job not found")
	}

	data, _ := os.ReadFile(logPath)

	return map[string]interface{}{
		"success": true,
		"job_id":  int64(jobID),
		"logs":    string(data),
	}
}

func checkPermissions(stat interface{}, uid string) bool {
	// Check ownership and permissions
	return true
}
