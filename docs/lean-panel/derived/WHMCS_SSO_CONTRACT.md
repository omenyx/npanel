# WHMCS → Panel SSO Contract (Lock Early)

Authoritative source:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../LEAN_PANEL_SPEC.md)

This document is the implementation contract that both sides must follow.

## Actors
- WHMCS: creates SSO deep-link token.
- Panel: validates token, enforces single-use, creates session.

## Transport
- Recommended: browser redirect to panel endpoint:
  - `GET /sso/whmcs?token=<signed>`

## Token requirements
- Short-lived: `exp <= now + 60s`
- Single-use: `jti` must be unique, stored/checked server-side with TTL
- Signed by WHMCS side
- Must bind to:
  - WHMCS user identity
  - WHMCS service identity

## Token format (locked)
- JWS compact serialization using JWT claims (i.e., a signed JWT).
- Recommended algorithms: `EdDSA` (Ed25519) or `RS256`.

## Claims (required)
- `iss`: fixed string, e.g. `whmcs`
- `sub`: WHMCS user ID (string)
- `service_id`: WHMCS service ID (string)
- `jti`: random nonce (string)
- `iat`: issued-at (unix seconds)
- `exp`: expiry (unix seconds)
- `return_to`: relative panel path (string)

## Signing
Preferred: asymmetric
- WHMCS signs with private key
- Panel verifies with public key

Alternative: HMAC shared secret
- Only if key management constraints prevent asymmetric

## Replay protection
- Store `jti` in Postgres or Redis with TTL (>= exp)
- Reject if exists
- Mark used atomically (insert unique constraint)

## Panel responses
- Success: 302 redirect to `return_to`
- Failure:
  - invalid signature → 401
  - expired token → 401
  - replay detected → 409
  - service suspended → 302 to read-only landing

## Suspension enforcement
- Panel must check service status on every request.
- WHMCS webhooks update status; panel also reconciles periodically.
