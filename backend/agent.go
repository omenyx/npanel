package main

import (
	"database/sql"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Agent represents the nPanel management agent
type Agent struct {
	db *sql.DB
}

// NewAgent creates a new agent instance
func NewAgent(db *sql.DB) *Agent {
	return &Agent{
		db: db,
	}
}

// DOMAIN OPERATIONS
// ─────────────────────────────────────────────────────────────

// CreateDomain creates a new domain
func (a *Agent) CreateDomain(ownerID, domainName, webRoot string) error {
	fmt.Printf("📝 Creating domain: %s\n", domainName)

	// Validate domain
	if !isValidDomain(domainName) {
		return fmt.Errorf("invalid domain name: %s", domainName)
	}

	domainID := generateID()
	now := time.Now()

	_, err := a.db.Exec(`
		INSERT INTO domains (id, name, owner_id, status, web_root, created_at, updated_at)
		VALUES (?, ?, ?, 'active', ?, ?, ?)
	`, domainID, domainName, ownerID, webRoot, now, now)

	if err != nil {
		return fmt.Errorf("failed to create domain: %w", err)
	}

	// Create web directory
	if err := createWebRoot(webRoot); err != nil {
		return fmt.Errorf("failed to create web root: %w", err)
	}

	fmt.Printf("✓ Domain created: %s\n", domainName)
	return nil
}

// SuspendDomain suspends a domain
func (a *Agent) SuspendDomain(domainID string) error {
	fmt.Printf("⏸️  Suspending domain: %s\n", domainID)

	_, err := a.db.Exec(`UPDATE domains SET status = 'suspended' WHERE id = ?`, domainID)
	if err != nil {
		return fmt.Errorf("failed to suspend domain: %w", err)
	}

	fmt.Printf("✓ Domain suspended\n")
	return nil
}

// ResumeDomain resumes a domain
func (a *Agent) ResumeDomain(domainID string) error {
	fmt.Printf("▶️  Resuming domain: %s\n", domainID)

	_, err := a.db.Exec(`UPDATE domains SET status = 'active' WHERE id = ?`, domainID)
	if err != nil {
		return fmt.Errorf("failed to resume domain: %w", err)
	}

	fmt.Printf("✓ Domain resumed\n")
	return nil
}

// DeleteDomain deletes a domain
func (a *Agent) DeleteDomain(domainID string) error {
	fmt.Printf("🗑️  Deleting domain: %s\n", domainID)

	var webRoot string
	err := a.db.QueryRow(`SELECT web_root FROM domains WHERE id = ?`, domainID).Scan(&webRoot)
	if err != nil {
		return fmt.Errorf("domain not found: %w", err)
	}

	// Delete from database
	_, err = a.db.Exec(`DELETE FROM domains WHERE id = ?`, domainID)
	if err != nil {
		return fmt.Errorf("failed to delete domain: %w", err)
	}

	// Remove web directory
	if err := removeWebRoot(webRoot); err != nil {
		return fmt.Errorf("failed to remove web root: %w", err)
	}

	fmt.Printf("✓ Domain deleted\n")
	return nil
}

// ListDomains lists all domains for a user
func (a *Agent) ListDomains(ownerID string) ([]Domain, error) {
	fmt.Printf("📋 Listing domains for user: %s\n", ownerID)

	rows, err := a.db.Query(`
		SELECT id, name, owner_id, status, web_root, created_at
		FROM domains WHERE owner_id = ?
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to list domains: %w", err)
	}
	defer rows.Close()

	var domains []Domain
	for rows.Next() {
		var d Domain
		err := rows.Scan(&d.ID, &d.Name, &d.OwnerID, &d.Status, &d.WebRoot, &d.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan domain: %w", err)
		}
		domains = append(domains, d)
	}

	fmt.Printf("✓ Found %d domains\n", len(domains))
	return domains, nil
}

// EMAIL OPERATIONS
// ─────────────────────────────────────────────────────────────

// CreateEmailAccount creates an email account
func (a *Agent) CreateEmailAccount(domainID, username, password string, quotaMB int) error {
	fmt.Printf("📧 Creating email account: %s\n", username)

	accountID := generateID()
	passwordHash, err := HashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	now := time.Now()
	_, err = a.db.Exec(`
		INSERT INTO email_accounts (id, domain_id, username, password_hash, quota_mb, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
	`, accountID, domainID, username, passwordHash, quotaMB, now, now)

	if err != nil {
		return fmt.Errorf("failed to create email account: %w", err)
	}

	fmt.Printf("✓ Email account created: %s\n", username)
	return nil
}

// DeleteEmailAccount deletes an email account
func (a *Agent) DeleteEmailAccount(accountID string) error {
	fmt.Printf("🗑️  Deleting email account: %s\n", accountID)

	_, err := a.db.Exec(`DELETE FROM email_accounts WHERE id = ?`, accountID)
	if err != nil {
		return fmt.Errorf("failed to delete email account: %w", err)
	}

	fmt.Printf("✓ Email account deleted\n")
	return nil
}

// ListEmailAccounts lists email accounts for a domain
func (a *Agent) ListEmailAccounts(domainID string) ([]EmailAccount, error) {
	fmt.Printf("📋 Listing email accounts for domain: %s\n", domainID)

	rows, err := a.db.Query(`
		SELECT id, username, quota_mb, used_mb, status, created_at
		FROM email_accounts WHERE domain_id = ?
		ORDER BY username
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("failed to list email accounts: %w", err)
	}
	defer rows.Close()

	var accounts []EmailAccount
	for rows.Next() {
		var acc EmailAccount
		err := rows.Scan(&acc.ID, &acc.Username, &acc.QuotaMB, &acc.UsedMB, &acc.Status, &acc.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan account: %w", err)
		}
		accounts = append(accounts, acc)
	}

	fmt.Printf("✓ Found %d email accounts\n", len(accounts))
	return accounts, nil
}

// DNS OPERATIONS
// ─────────────────────────────────────────────────────────────

// CreateDNSRecord creates a DNS record
func (a *Agent) CreateDNSRecord(domainID, recordType, name, value string, ttl int) error {
	fmt.Printf("📍 Creating DNS record: %s.%s %s\n", name, domainID, recordType)

	if !isValidDNSType(recordType) {
		return fmt.Errorf("invalid DNS record type: %s", recordType)
	}

	recordID := generateID()
	now := time.Now()

	_, err := a.db.Exec(`
		INSERT INTO dns_records (id, domain_id, type, name, value, ttl, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
	`, recordID, domainID, recordType, name, value, ttl, now, now)

	if err != nil {
		return fmt.Errorf("failed to create DNS record: %w", err)
	}

	fmt.Printf("✓ DNS record created\n")
	return nil
}

// DeleteDNSRecord deletes a DNS record
func (a *Agent) DeleteDNSRecord(recordID string) error {
	fmt.Printf("🗑️  Deleting DNS record: %s\n", recordID)

	_, err := a.db.Exec(`DELETE FROM dns_records WHERE id = ?`, recordID)
	if err != nil {
		return fmt.Errorf("failed to delete DNS record: %w", err)
	}

	fmt.Printf("✓ DNS record deleted\n")
	return nil
}

// ListDNSRecords lists DNS records for a domain
func (a *Agent) ListDNSRecords(domainID string) ([]DNSRecord, error) {
	fmt.Printf("📋 Listing DNS records for domain: %s\n", domainID)

	rows, err := a.db.Query(`
		SELECT id, type, name, value, ttl, status, created_at
		FROM dns_records WHERE domain_id = ?
		ORDER BY name
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("failed to list DNS records: %w", err)
	}
	defer rows.Close()

	var records []DNSRecord
	for rows.Next() {
		var rec DNSRecord
		err := rows.Scan(&rec.ID, &rec.Type, &rec.Name, &rec.Value, &rec.TTL, &rec.Status, &rec.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan record: %w", err)
		}
		records = append(records, rec)
	}

	fmt.Printf("✓ Found %d DNS records\n", len(records))
	return records, nil
}

// SERVICE OPERATIONS
// ─────────────────────────────────────────────────────────────

// RestartService restarts a system service
func (a *Agent) RestartService(serviceName string) error {
	fmt.Printf("🔄 Restarting service: %s\n", serviceName)

	// Validate service name
	if !isValidServiceName(serviceName) {
		return fmt.Errorf("invalid service name: %s", serviceName)
	}

	cmd := exec.Command("systemctl", "restart", serviceName)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to restart %s: %w", serviceName, err)
	}

	// Update database
	_, err := a.db.Exec(`
		UPDATE services SET status = 'running', last_check = ?, updated_at = ?
		WHERE name = ?
	`, time.Now(), time.Now(), serviceName)

	fmt.Printf("✓ Service restarted: %s\n", serviceName)
	return err
}

// GetServiceStatus gets the status of a service
func (a *Agent) GetServiceStatus(serviceName string) (string, error) {
	fmt.Printf("📊 Getting service status: %s\n", serviceName)

	cmd := exec.Command("systemctl", "is-active", serviceName)
	output, _ := cmd.Output()
	status := strings.TrimSpace(string(output))

	// Update database
	_, err := a.db.Exec(`
		UPDATE services SET status = ?, last_check = ?, updated_at = ?
		WHERE name = ?
	`, status, time.Now(), time.Now(), serviceName)

	fmt.Printf("✓ Service status: %s\n", status)
	return status, err
}

// SYSTEM OPERATIONS
// ─────────────────────────────────────────────────────────────

// GetSystemInfo gets system information
func (a *Agent) GetSystemInfo() (map[string]interface{}, error) {
	fmt.Println("📊 Getting system information...")

	info := make(map[string]interface{})

	// Get uptime
	uptime, err := exec.Command("uptime", "-p").Output()
	if err == nil {
		info["uptime"] = strings.TrimSpace(string(uptime))
	}

	// Get disk usage
	diskUsage, err := exec.Command("df", "-h", "/").Output()
	if err == nil {
		info["disk"] = strings.TrimSpace(string(diskUsage))
	}

	// Get memory usage
	memInfo, err := exec.Command("free", "-h").Output()
	if err == nil {
		info["memory"] = strings.TrimSpace(string(memInfo))
	}

	// Get CPU info
	cpuInfo, err := exec.Command("nproc").Output()
	if err == nil {
		info["cpu_cores"] = strings.TrimSpace(string(cpuInfo))
	}

	return info, nil
}

// BackupDomain backs up a domain
func (a *Agent) BackupDomain(domainID string) error {
	fmt.Printf("💾 Backing up domain: %s\n", domainID)

	var webRoot string
	err := a.db.QueryRow(`SELECT web_root FROM domains WHERE id = ?`, domainID).Scan(&webRoot)
	if err != nil {
		return fmt.Errorf("domain not found: %w", err)
	}

	backupDir := fmt.Sprintf("/var/backups/npanel/%s-%d", domainID, time.Now().Unix())

	cmd := exec.Command("tar", "-czf", backupDir+".tar.gz", webRoot)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to backup domain: %w", err)
	}

	fmt.Printf("✓ Domain backed up to: %s.tar.gz\n", backupDir)
	return nil
}

// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

func isValidDomain(domain string) bool {
	if len(domain) == 0 || len(domain) > 255 {
		return false
	}
	if !strings.Contains(domain, ".") {
		return false
	}
	return true
}

func isValidDNSType(recordType string) bool {
	validTypes := map[string]bool{
		"A":     true,
		"AAAA":  true,
		"CNAME": true,
		"MX":    true,
		"NS":    true,
		"TXT":   true,
		"SRV":   true,
		"SOA":   true,
	}
	return validTypes[strings.ToUpper(recordType)]
}

func isValidServiceName(serviceName string) bool {
	validServices := map[string]bool{
		"nginx":   true,
		"postfix": true,
		"dovecot": true,
		"bind":    true,
		"mysql":   true,
	}
	return validServices[serviceName]
}

func createWebRoot(path string) error {
	cmd := exec.Command("mkdir", "-p", path)
	return cmd.Run()
}

func removeWebRoot(path string) error {
	cmd := exec.Command("rm", "-rf", path)
	return cmd.Run()
}
