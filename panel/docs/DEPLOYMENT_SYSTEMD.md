# Lean Panel — systemd deployment (host install)

This is a host-native install path. You should run Alembic migrations before starting the API.

## Layout
Suggested:
- `/opt/panel/backend` (python venv + backend code)
- `/opt/panel/frontend` (templates/static)
- `/etc/panel/panel.env` (environment variables)

Mail stack templates (Phase 1):
- `panel/deploy/mail/postfix/*`
- `panel/deploy/mail/dovecot/*`
- `panel/deploy/mail/roundcube/*`

For Nginx with Roundcube proxying, use:
- `panel/deploy/nginx/panel.host.conf`

## Migrations
The unit template runs migrations on startup:
- `ExecStartPre=... alembic upgrade head`

So deployment is unattended as long as `panel.env` is present.

## Required env vars
In `/etc/panel/panel.env`:
- `PANEL_POSTGRES_DSN=postgresql+asyncpg://...`
- `PANEL_WHMCS_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----...`
- `PANEL_WHMCS_WEBHOOK_SECRET=...`

Optional:
- `PANEL_PDNS_API_URL=...`
- `PANEL_PDNS_API_KEY=...`
- `PANEL_PDNS_SERVER_ID=localhost`

## Enable service
- Install template unit from `panel/deploy/systemd/panel-api.service`
- `systemctl daemon-reload`
- `systemctl enable --now panel-api`
