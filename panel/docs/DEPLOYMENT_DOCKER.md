# Lean Panel — Docker deployment (single node)

This is the fastest unattended path for a single-node install.

## Prereqs
- Docker + Docker Compose
- A reachable PostgreSQL (or use the included container)

## Run
From repo root:

```bash
cd panel/deploy/docker
docker compose up --build
```

What happens:
- `postgres` starts
- `api` runs `alembic upgrade head` then starts Uvicorn
- `nginx` reverse proxies to the API and Roundcube webmail
- `postfix` + `dovecot` start for SMTP/IMAPS
- `webmail` (Roundcube) is served at `/webmail/`

Default ports:
- Nginx: `http://localhost:8080/`
- Webmail: `http://localhost:8080/webmail/`
- API: `http://localhost:8000/`

Mail ports:
- SMTP: `25`, Submission: `587`
- IMAPS: `993`

## Required env vars (API)
Set these in `docker-compose.yml` (or env file in production):
- `PANEL_POSTGRES_DSN`
- `PANEL_WHMCS_PUBLIC_KEY_PEM` (SSO verification)
- `PANEL_WHMCS_WEBHOOK_SECRET` (webhook HMAC)

Optional:
- `PANEL_SSO_TOKEN_AUDIENCE`
- `PANEL_PDNS_API_URL`, `PANEL_PDNS_API_KEY`, `PANEL_PDNS_SERVER_ID`

## WHMCS webhook
Send a signed webhook to:
- `POST /webhooks/whmcs`

The payload must include a `service_id`/`serviceid` and a `status`.
Feature flags accepted either top-level or under `features`:
- `dns_enabled`, `mail_enabled`, `migration_enabled`

Example headers:
- `X-WHMCS-Signature: <hex hmac-sha256(body)>`
