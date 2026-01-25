package main

import (
	"database/sql"
	"fmt"
	"time"
)

// InitDB initializes the database schema
func InitDB(db *sql.DB) error {
	schema := `
-- Users table
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT UNIQUE NOT NULL,
	password_hash TEXT NOT NULL,
	full_name TEXT,
	role TEXT NOT NULL DEFAULT 'user',
	status TEXT NOT NULL DEFAULT 'active',
	mfa_enabled BOOLEAN DEFAULT FALSE,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	key_hash TEXT UNIQUE NOT NULL,
	name TEXT NOT NULL,
	last_used DATETIME,
	expires_at DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Domains table
CREATE TABLE IF NOT EXISTS domains (
	id TEXT PRIMARY KEY,
	name TEXT UNIQUE NOT NULL,
	owner_id TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active',
	dns_nameserver TEXT,
	mail_server TEXT,
	web_root TEXT,
	disk_limit_gb INTEGER DEFAULT 10,
	disk_used_gb REAL DEFAULT 0,
	bandwidth_limit_gb INTEGER DEFAULT 100,
	bandwidth_used_gb REAL DEFAULT 0,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
	INDEX idx_owner (owner_id),
	UNIQUE(name)
);

-- Email Accounts table
CREATE TABLE IF NOT EXISTS email_accounts (
	id TEXT PRIMARY KEY,
	domain_id TEXT NOT NULL,
	username TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	quota_mb INTEGER DEFAULT 1024,
	used_mb REAL DEFAULT 0,
	forwarding_addresses TEXT,
	status TEXT NOT NULL DEFAULT 'active',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
	UNIQUE(domain_id, username),
	INDEX idx_domain (domain_id)
);

-- DNS Records table
CREATE TABLE IF NOT EXISTS dns_records (
	id TEXT PRIMARY KEY,
	domain_id TEXT NOT NULL,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	value TEXT NOT NULL,
	ttl INTEGER DEFAULT 3600,
	priority INTEGER,
	status TEXT NOT NULL DEFAULT 'active',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
	INDEX idx_domain (domain_id),
	UNIQUE(domain_id, type, name)
);

-- SSL Certificates table
CREATE TABLE IF NOT EXISTS ssl_certificates (
	id TEXT PRIMARY KEY,
	domain_id TEXT NOT NULL,
	certificate_pem TEXT NOT NULL,
	private_key_pem TEXT NOT NULL,
	issuer TEXT,
	expires_at DATETIME,
	auto_renew BOOLEAN DEFAULT FALSE,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
	INDEX idx_domain (domain_id)
);

-- Databases table (MySQL/PostgreSQL user databases)
CREATE TABLE IF NOT EXISTS databases (
	id TEXT PRIMARY KEY,
	domain_id TEXT NOT NULL,
	name TEXT NOT NULL,
	db_type TEXT NOT NULL,
	owner_username TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	size_mb REAL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'active',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
	UNIQUE(domain_id, name),
	INDEX idx_domain (domain_id)
);

-- Audit Log table
CREATE TABLE IF NOT EXISTS audit_logs (
	id TEXT PRIMARY KEY,
	user_id TEXT,
	action TEXT NOT NULL,
	resource_type TEXT,
	resource_id TEXT,
	details TEXT,
	result TEXT NOT NULL,
	ip_address TEXT,
	user_agent TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
	INDEX idx_user (user_id),
	INDEX idx_resource (resource_type, resource_id),
	INDEX idx_created (created_at)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	refresh_token TEXT UNIQUE NOT NULL,
	ip_address TEXT,
	user_agent TEXT,
	expires_at DATETIME NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	INDEX idx_user (user_id),
	INDEX idx_expires (expires_at)
);

-- Jobs table (for async operations)
CREATE TABLE IF NOT EXISTS jobs (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	action TEXT NOT NULL,
	resource_type TEXT,
	resource_id TEXT,
	params TEXT,
	status TEXT NOT NULL DEFAULT 'pending',
	result TEXT,
	error_message TEXT,
	progress_percent INTEGER DEFAULT 0,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	started_at DATETIME,
	completed_at DATETIME,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	INDEX idx_user (user_id),
	INDEX idx_status (status),
	INDEX idx_created (created_at)
);

-- Services table (for monitoring)
CREATE TABLE IF NOT EXISTS services (
	id TEXT PRIMARY KEY,
	name TEXT UNIQUE NOT NULL,
	status TEXT NOT NULL DEFAULT 'running',
	last_check DATETIME,
	restart_count INTEGER DEFAULT 0,
	error_message TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_status (status)
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_domains_owner ON domains(owner_id);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_emails_domain ON email_accounts(domain_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON email_accounts(status);
`

	// Execute schema
	_, err := db.Exec(schema)
	if err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	return nil
}

