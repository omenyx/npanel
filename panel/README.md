# Lean Panel (Scaffold)

This folder is a scaffold for the FastAPI/HTMX/Postgres implementation described in:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../docs/lean-panel/LEAN_PANEL_SPEC.md)

## What’s included
- FastAPI app skeleton: `panel/backend/app/main.py`
- Health endpoints: `/health`, `/ready`
- WHMCS SSO endpoint (signed JWT): `GET /sso/whmcs?token=...`
- WHMCS webhook receiver (HMAC): `POST /webhooks/whmcs`
- Nginx config template
- systemd unit template
- Docker Compose (single-node)

## Important
Use the locked contract in:
- [docs/lean-panel/derived/WHMCS_SSO_CONTRACT.md](../docs/lean-panel/derived/WHMCS_SSO_CONTRACT.md)

Migrations are handled via Alembic; Docker/systemd paths run `alembic upgrade head` automatically.

## Next implementation steps
- Flesh out mail (Postfix/Dovecot/Roundcube) provisioning and DNS record editing UX.
- Harden the migration runner into a dedicated agent (allowlists, key handling, auditing).
- Add Alembic autogeneration workflow and CI checks.
