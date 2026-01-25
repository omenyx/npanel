# nPanel Architecture

## Design Overview

nPanel is built on a **strict separation of concerns** with three independent layers:

1. **API Layer** - User-facing REST endpoints (no shell execution)
2. **Agent Layer** - Privileged system actions via allow-list
3. **UI Layer** - Static SPA served by Nginx

## Why This Architecture?

### Problem with Traditional Panels

cPanel, WHM, Plesk: Often execute shell commands directly from the web context.
- **Risk:** One API vulnerability = full system compromise
- **Performance:** Long-running commands block HTTP requests
- **Auditability:** Hard to track what actually happened on the system

### nPanel Solution

```
[ User Request ] → [ API Validates ] → [ Agent Executes ] → [ System ]
                        ↑                      ↑
                    RBAC Check            Allow-List Only
                    Audit Log             Sandboxed
```

## Component Details

### 1. Installer (`installer/`)

**Purpose:** Safe, one-command deployment

**Behavior:**
- Detect OS and versions
- Check system requirements
- Install Go runtime dependencies
- Build binaries from source
- Configure systemd services
- Initialize database
- Generate admin credentials
- Start services
- Display success/next steps

**Security:**
- Verify package signatures (where possible)
- Backup existing configs
- No password storage in plaintext
- Set restrictive file permissions
- Enable SELinux/AppArmor rules

### 2. API Server (`backend/`)

**Purpose:** REST endpoint for all UI/client operations

**Key Responsibilities:**
- User authentication & JWT tokens
- RBAC policy enforcement
- Input validation & sanitization
- Job queue submission
- Database operations
- Audit logging
- Rate limiting

**NOT Allowed:**
- Direct shell execution
- Direct file system modification
- Direct service management

**Communicates with Agent via:**
- Unix domain socket (local)
- mTLS (future: remote agents)

### 3. Local Agent (`agent/`)

**Purpose:** Execute privileged actions with guard rails

**Runs as:** root (but with cgroup limits)

**Capabilities:**
- Create/delete domains
- Manage DNS records
- Create/suspend email accounts
- Manage SSL certificates
- Manage databases
- Manage services (start/stop/restart)
- Tail logs
- Read metrics

**Guard Rails:**
- Allow-list of permitted actions
- Input validation on every call
- Immutable audit logs
- Resource limits via cgroups v2
- No direct shell - only typed operations

**Example:**
```go
// ALLOWED - Typed action
agent.CreateDomain("example.com", DomainConfig{...})

// NOT ALLOWED - Raw shell execution
agent.Exec("useradd -m -s /bin/bash newuser")
```

### 4. Frontend UI (`frontend/`)

**Purpose:** User-facing web interface

**Tech:** React (can be Vue/Svelte)

**Served by:** Nginx (static SPA)

**Features:**
- Dashboard
- Domain management
- Email management
- Database management
- SSL management
- Metrics & monitoring
- User settings

**Behavior:**
- All operations through REST API
- Token-based auth
- Client-side validation (for UX)
- Server-side validation (for security)

### 5. Job Queue (Redis)

**Purpose:** Async task processing

**Use Cases:**
- Long-running domain creation
- Backup jobs
- Bulk updates
- Health checks
- Log rotation

**Key Feature:** Strict concurrency limits to prevent resource exhaustion

## Data Flow Examples

### Example 1: Create Email Account

```
1. User clicks "Create Email" in UI
2. UI sends: POST /api/email/create {domain: "example.com", user: "hello"}
3. API:
   - Validates JWT token
   - Checks user RBAC (can they manage this domain?)
   - Validates input (domain exists, user name valid)
   - Logs action to audit table
   - Enqueues job in Redis
   - Returns job ID to UI

4. UI polls: GET /api/jobs/{job_id}

5. Job Worker:
   - Dequeues from Redis
   - Calls Agent: agent.CreateEmailUser(domain, user, password)

6. Agent:
   - Validates parameters again
   - Checks mailbox backend (Postfix/Dovecot)
   - Creates system user
   - Adds to virtual users table
   - Returns success

7. API receives Agent result
   - Updates job status in DB
   - Logs completion

8. UI sees job completed
   - Displays success
   - Refreshes email list
```

### Example 2: Restart Apache

```
1. User clicks "Restart Apache" in admin panel
2. UI sends: POST /api/services/apache/restart
3. API:
   - Checks user is admin
   - Validates input
   - Enqueues job
   - Returns immediately

4. Agent picks up job
   - Calls systemctl restart httpd
   - Waits for completion
   - Returns exit code

5. API logs result
   - If success: update service status cache
   - If failure: alert admin, log error

6. UI updates service status
```

## Security Model

### Authentication

- JWT tokens (short-lived, 1 hour default)
- Refresh tokens (long-lived, in httpOnly cookies)
- MFA support (TOTP optional)

### Authorization (RBAC)

```
Roles:
- root: All permissions
- admin: Server management, user management
- reseller: Can only manage own users
- user: Can only manage own resources
```

### Audit Trail

Every action logged:
```json
{
  "timestamp": "2025-01-25T10:30:45Z",
  "user": "admin@example.com",
  "action": "create_domain",
  "resource": "example.com",
  "result": "success",
  "details": {...}
}
```

### Secrets Management

- API keys → Redis with expiry
- Database credentials → OS environment (systemd)
- Certificates → `/etc/npanel/ssl/` (restricted perms)
- Admin password → scrypt hashed in DB

## Performance Targets

- API response time: <100ms (p95)
- Idle memory usage: <150MB total
- Idle CPU: <1%
- Max concurrent jobs: 5 (configurable)
- Database queries: Indexed, <10ms typical

## Observability

### Metrics (Prometheus-compatible)

- HTTP request rate/latency
- Job queue depth
- Agent execution time
- System resource usage
- Domain/user/email counts

### Logging

- Structured JSON logs
- Levels: ERROR, WARN, INFO, DEBUG
- Rotation: daily, 7-day retention
- Searchable: timestamp, level, component, action

### Health Checks

- API: GET /health
- Agent: GET /health (via socket)
- Database: SELECT 1
- Redis: PING

## Deployment Topology

### Single Server

```
nPanel API    ┐
nPanel Agent  ├─ All on one box (AlmaLinux 9)
nginx + UI    ┤
PostgreSQL    ┤
Redis         ┘
```

### Multi-Server (Future)

```
        [ Installer Node 0 ] ← Primary API + Agent
        [ Installer Node 1 ] ← Secondary Agent
        [ Installer Node 2 ] ← Secondary Agent
                 ↓
        [ Shared PostgreSQL ]
        [ Shared Redis ]
```

## Configuration

**Installer generates:** `/etc/npanel/config.yaml`

```yaml
server:
  port: 443
  tls_cert: /etc/npanel/ssl/cert.pem
  tls_key: /etc/npanel/ssl/key.pem

agent:
  socket: /var/run/npanel/agent.sock
  max_workers: 5

database:
  type: sqlite
  path: /var/lib/npanel/npanel.db

redis:
  addr: localhost:6379

logging:
  level: info
  format: json
  path: /var/log/npanel/
```

## Next Steps

1. **Installer** - Build deployment tooling
2. **Agent** - Build privileged daemon
3. **API** - Build REST server
4. **UI** - Build React frontend
5. **Testing** - Integration tests
6. **Documentation** - Operator guide