// User model
type User struct {
	ID           string    `db:"id"`
	Email        string    `db:"email"`
	PasswordHash string    `db:"password_hash"`
	FullName     string    `db:"full_name"`
	Role         string    `db:"role"`
	Status       string    `db:"status"`
	MFAEnabled   bool      `db:"mfa_enabled"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

// Domain model
type Domain struct {
	ID               string    `db:"id"`
	Name             string    `db:"name"`
	OwnerID          string    `db:"owner_id"`
	Status           string    `db:"status"`
	DNSNameserver    string    `db:"dns_nameserver"`
	MailServer       string    `db:"mail_server"`
	WebRoot          string    `db:"web_root"`
	DiskLimitGB      int       `db:"disk_limit_gb"`
	DiskUsedGB       float64   `db:"disk_used_gb"`
	BandwidthLimitGB int       `db:"bandwidth_limit_gb"`
	BandwidthUsedGB  float64   `db:"bandwidth_used_gb"`
	CreatedAt        time.Time `db:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"`
}

// EmailAccount model
type EmailAccount struct {
	ID                  string    `db:"id"`
	DomainID            string    `db:"domain_id"`
	Username            string    `db:"username"`
	PasswordHash        string    `db:"password_hash"`
	QuotaMB             int       `db:"quota_mb"`
	UsedMB              float64   `db:"used_mb"`
	ForwardingAddresses string    `db:"forwarding_addresses"`
	Status              string    `db:"status"`
	CreatedAt           time.Time `db:"created_at"`
	UpdatedAt           time.Time `db:"updated_at"`
}

// DNSRecord model
type DNSRecord struct {
	ID        string    `db:"id"`
	DomainID  string    `db:"domain_id"`
	Type      string    `db:"type"`
	Name      string    `db:"name"`
	Value     string    `db:"value"`
	TTL       int       `db:"ttl"`
	Priority  *int      `db:"priority"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

// Database model
type Database struct {
	ID              string    `db:"id"`
	DomainID        string    `db:"domain_id"`
	Name            string    `db:"name"`
	DBType          string    `db:"db_type"`
	OwnerUsername   string    `db:"owner_username"`
	PasswordHash    string    `db:"password_hash"`
	SizeMB          float64   `db:"size_mb"`
	Status          string    `db:"status"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

// AuditLog model
type AuditLog struct {
	ID           string    `db:"id"`
	UserID       *string   `db:"user_id"`
	Action       string    `db:"action"`
	ResourceType string    `db:"resource_type"`
	ResourceID   string    `db:"resource_id"`
	Details      string    `db:"details"`
	Result       string    `db:"result"`
	IPAddress    string    `db:"ip_address"`
	UserAgent    string    `db:"user_agent"`
	CreatedAt    time.Time `db:"created_at"`
}

// Job model
type Job struct {
	ID            string    `db:"id"`
	UserID        string    `db:"user_id"`
	Action        string    `db:"action"`
	ResourceType  string    `db:"resource_type"`
	ResourceID    string    `db:"resource_id"`
	Params        string    `db:"params"`
	Status        string    `db:"status"`
	Result        string    `db:"result"`
	ErrorMessage  string    `db:"error_message"`
	ProgressPercent int    `db:"progress_percent"`
	CreatedAt     time.Time `db:"created_at"`
	StartedAt     *time.Time `db:"started_at"`
	CompletedAt   *time.Time `db:"completed_at"`
}

// Session model
type Session struct {
	ID           string    `db:"id"`
	UserID       string    `db:"user_id"`
	RefreshToken string    `db:"refresh_token"`
	IPAddress    string    `db:"ip_address"`
	UserAgent    string    `db:"user_agent"`
	ExpiresAt    time.Time `db:"expires_at"`
	CreatedAt    time.Time `db:"created_at"`
}
