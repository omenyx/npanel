# Lean Control Panel (nPanel vNext) — Production-Ready Specification

Goal: a modern, lightweight hosting control panel that outperforms cPanel/WHM on 2 vCPU / 4GB RAM by focusing on a small set of high-value workflows, an API-first architecture, and security-first operations.

Non-goals: cloning legacy shared-hosting breadth, embedding billing logic, or exposing shell/root in any UI.

Stack constraints (fixed):
- Backend: FastAPI (Python, async)
- Web server: Nginx
- DB: PostgreSQL
- Frontend: server-rendered HTML (Jinja2) + HTMX + Alpine.js
- Process control: systemd
- Target OS: AlmaLinux / Ubuntu Server
- Container support: Docker (single-node)

Security-first principles (fixed):
- Assume passwords WILL be compromised.
- A stolen password alone MUST NEVER grant access.
- Zero-trust everywhere.

---

## 1) Feature Mapping (cPanel/WHM → Lean Panel)

Decision legend:
- **Keep**: high-value, low-complexity, strong ROI for small servers.
- **Simplify**: offer the 80/20, remove edge cases.
- **Replace**: different implementation with better security/ops.
- **Remove**: legacy complexity, security risk, or low ROI.

### Mapping table

| cPanel/WHM Feature | Lean Equivalent | Decision | Why (security / ops / ROI) |
|---|---|---:|---|
| Account management (create/suspend) | Service objects synced from WHMCS; local “service status” enforced | Replace | WHMCS is source of truth; prevents drift and duplicated billing logic |
| Package/plan limits | Feature flags + limits mapped from WHMCS product config | Replace | Centralized plan enforcement; easy to audit |
| DNS zone editor | Minimal DNS records editor + templates; optional external DNS integration | Simplify | Reduce blast radius; limit record types; strong validation |
| Nameserver cluster | External DNS providers only (optional) | Remove | High complexity and maintenance |
| File manager | Web file manager scoped to user root; SFTP instructions; safe ops via agent | Simplify | Avoid full-featured web IDE; reduce attack surface |
| FTP accounts | SFTP only (OpenSSH) with per-user chroot/jail | Replace | FTP is insecure and legacy; SFTP is simpler |
| Email accounts / webmail | Optional (Phase 2): basic mailbox mgmt; no bundled webmail | Simplify | Email stack is complex; keep minimal management |
| SpamAssassin / filtering UI | External or minimal toggles; no rule DSL in UI | Remove/Simplify | Complex and error-prone; high support cost |
| SSL/TLS management (AutoSSL) | ACME (Let’s Encrypt) via internal ACME worker + Nginx reload | Keep | High value, low overhead; automate renewals |
| Backup manager | Snapshot backups (filesystem + DB) + offsite targets; simple retention policies | Simplify | Backups must be reliable; keep opinionated policies |
| Restore backups | Point-in-time restore wizard + rollback plan | Simplify | Reduce “partial restore” complexity |
| Database management (MySQL/Postgres) | PostgreSQL provisioning (DB/user/roles); minimal UI | Simplify | Keep single DB engine for consistency |
| phpMyAdmin | Remove; provide read-only SQL console for admins (passkey step-up) | Remove/Replace | Web DB UIs are frequent RCE targets; keep minimal tools |
| Cron jobs UI | Allowlisted scheduled jobs (templates) or per-user systemd timers | Replace | Prevent arbitrary command execution; stable scheduling |
| Metrics & resource usage | Minimal per-service usage & limits (CPU/RAM/Disk/BW) | Keep | High value for customers & ops |
| Log viewer | Scoped logs (app/web access) + export; admin immutable audit logs | Simplify | Make troubleshooting safe and fast |
| Two-factor authentication (TOTP/SMS) | WebAuthn passkeys + hardware keys only; no SMS MFA | Replace | Passkeys resist phishing and credential stuffing |
| Security advisor | Minimal baseline checks + remediation guidance | Simplify | Avoid “checkbox theater”; focus on real issues |
| Firewall management | No raw firewall UI; provide safe profiles (Nginx ports, SSH) | Replace | Firewall UI often becomes root shell by proxy |
| Shell access | Never exposed in UI | Remove | Hard rule: no root/shell exposure |
| Plugin ecosystem | No plugin runtime in Phase 1 | Remove | Plugins expand attack surface and maintenance |
| Multi-server management | Single-node only; optional remote agent later | Remove | Keep scope aligned with 2vCPU/4GB |
| Reseller management | Not in Phase 1; minimal “sub-accounts” later | Remove/Simplify | Reseller stacks replicate cPanel complexity |
| WHM transfer tools | Purpose-built migration from cPanel backups | Replace | Narrow migration path with validation + rollback |

