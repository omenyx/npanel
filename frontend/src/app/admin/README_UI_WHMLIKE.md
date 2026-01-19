# Admin UI - WHM-Like Refactor (V1)

This refactor transforms the Npanel Admin UI into a server-centric, operator-first control panel similar to WHM. It focuses on V1 core hosting capabilities without V2/V3 features (billing, customer self-service, etc.).

## Key Changes

### 1. Navigation & Structure
- **Renamed Sections**:
  - `Hosting Services` -> `Accounts`
  - `Hosting Plans` -> `Packages`
  - `Migrations` -> `Transfers`
- **Sidebar Order**: Server -> Accounts -> Packages -> Transfers -> Logs / Status

### 2. Server Panel (`/admin/server`)
- Displays status of system tools (nginx, php-fpm, mysql, etc.) via `GET /system/tools/status`.
- Shows server info (Default IPv4, DNS/Mail/FTP backends).
- "Refresh" button to re-check tool availability.
- Missing tools are clearly highlighted.

### 3. Accounts (`/admin/accounts`)
- Lists all hosting accounts with primary domain, plan, customer, and status.
- **Actions**:
  - **Create**: Opens the new "Create Account Wizard".
  - **Provision**: Triggers provisioning for pending accounts.
  - **Suspend/Unsuspend**: Toggles account status (Unsuspend calls `POST /v1/hosting/services/:id/unsuspend`).
  - **Terminate**: Removes the account and resources.

### 4. Create Account Wizard
- Step-by-step modal for creating new accounts.
- Fields: Customer, Primary Domain, Package.
- **Auto-provision**: Checkbox to immediately provision after creation.

### 5. Packages (`/admin/packages`)
- Lists hosting plans (Packages).
- Shows "Used by X accounts" count.
- Prevents deletion if package is in use (UI warning).

### 6. Transfers (`/admin/transfers`)
- Lists active and past migration jobs.
- **Create Transfer Wizard**:
  - **Source Connection**: Job Name, Host IP, SSH User (requires key auth).
  - **System Public Key**: Displays the Npanel server's public SSH key with a copy button. Instructions provided to add this to the source server's authorized_keys.
  - **Account**: Source Username, Primary Domain.
  - **Dry Run**: Checkbox to test connectivity/rsync without writing.
  - **Flow**: Creates Job -> Adds Account (API chaining).

### 7. Logs & Status (`/admin/logs`)
- **Account Logs**: Detailed logs for specific hosting accounts.
- **Server/System Logs**: (Planned) View for system-wide tool failures and adapter errors.
- **Filtering**: Filter logs by level (Info/Warning/Error).

## Manual Test Checklist

- [ ] **Navigation**:
  - Verify all links work: Server, Accounts, Packages, Transfers, Logs.
  - Verify active state highlighting.

- [ ] **Server Panel**:
  - Check tool status loading.
  - Click "Refresh" and verify update.
  - Verify missing tools show red/error state.

- [ ] **Create Account**:
  - Open "New Account" wizard.
  - Fill form (valid domain, select package).
  - Submit.
  - Verify new account appears in list.

- [ ] **Account Actions**:
  - **Unsuspend**: Click Unsuspend on a suspended account. Verify status changes to "active".
  - **Suspend**: Click Suspend on an active account. Verify status changes to "suspended".
  - **Terminate**: (Caution) Verify account removal.

- [ ] **Create Transfer**:
  - Go to Transfers -> New Transfer.
  - Verify "System Public Key" is displayed and copiable.
  - Fill: "Test Job", Host "127.0.0.1", User "root", Account "testuser", Domain "test.com".
  - Submit.
  - Verify job appears in list with "Live SSH" and "Dry Run" status.

## Screenshots

*(Placeholders for screenshots)*

**Server Panel**
![Server Panel Placeholder](server_panel.png)

**Accounts List**
![Accounts List Placeholder](accounts_list.png)

**Create Account Wizard**
![Create Account Wizard Placeholder](create_account_wizard.png)
