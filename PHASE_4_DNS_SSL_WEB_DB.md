# Phase 4: DNS, SSL, Web Server, Database Implementation

**Date:** January 25, 2026  

---

## PRIORITY 2: DNS Management (PowerDNS)

### Agent Actions

```go
// DNSService - DNS management operations
type DNSService struct {
    API       string // PowerDNS API endpoint
    Zone      string // Zone name
    SOA       string // SOA record defaults
    AuditLog  *AuditLog
}

// 1. ZONE MANAGEMENT
func (d *DNSService) CreateZone(request *CreateZoneRequest) error {
    // Validation
    if err := ValidateDomain(request.Domain); err != nil {
        return fmt.Errorf("invalid domain: %w", err)
    }
    
    if request.Type != "native" && request.Type != "slave" {
        return fmt.Errorf("invalid zone type: %s", request.Type)
    }
    
    // Backup existing zone (if exists)
    backup := NewBackup(fmt.Sprintf("/etc/powerdns/zones/%s", request.Domain))
    backup.Create()
    
    // Create zone object
    zone := &DNSZone{
        Name:      request.Domain,
        Type:      request.Type,
        Nameservers: request.Nameservers,
        SOA:       request.SOA,
        CreatedAt: time.Now(),
    }
    
    // Create zone via PowerDNS API
    if err := d.createZoneAPI(zone); err != nil {
        backup.Restore()
        return fmt.Errorf("failed to create zone: %w", err)
    }
    
    // Initialize SOA record
    if err := d.addRecord(&DNSRecord{
        Zone:     request.Domain,
        Name:     request.Domain,
        Type:     "SOA",
        Content:  fmt.Sprintf("ns1.%s postmaster.%s 1 10800 3600 604800 3600", request.Domain, request.Domain),
        TTL:      3600,
    }); err != nil {
        d.deleteZoneAPI(request.Domain)
        backup.Restore()
        return fmt.Errorf("failed to add SOA: %w", err)
    }
    
    // Add nameserver records
    for _, ns := range request.Nameservers {
        if err := d.addRecord(&DNSRecord{
            Zone:     request.Domain,
            Name:     request.Domain,
            Type:     "NS",
            Content:  ns,
            TTL:      3600,
        }); err != nil {
            return fmt.Errorf("failed to add NS record: %w", err)
        }
    }
    
    d.AuditLog.LogSuccess("CreateZone", request.Domain, zone)
    return nil
}

// 2. RECORD MANAGEMENT
func (d *DNSService) AddRecord(request *AddRecordRequest) error {
    // Validation
    if err := ValidateDomain(request.Zone); err != nil {
        return fmt.Errorf("invalid domain: %w", err)
    }
    
    if !IsValidDNSType(request.Type) {
        return fmt.Errorf("invalid record type: %s", request.Type)
    }
    
    // Validate record content
    if err := d.validateRecordContent(request.Type, request.Content); err != nil {
        return fmt.Errorf("invalid record content: %w", err)
    }
    
    // Backup zone
    backup := NewBackup(fmt.Sprintf("/etc/powerdns/zones/%s", request.Zone))
    backup.Create()
    
    // Add record via API
    record := &DNSRecord{
        Zone:    request.Zone,
        Name:    request.Name,
        Type:    request.Type,
        Content: request.Content,
        TTL:     request.TTL,
    }
    
    if err := d.addRecordAPI(record); err != nil {
        backup.Restore()
        return fmt.Errorf("failed to add record: %w", err)
    }
    
    // Increment SOA serial
    if err := d.incrementSOASerial(request.Zone); err != nil {
        backup.Restore()
        return fmt.Errorf("failed to update SOA: %w", err)
    }
    
    // Reload zone
    d.reloadZone(request.Zone)
    
    d.AuditLog.LogSuccess("AddRecord", request.Zone, record)
    return nil
}

// 3. RECORD DELETION
func (d *DNSService) DeleteRecord(request *DeleteRecordRequest) error {
    if err := ValidateDomain(request.Zone); err != nil {
        return fmt.Errorf("invalid domain: %w", err)
    }
    
    // CRITICAL: Backup before deletion
    backup := NewBackup(fmt.Sprintf("/etc/powerdns/zones/%s", request.Zone))
    backup.Create()
    
    // Delete via API
    if err := d.deleteRecordAPI(request.Zone, request.RecordID); err != nil {
        backup.Restore()
        return fmt.Errorf("failed to delete record: %w", err)
    }
    
    // Increment SOA serial
    if err := d.incrementSOASerial(request.Zone); err != nil {
        backup.Restore()
        return fmt.Errorf("failed to update SOA: %w", err)
    }
    
    d.reloadZone(request.Zone)
    d.AuditLog.LogSuccess("DeleteRecord", request.Zone, map[string]string{"record_id": request.RecordID})
    return nil
}

// 4. ZONE IMPORT
func (d *DNSService) ImportZone(request *ImportZoneRequest) error {
    // Parse zone file
    records, err := parseZoneFile(request.ZoneFileContent)
    if err != nil {
        return fmt.Errorf("failed to parse zone file: %w", err)
    }
    
    // Validate all records before import
    for _, rec := range records {
        if err := d.validateRecordContent(rec.Type, rec.Content); err != nil {
            return fmt.Errorf("invalid record: %s %s: %w", rec.Name, rec.Type, err)
        }
    }
    
    // Create zone
    if err := d.CreateZone(&CreateZoneRequest{
        Domain:      request.Domain,
        Type:        "native",
        Nameservers: request.Nameservers,
    }); err != nil {
        return err
    }
    
    // Import all records
    for _, rec := range records {
        if err := d.addRecordAPI(rec); err != nil {
            return fmt.Errorf("failed to import record: %w", err)
        }
    }
    
    d.reloadZone(request.Domain)
    d.AuditLog.LogSuccess("ImportZone", request.Domain, map[string]int{"records": len(records)})
    return nil
}

// 5. RECORD VALIDATION
func (d *DNSService) ValidateRecords(domain string) ([]ValidationError, error) {
    records, err := d.listRecordsAPI(domain)
    if err != nil {
        return nil, fmt.Errorf("failed to list records: %w", err)
    }
    
    var errors []ValidationError
    for _, rec := range records {
        if err := d.validateRecordContent(rec.Type, rec.Content); err != nil {
            errors = append(errors, ValidationError{
                Record: fmt.Sprintf("%s %s", rec.Name, rec.Type),
                Error:  err.Error(),
            })
        }
    }
    
    return errors, nil
}

// 6. DNSSEC MANAGEMENT
func (d *DNSService) EnableDNSSEC(domain string) error {
    // Generate DNSSEC keys
    cmd := exec.Command("pdnsutil", "secure-zone", domain)
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("failed to enable DNSSEC: %s", string(output))
    }
    
    // Add DNSKEY records to zone
    d.reloadZone(domain)
    d.AuditLog.LogSuccess("EnableDNSSEC", domain, nil)
    return nil
}

func (d *DNSService) RotateDNSECKeys(domain string) error {
    cmd := exec.Command("pdnsutil", "increase-zone-serial", domain)
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("failed to rotate keys: %s", string(output))
    }
    
    cmd = exec.Command("pdnsutil", "rectify-zone", domain)
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("failed to rectify zone: %s", string(output))
    }
    
    d.reloadZone(domain)
    d.AuditLog.LogSuccess("RotateDNSECKeys", domain, nil)
    return nil
}

// 7. RECORD LISTING
func (d *DNSService) ListRecords(domain string) ([]DNSRecord, error) {
    records, err := d.listRecordsAPI(domain)
    if err != nil {
        return nil, fmt.Errorf("failed to list records: %w", err)
    }
    return records, nil
}

// INTERNAL HELPERS

func (d *DNSService) validateRecordContent(recordType, content string) error {
    switch recordType {
    case "A":
        return validateIPv4(content)
    case "AAAA":
        return validateIPv6(content)
    case "MX":
        return validateMXRecord(content)
    case "CNAME":
        return validateCNAME(content)
    case "TXT":
        return validateTXTRecord(content)
    case "NS":
        return validateNameserver(content)
    case "SOA":
        return validateSOARecord(content)
    default:
        return fmt.Errorf("unsupported record type: %s", recordType)
    }
}

func (d *DNSService) createZoneAPI(zone *DNSZone) error {
    // Call PowerDNS API
    data := map[string]interface{}{
        "kind": zone.Type,
        "name": zone.Name,
    }
    
    jsonData, _ := json.Marshal(data)
    req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/v1/servers/localhost/zones", d.API), bytes.NewBuffer(jsonData))
    req.Header.Set("X-API-Key", os.Getenv("POWERDNS_API_KEY"))
    req.Header.Set("Content-Type", "application/json")
    
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode >= 400 {
        body, _ := ioutil.ReadAll(resp.Body)
        return fmt.Errorf("API error: %s", string(body))
    }
    
    return nil
}

func (d *DNSService) addRecordAPI(record *DNSRecord) error {
    // Use PowerDNS API to add record
    rrsets := map[string]interface{}{
        "rrsets": []map[string]interface{}{
            {
                "name":       record.Name,
                "type":       record.Type,
                "ttl":        record.TTL,
                "changetype": "REPLACE",
                "records": []map[string]interface{}{
                    {
                        "content": record.Content,
                        "disabled": false,
                    },
                },
            },
        },
    }
    
    jsonData, _ := json.Marshal(rrsets)
    req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/api/v1/servers/localhost/zones/%s", d.API, record.Zone), bytes.NewBuffer(jsonData))
    req.Header.Set("X-API-Key", os.Getenv("POWERDNS_API_KEY"))
    req.Header.Set("Content-Type", "application/json")
    
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode >= 400 {
        body, _ := ioutil.ReadAll(resp.Body)
        return fmt.Errorf("API error: %s", string(body))
    }
    
    return nil
}

func (d *DNSService) reloadZone(domain string) error {
    cmd := exec.Command("pdnsctl", "reload-zone", domain)
    return cmd.Run()
}

func (d *DNSService) incrementSOASerial(domain string) error {
    // Get current SOA
    records, err := d.listRecordsAPI(domain)
    if err != nil {
        return err
    }
    
    var soaRecord *DNSRecord
    for _, rec := range records {
        if rec.Type == "SOA" {
            soaRecord = &rec
            break
        }
    }
    
    if soaRecord == nil {
        return fmt.Errorf("SOA record not found")
    }
    
    // Parse and increment serial
    parts := strings.Fields(soaRecord.Content)
    if len(parts) < 3 {
        return fmt.Errorf("invalid SOA record")
    }
    
    serial, _ := strconv.Atoi(parts[2])
    serial++
    parts[2] = strconv.Itoa(serial)
    soaRecord.Content = strings.Join(parts, " ")
    
    // Update SOA
    return d.addRecordAPI(soaRecord)
}

type DNSZone struct {
    Name        string
    Type        string
    Nameservers []string
    SOA         string
    CreatedAt   time.Time
}

type DNSRecord struct {
    ID      string
    Zone    string
    Name    string
    Type    string
    Content string
    TTL     int
}
```

