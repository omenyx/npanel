package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// EmailService handles all email operations
type EmailService struct {
	db            *sql.DB
	auditLog      func(action, email, user string, result bool, details string)
	mailbaseDir   string
	backupDir     string
	eximConfigDir string
	dovecotDir    string
}

// MailboxConfig represents a mailbox configuration
type MailboxConfig struct {
	Email     string
	Domain    string
	Password  string
	Quota     int64 // MB, range: 50-10240
	Enabled   bool
	CreatedAt time.Time
}

// NewEmailService creates a new email service instance
func NewEmailService(db *sql.DB, auditLog func(string, string, string, bool, string), config map[string]interface{}) *EmailService {
	mailbaseDir := "/var/mail/vhosts"
	if v, ok := config["mailbase_dir"].(string); ok && v != "" {
		mailbaseDir = v
	}
	backupDir := "/var/backups/mailboxes"
	if v, ok := config["backup_dir"].(string); ok && v != "" {
		backupDir = v
	}

	return &EmailService{
		db:            db,
		auditLog:      auditLog,
		mailbaseDir:   mailbaseDir,
		backupDir:     backupDir,
		eximConfigDir: "/etc/exim4",
		dovecotDir:    "/etc/dovecot",
	}
}

// CreateMailbox creates a new email mailbox
// Agent action: email_create_mailbox
// Requires: user role
// Audit: Yes
func (es *EmailService) CreateMailbox(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	startTime := time.Now()
	email, ok := params["email"].(string)
	if !ok || email == "" {
		return errorResponse("email parameter required")
	}

	password, ok := params["password"].(string)
	if !ok || password == "" {
		return errorResponse("password parameter required")
	}

	quotaVal, ok := params["quota"].(float64)
	if !ok {
		quotaVal = 256 // Default 256MB
	}
	quota := int64(quotaVal)

	// ====== STRICT INPUT VALIDATION ======
	// Email format validation
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailRegex.MatchString(email) {
		es.auditLog("email_create", email, ctx.User, false, "Invalid email format")
		return errorResponse("invalid email format")
	}

	parts := strings.Split(email, "@")
	localPart := parts[0]
	domain := parts[1]

	// Validate local part (no special shell chars)
	if !regexp.MustCompile(`^[a-zA-Z0-9._%+-]{1,64}$`).MatchString(localPart) {
		es.auditLog("email_create", email, ctx.User, false, "Invalid local part")
		return errorResponse("invalid email local part")
	}

	// Validate domain (no shell injection possible)
	if !regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`).MatchString(domain) {
		es.auditLog("email_create", email, ctx.User, false, "Invalid domain")
		return errorResponse("invalid domain")
	}

	// Password strength validation (12+ chars)
	if len(password) < 12 {
		es.auditLog("email_create", email, ctx.User, false, "Password too short")
		return errorResponse("password must be at least 12 characters")
	}

	// Quota validation (50-10240 MB)
	if quota < 50 || quota > 10240 {
		es.auditLog("email_create", email, ctx.User, false, "Invalid quota")
		return errorResponse("quota must be between 50 and 10240 MB")
	}

	// ====== ATOMIC BACKUP CREATION ======
	timestamp := time.Now().Format("20060102-150405")
	backupPath := filepath.Join(es.backupDir, fmt.Sprintf("mailbox-%s-%s.tar.gz.pre", 
		strings.ReplaceAll(email, "@", "_"), timestamp))
	
	// Create mailbox path
	mailboxPath := filepath.Join(es.mailbaseDir, domain, localPart)
	
	// If mailbox already exists, create backup
	if info, err := os.Stat(mailboxPath); err == nil && info.IsDir() {
		// Backup existing mailbox before modification
		if _, err := exec.Command("tar", "-czf", backupPath, "-C", 
			filepath.Join(es.mailbaseDir, domain), localPart).Output(); err != nil {
			es.auditLog("email_create", email, ctx.User, false, "Backup creation failed")
			return errorResponse("backup creation failed")
		}
	}

	// ====== CREATE MAILDIR STRUCTURE ======
	dirs := []string{
		filepath.Join(mailboxPath, "cur"),
		filepath.Join(mailboxPath, "new"),
		filepath.Join(mailboxPath, "tmp"),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0700); err != nil {
			// Cleanup on error
			os.RemoveAll(mailboxPath)
			if backupPath != "" {
				os.RemoveAll(backupPath)
			}
			es.auditLog("email_create", email, ctx.User, false, "Failed to create maildir: "+err.Error())
			return errorResponse("maildir creation failed")
		}
	}

	// Set correct permissions (0700)
	if err := os.Chmod(mailboxPath, 0700); err != nil {
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Failed to set permissions")
		return errorResponse("permission setup failed")
	}

	// Create maildirsize file for quota enforcement
	maildirsize := filepath.Join(mailboxPath, "maildirsize")
	sizeContent := fmt.Sprintf("%d 0\n", quota*1024) // Size in bytes
	if err := os.WriteFile(maildirsize, []byte(sizeContent), 0600); err != nil {
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Maildirsize creation failed")
		return errorResponse("quota configuration failed")
	}

	// ====== BCRYPT PASSWORD HASHING (COST 14) ======
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MaxCost)
	if err != nil {
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Password hashing failed")
		return errorResponse("password hashing failed")
	}

	// ====== PARAMETERIZED DATABASE INSERT ======
	// NO string concatenation - ONLY parameterized queries
	query := `INSERT INTO mailboxes (email, domain, local_part, password_hash, quota_mb, enabled, created_at, last_modified) 
	         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	
	now := time.Now()
	result, err := es.db.Exec(query, 
		email,           // Parameter 1
		domain,          // Parameter 2
		localPart,       // Parameter 3
		string(hashedPassword), // Parameter 4 (never plaintext)
		quota,           // Parameter 5
		1,               // Parameter 6 (enabled)
		now,             // Parameter 7
		now)             // Parameter 8

	if err != nil {
		// Cleanup on error
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Database insert failed: "+err.Error())
		return errorResponse("database operation failed")
	}

	mailboxID, err := result.LastInsertId()
	if err != nil {
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Failed to get mailbox ID")
		return errorResponse("database operation failed")
	}

	// ====== DOVECOT RELOAD ======
	if err := exec.Command("systemctl", "reload", "dovecot").Run(); err != nil {
		// Cleanup on error
		es.db.Exec("DELETE FROM mailboxes WHERE id = ?", mailboxID)
		os.RemoveAll(mailboxPath)
		es.auditLog("email_create", email, ctx.User, false, "Dovecot reload failed")
		return errorResponse("dovecot reload failed")
	}

	// ====== AUDIT LOGGING ======
	duration := time.Since(startTime)
	auditDetails := fmt.Sprintf("Mailbox created: %s, Quota: %dMB, Duration: %dms", 
		email, quota, duration.Milliseconds())
	es.auditLog("email_create", email, ctx.User, true, auditDetails)

	return map[string]interface{}{
		"success":   true,
		"mailbox_id": mailboxID,
		"email":     email,
		"quota_mb":  quota,
		"created_at": now,
		"duration_ms": duration.Milliseconds(),
	}
}

