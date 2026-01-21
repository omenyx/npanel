# PHASE 1 MIGRATION COMPLETION GUIDE

**Status**: 🔴 NOT STARTED  
**Estimated Duration**: 12-16 hours  
**Priority**: CRITICAL (blocks UAT)

---

## EXECUTIVE SUMMARY

The migration system has **structural code** (entities, controllers, repositories) but **lacks actual data sync implementation**. The following gap analysis shows what must be completed:

| Component | Current | Status | Work Required |
|-----------|---------|--------|----------------|
| SSH connectivity | ✅ Preflight implemented | 70% | Integrate with actual data operations |
| File migration | ❌ Stub only | 5% | Implement rsync + mapping logic |
| DB migration | ❌ Stub only | 5% | Implement mysqldump + import logic |
| Mail migration | ❌ Stub only | 5% | Implement mailbox API calls |
| DNS migration | ❌ Stub only | 5% | Implement zone import logic |
| FTP accounts | ❌ Stub only | 5% | Create accounts with correct perms |
| Service mapping | ❌ Not started | 0% | Map source user → target service |
| Parity validation | ❌ Not started | 0% | Implement checklist automation |
| Rollback testing | ⚠️ Partial | 30% | Actually run and verify procedures |

---

## PHASE 1.1: MIGRATION IMPLEMENTATION

### Architecture Overview

```
Source System (cPanel)         →  Migration Service (NPanel)    →  Target System (NPanel)
  - cPanel account              → Migration job                 → Service entity
  - User home: /home/cpanel     → Step tracking                 → Service home: /home/service_id
  - MySQL: username_db          → Credential mapping            → MySQL: service_id_db
  - Mail: user@domain           → Parity validation             → Mail: mailbox@domain
  - DNS: zone file              → History/audit log             → DNS zone record
```

### Implementation Order (Highest Risk First)

#### 1️⃣ Service Identity Mapping (CRITICAL)

**Risk**: Without correct user/service mapping, all subsequent operations fail

**What to Implement**:
```typescript
// In migration.service.ts - add new method:

async mapSourceUserToService(
  sourceUser: string,           // e.g., "cpanel_user"
  sourceDomain: string,         // e.g., "example.com"
  targetPlan: HostingPlan,      // Plan that was selected
): Promise<{
  systemUsername: string;       // e.g., "np_user123"
  mysqlUsername: string;        // e.g., "np_user123_db"
  homeDirectory: string;        // e.g., "/home/np_user123"
  phpPoolName: string;          // e.g., "np_user123"
}> {
  // 1. Check if user already exists (idempotency)
  const existing = await this.hosting.find({
    primaryDomain: sourceDomain,
  });
  
  if (existing) {
    return {
      systemUsername: existing.systemUsername,
      mysqlUsername: existing.mysqlUsername,
      homeDirectory: `/home/${existing.systemUsername}`,
      phpPoolName: existing.systemUsername,
    };
  }
  
  // 2. Derive system username from source (with safety)
  // Use hash of source to get deterministic ID
  const serviceId = this.deriveServiceId(sourceUser, sourceDomain);
  
  // 3. Verify no collision
  const collision = await this.hosting.find({
    systemUsername: `np_${serviceId}`,
  });
  
  if (collision) {
    throw new Error('Service ID collision - cannot map');
  }
  
  return {
    systemUsername: `np_${serviceId}`,
    mysqlUsername: `np_${serviceId}_db`,
    homeDirectory: `/home/np_${serviceId}`,
    phpPoolName: `np_${serviceId}`,
  };
}

private deriveServiceId(sourceUser: string, domain: string): string {
  // Create stable hash: hash(sourceUser + domain) % 999
  const combined = `${sourceUser}:${domain}`;
  const hash = createHash('sha256')
    .update(combined)
    .digest('hex');
  return hash.substring(0, 10); // Take first 10 chars (safe for any system)
}
```