### API Endpoints

```go
// DNS Management Endpoints

// POST /api/dns
// Create zone
func (api *APIServer) CreateDNSZone(w http.ResponseWriter, r *http.Request) {
    user := r.Context().Value("user").(User)
    if !user.HasRole("admin") && !user.HasRole("domain_owner") {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }
    
    var req CreateZoneRequest
    json.NewDecoder(r.Body).Decode(&req)
    
    job := api.jobQueue.Enqueue(&Job{
        Type:    "dns.create_zone",
        UserID:  user.ID,
        Payload: req,
    })
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
}

// POST /api/dns/{domain}/records
// Add DNS record
func (api *APIServer) AddDNSRecord(w http.ResponseWriter, r *http.Request) {
    user := r.Context().Value("user").(User)
    domain := chi.URLParam(r, "domain")
    
    if !user.OwnsDomain(domain) && !user.IsAdmin() {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }
    
    var req AddRecordRequest
    json.NewDecoder(r.Body).Decode(&req)
    
    job := api.jobQueue.Enqueue(&Job{
        Type:    "dns.add_record",
        UserID:  user.ID,
        Payload: req,
    })
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
}

// GET /api/dns/{domain}/records
// List DNS records
func (api *APIServer) ListDNSRecords(w http.ResponseWriter, r *http.Request) {
    domain := chi.URLParam(r, "domain")
    
    records, err := api.dnsService.ListRecords(domain)
    if err != nil {
        http.Error(w, "failed to list records", http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(records)
}

// DELETE /api/dns/{domain}/records/{id}
// Delete DNS record
func (api *APIServer) DeleteDNSRecord(w http.ResponseWriter, r *http.Request) {
    user := r.Context().Value("user").(User)
    domain := chi.URLParam(r, "domain")
    recordID := chi.URLParam(r, "id")
    
    if !user.OwnsDomain(domain) && !user.IsAdmin() {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }
    
    job := api.jobQueue.Enqueue(&Job{
        Type:    "dns.delete_record",
        UserID:  user.ID,
        Payload: map[string]string{"zone": domain, "record_id": recordID},
    })
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
}

// POST /api/dns/{domain}/validate
// Validate DNS records
func (api *APIServer) ValidateDNS(w http.ResponseWriter, r *http.Request) {
    domain := chi.URLParam(r, "domain")
    
    errors, err := api.dnsService.ValidateRecords(domain)
    if err != nil {
        http.Error(w, "validation failed", http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "valid":  len(errors) == 0,
        "errors": errors,
    })
}
```