High-value focus (Phase 1):
- Secure auth (passkeys), service access, domains/DNS basics, files, Postgres provisioning, SSL, usage, audit logs, WHMCS SSO + enforcement.

---

## 2) Product Roadmap & Phase Tracking

### Phase 1 — “Secure Core + WHMCS + Operability”

Objectives:
- Deliver a minimal customer panel for core tasks.
- Implement passkey-first auth and step-up requirements.
- Integrate WHMCS SSO + suspension enforcement.
- Provide safe admin/operator layer without root/shell.
- Ship an idempotent installer for AlmaLinux/Ubuntu + Docker single-node.

Feature scope:
- Auth: password + WebAuthn registration; passkey required for admin/operator roles.
- Step-up: enforced for privileged actions.
- RBAC: Customer, Support, Operator, Super-admin.
- Customer panel:
  - Dashboard
  - Services (feature-gated)
  - Domains + basic DNS records
  - Files (browse/upload; no arbitrary command execution)
  - Databases (Postgres DB/user create; rotate credentials)
  - Security: Passkeys, API tokens
  - Usage & limits
- Admin panel:
  - Customers/services view (synced from WHMCS)
  - Plans & feature flags mapping
  - Infrastructure status (health/metrics)
  - Audit logs
  - Task runner (safe operations)
- WHMCS integration:
  - Signed SSO deep link
  - Webhook listener for service status changes
  - Feature/limit mapping
  - Redirect billing actions to WHMCS
- Observability:
  - Health endpoints, structured logs, audit events
  - Minimal metrics (Prometheus text or JSON)

Security milestones:
- WebAuthn (registration + assertion) with resident keys support.
- Password-only access blocked for sensitive routes.
- Device-bound sessions + short-lived access tokens.
- Global rate limiting + per-account lockout.
- Immutable audit logging with hash-chaining.

Billing milestones:
- WHMCS SSO token validation + one-time use.
- Webhook processing for suspension/unsuspension.
- Enforcement layer prevents access when suspended.

Exit criteria:
- Fresh install completes unattended with sane defaults.
- Passkey required for admin/operator actions (enforced server-side).
- WHMCS SSO works with replay protection.
- Suspension in WHMCS blocks panel usage for that service.
- Upgrade flow supports zero/low downtime for API + migrations.

### Phase 2 — “Migration + Advanced Ops + Optional Email”

Objectives:
- Provide reliable cPanel→Lean migrations with dry-run and rollback.
- Expand domain/DNS/SSL flows.
- Add optional email management (still lean) if required.
- Harden admin operations and introduce safer automation templates.

Feature scope:
- Migration tooling:
  - Import cPanel backups (.tar.gz)
  - Validate integrity, dry-run, execute, rollback
  - Map users/domains/db/email, report diffs
- Ops:
  - Backup/restore automation improvements
  - Automated cert renewals with status
  - Extended audit log exports
- Optional email (only if demanded):
  - Account creation, password rotation, basic forwards
  - No bundled webmail

Security milestones:
- Admin task runner policies (OPA-like) or signed task manifests.
- Stronger insider controls: 4-eyes approval for destructive tasks.
- Per-service encryption keys and secret rotation.

Billing milestones:
- Plan changes reflected within minutes via webhook sync.
- Service limits enforced at API + agent.

Exit criteria:
- Migration success rate target met with documented rollback.
- Operator workflows require passkey step-up.
- All privileged actions are auditable and exportable.

### Phase Tracking Documentation Template

Copy/paste template per phase:

```md
# Phase X — <Name>

## Goals
- 

## Implemented Features
- 

## Deferred Features
- 

## Known Risks
- Risk:
  - Impact:
  - Mitigation:

## Security Status
- Passkeys:
- Step-up enforcement:
- Session lifecycle:
- Rate limiting:
- Audit logging:

## Billing Integration Status (WHMCS)
- SSO:
- Webhooks:
- Product/limits mapping:
- Suspension enforcement:

## Test Status
- Unit:
- Integration:
- Security:
- UAT:

## Deployment Readiness Checklist
- [ ] Fresh OS install validated (AlmaLinux)
- [ ] Fresh OS install validated (Ubuntu)
- [ ] Docker single-node validated
- [ ] Migrations applied successfully
- [ ] Rollback tested
- [ ] Secrets initialized and stored safely
- [ ] Health checks green
- [ ] Audit logs verified
- [ ] WHMCS suspension test passed
```