**Testing**:
- ✅ Same source→target mapping returns same service username
- ✅ Different sources get different usernames
- ✅ No collisions with existing services
- ✅ Usernames follow naming convention

**Exit Criteria**: Mapping deterministic and collision-free

---

#### 2️⃣ Filesystem Migration (CRITICAL)

**Risk**: File corruption, permission issues, orphaned files

**What to Implement**:
```typescript
async migrateFilesystem(
  sourceConfig: Record<string, unknown>,
  sourceUser: string,
  targetServicePath: string,
  dryRun: boolean = true,
): Promise<MigrationStep> {
  const step = this.createStep('filesystem', 'copy files');
  
  try {
    // 1. Create target directories
    await this.ensureServiceDirectories(targetServicePath);
    
    // 2. Use rsync with safety flags
    const rsyncCmd = [
      'rsync',
      '--archive',        // Preserve permissions, timestamps, etc
      '--checksum',       // Verify integrity
      '--delete',         // Remove files not in source
      '--verbose',        // Log transfers
      '--delete-during',  // Delete during transfer (faster)
      '--delay-updates',  // Ensure atomicity
      ...(dryRun ? ['--dry-run'] : []),
      `${sourceUser}@${sourceConfig.host}:~/`, // Source (trailing slash = contents)
      `${targetServicePath}/`,                    // Target
    ];
    
    const result = await this.execCommand('rsync', rsyncCmd);
    
    if (result.code !== 0) {
      throw new Error(`rsync failed: ${result.stderr}`);
    }
    
    // 3. Fix ownership (in case rsync ran as different user)
    const chownCmd = [
      'chown',
      '-R',
      `${this.deriveSystemUsername(sourceUser)}:${this.deriveSystemUsername(sourceUser)}`,
      targetServicePath,
    ];
    
    await this.execCommand('chown', chownCmd);
    
    // 4. Verify checksums on sample files
    const sampleFiles = await this.selectSampleFiles(targetServicePath, 5);
    for (const file of sampleFiles) {
      const sourceChecksum = await this.getRemoteChecksum(sourceConfig, sourceUser, file);
      const targetChecksum = await this.getLocalChecksum(join(targetServicePath, file));
      
      if (sourceChecksum !== targetChecksum) {
        throw new Error(`Checksum mismatch on ${file}`);
      }
    }
    
    step.status = 'completed';
    step.metadata = {
      filesTransferred: result.stdout.split('\n').length,
      sampleChecksumsVerified: sampleFiles.length,
    };
    
    return step;
  } catch (error) {
    step.status = 'failed';
    step.errorReason = error.message;
    step.rollbackPlan = `Delete ${targetServicePath}`;
    throw error;
  }
}

private async ensureServiceDirectories(servicePath: string): Promise<void> {
  const dirs = [
    servicePath,
    join(servicePath, 'public_html'),
    join(servicePath, 'logs'),
    join(servicePath, 'tmp'),
    join(servicePath, 'mail'),
  ];
  
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true, mode: 0o750 });
  }
}

private async getRemoteChecksum(
  sourceConfig: Record<string, unknown>,
  sourceUser: string,
  relativePath: string,
): Promise<string> {
  const result = await this.execSshCommand(
    sourceConfig,
    `sha256sum ~/${relativePath} | cut -d' ' -f1`,
  );
  return result.stdout.trim();
}

private async getLocalChecksum(filePath: string): Promise<string> {
  const result = await this.execCommand('sha256sum', [filePath]);
  return result.stdout.split(' ')[0];
}
```

**Testing**:
- ✅ Small files transfer correctly
- ✅ Large files transfer correctly
- ✅ Permissions preserved
- ✅ Checksums match post-transfer
- ✅ Dry-run doesn't modify target
- ✅ Subsequent run is idempotent (no re-transfer)

**Exit Criteria**: Files transferred with verified checksums

