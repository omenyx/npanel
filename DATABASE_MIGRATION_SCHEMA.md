# Migration System Database Schema

## Tables

### migration_jobs

Stores migration job tracking and status.

```sql
CREATE TABLE migration_jobs (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- Status values: pending, validating, extracting, planning, applying, verifying, complete, failed, rolled_back
    
    progress INTEGER DEFAULT 0, -- 0-100%
    current_step VARCHAR(255),
    
    source_type VARCHAR(50), -- cpmove-tar.gz, cpmove-tar, cpbackup-tar.gz
    source_path VARCHAR(500) NOT NULL,
    
    target_user VARCHAR(255) NOT NULL,
    
    dry_run_mode BOOLEAN DEFAULT false,
    
    error_msg TEXT,
    plan_json LONGTEXT, -- Serialized MigrationPlan
    log_path VARCHAR(500),
    
    approval_token VARCHAR(500),
    approval_timestamp TIMESTAMP NULL,
    approved_by VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    
    KEY idx_status (status),
    KEY idx_target_user (target_user),
    KEY idx_created_at (created_at),
    UNIQUE KEY idx_job_user (target_user, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### migration_steps

Tracks individual migration steps (sub-operations).

```sql
CREATE TABLE migration_steps (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    job_id INTEGER NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    
    status VARCHAR(50) DEFAULT 'pending',
    -- pending, running, complete, failed, skipped
    
    progress INTEGER DEFAULT 0,
    
    details LONGTEXT,
    error_msg TEXT,
    
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    
    duration_seconds FLOAT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE,
    KEY idx_job_id (job_id),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### migration_logs

Detailed audit trail for all migration operations.

```sql
CREATE TABLE migration_logs (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    job_id INTEGER NOT NULL,
    action VARCHAR(255) NOT NULL,
    
    resource_type VARCHAR(100),
    -- user, domain, email, database, dns_zone, ssl_cert, file
    
    resource_name VARCHAR(500),
    result VARCHAR(50),
    -- success, failure, warning, skipped
    
    message TEXT,
    details LONGTEXT,
    
    admin_user VARCHAR(255),
    source_ip VARCHAR(45),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE,
    KEY idx_job_id (job_id),
    KEY idx_action (action),
    KEY idx_resource (resource_type, resource_name),
    KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### migration_backups

References stored backups for restoration.

```sql
CREATE TABLE migration_backups (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    filename VARCHAR(500) NOT NULL,
    filepath VARCHAR(1000) NOT NULL,
    
    source_cpanel_account VARCHAR(255),
    source_whm_server VARCHAR(255),
    
    backup_format VARCHAR(100),
    -- cpmove-tar.gz, cpmove-tar, cpbackup-tar.gz, custom
    
    file_size BIGINT,
    file_hash VARCHAR(64), -- SHA256
    
    created_date TIMESTAMP,
    verified BOOLEAN DEFAULT false,
    verification_date TIMESTAMP NULL,
    
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(255),
    
    retention_policy VARCHAR(50),
    -- manual, 30days, 60days, 1year
    
    should_delete_at TIMESTAMP NULL,
    
    storage_location VARCHAR(500),
    -- local, s3, remote-server
    
    metadata_json LONGTEXT,
    
    KEY idx_source_account (source_cpanel_account),
    KEY idx_created_date (created_date),
    KEY idx_uploaded_at (uploaded_at),
    UNIQUE KEY idx_filepath (filepath)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### migration_resources

Maps cPanel resources to nPanel resources.

```sql
CREATE TABLE migration_resources (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    job_id INTEGER NOT NULL,
    
    resource_type VARCHAR(100),
    -- domain, email, database, dns_zone, ssl_cert, cron_job
    
    cpanel_name VARCHAR(500),
    npanel_name VARCHAR(500),
    
    cpanel_id VARCHAR(100),
    npanel_id VARCHAR(100),
    
    status VARCHAR(50),
    -- pending, migrated, failed, skipped
    
    migration_time_seconds FLOAT,
    error_msg TEXT,
    
    size_bytes BIGINT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE,
    KEY idx_job_id (job_id),
    KEY idx_resource_type (resource_type),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### migration_conflicts

Records conflicts detected during migration planning.

```sql
CREATE TABLE migration_conflicts (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    job_id INTEGER NOT NULL,
    
    conflict_type VARCHAR(100),
    -- user_exists, domain_exists, email_exists, database_exists, dns_zone_exists
    
    resource_name VARCHAR(500),
    conflict_description TEXT,
    
    resolution VARCHAR(50),
    -- skip, merge, overwrite, manual_review
    
    resolution_notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE,
    KEY idx_job_id (job_id),
    KEY idx_type (conflict_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Indexes

```sql
-- For efficient migration job queries
CREATE INDEX idx_migration_job_status ON migration_jobs(status, created_at DESC);
CREATE INDEX idx_migration_job_user_status ON migration_jobs(target_user, status);

-- For audit trail queries
CREATE INDEX idx_migration_logs_job_action ON migration_logs(job_id, action);
CREATE INDEX idx_migration_logs_resource ON migration_logs(resource_type, resource_name);
CREATE INDEX idx_migration_logs_date ON migration_logs(created_at DESC);

-- For resource mapping queries
CREATE INDEX idx_migration_resources_job ON migration_resources(job_id, resource_type);
CREATE INDEX idx_migration_resources_status ON migration_resources(status);

-- For backup queries
CREATE INDEX idx_migration_backups_source ON migration_backups(source_cpanel_account, created_date DESC);
CREATE INDEX idx_migration_backups_retention ON migration_backups(should_delete_at);
```

## Sample Queries

### Get migration job status and steps

```sql
SELECT 
    j.id,
    j.status,
    j.progress,
    j.current_step,
    j.target_user,
    j.created_at,
    j.started_at,
    j.completed_at,
    COUNT(s.id) as total_steps,
    SUM(CASE WHEN s.status = 'complete' THEN 1 ELSE 0 END) as completed_steps,
    SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) as failed_steps
FROM migration_jobs j
LEFT JOIN migration_steps s ON j.id = s.job_id
WHERE j.id = ?
GROUP BY j.id;
```

### Get migration audit trail

```sql
SELECT 
    l.created_at,
    l.action,
    l.resource_type,
    l.resource_name,
    l.result,
    l.message,
    l.admin_user
FROM migration_logs l
WHERE l.job_id = ?
ORDER BY l.created_at DESC
LIMIT 1000;
```

### Get resource migration status

```sql
SELECT 
    resource_type,
    status,
    COUNT(*) as count,
    SUM(size_bytes) as total_size,
    AVG(migration_time_seconds) as avg_duration
FROM migration_resources
WHERE job_id = ?
GROUP BY resource_type, status;
```

### Find backups ready for deletion

```sql
SELECT 
    id,
    filename,
    filepath,
    source_cpanel_account,
    file_size,
    should_delete_at
FROM migration_backups
WHERE should_delete_at IS NOT NULL
  AND should_delete_at < NOW()
  AND storage_location = 'local'
ORDER BY should_delete_at ASC;
```

### Get migration statistics

```sql
SELECT 
    DATE(j.created_at) as migration_date,
    COUNT(*) as total_migrations,
    SUM(CASE WHEN j.status = 'complete' THEN 1 ELSE 0 END) as successful,
    SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failed,
    AVG(TIMESTAMPDIFF(SECOND, j.started_at, j.completed_at)) as avg_duration_seconds,
    SUM(mr.size_bytes) / 1024 / 1024 / 1024 as total_gb_migrated
FROM migration_jobs j
LEFT JOIN migration_resources mr ON j.id = mr.job_id
WHERE j.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(j.created_at)
ORDER BY migration_date DESC;
```

## Database Setup

```bash
# Create migration tables
mysql -u root -p nPanel < schema.sql

# Grant permissions to nPanel user
mysql -u root -p nPanel << EOF
GRANT SELECT, INSERT, UPDATE, DELETE ON nPanel.migration_* TO 'npanel'@'localhost';
FLUSH PRIVILEGES;
EOF
```

## Maintenance

### Backup retention policy

```sql
-- Mark old backup files for deletion (keep last 60 days, delete after 90 days)
UPDATE migration_backups
SET should_delete_at = DATE_ADD(created_date, INTERVAL 90 DAY),
    retention_policy = '60days'
WHERE created_date < DATE_SUB(NOW(), INTERVAL 60 DAY)
  AND should_delete_at IS NULL;
```

### Archive old migration logs

```sql
-- Archive migrations older than 1 year to separate table
INSERT INTO migration_logs_archive
SELECT * FROM migration_logs
WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);

DELETE FROM migration_logs
WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

### Clean up failed temporary files

```sql
-- Mark temporary extraction directories for cleanup
SELECT l.log_path 
FROM migration_logs l
WHERE l.action = 'extraction_failed'
  AND l.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
```