---

## 3) What Not To Build (Critical)

Explicit exclusions:

- Full reseller/WHM ecosystem
  - Why: recreates cPanel complexity; expands RBAC and billing edge cases.
- Plugin marketplace / third-party code execution
  - Why: catastrophic supply-chain risk; unbounded maintenance.
- In-browser terminal / shell / “Run command” buttons
  - Why: becomes root exposure; impossible to secure long-term.
- Generic cron “run any command” editor
  - Why: privilege escalation and persistence vector.
- Bundled webmail (Roundcube) and full mail server UI in Phase 1
  - Why: high vulnerability surface; mail stacks are operationally heavy.
- phpMyAdmin-like DB admin UI
  - Why: historically high-risk; unnecessary for most customers.
- DNS clustering and multi-node orchestration
  - Why: not aligned to single-node 2vCPU/4GB; operational complexity.
- SMS-based MFA
  - Why: SIM swap and interception; violates passkey-first rule.

---

## 4) Wireframes (ASCII)

### Customer Control Panel

```
┌───────────────────────────────────────────────────────────────┐
│ LOGO   Dashboard   Services   Billing   👤 Account             │
├───────────────────────────────────────────────────────────────┤
│ ▸ Overview                                                     │
│ ▸ Services (feature-gated)                                     │
│ ▸ Domains                                                      │
│ ▸ Files (upload / browser)                                     │
│ ▸ Databases                                                    │
│ ▸ Security (Passkeys, API keys)                                │
│ ▸ Usage & Limits                                               │
├───────────────────────────────────────────────────────────────┤
│ Overview                                                       │
│  Service:  VPS-123   Status: Active                            │
│  Plan:     Starter   Limits: CPU 2 | RAM 4GB | Disk 80GB        │
│                                                               │
│  Quick Actions (non-privileged):                               │
│   [Upload Files] [Create DB] [Add Domain] [View Usage]          │
│                                                               │
│  Notices:                                                      │
│   - Billing actions happen in WHMCS → [Open Billing]            │
└───────────────────────────────────────────────────────────────┘
```

### Admin (WHM-like) Panel

```
┌───────────────────────────────────────────────────────────────┐
│ ADMIN PANEL   Infrastructure   Audit Logs   👑 Admin            │
├───────────────────────────────────────────────────────────────┤
│ ▸ Customers                                                    │
│ ▸ Plans & Feature Flags                                        │
│ ▸ Infrastructure                                               │
│ ▸ Migrations                                                   │
│ ▸ Security (RBAC, Passkeys)                                    │
├───────────────────────────────────────────────────────────────┤
│ Infrastructure                                                 │
│  Health:  API ✓  Agent ✓  Nginx ✓  Postgres ✓                  │
│  Queue:   Tasks 2 pending                                      │
│  Alerts:  0 critical                                           │
│                                                               │
│  Privileged Actions (Passkey required):                         │
│   [Rotate Secrets] [Reload Nginx] [Run Migration] [Suspend Svc]  │
└───────────────────────────────────────────────────────────────┘
```

### Authentication & Passkey Flow

```
┌──────────────────────────────────────────────────────────┐
│ Login: email + password                                  │
│  └─ If action is non-sensitive: allow with low-priv token │
│ Step-Up: WebAuthn passkey required                        │
│  └─ Required for: admin/support actions, billing links,   │
│     infra operations, API key creation, secret viewing    │
│ Privileged: passkey-only (no password-only sessions)      │
│  └─ Admin / Operator roles must always use passkeys       │
└──────────────────────────────────────────────────────────┘
```

### WHMCS → Control Panel Flow

```
WHMCS Client Area
[ Manage Service ]
        |
        v  (Signed SSO Token: short-lived + single-use)
Control Panel
  -> Validate token + mark used
  -> Resolve service + status (Active/Suspended)
  -> Create session bound to service + user
  -> Show Dashboard

(Service Suspended)
  -> Read-only view + “Go to WHMCS” for billing
```

---

## 5) WHM-like Admin Layer (Without Root Risk)