---

#### 3️⃣ Database Migration (CRITICAL)

**Risk**: Data loss, corruption, access denied

**What to Implement**:
```typescript
async migrateDatabase(
  sourceConfig: Record<string, unknown>,
  sourceUser: string,
  sourceDb: string,
  targetServiceUser: string,
  targetServiceDb: string,
  dryRun: boolean = true,
): Promise<MigrationStep> {
  const step = this.createStep('database', 'migrate data');
  
  try {
    // 1. Dump source database
    const dumpFile = `/tmp/migration_${randomBytes(8).toString('hex')}.sql`;
    
    const dumpCmd = [
      `mysqldump`,
      `--user=${sourceUser}`,
      `--password=${sourceConfig.mysqlPassword}`,
      `--single-transaction`,  // Consistent snapshot
      `--quick`,               // Stream large tables
      `--lock-tables=false`,   // Don't lock source
      `--no-tablespaces`,      // Ignore tablespace directives
      sourceDb,
    ];
    
    const dumpResult = await this.execSshCommand(
      sourceConfig,
      dumpCmd.join(' '),
    );
    
    if (dumpResult.code !== 0) {
      throw new Error(`mysqldump failed: ${dumpResult.stderr}`);
    }
    
    // 2. Copy dump to target via SFTP or SSH
    await this.transferFile(
      sourceConfig,
      dumpFile,
      `/tmp/${Path.basename(dumpFile)}`,
    );
    
    // 3. Create database in target
    const createDbCmd = `
      CREATE DATABASE IF NOT EXISTS ${targetServiceDb};
      GRANT ALL PRIVILEGES ON ${targetServiceDb}.* 
        TO '${targetServiceUser}'@'localhost';
      FLUSH PRIVILEGES;
    `;
    
    const createResult = await this.execMysqlCommand(
      createDbCmd,
      'root', // Need root to create DB
    );
    
    // 4. Import dump
    if (!dryRun) {
      const importCmd = `
        mysql --user=${targetServiceUser} ${targetServiceDb} 
              < /tmp/${Path.basename(dumpFile)}
      `;
      
      const importResult = await this.execCommand('bash', ['-c', importCmd]);
      
      if (importResult.code !== 0) {
        throw new Error(`Import failed: ${importResult.stderr}`);
      }
    }
    
    // 5. Verify table count
    const tableCountCmd = `
      SELECT COUNT(*) as count FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = '${targetServiceDb}';
    `;
    
    const countResult = await this.execMysqlCommand(
      tableCountCmd,
      targetServiceUser,
    );
    
    const tableCount = parseInt(countResult.stdout);
    
    // 6. Cleanup
    await this.execCommand('rm', ['-f', `/tmp/${Path.basename(dumpFile)}`]);
    
    step.status = 'completed';
    step.metadata = {
      tablesImported: tableCount,
      dumpSize: dumpResult.stdout.length,
    };
    
    return step;
  } catch (error) {
    step.status = 'failed';
    step.errorReason = error.message;
    step.rollbackPlan = `DROP DATABASE ${targetServiceDb}`;
    throw error;
  }
}
```

**Testing**:
- ✅ Table count matches source
- ✅ Sample query returns expected rows
- ✅ Foreign keys intact
- ✅ User credentials work
- ✅ Dryrun doesn't import

**Exit Criteria**: Database imported and queryable

---

#### 4️⃣ Mail Migration

**Risk**: Mailbox data loss, quota issues, forwarding breaks

