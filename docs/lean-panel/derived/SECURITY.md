# Security (Derived)

Authoritative source:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../LEAN_PANEL_SPEC.md)

## Non-negotiables
- Passwords will be compromised; password-only access must never grant sensitive access.
- WebAuthn passkeys required for Operator/Super-admin roles.
- Step-up required for privileged operations (short window, server-side enforced).
- No shell/root exposure in UI.

## Authentication & Step-up
- Baseline login: email/password → low-priv session.
- Passkey login: WebAuthn assertion → higher-auth-strength session.
- Step-up policy (examples):
  - Admin/support/operator actions
  - API key creation/revocation
  - Viewing any sensitive secret material
  - Any billing deep-link/redirect
  - Infrastructure operations via task runner

## Session lifecycle
- Short-lived access tokens (5–10 min)
- Refresh tokens rotate-on-use
- Session binds: user_id, service_id, auth_strength, last_step_up_at, device hints

## Audit logging (immutable)
- Append-only audit event stream.
- Hash chain per event (`prev_hash` → `event_hash`).
- Export option to WORM/offsite storage.

## Security implementation checklist
- [ ] WebAuthn registration + assertion verification
- [ ] Policy engine: route permission + step-up required checks
- [ ] Rate limiting (per-IP + per-account)
- [ ] Secrets encryption at rest + rotation
- [ ] Immutable audit chain verification utility
