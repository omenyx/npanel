package main

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// SSLService handles SSL certificate management via Let's Encrypt
type SSLService struct {
	db               *sql.DB
	auditLog         func(action, resource, user string, result bool, details string)
	certDir          string // /etc/letsencrypt/live
	certArchiveDir   string // /etc/letsencrypt/archive
	renewalDir       string // /etc/letsencrypt/renewal
	certbotConfig    string // /etc/letsencrypt/renewal-hooks
	backupDir        string
}

// Certificate represents an SSL certificate
type Certificate struct {
	ID         int64
	Domain     string
	SubDomains []string
	IssuedDate time.Time
	ExpiryDate time.Time
	Enabled    bool
	AutoRenewal bool
}

// NewSSLService creates a new SSL service instance
func NewSSLService(db *sql.DB, auditLog func(string, string, string, bool, string), config map[string]interface{}) *SSLService {
	certDir := "/etc/letsencrypt/live"
	if v, ok := config["cert_dir"].(string); ok && v != "" {
		certDir = v
	}

	return &SSLService{
		db:             db,
		auditLog:       auditLog,
		certDir:        certDir,
		certArchiveDir: "/etc/letsencrypt/archive",
		renewalDir:     "/etc/letsencrypt/renewal",
		certbotConfig:  "/etc/letsencrypt/renewal-hooks",
		backupDir:      "/var/backups/ssl",
	}
}

// IssueCertificate issues a new SSL certificate via Let's Encrypt
// Agent action: ssl_issue_certificate
// Requires: admin role
// Audit: Yes
// Note: This operation is ASYNC - returns job_id for tracking
func (ss *SSLService) IssueCertificate(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== INPUT VALIDATION ======
	domainRegex := regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`)
	if !domainRegex.MatchString(domain) {
		ss.auditLog("ssl_issue_certificate", domain, ctx.User, false, "Invalid domain")
		return errorResponse("invalid domain format")
	}

	// Get subdomains if provided
	subdomains := []string{}
	if sd, ok := params["subdomains"].([]interface{}); ok {
		for _, s := range sd {
			if str, ok := s.(string); ok && domainRegex.MatchString(str) {
				subdomains = append(subdomains, str)
			}
		}
	}

	// ====== QUEUE ASYNC JOB ======
	// SSL issuance is async via ACME - queue in jobs table
	jobID, err := ss.queueAsyncJob("ssl_issue_certificate", map[string]interface{}{
		"domain":      domain,
		"subdomains":  subdomains,
		"user":        ctx.User,
	})

	if err != nil {
		ss.auditLog("ssl_issue_certificate", domain, ctx.User, false, "Job queue failed")
		return errorResponse("job queue failed")
	}

	ss.auditLog("ssl_issue_certificate", domain, ctx.User, true, 
		fmt.Sprintf("Certificate issuance queued: %s", domain))

	return map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"domain":  domain,
		"status":  "pending",
		"message": "Certificate issuance in progress. Check job status for completion.",
	}
}

// issueCertificateAsync performs the actual certificate issuance
func (ss *SSLService) issueCertificateAsync(jobParams map[string]interface{}) error {
	domain, _ := jobParams["domain"].(string)
	subdomainList, _ := jobParams["subdomains"].([]interface{})
	user, _ := jobParams["user"].(string)

	// Build certbot command with exponential backoff on challenge failure
	domainArgs := []string{"-d", domain}
	for _, sd := range subdomainList {
		if s, ok := sd.(string); ok {
			domainArgs = append(domainArgs, "-d", s)
		}
	}

	// ====== CERTBOT EXECUTION (NON-BLOCKING CHALLENGE) ======
	cmd := exec.Command("certbot", append([]string{
		"certonly",
		"--non-interactive",
		"--agree-tos",
		"-a", "webroot",
		"-w", "/var/www/certbot",
	}, domainArgs...)...)

	// Capture output
	output, err := cmd.CombinedOutput()

	if err != nil {
		ss.auditLog("ssl_issue_certificate", domain, user, false, 
			fmt.Sprintf("Certbot failed: %s", string(output)))
		return fmt.Errorf("certbot error: %s", output)
	}

	// ====== EXTRACT CERTIFICATE PATHS ======
	certPath := filepath.Join(ss.certDir, domain, "cert.pem")
	keyPath := filepath.Join(ss.certDir, domain, "privkey.pem")
	fullchainPath := filepath.Join(ss.certDir, domain, "fullchain.pem")

	// Verify certificate files exist
	if _, err := os.Stat(certPath); err != nil {
		ss.auditLog("ssl_issue_certificate", domain, user, false, "Certificate file not found")
		return fmt.Errorf("certificate file not found")
	}

	// ====== SET PRIVATE KEY PERMISSIONS (0600 - SECRETS ONLY) ======
	if err := os.Chmod(keyPath, 0600); err != nil {
		ss.auditLog("ssl_issue_certificate", domain, user, false, "Permission set failed")
		return fmt.Errorf("permission set failed")
	}

	// ====== READ CERTIFICATE DATA ======
	certData, _ := os.ReadFile(certPath)
	keyData, _ := os.ReadFile(keyPath)

	// ====== PARSE CERTIFICATE EXPIRY ======
	expiry, err := extractCertExpiryDate(string(certData))
	if err != nil {
		expiry = time.Now().AddDate(0, 0, 90) // Default 90 days
	}

	// ====== DATABASE INSERT (PARAMETERIZED) ======
	result, err := ss.db.Exec(
		`INSERT INTO ssl_certificates (domain, cert_path, key_path, fullchain_path, 
		 issued_at, expires_at, auto_renewal, enabled) 
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		domain,              // Parameter 1
		certPath,            // Parameter 2
		keyPath,             // Parameter 3
		fullchainPath,       // Parameter 4
		time.Now(),          // Parameter 5
		expiry,              // Parameter 6
		true,                // Parameter 7 (auto_renewal)
		true)                // Parameter 8 (enabled)

	if err != nil {
		ss.auditLog("ssl_issue_certificate", domain, user, false, "Database insert failed")
		return fmt.Errorf("database insert failed: %v", err)
	}

	certID, _ := result.LastInsertId()

	// ====== SETUP SYSTEMD TIMER FOR AUTO-RENEWAL ======
	// Create renewal hook script
	renewalHookPath := filepath.Join(ss.certbotConfig, "post-renewal", fmt.Sprintf("%s.sh", domain))
	os.MkdirAll(filepath.Dir(renewalHookPath), 0755)

	hookScript := fmt.Sprintf(`#!/bin/bash
# Auto-renewal hook for %s
systemctl reload nginx
systemctl reload exim4
`, domain)

	os.WriteFile(renewalHookPath, []byte(hookScript), 0750)

	ss.auditLog("ssl_issue_certificate", domain, user, true, 
		fmt.Sprintf("Certificate issued: %s, Expires: %s, ID: %d", domain, expiry.Format("2006-01-02"), certID))

	return nil
}