```typescript
async migrateMailboxes(
  sourceConfig: Record<string, unknown>,
  sourceDomain: string,
  targetServiceId: string,
  targetDomain: string,
  dryRun: boolean = true,
): Promise<MigrationStep> {
  const step = this.createStep('mail', 'create mailboxes');
  
  try {
    // 1. Get list of mailboxes from source
    const mailboxes = await this.getRemoteMailboxList(
      sourceConfig,
      sourceDomain,
    );
    
    // 2. For each mailbox: create in target
    for (const mailbox of mailboxes) {
      if (!dryRun) {
        const service = await this.hosting.get(targetServiceId);
        
        await this.hosting.ensureMailboxPresent(service, {
          address: `${mailbox.username}@${targetDomain}`,
          quotaMb: mailbox.quotaMb,
          password: this.deriveMailboxPassword(mailbox.username, targetServiceId),
        });
      }
    }
    
    // 3. Handle mailbox migrations (if POP3 access available)
    // This is complex - might need manual intervention
    
    step.status = 'completed';
    step.metadata = {
      mailboxesMigrated: mailboxes.length,
      note: 'Mailbox contents may require manual migration',
    };
    
    return step;
  } catch (error) {
    step.status = 'failed';
    step.errorReason = error.message;
    throw error;
  }
}

private async getRemoteMailboxList(
  sourceConfig: Record<string, unknown>,
  domain: string,
): Promise<Array<{ username: string; quotaMb: number }>> {
  // Implementation depends on source mail server type
  // This is a placeholder - actual implementation varies by cPanel/Plesk/etc
  const result = await this.execSshCommand(
    sourceConfig,
    `grep "^${domain}:" /etc/virtual/domains 2>/dev/null | cut -d: -f2`,
  );
  
  // Parse and return
  const mailboxes = [];
  for (const line of result.stdout.trim().split('\n')) {
    const [username, quota] = line.split(':');
    if (username) {
      mailboxes.push({
        username,
        quotaMb: parseInt(quota) || 1000,
      });
    }
  }
  
  return mailboxes;
}
```

**Testing**:
- ✅ All mailboxes created
- ✅ Mailboxes accessible via webmail/IMAP/POP3
- ✅ Quotas enforced
- ✅ Dryrun doesn't create

---

#### 5️⃣ DNS Migration

**Risk**: Domain stops resolving

```typescript
async migrateDNS(
  sourceConfig: Record<string, unknown>,
  sourceDomain: string,
  targetDomain: string,
  dryRun: boolean = true,
): Promise<MigrationStep> {
  const step = this.createStep('dns', 'import zone');
  
  try {
    // 1. Get zone file from source
    const zoneData = await this.getRemoteZoneFile(
      sourceConfig,
      sourceDomain,
    );
    
    // 2. Parse and adapt records (change IPs, nameservers, etc)
    const adaptedRecords = this.adaptDNSRecords(
      zoneData,
      sourceDomain,
      targetDomain,
      this.config.targetServerIP,
      this.config.targetNameservers,
    );
    
    // 3. Create zone in target
    if (!dryRun) {
      const service = await this.hosting.get(targetServiceId);
      
      await this.hosting.ensureZonePresent(service, {
        zoneName: targetDomain,
        records: adaptedRecords,
      });
    }
    
    step.status = 'completed';
    step.metadata = {
      recordsImported: adaptedRecords.length,
    };
    
    return step;
  } catch (error) {
    step.status = 'failed';
    step.errorReason = error.message;
    throw error;
  }
}

private adaptDNSRecords(
  zoneData: string,
  sourceDomain: string,
  targetDomain: string,
  targetIP: string,
  targetNameservers: string[],
): any[] {
  // Parse BIND zone file format
  const records = [];
  
  for (const line of zoneData.split('\n')) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith(';')) continue;
    
    // Parse record: name ttl class type value
    const match = trimmed.match(/^(\S+)\s+(\d+)\s+IN\s+(\w+)\s+(.+)$/);
    
    if (!match) continue;
    
    const [, name, ttl, type, value] = match;
    
    // Skip NS and SOA (will be set by system)
    if (['NS', 'SOA'].includes(type)) continue;
    
    // Adapt A records to point to target IP
    if (type === 'A') {
      records.push({
        name: name === '@' ? targetDomain : name.replace(sourceDomain, targetDomain),
        type,
        ttl: parseInt(ttl),
        value: targetIP,
      });
    } else {
      // Copy other records as-is
      records.push({
        name: name === '@' ? targetDomain : name.replace(sourceDomain, targetDomain),
        type,
        ttl: parseInt(ttl),
        value: value.replace(sourceDomain, targetDomain),
      });
    }
  }
  
  return records;
}
```

