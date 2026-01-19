PANEL AUTHENTICATION MODEL
==========================

This document describes how users authenticate to the Npanel web interface and
how that authentication is intentionally decoupled from the OS execution
identity used for hosting operations.

The goal is to make the following decisions explicit and non-negotiable for V1:

- Panel authentication uses its own user database, JWTs and roles.
- OS users (including `root`) exist only for service execution and are never
  used to log into the panel.
- Panel authentication is intentionally decoupled from OS authentication.

1. Panel authentication
-----------------------

- Users authenticate **only** as panel users stored in the panel database.
- Authentication mechanisms:
  - Email + password against the `iam_users` table.
  - JWT access token (`Authorization: Bearer …`) and long-lived refresh token.
  - Role-based access control enforced by guards.
- Roles:
  - `ADMIN`
  - `RESELLER`
  - `SUPPORT`
  - `CUSTOMER`
- Panel users:
  - Are **not** OS users.
  - Do **not** map to `/etc/passwd`.
  - Do **not** reuse OS passwords.
  - Do **not** authenticate via PAM or SSH.

Relevant implementation pieces:

- Entity: `User` in `src/iam/user.entity.ts` (email, passwordHash, role).
- Service: `IamService` in `src/iam/iam.service.ts`:
  - `createInitialAdmin` creates the first admin user with a bcrypt-hashed
    password.
  - `validateUser` checks credentials by comparing the supplied password
    against `passwordHash`.
- Controller: `IamController` in `src/iam/iam.controller.ts`:
  - `POST /v1/install/init` bootstraps the initial admin.
  - `POST /v1/auth/login` returns `{ ok, user, tokens }` on success.
- JWT strategy: `JwtStrategy` in `src/iam/jwt.strategy.ts`:
  - Extracts the Bearer token from the `Authorization` header.
  - Validates signature and expiration.
  - Loads the user from the panel database and attaches `{ id, email, role }`
    to the request.
- Guards: `JwtAuthGuard` and `RolesGuard`:
  - Ensure that protected endpoints require a valid JWT and a sufficient role.

2. OS execution identity
------------------------

- OS users (including `root` and per-site system users) exist **only** for:
  - Service execution (web server, PHP-FPM, MySQL, DNS, mail, FTP).
  - Resource ownership (files, processes, sockets).
- OS credentials:
  - Are never exposed to the UI or public API.
  - Are never accepted as panel login credentials.
  - Are managed by hosting adapters and deployment tooling, not by panel users.
- OS users:
  - Never log into the panel.
  - Are not looked up during `/v1/auth/login`.

Relevant implementation pieces:

- Privileged execution model: `PRIVILEGED_EXECUTION_V1.md`.
  - Backend runs as `root` inside an isolated environment.
  - Hosting adapters manage system users, PHP-FPM pools, vhosts, MySQL
    accounts, DNS zones, mailboxes and FTP accounts.
- Hosting user adapter: `src/hosting/hosting-shell-user.adapter.ts`.
  - Creates, updates, suspends and deletes system users for hosting services.
  - Is driven by hosting service state, not by panel login.
- Other shell adapters:
  - Web server, PHP-FPM, MySQL, DNS, mail and FTP adapters manage OS-level
    resources for hosting, again independent of panel authentication.

3. Security rationale
---------------------

Decoupling panel authentication from OS authentication is intentional and
serves several security goals:

- Prevent privilege escalation from UI compromise:
  - Compromise of a panel account does **not** yield OS credentials.
  - Attackers still need to break out of the application container/VM to reach
    `root` or system users.
- Avoid password lifecycle conflicts:
  - Panel passwords can be rotated, reset and enforced independently of OS
    password policies.
  - OS passwords can be managed by infrastructure teams without breaking panel
    access.
- Preserve least privilege and auditability:
  - Panel roles (`ADMIN`, `RESELLER`, `SUPPORT`, `CUSTOMER`) describe what a
    user can do within the panel, not what they can do on the OS.
  - OS-level operations are logged via hosting and migration logs, and are
    tied to hosting services, not interactive logins.
- Align with real hosting panels:
  - Mirrors separation used by WHM, DirectAdmin, ISPConfig and similar
    platforms where panel login accounts are distinct from system accounts.

Short statement for reuse:

> Panel authentication is intentionally decoupled from OS authentication.

4. Out-of-scope OS-based login
------------------------------

For V1 and the foreseeable roadmap:

- PAM-based authentication or direct OS-backed login is **explicitly out of
  scope**.
- The panel:
  - Does not attempt OS user lookup during login.
  - Does not call PAM or SSH for credential validation.
  - Does not reuse or expose OS passwords.

If OS-backed login is ever considered in a future version (for example V3+):

- It must be **additive** to the existing panel user model.
- It must still map identities into panel roles (`ADMIN`, `RESELLER`,
  `SUPPORT`, `CUSTOMER`).
- It must never expose OS credentials directly to the UI or API.
- It must preserve the principle that OS users are primarily about execution
  identity, not interactive panel sessions.

5. Invariants and guardrails
----------------------------

The following are treated as invariants for the codebase:

- `/v1/auth/login` and related endpoints **only** consult the panel database
  (`iam_users`) for credential validation.
- No code path:
  - Reads `/etc/passwd` or other system account databases for login.
  - Uses PAM, SSH or other OS auth mechanisms for panel login.
  - Stores or reuses OS passwords as panel passwords.
- Any future authentication feature:
  - Must continue to issue JWTs and rely on roles for authorization.
  - Must keep panel authentication logically separate from OS execution
    identity.