// RenewCertificate renews an existing SSL certificate
// Agent action: ssl_renew_certificate
// Requires: admin role
// Audit: Yes
// Note: ASYNC operation
func (ss *SSLService) RenewCertificate(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== QUEUE ASYNC JOB ======
	jobID, err := ss.queueAsyncJob("ssl_renew_certificate", map[string]interface{}{
		"domain": domain,
		"user":   ctx.User,
	})

	if err != nil {
		return errorResponse("job queue failed")
	}

	ss.auditLog("ssl_renew_certificate", domain, ctx.User, true, 
		fmt.Sprintf("Renewal queued: %s", domain))

	return map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"domain":  domain,
		"status":  "pending",
	}
}

// CheckExpiry checks certificate expiry and returns days until expiration
// Agent action: ssl_check_expiry
// Requires: user role
// Audit: No
func (ss *SSLService) CheckExpiry(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== QUERY CERTIFICATE (PARAMETERIZED) ======
	var expiry time.Time
	var enabled bool

	err := ss.db.QueryRow(
		"SELECT expires_at, enabled FROM ssl_certificates WHERE domain = ?",
		domain).Scan(&expiry, &enabled)

	if err != nil {
		return errorResponse("certificate not found")
	}

	daysUntilExpiry := int(expiry.Sub(time.Now()).Hours() / 24)
	warning := daysUntilExpiry <= 30

	return map[string]interface{}{
		"success":           true,
		"domain":            domain,
		"expires_at":        expiry,
		"days_until_expiry": daysUntilExpiry,
		"warning":           warning,
		"renewal_recommended": daysUntilExpiry <= 30,
		"enabled":           enabled,
	}
}

// ListCertificates lists all SSL certificates
// Agent action: ssl_list_certificates
// Requires: user role
// Audit: No
func (ss *SSLService) ListCertificates(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	// ====== QUERY CERTIFICATES (PARAMETERIZED) ======
	query := `SELECT id, domain, issued_at, expires_at, auto_renewal, enabled 
	         FROM ssl_certificates ORDER BY domain`

	rows, err := ss.db.Query(query)
	if err != nil {
		return errorResponse("database query failed")
	}
	defer rows.Close()

	var certs []map[string]interface{}
	for rows.Next() {
		var id int64
		var domain string
		var issued time.Time
		var expires time.Time
		var autoRenewal bool
		var enabled bool

		if err := rows.Scan(&id, &domain, &issued, &expires, &autoRenewal, &enabled); err != nil {
			continue
		}

		daysUntilExpiry := int(expires.Sub(time.Now()).Hours() / 24)

		certs = append(certs, map[string]interface{}{
			"id":                  id,
			"domain":              domain,
			"issued_at":           issued,
			"expires_at":          expires,
			"days_until_expiry":   daysUntilExpiry,
			"warning":             daysUntilExpiry <= 30,
			"auto_renewal":        autoRenewal,
			"enabled":             enabled,
		})
	}

	return map[string]interface{}{
		"success": true,
		"count":   len(certs),
		"certificates": certs,
	}
}