### Security Considerations

```
DNS Security Checklist:

1. ZONE ISOLATION
   ✅ Users can only manage own domains
   ✅ RBAC enforcement on all endpoints
   ✅ Cross-domain access prevention

2. RECORD VALIDATION
   ✅ IP addresses validated (A/AAAA)
   ✅ CNAME records validated
   ✅ MX records validated
   ✅ TXT record length limited (255 chars)
   ✅ No wildcard abuse allowed

3. API SECURITY
   ✅ PowerDNS API key in environment variable
   ✅ HTTPS/TLS to PowerDNS API
   ✅ Request signing (if supported)
   ✅ API key rotation supported

4. ZONE UPDATES
   ✅ Atomic backup before changes
   ✅ SOA serial auto-increment
   ✅ DNSSEC support (optional)
   ✅ Zone validation before apply

5. AUDIT TRAIL
   ✅ All record changes logged
   ✅ Timestamp/user/action captured
   ✅ Rollback capability on failure

6. PERFORMANCE
   ✅ Caching of record lists
   ✅ Batch operations supported
   ✅ Zone serialization optimized
```

---

## PRIORITY 3: SSL/TLS Automation (Let's Encrypt)

### Agent Actions

```go
// SSLService - SSL certificate management
type SSLService struct {
    CertbotPath string
    CertDir     string
    KeyDir      string
    AuditLog    *AuditLog
}

// 1. ISSUE CERTIFICATE
func (s *SSLService) IssueCertificate(request *IssueCertRequest) error {
    // Validation
    for _, domain := range request.Domains {
        if err := ValidateDomain(domain); err != nil {
            return fmt.Errorf("invalid domain: %w", err)
        }
    }
    
    // Verify domain ownership via ACME challenge
    // (HTTP-01 or DNS-01)
    
    domains := strings.Join(request.Domains, " ")
    cmd := exec.Command("certbot", "certonly",
        "--agree-tos",
        "--email", request.Email,
        "-d", domains,
        "--webroot",
        "-w", "/var/www/acme-challenge/",
    )
    
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("certbot failed: %s", string(output))
    }
    
    // Link certificate to domain
    certPath := fmt.Sprintf("/etc/letsencrypt/live/%s/fullchain.pem", request.Domains[0])
    keyPath := fmt.Sprintf("/etc/letsencrypt/live/%s/privkey.pem", request.Domains[0])
    
    // Store mapping in database
    if err := s.saveCertMapping(request.Domains[0], certPath, keyPath); err != nil {
        return fmt.Errorf("failed to save cert mapping: %w", err)
    }
    
    s.AuditLog.LogSuccess("IssueCertificate", request.Domains[0], map[string]interface{}{
        "domains": request.Domains,
        "cert":    certPath,
    })
    return nil
}

// 2. RENEW CERTIFICATE
func (s *SSLService) RenewCertificate(domain string) error {
    cmd := exec.Command("certbot", "renew",
        "--cert-name", domain,
        "--quiet",
    )
    
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("renewal failed: %s", string(output))
    }
    
    s.AuditLog.LogSuccess("RenewCertificate", domain, nil)
    return nil
}

// 3. AUTO-RENEWAL SCHEDULING
func (s *SSLService) EnableAutoRenewal(domain string) error {
    // Add systemd timer for auto-renewal
    timer := `
