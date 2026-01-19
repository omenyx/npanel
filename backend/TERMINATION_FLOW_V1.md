## Hosting Service Termination Flow (V1 Hardening)

- Termination is a two-phase operation and cannot be executed as a single call.
- Phase 1: `POST /v1/hosting/services/:id/terminate/prepare`
  - Sets service status to `termination_pending`.
  - Generates a one-time confirmation token (10 minute TTL).
  - Writes an audit log entry with `termination_prepare` action.
- Phase 2: `POST /v1/hosting/services/:id/terminate/confirm`
  - Requires the confirmation token in the request body.
  - Verifies token, expiry, and status.
  - Executes full termination across adapters (user/web/PHP-FPM/DB/DNS/Mail/FTP).
  - Sets status to `terminated` and clears the token.
- Optional cancel: `POST /v1/hosting/services/:id/terminate/cancel`
  - Only allowed while status is `termination_pending`.
  - Restores status to `active` and clears the token.
- Direct calls to `POST /v1/hosting/services/:id/terminate` now fail with a 400 error.