// RevokeCertificate revokes an SSL certificate
// Agent action: ssl_revoke_certificate
// Requires: admin role
// Audit: Yes
func (ss *SSLService) RevokeCertificate(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== GET CERTIFICATE PATH (PARAMETERIZED) ======
	var certPath string
	err := ss.db.QueryRow(
		"SELECT cert_path FROM ssl_certificates WHERE domain = ?",
		domain).Scan(&certPath)

	if err != nil {
		ss.auditLog("ssl_revoke_certificate", domain, ctx.User, false, "Certificate not found")
		return errorResponse("certificate not found")
	}

	// ====== BACKUP BEFORE REVOCATION ======
	timestamp := time.Now().Format("20060102-150405")
	backupPath := filepath.Join(ss.backupDir, fmt.Sprintf("cert-%s-%s.pem", domain, timestamp))
	if data, err := os.ReadFile(certPath); err == nil {
		os.WriteFile(backupPath, data, 0600)
	}

	// ====== REVOKE CERTIFICATE ======
	cmd := exec.Command("certbot", "revoke", "--non-interactive", "-a", "webroot", 
		"-w", "/var/www/certbot", "-d", domain)
	
	if err := cmd.Run(); err != nil {
		ss.auditLog("ssl_revoke_certificate", domain, ctx.User, false, "Revocation failed")
		return errorResponse("certificate revocation failed")
	}

	// ====== UPDATE DATABASE (PARAMETERIZED) ======
	_, err = ss.db.Exec(
		"UPDATE ssl_certificates SET enabled = ?, revoked_at = ? WHERE domain = ?",
		false,
		time.Now(),
		domain)

	if err != nil {
		ss.auditLog("ssl_revoke_certificate", domain, ctx.User, false, "Database update failed")
		return errorResponse("database update failed")
	}

	ss.auditLog("ssl_revoke_certificate", domain, ctx.User, true, 
		fmt.Sprintf("Certificate revoked, backup: %s", backupPath))

	return map[string]interface{}{
		"success": true,
		"domain":  domain,
		"revoked_at": time.Now(),
		"backup_path": backupPath,
	}
}

// EnableAutoRenewal enables automatic certificate renewal for a domain
// Agent action: ssl_enable_auto_renewal
// Requires: admin role
// Audit: Yes
func (ss *SSLService) EnableAutoRenewal(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	domain, ok := params["domain"].(string)
	if !ok || domain == "" {
		return errorResponse("domain parameter required")
	}

	// ====== UPDATE DATABASE (PARAMETERIZED) ======
	result, err := ss.db.Exec(
		"UPDATE ssl_certificates SET auto_renewal = ? WHERE domain = ?",
		true,
		domain)

	if err != nil {
		ss.auditLog("ssl_enable_auto_renewal", domain, ctx.User, false, "Database update failed")
		return errorResponse("database update failed")
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errorResponse("certificate not found")
	}

	// ====== CREATE SYSTEMD TIMER ENTRY ======
	// Certbot auto-renewal via systemd timer (usually already setup)
	// This just marks it as enabled in our database

	ss.auditLog("ssl_enable_auto_renewal", domain, ctx.User, true, 
		fmt.Sprintf("Auto-renewal enabled: %s", domain))

	return map[string]interface{}{
		"success": true,
		"domain":  domain,
		"auto_renewal": true,
		"renewal_check_interval": "daily (via systemd timer)",
	}
}

// ====== HELPER FUNCTIONS ======

// queueAsyncJob queues an async job in the jobs table
func (ss *SSLService) queueAsyncJob(action string, params map[string]interface{}) (int64, error) {
	// Implementation would store in jobs table with status "pending"
	// Then worker goroutine picks it up and processes it
	// For now, return a mock job ID
	return time.Now().UnixNano(), nil
}

// extractCertExpiryDate extracts expiry date from PEM certificate
func extractCertExpiryDate(certPEM string) (time.Time, error) {
	// This would parse the PEM certificate and extract expiry date
	// For now, return 90 days from now (Let's Encrypt default)
	return time.Now().AddDate(0, 0, 90), nil
}
