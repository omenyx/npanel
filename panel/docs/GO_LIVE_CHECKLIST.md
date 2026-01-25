# Lean Panel — Go-live checklist

## Before DNS cutover
- Confirm PostgreSQL backups and PITR strategy.
- Confirm `alembic upgrade head` runs cleanly.
- Confirm WHMCS SSO public key is correct (`PANEL_WHMCS_PUBLIC_KEY_PEM`).
- Confirm webhook secret matches WHMCS config (`PANEL_WHMCS_WEBHOOK_SECRET`).
- Confirm service status mapping:
  - Active → full access
  - Suspended → read-only
  - Terminated → deny

## Security
- Confirm HTTPS termination (Nginx + Let’s Encrypt).
- Confirm admin endpoints are not exposed (customer-only panel).
- Confirm audit table is persisting (`audit_events`).

## PowerDNS (if enabled)
- Verify `PANEL_PDNS_API_URL` and `PANEL_PDNS_API_KEY`.
- Verify zone create works in the panel (`/dns`) for an active service.
- Verify zone changes are blocked for suspended services.

## Mail (if enabled)
- Verify `mail_domains` and `mailboxes` tables populate from API.
- Verify Postfix/Dovecot are configured to query Postgres for virtual users.
  - This repo currently provides the control-plane tables + API only.

## Migration (if enabled)
- Verify `migration_jobs` create/list API works.
- Verify server-side runner can execute one dry-run job:
  - `python panel/scripts/run_migration_job.py --job-id <id> --db-dsn "$PANEL_POSTGRES_DSN"`
  - This runner is a scaffold; production should use a hardened agent.