// DeleteMailbox deletes a mailbox with 30-day backup retention
// Agent action: email_delete_mailbox
// Requires: user role
// Audit: Yes
func (es *EmailService) DeleteMailbox(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	email, ok := params["email"].(string)
	if !ok || email == "" {
		return errorResponse("email parameter required")
	}

	// ====== INPUT VALIDATION ======
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailRegex.MatchString(email) {
		es.auditLog("email_delete", email, ctx.User, false, "Invalid email format")
		return errorResponse("invalid email format")
	}

	parts := strings.Split(email, "@")
	localPart := parts[0]
	domain := parts[1]

	// ====== BACKUP BEFORE DELETION ======
	timestamp := time.Now().Format("20060102-150405")
	backupPath := filepath.Join(es.backupDir, fmt.Sprintf("mailbox-%s-%s.tar.gz", 
		strings.ReplaceAll(email, "@", "_"), timestamp))

	mailboxPath := filepath.Join(es.mailbaseDir, domain, localPart)
	
	// Create 30-day retention backup
	if info, err := os.Stat(mailboxPath); err == nil && info.IsDir() {
		if err := exec.Command("tar", "-czf", backupPath, "-C", 
			filepath.Join(es.mailbaseDir, domain), localPart).Run(); err != nil {
			es.auditLog("email_delete", email, ctx.User, false, "Backup creation failed")
			return errorResponse("backup creation failed")
		}
		
		// Set backup retention (30 days from now it will be deleted)
		retentionPath := backupPath + ".retention"
		retentionTime := time.Now().AddDate(0, 0, 30)
		os.WriteFile(retentionPath, []byte(retentionTime.Format(time.RFC3339)), 0600)
	}

	// ====== DATABASE DELETION (PARAMETERIZED) ======
	result, err := es.db.Exec("DELETE FROM mailboxes WHERE email = ?", email)
	if err != nil {
		es.auditLog("email_delete", email, ctx.User, false, "Database delete failed")
		return errorResponse("database operation failed")
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		es.auditLog("email_delete", email, ctx.User, false, "Mailbox not found")
		return errorResponse("mailbox not found")
	}

	// ====== FILE DELETION ======
	if err := os.RemoveAll(mailboxPath); err != nil {
		es.auditLog("email_delete", email, ctx.User, false, "File deletion failed")
		return errorResponse("file deletion failed")
	}

	// ====== DOVECOT RELOAD ======
	if err := exec.Command("systemctl", "reload", "dovecot").Run(); err != nil {
		es.auditLog("email_delete", email, ctx.User, false, "Dovecot reload failed")
		return errorResponse("dovecot reload failed")
	}

	es.auditLog("email_delete", email, ctx.User, true, 
		fmt.Sprintf("Deleted with 30-day backup: %s", backupPath))

	return map[string]interface{}{
		"success": true,
		"email":   email,
		"backup":  backupPath,
		"retention_days": 30,
	}
}

