package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MigrationHandler handles migration API endpoints
type MigrationHandler struct {
	service *MigrationService
	mu      sync.RWMutex
}

// ValidateBackupRequest represents backup validation request
type ValidateBackupRequest struct {
	BackupPath string `json:"backup_path" binding:"required"`
	TargetUser string `json:"target_user" binding:"required"`
}

// ValidateBackupResponse represents validation result
type ValidateBackupResponse struct {
	Success       bool   `json:"success"`
	Valid         bool   `json:"valid"`
	BackupFormat  string `json:"backup_format"`
	BackupSize    int64  `json:"backup_size"`
	DiskAvailable int64  `json:"disk_available"`
	Message       string `json:"message"`
	Errors        []string `json:"errors,omitempty"`
}

// AnalyzeBackupRequest represents analysis request
type AnalyzeBackupRequest struct {
	BackupPath string `json:"backup_path" binding:"required"`
	TargetUser string `json:"target_user" binding:"required"`
}

// AnalyzeBackupResponse represents async analysis response
type AnalyzeBackupResponse struct {
	Success bool   `json:"success"`
	JobID   int64  `json:"job_id"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// MigrationPlanResponse represents migration plan
type MigrationPlanResponse struct {
	Success bool        `json:"success"`
	Plan    interface{} `json:"plan"`
	Mapping interface{} `json:"mapping,omitempty"`
}

// PreviewResponse represents dry-run preview
type PreviewResponse struct {
	Success     bool        `json:"success"`
	DryRun      bool        `json:"dry_run"`
	Simulation  interface{} `json:"simulation"`
	NextAction  string      `json:"next_action"`
	Message     string      `json:"message"`
}

// ApplyMigrationRequest represents migration apply request
type ApplyMigrationRequest struct {
	JobID          int64  `json:"job_id" binding:"required"`
	ApprovalToken  string `json:"approval_token" binding:"required"`
	Confirmation   string `json:"confirmation,omitempty"`
}

// ApplyMigrationResponse represents apply response
type ApplyMigrationResponse struct {
	Success    bool   `json:"success"`
	ApplyJobID int64  `json:"apply_job_id"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	CheckURL   string `json:"check_progress"`
	CancelURL  string `json:"cancel_endpoint"`
}

// JobStatusResponse represents job status
type JobStatusResponse struct {
	Success        bool           `json:"success"`
	JobID          int64          `json:"job_id"`
	Status         string         `json:"status"`
	Progress       int            `json:"progress"`
	CurrentStep    string         `json:"current_step"`
	TargetUser     string         `json:"target_user,omitempty"`
	ErrorMessage   string         `json:"error_message,omitempty"`
	Timeline       interface{}    `json:"timeline,omitempty"`
	CheckpointInfo interface{}    `json:"checkpoint_info,omitempty"`
}

// ValidateMigrationRequest represents validation request
type ValidateMigrationRequest struct {
	TargetUser string `json:"target_user" binding:"required"`
	JobID      int64  `json:"job_id,omitempty"`
}

// ValidateMigrationResponse represents validation results
type ValidateMigrationResponse struct {
	Success bool                   `json:"success"`
	Checks  map[string]interface{} `json:"checks"`
	Summary string                 `json:"summary"`
	Issues  []string               `json:"issues,omitempty"`
}

// RollbackRequest represents rollback request
type RollbackRequest struct {
	JobID int64 `json:"job_id" binding:"required"`
}

// RollbackResponse represents rollback result
type RollbackResponse struct {
	Success      bool   `json:"success"`
	TargetUser   string `json:"target_user"`
	Message      string `json:"message"`
	CleanupStatus interface{} `json:"cleanup_status"`
	BackupLocation string `json:"backup_location"`
	BackupStatus string `json:"backup_status"`
}

// SelectiveRestoreRequest represents selective restore request
type SelectiveRestoreRequest struct {
	BackupPath string            `json:"backup_path" binding:"required"`
	TargetUser string            `json:"target_user" binding:"required"`
	Components map[string]bool   `json:"components"`
	Mode       string            `json:"mode"` // merge or overwrite
	Confirmation string          `json:"confirmation,omitempty"`
}

