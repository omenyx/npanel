# Npanel Setup & Onboarding Flow

## Overview

After installation and first login, Npanel provides a guided setup experience to help you configure the system.

---

## First Login Flow

```
1. Visit http://your-server:8080/
   ↓
2. Login with credentials:
   - Username: root
   - Password: (auto-generated in .env or provided by administrator)
   ↓
3. Redirected to /admin/dashboard
   ↓
4. Setup Wizard appears (if first login detected)
```

---

## Setup Wizard Steps

### Step 1: System Health Check
**Purpose:** Verify all services are operational

✅ **Checks Performed:**
- Nginx service running
- Backend API responding
- Database connected
- Mail service (Exim) running
- DNS service running
- FTP service running
- System resources available
- **Nameserver configuration** (new)

✅ **Nameserver Verification:**
- DNS backend type (BIND, PowerDNS, etc.)
- Configured nameservers listed
- Warning if no nameservers set
- Ready for zone creation

**Action:** Automatic - just verify all systems show green checkmarks

---

### Step 2: Admin Account Verification
**Purpose:** Confirm root access is working

✅ **Verifies:**
- You're logged in as root administrator
- Full system access enabled
- No authentication issues

**Action:** No configuration needed - just informational

---

### Step 3: Email Configuration (Optional)
**Purpose:** Configure mail service settings

⏭️ **Can Skip:** Yes

**Configure Later:** Settings → Mail Services

**Includes:**
- Exim configuration
- Dovecot IMAP setup
- Default mail domain
- Mailbox quotas

---

### Step 4: Backup Configuration (Optional)
**Purpose:** Set up backup retention policies

⏭️ **Can Skip:** Yes

**Configure Later:** Settings → Backup Management

**Includes:**
- Backup retention days
- Backup frequency
- Storage location
- Automatic cleanup

---

### Step 5: DNS Provider Setup (Optional)
**Purpose:** Configure DNS backend

⏭️ **Can Skip:** Yes

**Configure Later:** Settings → DNS Backend

**Supported:**
- BIND (Local DNS)
- PowerDNS (With MySQL)
- External API (Future)

---

### Step 6: Setup Complete
**Purpose:** Confirm wizard completion

✅ **Actions:**
- Mark setup as complete in localStorage
- Show dashboard
- Provide next steps

**Next Steps Suggested:**
1. Create your first customer
2. Set up hosting packages
3. Configure system settings

---

## Dashboard Layout After Setup

```
┌─────────────────────────────────────────┐
│          Npanel Dashboard               │
├─────────────────────────────────────────┤
│  📊 System Status Cards                 │
│  ├─ Active Accounts                     │
│  ├─ Pending Services                    │
│  ├─ System Load                         │
│  └─ Storage Usage                       │
│                                         │
│  🔧 System Health                       │
│  ├─ Running Services                    │
│  ├─ Tool Status                         │
│  ├─ Missing Dependencies                │
│  └─ Quick Actions                       │
│                                         │
│  📋 Recent Activity                     │
│  └─ Latest logs (12 entries)            │
└─────────────────────────────────────────┘
```

---

## Navigation After Setup

### Admin Panel
```
/admin (redirects to /admin/dashboard)
├─ /admin/dashboard          System overview
├─ /admin/accounts           Customer accounts
├─ /admin/packages           Hosting packages
├─ /admin/transfers          Migration jobs
├─ /admin/databases          MySQL management
├─ /admin/email              Mail services
├─ /admin/files              File explorer
├─ /admin/dns                Zone management
├─ /admin/security           User access control
├─ /admin/backups            Backup management
├─ /admin/logs               System logs
├─ /admin/metrics            Performance graphs
├─ /admin/server             Server config
└─ /admin/api                API documentation
```

### Customer Portal
```
/customer (redirects to /customer/migrations)
├─ /customer/migrations      Account migrations
├─ /customer/services/[id]   Service details
├─ /customer/domains         Domain management
├─ /customer/email           Mailbox management
├─ /customer/databases       Database management
├─ /customer/files           File explorer
├─ /customer/backups         Backup history
├─ /customer/metrics         Usage statistics
├─ /customer/security        Access credentials
└─ /customer/api             API access
```

---

## Skipping vs Completing Setup Steps

### Mandatory Steps (Cannot Skip)
- ✋ System Health Check
- ✋ Admin Account Verification
- ✋ Setup Complete

### Optional Steps (Can Skip)
- ⏭️ Email Configuration
- ⏭️ Backup Settings
- ⏭️ DNS Provider

**Note:** Skipped steps can always be configured later in Settings

---

## First Admin Tasks

After completing the setup wizard, recommended first tasks:

### 1. Create First Customer
```
Go to: /admin/accounts
Click: "+ New Customer"
Fill: Customer details
```

### 2. Create Hosting Package
```
Go to: /admin/packages
Click: "+ New Package"
Define: Resource limits
```

### 3. Provision Hosting Service
```
Go to: /admin/accounts > Select Customer
Click: "+ New Service"
Select: Package
```

### 4. Configure Email Domain
```
Go to: /admin/email
Click: "+ Add Domain"
Configure: Mailbox quotas
```

### 5. Setup Backup Schedule
```
Go to: /admin/backups
Click: "+ Create Schedule"
Configure: Frequency & retention
```

---

## Skipping Setup & Accessing Dashboard Directly

To skip the wizard and go straight to the dashboard:

### Via Browser
```javascript
// In browser console
localStorage.setItem('npanel_setup_complete', 'true');
location.reload();
```

### Via Manual Skip
Click "Skip" on any optional step to continue to the next step

---

## Re-running Setup Wizard

To show the setup wizard again:

### Via Browser
```javascript
// In browser console
localStorage.removeItem('npanel_setup_complete');
location.reload();
```

### Via Settings
Currently: Must use browser console

**Future:** Will add "Re-run Setup" option in Settings

---

## Environment Variables for Setup

Setup behavior controlled by environment variables:

```bash
# In /opt/npanel/backend/.env

# Skip setup wizard automatically (for automated deployments)
NPANEL_SKIP_SETUP=true

# Pre-configure email settings
NPANEL_MAIL_HOST=mail.example.com
NPANEL_MAIL_PORT=587

# Pre-configure backup settings
NPANEL_BACKUP_RETENTION_DAYS=30
NPANEL_BACKUP_FREQUENCY=daily
```

---

## Troubleshooting Setup Issues

### Setup Wizard Not Appearing
- Check browser localStorage: `localStorage.getItem('npanel_setup_complete')`
- Clear localStorage: `localStorage.clear()`
- Refresh page

### Health Check Failing
- Service not running: Check systemctl status
- Port not accessible: Check firewall
- DNS issue: Verify /etc/resolv.conf

### Setup Wizard Stuck
- Check browser console for errors (F12)
- Restart backend: `systemctl restart npanel-backend.service`
- Clear browser cache: Ctrl+Shift+Delete

---

## See Also

- [INSTALLATION_FIX_GUIDE.md](../INSTALLATION_FIX_GUIDE.md) - Installation troubleshooting
- [ROOT_AUTHENTICATION_SETUP.md](../ROOT_AUTHENTICATION_SETUP.md) - Root admin setup
- [FRONTEND_STARTUP_FIX.md](../FRONTEND_STARTUP_FIX.md) - Frontend issues