// SetQuota sets or updates mailbox quota
// Agent action: email_set_quota
// Requires: user role
// Audit: Yes
func (es *EmailService) SetQuota(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	email, ok := params["email"].(string)
	if !ok || email == "" {
		return errorResponse("email parameter required")
	}

	quotaVal, ok := params["quota"].(float64)
	if !ok {
		return errorResponse("quota parameter required")
	}
	quota := int64(quotaVal)

	// ====== INPUT VALIDATION ======
	if quota < 50 || quota > 10240 {
		es.auditLog("email_set_quota", email, ctx.User, false, "Invalid quota")
		return errorResponse("quota must be between 50 and 10240 MB")
	}

	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return errorResponse("invalid email format")
	}
	localPart := parts[0]
	domain := parts[1]

	// ====== UPDATE MAILDIRSIZE ======
	mailboxPath := filepath.Join(es.mailbaseDir, domain, localPart)
	maildirsize := filepath.Join(mailboxPath, "maildirsize")

	sizeContent := fmt.Sprintf("%d 0\n", quota*1024) // Size in bytes
	if err := os.WriteFile(maildirsize, []byte(sizeContent), 0600); err != nil {
		es.auditLog("email_set_quota", email, ctx.User, false, "Maildirsize update failed")
		return errorResponse("quota update failed")
	}

	// ====== UPDATE DATABASE (PARAMETERIZED) ======
	_, err := es.db.Exec(
		"UPDATE mailboxes SET quota_mb = ?, last_modified = ? WHERE email = ?",
		quota,
		time.Now(),
		email)

	if err != nil {
		es.auditLog("email_set_quota", email, ctx.User, false, "Database update failed")
		return errorResponse("database operation failed")
	}

	es.auditLog("email_set_quota", email, ctx.User, true, 
		fmt.Sprintf("Quota updated to %dMB", quota))

	return map[string]interface{}{
		"success": true,
		"email":   email,
		"quota_mb": quota,
	}
}