// NewMigrationHandler creates new migration handler
func NewMigrationHandler(service *MigrationService) *MigrationHandler {
	return &MigrationHandler{
		service: service,
	}
}

// HandleValidateBackup validates a backup file
func (h *MigrationHandler) HandleValidateBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ValidateBackupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate input
	if req.BackupPath == "" || req.TargetUser == "" {
		respondWithError(w, http.StatusBadRequest, "Missing required fields", nil)
		return
	}

	// Perform validation
	err := h.service.ValidateBackup(req.BackupPath, req.TargetUser)
	
	resp := ValidateBackupResponse{
		Success: err == nil,
		Message: "Backup validation complete",
		Errors:  []string{},
	}

	if err != nil {
		resp.Valid = false
		resp.Message = fmt.Sprintf("Validation failed: %v", err)
		resp.Errors = []string{err.Error()}
		respondWithJSON(w, http.StatusOK, resp)
		return
	}

	resp.Valid = true
	resp.Message = "Backup is valid and ready for migration"
	
	// Get file info for size
	// TODO: Fill in actual values
	resp.BackupFormat = "cpmove-tar.gz"
	resp.BackupSize = 25600000000
	resp.DiskAvailable = 1099511627776

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleAnalyzeBackup queues backup analysis
func (h *MigrationHandler) HandleAnalyzeBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AnalyzeBackupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Queue analysis
	jobID, err := h.service.AnalyzeBackup(req.BackupPath, req.TargetUser)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to queue analysis", err)
		return
	}

	resp := AnalyzeBackupResponse{
		Success: true,
		JobID:   jobID,
		Status:  "analyzing",
		Message: "Backup analysis in progress",
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleGetMigrationPlan returns migration plan
func (h *MigrationHandler) HandleGetMigrationPlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	jobIDStr := r.URL.Query().Get("job_id")
	if jobIDStr == "" {
		respondWithError(w, http.StatusBadRequest, "Missing job_id parameter", nil)
		return
	}

	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid job_id", err)
		return
	}

	plan, err := h.service.CreateMigrationPlan(jobID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "Migration plan not found", err)
		return
	}

	resp := MigrationPlanResponse{
		Success: true,
		Plan:    plan,
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandlePreviewMigration shows dry-run preview
func (h *MigrationHandler) HandlePreviewMigration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		JobID int64 `json:"job_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	preview, err := h.service.PreviewMigration(req.JobID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to generate preview", err)
		return
	}

	resp := PreviewResponse{
		Success:    true,
		DryRun:     true,
		Simulation: preview,
		NextAction: fmt.Sprintf("Call migration_apply with job_id=%d and approval_token", req.JobID),
		Message:    "No changes have been made. This is a preview.",
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleApplyMigration starts migration with approval
func (h *MigrationHandler) HandleApplyMigration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ApplyMigrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Apply migration
	err := h.service.ApplyMigration(req.JobID, req.ApprovalToken)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Failed to apply migration", err)
		return
	}

	resp := ApplyMigrationResponse{
		Success:    true,
		ApplyJobID: req.JobID,
		Status:     "applying",
		Message:    "Migration in progress",
		CheckURL:   fmt.Sprintf("/api/migration/job/%d/status", req.JobID),
		CancelURL:  fmt.Sprintf("/api/migration/job/%d/cancel", req.JobID),
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleGetJobStatus returns job status
func (h *MigrationHandler) HandleGetJobStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID from path
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		respondWithError(w, http.StatusBadRequest, "Invalid path", nil)
		return
	}

	jobID, err := strconv.ParseInt(parts[len(parts)-2], 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid job_id", err)
		return
	}

	job, err := h.service.GetJobStatus(jobID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "Job not found", err)
		return
	}

	timeline := map[string]interface{}{
		"started_at":          job.StartedAt,
		"estimated_completion": time.Now().Add(5 * time.Minute), // TODO: Calculate
		"elapsed_seconds":     0, // TODO: Calculate
	}

	resp := JobStatusResponse{
		Success:     true,
		JobID:       job.ID,
		Status:      job.Status,
		Progress:    job.Progress,
		CurrentStep: job.CurrentStep,
		TargetUser:  job.TargetUser,
		Timeline:    timeline,
	}

	if job.ErrorMsg != "" {
		resp.ErrorMessage = job.ErrorMsg
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleGetJobLogs returns job logs
func (h *MigrationHandler) HandleGetJobLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID from path
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		respondWithError(w, http.StatusBadRequest, "Invalid path", nil)
		return
	}

	jobID, err := strconv.ParseInt(parts[len(parts)-2], 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid job_id", err)
		return
	}

	logs, err := h.service.GetJobLogs(jobID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "Logs not found", err)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, logs)
}

// HandleValidateMigration validates completed migration
func (h *MigrationHandler) HandleValidateMigration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ValidateMigrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	checks, err := h.service.ValidateMigration(req.TargetUser)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Validation failed", err)
		return
	}

	issues := []string{}
	for check, passed := range checks {
		if !passed {
			issues = append(issues, fmt.Sprintf("%s: failed", check))
		}
	}

	allPassed := len(issues) == 0

	resp := ValidateMigrationResponse{
		Success: true,
		Checks:  checks,
		Summary: "Migration validation complete",
		Issues:  issues,
	}

	if !allPassed {
		resp.Summary = fmt.Sprintf("Validation found %d issues", len(issues))
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleRollbackMigration rolls back a migration
func (h *MigrationHandler) HandleRollbackMigration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RollbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	job, err := h.service.GetJobStatus(req.JobID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "Job not found", err)
		return
	}

	err = h.service.RollbackMigration(req.JobID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Rollback failed", err)
		return
	}

	resp := RollbackResponse{
		Success:        true,
		TargetUser:     job.TargetUser,
		Message:        "Migration rolled back successfully",
		BackupLocation: job.SourcePath,
		BackupStatus:   "intact",
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// HandleSelectiveRestore restores specific components
func (h *MigrationHandler) HandleSelectiveRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SelectiveRestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate mode
	if req.Mode != "merge" && req.Mode != "overwrite" {
		respondWithError(w, http.StatusBadRequest, "Invalid mode (must be 'merge' or 'overwrite')", nil)
		return
	}

	// If overwrite mode, require confirmation
	if req.Mode == "overwrite" && req.Confirmation == "" {
		respondWithError(w, http.StatusBadRequest, "Overwrite mode requires explicit confirmation", nil)
		return
	}

	err := h.service.SelectiveRestore(req.BackupPath, req.TargetUser, req.Components, req.Mode)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Selective restore failed", err)
		return
	}

	resp := AnalyzeBackupResponse{
		Success: true,
		Status:  "restoring",
		Message: fmt.Sprintf("Selective restore in progress (mode: %s)", req.Mode),
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// Helper functions

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

func respondWithError(w http.ResponseWriter, code int, message string, err error) {
	resp := map[string]interface{}{
		"success": false,
		"message": message,
	}
	if err != nil {
		resp["error"] = err.Error()
	}
	respondWithJSON(w, code, resp)
}

// MigrationService interface for handler
type MigrationService interface {
	ValidateBackup(backupPath, targetUser string) error
	AnalyzeBackup(backupPath, targetUser string) (int64, error)
	CreateMigrationPlan(jobID int64) (interface{}, error)
	PreviewMigration(jobID int64) (map[string]interface{}, error)
	ApplyMigration(jobID int64, approvalToken string) error
	GetJobStatus(jobID int64) (*MigrationJob, error)
	GetJobLogs(jobID int64) (string, error)
	ValidateMigration(username string) (map[string]bool, error)
	RollbackMigration(jobID int64) error
	SelectiveRestore(backupPath, username string, components map[string]bool, mode string) error
}

// MigrationJob represents a migration job
type MigrationJob struct {
	ID             int64
	Status         string
	Progress       int
	CurrentStep    string
	TargetUser     string
	SourcePath     string
	StartedAt      *time.Time
	CompletedAt    *time.Time
	ErrorMsg       string
}