### Design goals
- Never expose root credentials, shell, or arbitrary command execution.
- All privileged actions must be:
  - passkey-gated (step-up)
  - pre-defined and allowlisted
  - parameter-validated
  - auditable and replay-resistant

### Components
- **API (FastAPI)**: authorization + policy engine + task dispatcher.
- **Agent (local daemon)**: executes safe tasks on host.
- **Task Runner**: a minimal privileged runner invoked via systemd, not via shell.
- **Sudo allowlist**:
  - A fixed set of commands with fixed arguments (or strict patterns).
  - No variable command strings.

### Execution model (no shell)
1. Admin requests “Reload Nginx”.
2. API verifies:
   - role permission
   - step-up satisfied (WebAuthn assertion within last N minutes)
   - request is within policy (service state, rate limits)
3. API writes an **admin_task** row and pushes job to queue.
4. Agent pulls job, validates task signature and arguments, then executes:
   - systemd unit restart/reload
   - Nginx config test + reload
   - certificate renew
   - database migration (safe wrapper)
5. Agent returns status + stdout/stderr summary.
6. API records result into immutable audit log.

### RBAC separation
- **Customer**: manage their service resources; no infra actions.
- **Support**: view customer status and logs; limited resets; no infra.
- **Operator**: infrastructure actions (reload, restart, migrations); no billing.
- **Super-admin**: policy changes, role assignment, WHMCS integration keys.

### Security rules
- Operator and Super-admin MUST use passkeys (no password-only sessions).
- Every privileged action requires a fresh passkey assertion (step-up window).
- Admin tasks are signed by API and verified by agent.
- No direct SSH keys managed in UI.

### Immutable audit logging
- Append-only audit table with hash chaining:
  - Each event stores `prev_hash` and `event_hash = HMAC(secret, canonical_event || prev_hash)`
- Periodic export to WORM storage (optional): local append-only file + offsite.

---

## 6) Migration Tooling (cPanel → New Panel)

### Inputs
- cPanel backup archives (`.tar.gz` / `.tar`) in well-known formats.

### Workflow
1. **Upload/Provide path**: admin provides backup path (via agent-managed upload) or pre-uploaded file.
2. **Validate**:
   - archive integrity
   - expected structure
   - sizes, quotas, disk availability
   - malware scan (optional baseline)
3. **Dry-run**:
   - compute plan: users/domains/db/email mapping
   - list diffs and potential conflicts
   - estimate time and disk impact
4. **Execute**:
   - create users/service resources
   - import domain configs
   - import DB dumps into Postgres (with mapping)
   - import mailboxes if Phase 2 email enabled
5. **Verify**:
   - checksums / counts / sample queries
   - domain resolution readiness
6. **Activate**:
   - switch Nginx vhosts
7. **Rollback**:
   - revert vhosts
   - restore previous DB snapshot
   - restore files snapshot

### Design constraints
- Migrations run as queued jobs via agent (no inline long requests).
- Every migration has a job ID and resumable steps.
- Rollback is always available until “Finalize” is confirmed.

---

## 7) Zero-Trust Security Model

### Authentication flows
- **Login (baseline)**: email + password → low-priv session token.
- **Passkey registration**: allowed after baseline login with step-up requirement.
- **Step-up**: WebAuthn assertion required for sensitive operations.
- **Passkey-only login**: WebAuthn assertion → full session based on role.

### Step-up policy
Sensitive operations require step-up within last N minutes (e.g., 5 minutes):
- admin/operator/support actions
- any billing-related deep link
- creating/revoking API keys
- viewing secrets or recovery codes (if any)
- infrastructure operations (restart/reload)

### RBAC boundaries
- Enforce on every API route.
- Deny by default.
- Separate “support” vs “operator” capabilities to reduce insider risk.

### Session lifecycle
- Access tokens: short-lived (5–10 minutes).
- Refresh tokens: bound to device + IP range heuristics; rotate on use.
- Sessions tied to:
  - user_id
  - service_id (WHMCS service)
  - auth_strength: `password_only` vs `passkey`
  - last_step_up_at

### Rate limiting & brute-force
- Per-IP and per-account rate limits.
- Exponential backoff and lockout after repeated failures.
- WebAuthn endpoints also rate-limited.

### Secret handling
- Secrets never returned after creation except once (display-once).
- Encryption at rest for sensitive fields:
  - use envelope encryption keys stored in OS key store or file permissions + rotation.
