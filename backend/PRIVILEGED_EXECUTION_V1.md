V1 PRIVILEGED EXECUTION MODEL
=============================

1. Execution identity
---------------------

In V1 the backend process is expected to run as `root` inside an isolated
environment (VM or container) that is dedicated to the hosting control plane.
Panel authentication is intentionally decoupled from OS authentication; panel
users never authenticate as OS users.

Rationale:
- The hosting adapters call system tools such as `useradd`, `usermod`,
  `userdel`, `nginx`, `php-fpm`, `mysql`, `rndc`, `pdnsutil`, and `rsync`
  directly via `spawn`, without `sudo`.
- These tools typically require root privileges. Running the backend as root
  avoids a secondary privilege escalation channel inside the application
  itself and keeps the privilege boundary at the OS/container level.
- The application already constrains what it executes (no shell string
  interpolation, only fixed binaries resolved by the ToolResolver).

Recommended deployment:
- Run the backend in a dedicated VM or container.
- Limit inbound traffic to trusted frontends or an internal network.
- Do not colocate untrusted workloads in the same OS instance.

2. Privilege boundaries
-----------------------

Because the backend process runs as root, privilege boundaries are enforced at
these layers:

- Which binaries are called:
  - All system interactions go through the strongly typed hosting adapters and
    the migration service.
  - Binaries are resolved via the ToolResolver, which only accepts safe tool
    names and searches a fixed set of system paths.
  - There is no generic “run arbitrary command” API.

- What arguments are used:
  - Adapters build argument arrays, never shell strings.
  - Unsafe user input is either rejected or normalised (for example domain and
    username sanitisation in hosting service and adapters).
  - SQL for MySQL management is constructed from validated identifiers and
    escaped strings.

- OS level:
  - The root process is confined by the container/VM security boundary, file
    permissions and network policy.
  - Operators can use standard mechanisms (AppArmor/SELinux, Kubernetes
    securityContext, systemd unit limits) to further constrain the process.

V1 does not introduce a sudo-based model or agent user because that would
require a broader refactor of how binaries are invoked. The current model
keeps the privilege story simple and auditable at the cost of requiring an
isolated runtime environment.

3. Environment sanitation
-------------------------

All subprocesses spawned by the backend use a sanitised environment built by
`buildSafeExecEnv` in `src/system/exec-env.ts`.

Key properties:
- Fixed PATH:
  - PATH is forced to either:
    - `NPANEL_FIXED_PATH` (if set by the operator), or
    - `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`.
  - This prevents user-controlled PATH from influencing which binaries are
    executed.

- Whitelisted variables:
  - Only a small set of generic OS variables are passed through:
    - `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_COLLATE`, `LC_MESSAGES`
    - `TZ`, `HOME`, `SHELL`, `LOGNAME`, `USER`
  - All other non-NPANEL variables are dropped.

- Operator-controlled NPANEL_* variables:
  - Every environment variable starting with `NPANEL_` is propagated.
  - These variables define:
    - Which adapters are active.
    - Paths for configuration directories (for example PHP-FPM pool root,
      DNS zone directories).
    - Optional arguments for individual tools.
  - They are assumed to be set by the operator via systemd, container
    manifests or similar; application users have no influence over them.

4. Adapter enforcement
----------------------

All shell-based adapters and the migration rsync logic use the same execution
pattern:

- Binaries:
  - Paths are resolved using `ToolResolver` (`src/system/tool-resolver.ts`).
  - `ToolResolver`:
    - Enforces a safe tool name pattern (`[a-zA-Z0-9._+-]+`).
    - Resolves via `command -v`, `which`, or a fixed list of fallback
      directories.
    - Caches resolved paths in memory.
    - Exposes diagnostic information through the `/system/tools/status`
      endpoint.

- Process spawning:
  - All `spawn` calls pass:
    - `stdio: ['ignore', 'pipe', 'pipe']`
    - `env: buildSafeExecEnv()`
  - This applies to:
    - Shell user adapter (`hosting-shell-user.adapter.ts`).
    - Shell web adapter (`hosting-shell-web.adapter.ts`).
    - Shell PHP-FPM adapter (`hosting-shell-php-fpm.adapter.ts`).
    - Shell MySQL adapter (`hosting-shell-mysql.adapter.ts`).
    - Shell DNS adapter (`hosting-shell-dns.adapter.ts`).
    - Shell mail adapter (`hosting-shell-mail.adapter.ts`).
    - Shell FTP adapter (`hosting-shell-ftp.adapter.ts`).
    - Migration service rsync execution (`migration.service.ts`).

- No bypass:
  - There is no code path that invokes `spawn` for hosting or migration
    purposes outside these modules.
  - There is no shell interpolation (`spawn` is always called with `command`
    and `args[]`).
  - Tool names and arguments are either constants or constructed from
    validated, domain-specific data.

Failure behaviour:
- If a required tool is missing, `ToolResolver` throws `ToolNotFoundError`.
  Adapters catch this and log a structured `tool_not_found` entry before
  failing the operation.
- If the OS denies execution (for example insufficient filesystem permissions),
  the exit code is non-zero, the adapter logs a failure with captured stdout
  and stderr, and the hosting or migration operation fails fast.

5. Auditing and debugging
-------------------------

Operators can audit privileged operations using three main sources:

- Hosting logs:
  - Stored in the `host_logs` table via the `HostingLog` entity.
  - Each entry includes:
    - `serviceId`, `adapter`, `operation`, `targetKind`, `targetKey`,
      `success`, `dryRun`, `details`, `errorMessage`, `createdAt`.
  - Accessible through the API:
    - `GET /v1/hosting/services/:id/logs`
  - Also visible in the admin UI logs panel for each hosting service.

- Migration logs:
  - Stored in the `migration_logs` table via the `MigrationLog` entity.
  - Each entry includes:
    - `job`, optional `account`, `level`, `message`, `context`, `createdAt`.
  - Exposed via the migration endpoints and can be used to trace rsync activity
    and other migration-related operations.

- System logs:
  - The Node.js process can be run under systemd or another supervisor so that
    stdout/stderr are captured.
  - When hosting logs are emitted with `NPANEL_HOSTING_LOG=json`, they produce
    structured JSON suitable for log aggregation.

6. Summary
----------

For V1 the privileged execution model is:
- Backend runs as root inside an isolated environment.
- All external commands are:
  - Resolved via a constrained ToolResolver.
  - Executed with a fixed PATH and sanitised environment.
  - Called through strongly typed adapters that validate inputs.
- Failures in tool resolution or execution:
  - Immediately abort the current hosting or migration operation.
  - Emit detailed, structured logs for auditing and debugging.

This model trades off the complexity of in-application privilege escalation
layers (sudo, agent daemons) in favour of a simpler and more easily audited
root-in-container deployment, which is appropriate for V1.