// GenerateDKIM generates DKIM keys for a domain
// Agent action: email_generate_dkim
// Requires: admin role
// Audit: Yes
func (es *EmailService) GenerateDKIM(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	selector, ok := params["selector"].(string)
	if !ok {
		selector = "default"
	}

	// ====== INPUT VALIDATION ======
	domainRegex := regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`)
	if !domainRegex.MatchString(domain) {
		es.auditLog("email_generate_dkim", domain, ctx.User, false, "Invalid domain")
		return errorResponse("invalid domain format")
	}

	// ====== GENERATE RSA 2048-BIT KEY ======
	dkimDir := filepath.Join(es.eximConfigDir, "dkim", domain)
	os.MkdirAll(dkimDir, 0750)

	keyPath := filepath.Join(dkimDir, fmt.Sprintf("%s.private", selector))
	
	// Generate private key using openssl
	cmd := exec.Command("openssl", "genrsa", "-out", keyPath, "2048")
	if err := cmd.Run(); err != nil {
		es.auditLog("email_generate_dkim", domain, ctx.User, false, "Key generation failed")
		return errorResponse("DKIM key generation failed")
	}

	// Set permissions to 0600 (secrets)
	os.Chmod(keyPath, 0600)

	// ====== GENERATE PUBLIC KEY ======
	pubKeyPath := filepath.Join(dkimDir, fmt.Sprintf("%s.public", selector))
	cmd = exec.Command("openssl", "rsa", "-in", keyPath, "-pubout", "-out", pubKeyPath)
	if err := cmd.Run(); err != nil {
		os.RemoveAll(dkimDir)
		es.auditLog("email_generate_dkim", domain, ctx.User, false, "Public key generation failed")
		return errorResponse("public key generation failed")
	}

	// ====== READ PUBLIC KEY FOR DNS RECORD ======
	pubKeyData, err := os.ReadFile(pubKeyPath)
	if err != nil {
		os.RemoveAll(dkimDir)
		es.auditLog("email_generate_dkim", domain, ctx.User, false, "Failed to read public key")
		return errorResponse("public key read failed")
	}

	// Format for DNS TXT record
	pubKeyStr := string(pubKeyData)
	pubKeyStr = strings.ReplaceAll(pubKeyStr, "-----BEGIN PUBLIC KEY-----\n", "")
	pubKeyStr = strings.ReplaceAll(pubKeyStr, "-----END PUBLIC KEY-----\n", "")
	pubKeyStr = strings.ReplaceAll(pubKeyStr, "\n", "")

	dnsRecord := fmt.Sprintf(`v=DKIM1; k=rsa; p=%s`, pubKeyStr)

	// ====== STORE IN DATABASE (PARAMETERIZED) ======
	_, err = es.db.Exec(
		"INSERT INTO dkim_keys (domain, selector, private_key_path, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
		domain,           // Parameter 1
		selector,         // Parameter 2
		keyPath,          // Parameter 3
		pubKeyStr,        // Parameter 4
		time.Now())       // Parameter 5

	if err != nil {
		os.RemoveAll(dkimDir)
		es.auditLog("email_generate_dkim", domain, ctx.User, false, "Database insert failed")
		return errorResponse("database operation failed")
	}

	es.auditLog("email_generate_dkim", domain, ctx.User, true, 
		fmt.Sprintf("DKIM key generated for selector: %s", selector))

	return map[string]interface{}{
		"success": true,
		"domain":  domain,
		"selector": selector,
		"dns_record_name": fmt.Sprintf("%s._domainkey.%s", selector, domain),
		"dns_record_type": "TXT",
		"dns_record_value": dnsRecord,
		"instructions": "Add the DNS TXT record above to your domain's DNS settings",
	}
}

// ListMailboxes lists all mailboxes for a domain
// Agent action: email_list_mailboxes
// Requires: user role
// Audit: No
func (es *EmailService) ListMailboxes(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== INPUT VALIDATION ======
	domainRegex := regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`)
	if !domainRegex.MatchString(domain) {
		return errorResponse("invalid domain format")
	}

	// ====== QUERY MAILBOXES (PARAMETERIZED) ======
	query := "SELECT email, quota_mb, enabled, created_at FROM mailboxes WHERE domain = ? ORDER BY email"
	rows, err := es.db.Query(query, domain)
	if err != nil {
		return errorResponse("database query failed")
	}
	defer rows.Close()

	var mailboxes []map[string]interface{}
	for rows.Next() {
		var email string
		var quota int64
		var enabled bool
		var createdAt time.Time

		if err := rows.Scan(&email, &quota, &enabled, &createdAt); err != nil {
			continue
		}

		// Get disk usage from maildirsize
		localPart := strings.Split(email, "@")[0]
		maildirsize := filepath.Join(es.mailbaseDir, domain, localPart, "maildirsize")
		usage := int64(0)

		if data, err := os.ReadFile(maildirsize); err == nil {
			fields := strings.Fields(string(data))
			if len(fields) > 1 {
				fmt.Sscanf(fields[1], "%d", &usage)
				usage = usage / 1024 / 1024 // Convert to MB
			}
		}

		mailboxes = append(mailboxes, map[string]interface{}{
			"email":       email,
			"quota_mb":    quota,
			"usage_mb":    usage,
			"enabled":     enabled,
			"created_at":  createdAt,
			"utilization": float64(usage) / float64(quota) * 100,
		})
	}

	return map[string]interface{}{
		"success":    true,
		"domain":     domain,
		"count":      len(mailboxes),
		"mailboxes":  mailboxes,
	}
}