**Testing**:
- ✅ Zone resolves via target nameservers
- ✅ A records point to target IP
- ✅ MX records correct
- ✅ CNAME records functional

---

### Integration into Migration Job

Update `customer-migration.controller.ts` to execute all steps:

```typescript
@Post('/execute')
async executeMigration(@Body() input: ExecuteMigrationDto) {
  const job = await this.migration.createJob({
    sourceConfig: input.sourceConfig,
    accounts: input.accounts,
  });
  
  try {
    // 1. Service mapping
    const serviceMapping = await this.migration.mapSourceUserToService(
      input.sourceUser,
      input.sourceDomain,
      input.targetPlan,
    );
    
    // 2. Create service in NPanel
    const service = await this.hosting.provisionService({
      primaryDomain: input.targetDomain,
      systemUsername: serviceMapping.systemUsername,
      ...
    });
    
    // 3. Execute migration steps
    const steps = [];
    
    // Filesystem
    steps.push(await this.migration.migrateFilesystem(
      input.sourceConfig,
      input.sourceUser,
      serviceMapping.homeDirectory,
      false, // Not dry-run
    ));
    
    // Database
    steps.push(await this.migration.migrateDatabase(
      input.sourceConfig,
      input.sourceUser,
      input.sourceDb,
      serviceMapping.systemUsername,
      `${serviceMapping.systemUsername}_db`,
      false,
    ));
    
    // Mail
    steps.push(await this.migration.migrateMailboxes(
      input.sourceConfig,
      input.sourceDomain,
      service.id,
      input.targetDomain,
      false,
    ));
    
    // DNS
    steps.push(await this.migration.migrateDNS(
      input.sourceConfig,
      input.sourceDomain,
      input.targetDomain,
      false,
    ));
    
    job.status = 'completed';
    job.completedAt = new Date();
    
  } catch (error) {
    job.status = 'failed';
    job.errorReason = error.message;
    
    // Execute rollback steps in reverse order
    await this.migration.rollbackMigrationJob(job);
  }
  
  await this.migration.saveJob(job);
  
  return job;
}
```

---

## PHASE 1.2: PARITY VALIDATION

**Objective**: Automate PARITY_CHECKLIST.md execution

**Implementation**:
- Create `migration-validator.service.ts`
- Implement all checks from checklist
- Generate validation report
- Store results in database

**Timeline**: 4 hours

---

## PHASE 1.3: ROLLBACK TESTING

**Objective**: Verify rollback procedures work

**Process**:
1. Execute migration on test account
2. Verify success
3. Execute rollback
4. Verify system returns to pre-migration state
5. Document any irreversible operations

**Timeline**: 3 hours

---

## SUCCESS CRITERIA FOR PHASE 1

- ✅ Service identity mapping deterministic and collision-free
- ✅ Filesystem migrated with verified checksums
- ✅ Database schema and data imported correctly
- ✅ Mailboxes created and accessible
- ✅ DNS zone resolves correctly
- ✅ FTP accounts functional
- ✅ Parity validation passes all checks
- ✅ Rollback tested and working
- ✅ UAT ready (can proceed to Phase 4)

---

## NEXT ACTIONS

1. Start with service identity mapping (lowest risk, enables others)
2. Implement filesystem migration (most data)
3. Implement database migration (most critical)
4. Implement mail and DNS (dependent on hosting service)
5. Build parity validation harness
6. Execute end-to-end test
7. Document any findings