[Unit]
Description=Let's Encrypt renewal for %s
After=network-online.target

[Timer]
OnBootSec=15min
OnUnitActiveSec=1d
Persistent=true

[Install]
WantedBy=timers.target
`
    
    timerFile := fmt.Sprintf("/etc/systemd/system/certbot-renewal-%s.timer", domain)
    serviceFile := fmt.Sprintf("/etc/systemd/system/certbot-renewal-%s.service", domain)
    
    if err := ioutil.WriteFile(timerFile, []byte(timer), 0644); err != nil {
        return fmt.Errorf("failed to write timer: %w", err)
    }
    
    service := fmt.Sprintf(`
[Unit]
Description=Certbot renewal for %s
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --cert-name %s --quiet
ExecStartPost=/usr/bin/systemctl reload nginx

[Install]
WantedBy=multi-user.target
`, domain, domain)
    
    if err := ioutil.WriteFile(serviceFile, []byte(service), 0644); err != nil {
        return fmt.Errorf("failed to write service: %w", err)
    }
    
    // Enable timer
    exec.Command("systemctl", "daemon-reload").Run()
    exec.Command("systemctl", "enable", fmt.Sprintf("certbot-renewal-%s.timer", domain)).Run()
    exec.Command("systemctl", "start", fmt.Sprintf("certbot-renewal-%s.timer", domain)).Run()
    
    s.AuditLog.LogSuccess("EnableAutoRenewal", domain, nil)
    return nil
}

// 4. REVOKE CERTIFICATE
func (s *SSLService) RevokeCertificate(domain string) error {
    cmd := exec.Command("certbot", "revoke",
        "--cert-name", domain,
    )
    
    if output, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("revocation failed: %s", string(output))
    }
    
    // Remove from database
    stmt, _ := s.db.Prepare(`DELETE FROM ssl_certificates WHERE domain = ?`)
    stmt.Exec(domain)
    
    s.AuditLog.LogSuccess("RevokeCertificate", domain, nil)
    return nil
}

// 5. LIST CERTIFICATES
func (s *SSLService) ListCertificates() ([]Certificate, error) {
    rows, err := s.db.Query(`
        SELECT domain, cert_path, key_path, expiry_date, auto_renew
        FROM ssl_certificates
        ORDER BY expiry_date
    `)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var certs []Certificate
    for rows.Next() {
        var cert Certificate
        rows.Scan(&cert.Domain, &cert.CertPath, &cert.KeyPath, &cert.ExpiryDate, &cert.AutoRenew)
        certs = append(certs, cert)
    }
    
    return certs, nil
}

// 6. CHECK EXPIRY
func (s *SSLService) CheckExpiry() ([]ExpiringSoon, error) {
    rows, err := s.db.Query(`
        SELECT domain, expiry_date
        FROM ssl_certificates
        WHERE expiry_date < datetime('now', '+30 days')
        ORDER BY expiry_date
    `)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var expiring []ExpiringSoon
    for rows.Next() {
        var item ExpiringSoon
        rows.Scan(&item.Domain, &item.ExpiryDate)
        expiring = append(expiring, item)
    }
    
    return expiring, nil
}

type Certificate struct {
    Domain     string
    CertPath   string
    KeyPath    string
    ExpiryDate time.Time
    AutoRenew  bool
}

type IssueCertRequest struct {
    Domains []string `json:"domains"`
    Email   string   `json:"email"`
}
```