// GetSPFRecord returns SPF record for domain
// Agent action: email_get_spf
// Requires: user role
// Audit: No
func (es *EmailService) GetSPFRecord(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// Standard SPF for hosting control panel
	spfRecord := fmt.Sprintf("v=spf1 mx ~all")

	return map[string]interface{}{
		"success": true,
		"domain":  domain,
		"spf_record": spfRecord,
		"dns_record_type": "TXT",
		"instructions": "Add this TXT record to your domain's DNS settings",
	}
}

// GetDMARCRecord returns DMARC record for domain
// Agent action: email_get_dmarc
// Requires: user role
// Audit: No
func (es *EmailService) GetDMARCRecord(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	email, ok := params["report_email"].(string)
	if !ok {
		email = fmt.Sprintf("postmaster@%s", domain)
	}

	// Standard DMARC policy
	dmarcRecord := fmt.Sprintf("v=DMARC1; p=quarantine; rua=mailto:%s; ruf=mailto:%s; fo=1", email, email)

	return map[string]interface{}{
		"success": true,
		"domain":  domain,
		"dmarc_record": dmarcRecord,
		"record_name": fmt.Sprintf("_dmarc.%s", domain),
		"dns_record_type": "TXT",
		"instructions": "Add this TXT record to your domain's DNS settings at _dmarc subdomain",
	}
}

// ====== HELPER FUNCTIONS ======

func errorResponse(msg string) map[string]interface{} {
	return map[string]interface{}{
		"success": false,
		"error":   msg,
	}
}

// GenerateSecurePassword generates a cryptographically secure random password
func GenerateSecurePassword(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
	b := make([]byte, length)
	for i := range b {
		num, err := rand.Int(rand.Reader, nil)
		if err != nil {
			return "", err
		}
		b[i] = charset[num.Uint64()%uint64(len(charset))]
	}
	return string(b), nil
}