- Separate secrets for:
  - DB
  - JWT/signing
  - WHMCS signing

### Audit logging schema (core)
Recommended minimal schema:
- `audit_event(id, ts, actor_user_id, actor_role, actor_ip, action, target_type, target_id, service_id, request_id, result, details_json, prev_hash, event_hash)`

---

## 8) Deployment Strategy

### Fresh OS installs (AlmaLinux / Ubuntu)
- Idempotent installer:
  - installs OS packages
  - provisions Postgres
  - configures Nginx
  - installs app + agent
  - creates systemd units
  - initializes secrets
  - runs DB migrations
  - config test + health checks

Health checks:
- `GET /health` (API)
- `GET /ready` (DB + dependencies)
- Agent heartbeat
- Nginx config test before reload

Recovery:
- `panelctl status` and `panelctl repair` commands (root-only CLI, not UI).

### Docker single-node
- Compose with:
  - `api` (uvicorn/gunicorn)
  - `nginx`
  - `postgres`
  - `agent` (with restricted mounts)

Constraints:
- No orchestration beyond compose.
- Host-level tasks limited or disabled in container mode.

---

## 9) Update & Patch Management

Principles:
- Zero/low downtime for API updates.
- Safe migrations with backward-compatible steps.

Strategy:
- Versioned releases with signed artifacts.
- Blue/green style at process level:
  - start new API process, pass health, swap Nginx upstream.
- DB migrations:
  - use Alembic with transactional migrations.
  - split large migrations into additive steps.
- Rollback:
  - keep previous app version and migration down scripts where possible.
  - for irreversible migrations: provide forward-only + backup snapshot.

---

## 10) Production File & Folder Structure

Recommended repo layout:

```
panel/
  backend/
    app/
      main.py
      config/
        settings.py
      api/
        routes/
          auth.py
          sso_whmcs.py
          services.py
          domains.py
          files.py
          databases.py
          admin_tasks.py
          audit.py
        deps.py
      auth/
        passwords.py
        webauthn/
          registration.py
          assertion.py
          models.py
          verification.py
        stepup.py
        sessions.py
      rbac/
        roles.py
        permissions.py
        policy.py
      whmcs/
        client.py
        sso.py
        webhooks.py
        mapping.py
      featureflags/
        limits.py
        enforcement.py
      admin/
        tasks/
          definitions.py
          validators.py
          signer.py
        approvals.py
      migrations/
        alembic/
      audit/
        schema.py
        hashchain.py
        exporter.py
      observability/
        logging.py
        metrics.py
        health.py
    tests/
      unit/
      integration/
  frontend/
    templates/
      base.html
      dashboard.html
      services.html
      admin/
    static/
      css/
      js/
  deploy/
    systemd/
      panel-api.service
      panel-agent.service
    nginx/
      panel.conf
    docker/
      docker-compose.yml
  scripts/
    install.sh
    update.sh
    backup.sh
    restore.sh
    panelctl
  docs/
    security/
    operations/
    whmcs/
    migrations/
```

Notes:
- WebAuthn code is isolated and testable.
- WHMCS integration is a distinct module with strict boundaries.
- Admin tasks have definitions + validators + signer to prevent arbitrary execution.

---

## Appendix A — WHMCS Integration Details (SSO + Enforcement)

### SSO deep-link requirements
- WHMCS is the source of truth.
- Token must be signed, short-lived, single-use.

### Token shape (recommended)
- Signed payload (JWS compact JWT):
  - `iss = whmcs`
  - `sub = whmcs_user_id`
  - `service_id = whmcs_service_id`
  - `jti = random nonce`
  - `exp = now + 60s`
  - `return_to = /app/services/<id>`

### Signing options
- Preferred: asymmetric (WHMCS plugin signs with private key; panel verifies with public key).
- Alternative: shared HMAC secret stored in WHMCS and panel.

### Single-use enforcement
- Store `jti` in Redis/Postgres with TTL; reject if already used.

### Suspension enforcement
- WHMCS webhook → panel updates `service.status`.
- Every request is authorized against service status:
  - Suspended: read-only panel + redirect billing to WHMCS.

---

## Appendix B — Minimal privileged sudo allowlist example

Example commands (illustrative):
- `systemctl reload nginx`
- `systemctl restart panel-agent`
- `panelctl run-migrations --revision <safe>` (revision allowlisted)

Rule: never allow arbitrary args; validate against strict patterns.