### Security Considerations

```
SSL/TLS Security Checklist:

1. CERTIFICATE VALIDATION
   ✅ ACME challenge verification
   ✅ Domain ownership validation
   ✅ Wildcard certificate support
   ✅ SAN (Subject Alt Name) support

2. KEY MANAGEMENT
   ✅ Private keys in /etc/letsencrypt/private/ (0600)
   ✅ Never transmitted over network
   ✅ Never logged in plaintext
   ✅ Strong key size (2048+ bit RSA)

3. RENEWAL AUTOMATION
   ✅ Systemd timer for scheduled renewal
   ✅ Exponential backoff on failures
   ✅ Alert on renewal failures
   ✅ Dry-run test before production

4. CERTIFICATE PINNING
   ✅ Track certificate fingerprints
   ✅ Alert on unexpected changes
   ✅ Rollback on key compromise

5. PERFORMANCE
   ✅ Non-blocking ACME challenges
   ✅ Async renewal via job queue
   ✅ Cache certificate metadata
```

---

## PRIORITY 4: Web Server (Nginx + PHP-FPM)

### Agent Actions

```go
// WebServerService - Nginx and PHP-FPM management
type WebServerService struct {
    NginxPath    string
    PHPFPMPath   string
    VhostDir     string
    AuditLog     *AuditLog
}

// 1. CREATE VHOST
func (w *WebServerService) CreateVhost(request *CreateVhostRequest) error {
    // Validation
    if err := ValidateDomain(request.Domain); err != nil {
        return fmt.Errorf("invalid domain: %w", err)
    }
    
    // Create document root
    docRoot := fmt.Sprintf("/home/%s/public_html", request.Username)
    if err := os.MkdirAll(docRoot, 0755); err != nil {
        return fmt.Errorf("failed to create docroot: %w", err)
    }
    
    if err := os.Chown(docRoot, UID(request.Username), GID(request.Username)); err != nil {
        return fmt.Errorf("failed to set ownership: %w", err)
    }
    
    // Generate Nginx vhost config
    config := s.generateVhostConfig(request)
    vhostFile := fmt.Sprintf("%s/%s.conf", w.VhostDir, request.Domain)
    
    if err := ioutil.WriteFile(vhostFile, []byte(config), 0644); err != nil {
        return fmt.Errorf("failed to write vhost config: %w", err)
    }
    
    // Create PHP-FPM pool
    poolConfig := s.generatePHPFPMPool(request)
    poolFile := fmt.Sprintf("/etc/php/fpm/pool.d/%s.conf", request.Domain)
    
    if err := ioutil.WriteFile(poolFile, []byte(poolConfig), 0644); err != nil {
        return fmt.Errorf("failed to write PHP pool: %w", err)
    }
    
    // Test Nginx config
    cmd := exec.Command("nginx", "-t")
    if output, err := cmd.CombinedOutput(); err != nil {
        os.Remove(vhostFile)
        os.Remove(poolFile)
        return fmt.Errorf("Nginx config invalid: %s", string(output))
    }
    
    // Reload services
    w.reloadNginx()
    w.reloadPHPFPM()
    
    w.AuditLog.LogSuccess("CreateVhost", request.Domain, request)
    return nil
}

// 2. DELETE VHOST
func (w *WebServerService) DeleteVhost(domain string) error {
    vhostFile := fmt.Sprintf("%s/%s.conf", w.VhostDir, domain)
    poolFile := fmt.Sprintf("/etc/php/fpm/pool.d/%s.conf", domain)
    
    // Backup before deletion
    backup := NewBackup(vhostFile)
    backup.Create()
    
    // Delete files
    os.Remove(vhostFile)
    os.Remove(poolFile)
    
    // Reload services
    w.reloadNginx()
    w.reloadPHPFPM()
    
    w.AuditLog.LogSuccess("DeleteVhost", domain, nil)
    return nil
}

// 3. SET PHP VERSION
func (w *WebServerService) SetPHPVersion(domain, phpVersion string) error {
    poolFile := fmt.Sprintf("/etc/php/fpm/pool.d/%s.conf", domain)
    
    // Update PHP-FPM socket path to specific version
    content, err := ioutil.ReadFile(poolFile)
    if err != nil {
        return fmt.Errorf("failed to read pool config: %w", err)
    }
    
    newContent := strings.ReplaceAll(
        string(content),
        "listen = /run/php/",
        fmt.Sprintf("listen = /run/php/%s/", phpVersion),
    )
    
    if err := ioutil.WriteFile(poolFile, []byte(newContent), 0644); err != nil {
        return fmt.Errorf("failed to update pool config: %w", err)
    }
    
    w.reloadPHPFPM()
    w.AuditLog.LogSuccess("SetPHPVersion", domain, map[string]string{"php_version": phpVersion})
    return nil
}

// INTERNAL HELPERS

func (w *WebServerService) generateVhostConfig(request *CreateVhostRequest) string {
    return fmt.Sprintf(`
