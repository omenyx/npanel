<?php
// Roundcube config template
$config = [];

// IMAP
$config['default_host'] = 'tls://dovecot';
$config['default_port'] = 993;

// SMTP
$config['smtp_server'] = 'tls://postfix';
$config['smtp_port'] = 587;
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';

// Product name
$config['product_name'] = 'Lean Panel Webmail';

// Prefer secure cookies when behind TLS-terminating proxy.
$config['force_https'] = false;

// Database (use sqlite by default inside container)
// Configure to Postgres if desired.
