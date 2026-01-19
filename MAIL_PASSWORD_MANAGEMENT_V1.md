# Mail Password Management (V1)

## Architecture

Npanel V1 provides a centralized mechanism for managing mailbox passwords, ensuring that Dovecot (and by extension Exim) remains the single source of truth for authentication. Npanel **NEVER** stores plaintext mailbox passwords in its database.

### Components

1.  **Dovecot/Exim**: The authoritative authentication backend. Passwords are stored in a format compatible with both services (e.g., crypt/SHA512-CRYPT) managed via system tools.
2.  **Npanel Mail Adapter**: An abstraction layer that executes privileged system commands (`passwd`, `list`) to modify the backend state.
3.  **Npanel API**: Exposes authenticated endpoints for customers to update passwords.
4.  **Roundcube**: Configured to call the Npanel API for password changes, ensuring consistent policy enforcement and audit logging.
5.  **Customer Dashboard**: A minimal UI for customers to view mailboxes and update passwords.

## Password Flow

### 1. Customer Dashboard Flow
1.  Customer logs in to Npanel Customer Dashboard.
2.  Views list of mailboxes for their service (read-only list fetched from backend).
3.  Initiates "Change Password".
4.  Frontend calls `POST /v1/customer/hosting/services/:id/mailboxes/password`.
5.  Backend validates ownership and password strength.
6.  Backend invokes `ShellMailAdapter.updatePassword()`.
7.  Adapter executes system command (e.g., `doveadm pw` or custom script) to update the password store.

### 2. Roundcube Integration Flow
Roundcube does **NOT** modify passwords directly. It uses the `password` plugin configured with the `http` driver.

**Configuration:**
- **Driver**: `http`
- **Method**: `POST`
- **URL**: `http://127.0.0.1:3000/v1/customer/hosting/services/:serviceId/mailboxes/password` (Note: This requires a bridge or token handling since Roundcube user context differs from Npanel JWT).
    - *Alternative V1*: For V1, since Roundcube usually runs on the same server, it may use a custom script driver that calls `npanel-cli` or similar, OR the HTTP driver calls a specialized endpoint.
    - *Simpler V1 Approach*: Roundcube uses the `sql` driver pointing to the same DB as Dovecot if applicable, BUT Npanel architecture mandates API usage.
    - *Recommended V1*: Use the `http` driver pointing to a dedicated integration endpoint or the Customer API (if tokens can be managed).

**Constraints for Roundcube in V1:**
- Roundcube integration requires the `password` plugin.
- The plugin should be configured to hit the Npanel API.
- Since Npanel uses JWT for customers, and Roundcube uses IMAP auth, bridging the two requires either:
    1.  An API endpoint that accepts IMAP credentials to validate before change (Double Auth).
    2.  A shared secret (API Key) for Roundcube-to-Npanel communication (Server-to-Server).

**V1 Decision**: Roundcube should use a **Server-to-Server** endpoint protected by an internal API key or allowed IP (localhost) to change passwords, validating the *old* password via IMAP first if possible, or trusting the Roundcube session.

## Security Guarantees

1.  **No Plaintext Storage**: Npanel does not store mailbox passwords.
2.  **Authorization**: Customers can only modify mailboxes belonging to their services.
3.  **Audit Logging**: All password changes are logged in the Npanel audit trail (without the password itself).
4.  **Rate Limiting**: Password change attempts are subject to API rate limits.

## Scope & Limitations (V1)

- **No Mailbox Creation/Deletion**: Customers cannot add or remove mailboxes via the dashboard. This is an admin/provisioning task.
- **No Advanced Features**: Forwarders, aliases, autoresponders, and filters are not managed via Npanel in V1.
- **No Billing Integration**: Password changes do not trigger billing events.