server {
    listen 80;
    listen [::]:80;
    server_name %s www.%s;
    root %s;
    index index.php index.html;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";
    
    # PHP-FPM integration
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/%s/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
    
    # Deny access to dotfiles
    location ~ /\. {
        deny all;
    }
    
    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    
    # Access log
    access_log /var/log/nginx/%s-access.log combined;
    error_log /var/log/nginx/%s-error.log warn;
}
`, request.Domain, request.Domain, request.DocRoot, request.PHPVersion, request.Domain, request.Domain)
}

func (w *WebServerService) reloadNginx() error {
    return exec.Command("systemctl", "reload", "nginx").Run()
}

func (w *WebServerService) reloadPHPFPM() error {
    return exec.Command("systemctl", "reload", "php-fpm").Run()
}

type CreateVhostRequest struct {
    Domain     string `json:"domain"`
    Username   string `json:"username"`
    DocRoot    string `json:"doc_root"`
    PHPVersion string `json:"php_version"`
}
```

---

## PRIORITY 5: Database (MariaDB)

### Agent Actions

```go
// DatabaseService - MariaDB management
type DatabaseService struct {
    DBPath   string
    RootPass string
    AuditLog *AuditLog
}

// 1. CREATE DATABASE
func (d *DatabaseService) CreateDatabase(request *CreateDBRequest) error {
    if err := ValidateDatabaseName(request.Name); err != nil {
        return fmt.Errorf("invalid database name: %w", err)
    }
    
    conn, err := d.getConnection()
    if err != nil {
        return fmt.Errorf("connection failed: %w", err)
    }
    defer conn.Close()
    
    // Create database
    query := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", request.Name)
    if _, err := conn.Exec(query); err != nil {
        return fmt.Errorf("create database failed: %w", err)
    }
    
    // Create user with random password
    userPassword := GenerateRandomPassword(16)
    createUserQuery := fmt.Sprintf("CREATE USER '%s'@'localhost' IDENTIFIED BY '%s'", request.Username, userPassword)
    if _, err := conn.Exec(createUserQuery); err != nil {
        return fmt.Errorf("create user failed: %w", err)
    }
    
    // Grant privileges
    grantQuery := fmt.Sprintf("GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'localhost'", request.Name, request.Username)
    if _, err := conn.Exec(grantQuery); err != nil {
        return fmt.Errorf("grant privileges failed: %w", err)
    }
    
    conn.Exec("FLUSH PRIVILEGES")
    
    d.AuditLog.LogSuccess("CreateDatabase", request.Name, map[string]string{
        "username": request.Username,
        "password": "[REDACTED]",
    })
    
    return nil
}

// 2. DELETE DATABASE
func (d *DatabaseService) DeleteDatabase(name string) error {
    conn, err := d.getConnection()
    if err != nil {
        return fmt.Errorf("connection failed: %w", err)
    }
    defer conn.Close()
    
    // CRITICAL: Backup before deletion
    backup := fmt.Sprintf("/var/backups/mysql/%s.sql.gz", name)
    cmd := exec.Command("mysqldump", "-u", "root", "-p"+d.RootPass, name)
    gzipCmd := exec.Command("gzip", "-", ">", backup)
    
    pipe, _ := cmd.StdoutPipe()
    gzipCmd.Stdin = pipe
    cmd.Start()
    gzipCmd.Run()
    cmd.Wait()
    
    // Drop database
    query := fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", name)
    if _, err := conn.Exec(query); err != nil {
        return fmt.Errorf("drop database failed: %w", err)
    }
    
    d.AuditLog.LogSuccess("DeleteDatabase", name, map[string]string{"backup": backup})
    return nil
}

// 3. CREATE USER
func (d *DatabaseService) CreateUser(username string, password string) error {
    conn, err := d.getConnection()
    if err != nil {
        return fmt.Errorf("connection failed: %w", err)
    }
    defer conn.Close()
    
    query := fmt.Sprintf("CREATE USER '%s'@'localhost' IDENTIFIED BY '%s'", username, password)
    if _, err := conn.Exec(query); err != nil {
        return fmt.Errorf("create user failed: %w", err)
    }
    
    conn.Exec("FLUSH PRIVILEGES")
    return nil
}

// 4. SET PRIVILEGES
func (d *DatabaseService) SetPrivileges(database, username string, privileges []string) error {
    conn, err := d.getConnection()
    if err != nil {
        return fmt.Errorf("connection failed: %w", err)
    }
    defer conn.Close()
    
    privString := strings.Join(privileges, ",")
    query := fmt.Sprintf("GRANT %s ON `%s`.* TO '%s'@'localhost'", privString, database, username)
    if _, err := conn.Exec(query); err != nil {
        return fmt.Errorf("grant failed: %w", err)
    }
    
    conn.Exec("FLUSH PRIVILEGES")
    return nil
}

func (d *DatabaseService) getConnection() (*sql.DB, error) {
    dsn := fmt.Sprintf("root:%s@tcp(127.0.0.1:3306)/", d.RootPass)
    return sql.Open("mysql", dsn)
}

type CreateDBRequest struct {
    Name     string `json:"name"`
    Username string `json:"username"`
    Password string `json:"password"`
}
```

