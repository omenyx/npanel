# Lean Panel — Mail stack (Phase 1)

Phase 1 scope: functional virtual-hosted mail with Postfix + Dovecot (Postgres-backed users) and Roundcube webmail behind Nginx.

## Database source of truth
The panel writes to Postgres tables:
- `mail_domains(domain, service_id, ...)`
- `mailboxes(domain, localpart, password_hash, quota_mb, ...)`

Dovecot and Postfix read these tables directly via SQL map files.

Password hashing default:
- `SHA512-CRYPT` (broad Dovecot compatibility)

## Docker (unattended)
From repo root:

```bash
cd panel/deploy/docker
docker compose up --build
```

Exposed services (defaults):
- Panel via Nginx: `http://localhost:8080/`
- Roundcube: `http://localhost:8080/webmail/`
- SMTP: ports `25` and `587`
- IMAPS: port `993`

## Host install (outline)
You can install Postfix/Dovecot/Roundcube with distro packages and use the templates under:
- `panel/deploy/mail/postfix/*`
- `panel/deploy/mail/dovecot/*`
- `panel/deploy/mail/roundcube/*`

For Nginx, use:
- `panel/deploy/nginx/panel.host.conf`

Notes:
- Ensure Postfix has `postfix-pgsql` and Dovecot has `dovecot-pgsql`.
- Provide real TLS certs at `/etc/ssl/mail/tls.crt` and `/etc/ssl/mail/tls.key`.

## Minimal end-to-end validation
1. Use WHMCS webhook to enable mail for a service (`mail_enabled: true`) and create a session.
2. Create domain + mailbox via API.
3. Log in to Roundcube with `user@domain` and the mailbox password.

This repo ships a safe-by-default setup for UAT; production should replace the self-signed mail TLS certs with Let’s Encrypt.
