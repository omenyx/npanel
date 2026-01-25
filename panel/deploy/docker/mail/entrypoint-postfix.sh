#!/bin/sh
set -eu

# Generate self-signed cert if none provided (safe default for unattended UAT).
if [ ! -f /etc/ssl/mail/tls.crt ] || [ ! -f /etc/ssl/mail/tls.key ]; then
  echo "[postfix] generating self-signed TLS cert"
  openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
    -subj "/CN=mail.local" \
    -keyout /etc/ssl/mail/tls.key -out /etc/ssl/mail/tls.crt >/dev/null 2>&1
fi

# Ensure postfix dirs exist
mkdir -p /var/spool/postfix/private

# Run postfix in foreground
exec /usr/sbin/postfix start-fg