---

## 🔴 RED/BLUE TEAM AUDIT FRAMEWORK FOR PHASE 4

After implementing each service, execute:

### RED TEAM ATTACK VECTORS

```
Email Service:
  [ ] SQL injection in mailbox creation
  [ ] Shell injection in service restart
  [ ] Directory traversal in maildir path
  [ ] Password brute force (rate limiting)
  [ ] Cross-domain mailbox access
  [ ] DKIM key leakage
  [ ] Mail queue DOS

DNS Service:
  [ ] SQL injection in record add
  [ ] Record injection attacks (DNS poisoning)
  [ ] Zone takeover via API key theft
  [ ] DNSSEC bypass
  [ ] SOA serial abuse

SSL Service:
  [ ] Certificate revocation checking bypass
  [ ] Key material exposure
  [ ] ACME challenge bypass
  [ ] Auto-renewal failure DOS

Web Service:
  [ ] Config file exposure via Nginx
  [ ] PHP-FPM socket accessible
  [ ] Vhost escape / cross-site
  [ ] Privilege escalation via PHP

Database:
  [ ] Root password exposure
  [ ] Unencrypted user passwords
  [ ] Database name injection
  [ ] Privilege escalation to root
```

### BLUE TEAM FIXES

1. All queries parameterized (no string concatenation)
2. All shell commands use exec.Command (no shell interpretation)
3. All secrets in environment variables (not files)
4. All passwords hashed (Bcrypt or scrypt)
5. All audit logs immutable
6. All file operations with explicit permissions
7. All failures logged and alerted

### Success Criteria

- [ ] Zero high-severity vulnerabilities
- [ ] All medium vulnerabilities documented + mitigated
- [ ] <1% performance overhead
- [ ] <5 minute recovery from failure
- [ ] 100% of operations logged
- [ ] Rollback tested for each service

---

**Next**: Implement Backup & Migration, then execute full red/blue team security audit on entire Phase 4.
