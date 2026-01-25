package main

import (
	"database/sql"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DNSService handles DNS zone and record management via PowerDNS
type DNSService struct {
	db           *sql.DB
	auditLog     func(action, resource, user string, result bool, details string)
	pdnsAPI      string // PowerDNS API endpoint (e.g., http://localhost:8001)
	pdnsKey      string // PowerDNS API key (from environment)
	backupDir    string
}

// Zone represents a DNS zone
type Zone struct {
	Name      string
	Type      string // "Zone", "Account"
	Serial    int64
	CreatedAt time.Time
	Enabled   bool
}

// Record represents a DNS record
type Record struct {
	Name     string
	Type     string // A, AAAA, MX, CNAME, TXT, NS, SOA
	Content  string
	TTL      int
	Priority int
	Disabled bool
}

// NewDNSService creates a new DNS service instance
func NewDNSService(db *sql.DB, auditLog func(string, string, string, bool, string), config map[string]interface{}) *DNSService {
	pdnsAPI := "http://localhost:8001"
	if v, ok := config["pdns_api"].(string); ok && v != "" {
		pdnsAPI = v
	}

	pdnsKey := ""
	if v, ok := config["pdns_key"].(string); ok {
		pdnsKey = v
	}

	backupDir := "/var/backups/dns"
	if v, ok := config["backup_dir"].(string); ok && v != "" {
		backupDir = v
	}

	return &DNSService{
		db:       db,
		auditLog: auditLog,
		pdnsAPI:  pdnsAPI,
		pdnsKey:  pdnsKey,
		backupDir: backupDir,
	}
}

// CreateZone creates a new DNS zone
// Agent action: dns_create_zone
// Requires: admin role
// Audit: Yes
func (ds *DNSService) CreateZone(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	zoneName, ok := params["zone"].(string)
	if !ok || zoneName == "" {
		return errorResponse("zone parameter required")
	}

	// ====== INPUT VALIDATION ======
	// Remove trailing dot if present
	zoneName = strings.TrimSuffix(zoneName, ".")
	
	// Validate domain name
	domainRegex := regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`)
	if !domainRegex.MatchString(zoneName) {
		ds.auditLog("dns_create_zone", zoneName, ctx.User, false, "Invalid zone name")
		return errorResponse("invalid zone name")
	}

	// Check for DNS name injection
	if strings.Contains(zoneName, "..") || strings.Contains(zoneName, "-.") || strings.Contains(zoneName, ".-") {
		ds.auditLog("dns_create_zone", zoneName, ctx.User, false, "Invalid zone name pattern")
		return errorResponse("invalid zone name pattern")
	}

	// ====== ZONE BACKUP (if exists) ======
	// Code to export existing zone before recreation...

	// ====== DATABASE ZONE CREATION (PARAMETERIZED) ======
	// Check if zone already exists
	var existingZone string
	err := ds.db.QueryRow("SELECT name FROM dns_zones WHERE name = ?", zoneName).Scan(&existingZone)
	if err == nil {
		ds.auditLog("dns_create_zone", zoneName, ctx.User, false, "Zone already exists")
		return errorResponse("zone already exists")
	}

	// Insert zone with initial serial
	serial := time.Now().Unix()
	result, err := ds.db.Exec(
		"INSERT INTO dns_zones (name, serial, type, enabled, created_at) VALUES (?, ?, ?, ?, ?)",
		zoneName,      // Parameter 1
		serial,        // Parameter 2
		"Zone",        // Parameter 3
		true,          // Parameter 4
		time.Now())    // Parameter 5

	if err != nil {
		ds.auditLog("dns_create_zone", zoneName, ctx.User, false, "Database insert failed")
		return errorResponse("database operation failed")
	}

	zoneID, _ := result.LastInsertId()

	// ====== CREATE SOA RECORD (PARAMETERIZED) ======
	soaContent := fmt.Sprintf("ns1.%s. hostmaster.%s. %d 10800 3600 604800 3600", zoneName, zoneName, serial)
	_, err = ds.db.Exec(
		"INSERT INTO dns_records (zone_id, name, type, content, ttl) VALUES (?, ?, ?, ?, ?)",
		zoneID,        // Parameter 1
		zoneName,      // Parameter 2
		"SOA",         // Parameter 3
		soaContent,    // Parameter 4
		3600)          // Parameter 5 (TTL)

	if err != nil {
		ds.db.Exec("DELETE FROM dns_zones WHERE id = ?", zoneID)
		ds.auditLog("dns_create_zone", zoneName, ctx.User, false, "SOA creation failed")
		return errorResponse("SOA record creation failed")
	}

	ds.auditLog("dns_create_zone", zoneName, ctx.User, true, 
		fmt.Sprintf("Zone created with serial %d", serial))

	return map[string]interface{}{
		"success": true,
		"zone":    zoneName,
		"zone_id": zoneID,
		"serial":  serial,
		"created_at": time.Now(),
	}
}

// AddRecord adds a DNS record to a zone
// Agent action: dns_add_record
// Requires: user role
// Audit: Yes
func (ds *DNSService) AddRecord(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	zoneName, ok := params["zone"].(string)
	if !ok || zoneName == "" {
		return errorResponse("zone parameter required")
	}

	recordName, ok := params["name"].(string)
	if !ok || recordName == "" {
		return errorResponse("name parameter required")
	}

	recordType, ok := params["type"].(string)
	if !ok || recordType == "" {
		return errorResponse("type parameter required")
	}

	content, ok := params["content"].(string)
	if !ok || content == "" {
		return errorResponse("content parameter required")
	}

	ttlVal, ok := params["ttl"].(float64)
	if !ok {
		ttlVal = 3600 // Default 1 hour
	}
	ttl := int(ttlVal)

	// ====== INPUT VALIDATION ======
	// Validate zone name
	zoneName = strings.TrimSuffix(zoneName, ".")
	domainRegex := regexp.MustCompile(`^[a-zA-Z0-9.-]{1,255}$`)
	if !domainRegex.MatchString(zoneName) {
		return errorResponse("invalid zone name")
	}

	// Validate record name
	if !domainRegex.MatchString(recordName) && recordName != "@" {
		return errorResponse("invalid record name")
	}

	// Validate record type
	validTypes := map[string]bool{"A": true, "AAAA": true, "MX": true, "CNAME": true, "TXT": true, "NS": true, "SPF": true, "SRV": true}
	if !validTypes[recordType] {
		return errorResponse("invalid record type")
	}

	// Record-specific validation
	switch recordType {
	case "A":
		if net.ParseIP(content) == nil || net.ParseIP(content).To4() == nil {
			return errorResponse("invalid IPv4 address")
		}
	case "AAAA":
		if net.ParseIP(content) == nil || net.ParseIP(content).To4() != nil {
			return errorResponse("invalid IPv6 address")
		}
	case "CNAME":
		if !domainRegex.MatchString(content) {
			return errorResponse("invalid CNAME target")
		}
	case "MX":
		parts := strings.Fields(content)
		if len(parts) != 2 {
			return errorResponse("MX content must be: priority hostname")
		}
		if _, err := strconv.Atoi(parts[0]); err != nil {
			return errorResponse("MX priority must be numeric")
		}
	case "TXT":
		if len(content) > 255 {
			return errorResponse("TXT record too long")
		}
	}

	// TTL validation (60-86400 seconds)
	if ttl < 60 || ttl > 86400 {
		return errorResponse("TTL must be between 60 and 86400 seconds")
	}

	// ====== GET ZONE ID (PARAMETERIZED) ======
	var zoneID int64
	err := ds.db.QueryRow("SELECT id FROM dns_zones WHERE name = ?", zoneName).Scan(&zoneID)
	if err != nil {
		return errorResponse("zone not found")
	}

	// ====== INCREMENT SOA SERIAL ======
	serial := time.Now().Unix()
	_, err = ds.db.Exec(
		"UPDATE dns_zones SET serial = ? WHERE id = ?",
		serial,
		zoneID)

	// ====== INSERT RECORD (PARAMETERIZED) ======
	result, err := ds.db.Exec(
		"INSERT INTO dns_records (zone_id, name, type, content, ttl, disabled) VALUES (?, ?, ?, ?, ?, ?)",
		zoneID,        // Parameter 1
		recordName,    // Parameter 2
		recordType,    // Parameter 3
		content,       // Parameter 4
		ttl,           // Parameter 5
		false)         // Parameter 6

	if err != nil {
		ds.auditLog("dns_add_record", zoneName, ctx.User, false, "Insert failed")
		return errorResponse("database operation failed")
	}

	recordID, _ := result.LastInsertId()

	ds.auditLog("dns_add_record", zoneName, ctx.User, true, 
		fmt.Sprintf("Record added: %s IN %s %s", recordName, recordType, content))

	return map[string]interface{}{
		"success":   true,
		"zone":      zoneName,
		"record_id": recordID,
		"name":      recordName,
		"type":      recordType,
		"content":   content,
		"ttl":       ttl,
		"serial":    serial,
	}
}

// DeleteRecord deletes a DNS record
// Agent action: dns_delete_record
// Requires: user role
// Audit: Yes
func (ds *DNSService) DeleteRecord(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	zoneName, ok := params["zone"].(string)
	if !ok || zoneName == "" {
		return errorResponse("zone parameter required")
	}

	recordID, ok := params["record_id"].(float64)
	if !ok {
		return errorResponse("record_id parameter required")
	}

	// ====== INPUT VALIDATION ======
	zoneName = strings.TrimSuffix(zoneName, ".")

	// ====== GET ZONE ID & VERIFY OWNERSHIP (PARAMETERIZED) ======
	var zoneID int64
	var recordName string
	var recordType string

	err := ds.db.QueryRow(
		"SELECT z.id, r.name, r.type FROM dns_zones z JOIN dns_records r ON z.id = r.zone_id WHERE z.name = ? AND r.id = ?",
		zoneName,
		int64(recordID)).Scan(&zoneID, &recordName, &recordType)

	if err != nil {
		ds.auditLog("dns_delete_record", zoneName, ctx.User, false, "Record not found")
		return errorResponse("record not found")
	}

	// Prevent SOA deletion
	if recordType == "SOA" {
		ds.auditLog("dns_delete_record", zoneName, ctx.User, false, "Cannot delete SOA record")
		return errorResponse("cannot delete SOA record")
	}

	// ====== INCREMENT SERIAL ======
	serial := time.Now().Unix()
	ds.db.Exec("UPDATE dns_zones SET serial = ? WHERE id = ?", serial, zoneID)

	// ====== DELETE RECORD (PARAMETERIZED) ======
	result, err := ds.db.Exec("DELETE FROM dns_records WHERE id = ? AND zone_id = ?", 
		int64(recordID), zoneID)

	if err != nil {
		ds.auditLog("dns_delete_record", zoneName, ctx.User, false, "Delete failed")
		return errorResponse("database operation failed")
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errorResponse("record not found")
	}

	ds.auditLog("dns_delete_record", zoneName, ctx.User, true, 
		fmt.Sprintf("Deleted: %s IN %s", recordName, recordType))

	return map[string]interface{}{
		"success": true,
		"zone":    zoneName,
		"serial":  serial,
	}
}

// ListRecords lists all records in a zone
// Agent action: dns_list_records
// Requires: user role
// Audit: No
func (ds *DNSService) ListRecords(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	zoneName, ok := params["zone"].(string)
	if !ok || zoneName == "" {
		return errorResponse("zone parameter required")
	}

	// ====== INPUT VALIDATION ======
	zoneName = strings.TrimSuffix(zoneName, ".")

	// ====== QUERY RECORDS (PARAMETERIZED) ======
	query := `SELECT r.id, r.name, r.type, r.content, r.ttl, r.disabled 
	         FROM dns_records r 
	         JOIN dns_zones z ON r.zone_id = z.id 
	         WHERE z.name = ? 
	         ORDER BY r.name, r.type`

	rows, err := ds.db.Query(query, zoneName)
	if err != nil {
		return errorResponse("database query failed")
	}
	defer rows.Close()

	var records []map[string]interface{}
	for rows.Next() {
		var id int64
		var name, rType, content string
		var ttl int
		var disabled bool

		if err := rows.Scan(&id, &name, &rType, &content, &ttl, &disabled); err != nil {
			continue
		}

		records = append(records, map[string]interface{}{
			"id":       id,
			"name":     name,
			"type":     rType,
			"content":  content,
			"ttl":      ttl,
			"disabled": disabled,
		})
	}

	return map[string]interface{}{
		"success": true,
		"zone":    zoneName,
		"count":   len(records),
		"records": records,
	}
}

// ValidateRecords validates all records in a zone
// Agent action: dns_validate_records
// Requires: user role
// Audit: Yes
func (ds *DNSService) ValidateRecords(ctx *ActionContext, params map[string]interface{}) map[string]interface{} {
	zoneName, ok := params["zone"].(string)
	if !ok || zoneName == "" {
		return errorResponse("zone parameter required")
	}

	zoneName = strings.TrimSuffix(zoneName, ".")

	// ====== QUERY ALL RECORDS ======
	query := `SELECT r.name, r.type, r.content FROM dns_records r 
	         JOIN dns_zones z ON r.zone_id = z.id WHERE z.name = ?`

	rows, err := ds.db.Query(query, zoneName)
	if err != nil {
		return errorResponse("database query failed")
	}
	defer rows.Close()

	var errors []string
	var warnings []string

	for rows.Next() {
		var name, rType, content string
		if err := rows.Scan(&name, &rType, &content); err != nil {
			continue
		}

		// Validate each record
		switch rType {
		case "A":
			if net.ParseIP(content) == nil || net.ParseIP(content).To4() == nil {
				errors = append(errors, fmt.Sprintf("%s: invalid A record %s", name, content))
			}
		case "AAAA":
			if net.ParseIP(content) == nil {
				errors = append(errors, fmt.Sprintf("%s: invalid AAAA record %s", name, content))
			}
		case "CNAME":
			if strings.Count(content, ".") < 1 {
				warnings = append(warnings, fmt.Sprintf("%s: CNAME may be invalid: %s", name, content))
			}
		}
	}

	ds.auditLog("dns_validate_records", zoneName, ctx.User, true, 
		fmt.Sprintf("Validation complete: %d errors, %d warnings", len(errors), len(warnings)))

	return map[string]interface{}{
		"success":  true,
		"zone":     zoneName,
		"errors":   errors,
		"warnings": warnings,
		"valid":    len(errors) == 0,
	}
}
