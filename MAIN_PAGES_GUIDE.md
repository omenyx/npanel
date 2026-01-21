# Npanel Main Pages & Routes Guide

## Overview

Npanel is a dual-interface hosting control panel with separate admin and customer portals. All pages are accessible through the nginx proxy on port 8080.

---

## 🏠 Entry Points

### 1. **Login Page**
- **URL:** `http://localhost:8080/login`
- **Purpose:** User authentication
- **Access:** Everyone (public)
- **Features:**
  - Email/password authentication
  - Role-based redirection (admin vs customer)
  - Session management
  - Error handling

```bash
curl http://localhost:8080/login
```

---

## 👨‍💼 Admin Portal

### Access
- **URL:** `http://localhost:8080/admin`
- **Redirect:** `/admin` → `/admin/dashboard`
- **Role:** Administrator access only
- **Default Route:** Redirects to dashboard on load

### Main Pages

#### **Dashboard** (`/admin/dashboard`)
- Overview of system status
- Quick stats and metrics
- Server health information
- Setup wizard (first-time users)

#### **Accounts** (`/admin/accounts`)
- Manage customer accounts
- Create/edit/delete customer accounts
- Account status monitoring
- Billing information

#### **Hosting** (`/admin/hosting`)
- Server hosting management
- Service plans and packages
- Customer hosting assignments
- Resource allocation

#### **DNS** (`/admin/dns`)
- Domain name server management
- Zone file management
- DNS records configuration
- DNS zone transfers

#### **Email** (`/admin/email`)
- Email server management
- Mailbox management
- Email account configuration
- Spam/antivirus settings

#### **Databases** (`/admin/databases`)
- Database server management
- Database creation/deletion
- User permissions
- Backup management

#### **Files** (`/admin/files`)
- File storage management
- Backup locations
- Restore operations
- File system monitoring

#### **Backups** (`/admin/backups`)
- Backup scheduling
- Backup restoration
- Backup storage management
- Backup history

#### **Security** (`/admin/security`)
- Security settings
- SSL certificate management
- Firewall rules
- DDoS protection

#### **Logs** (`/admin/logs`)
- System logs viewing
- Error logs
- Access logs
- Audit trail

#### **Metrics** (`/admin/metrics`)
- Performance metrics
- Resource usage (CPU, RAM, Disk)
- Network statistics
- Historical trends

#### **Packages** (`/admin/packages`)
- Hosting plan templates
- Package management
- Feature customization
- Pricing management

#### **Server** (`/admin/server`)
- Server configuration
- System settings
- Service management
- Software versions

#### **Access** (`/admin/access`)
- User access control
- Admin account management
- Permission levels
- API key management

#### **Transfers** (`/admin/transfers`)
- Account migrations
- Domain transfers
- Service transfers
- Transfer history

---

## 👥 Customer Portal

### Access
- **URL:** `http://localhost:8080/customer`
- **Redirect:** `/customer` → Shows hosted services overview
- **Role:** Customer access only
- **Permission:** Can only manage their own services

### Main Pages

#### **Dashboard** (`/customer`)
- Hosted services overview
- Disk usage statistics
- Database information
- Email quota information
- Quick links to services

#### **Domains** (`/customer/domains`)
- Domain management
- Domain registration
- DNS configuration
- Domain renewal
- Domain transfers

#### **Email** (`/customer/email`)
- Email account management
- Mailbox creation/deletion
- Email forwarding
- Email aliases
- Spam settings

#### **Databases** (`/customer/databases`)
- Database management
- Database creation
- User management
- Backup/restore
- Database tools

#### **Backups** (`/customer/backups`)
- Backup scheduling
- Restore backups
- Download backups
- Backup history
- Automated backups

#### **Files** (`/customer/files`)
- File manager
- Upload/download files
- Folder management
- File permissions
- Quota usage

#### **Migrations** (`/customer/migrations`)
- Account migration tracking
- Data transfer status
- Migration history
- Migration support

#### **Security** (`/customer/security`)
- SSL certificates
- SSH keys
- IP whitelist
- Password management
- Security logs

#### **Metrics** (`/customer/metrics`)
- Bandwidth usage
- Resource utilization
- Email statistics
- Database statistics
- Historical data

#### **Services** (`/customer/services/[id]`)
- Individual service details
- Service configuration
- Service status
- Service management
- Renewal information

---

## 📊 API Endpoints

### Backend Routes (Proxied to port 3000)

**All API calls go through:** `http://localhost:8080/api/`

```bash
# Health check
GET /api/v1/health

# Admin endpoints
GET /api/v1/admin/accounts
POST /api/v1/admin/hosting/services
GET /api/v1/admin/dns/zones

# Customer endpoints
GET /api/v1/customer/hosting/services
POST /api/v1/customer/email/accounts
GET /api/v1/customer/domains
```

---

## 🔐 Authentication Flow

```
1. User visits http://localhost:8080/
   ↓
2. Redirected to /admin (default)
   ↓
3. Not authenticated → Redirected to /login
   ↓
4. User logs in with email/password
   ↓
5. Backend verifies credentials
   ↓
6. Session token stored in browser
   ↓
7. Redirected based on role:
   - ADMIN → /admin/dashboard
   - CUSTOMER → /customer
```

---

## 🗺️ Complete Route Map

```
localhost:8080/
├── /                           Root (redirects to /admin)
├── /login                       Authentication page
├── /admin                       Admin dashboard redirect
│   ├── /admin/dashboard         System overview
│   ├── /admin/accounts          Customer management
│   ├── /admin/hosting           Hosting services
│   ├── /admin/dns               DNS management
│   ├── /admin/email             Email configuration
│   ├── /admin/databases         Database management
│   ├── /admin/files             File storage
│   ├── /admin/backups           Backup management
│   ├── /admin/security          Security settings
│   ├── /admin/logs              System logs
│   ├── /admin/metrics           Performance metrics
│   ├── /admin/packages          Hosting packages
│   ├── /admin/server            Server configuration
│   ├── /admin/access            Access control
│   └── /admin/transfers         Migration management
├── /customer                    Customer dashboard
│   ├── /customer/domains        Domain management
│   ├── /customer/email          Email accounts
│   ├── /customer/databases      Database management
│   ├── /customer/backups        Backup management
│   ├── /customer/files          File management
│   ├── /customer/migrations     Migration status
│   ├── /customer/security       Security settings
│   ├── /customer/metrics        Usage metrics
│   └── /customer/services/[id]  Service details
└── /api                         API endpoints (backend)
    ├── /api/v1/health           Health check
    ├── /api/v1/admin/*          Admin API
    └── /api/v1/customer/*       Customer API
```

---

## 🚀 Quick Access Links

| User Type | Login | Dashboard | Main Feature |
|-----------|-------|-----------|--------------|
| **Admin** | `/login` | `/admin/dashboard` | `/admin/accounts` |
| **Customer** | `/login` | `/customer` | `/customer/domains` |

---

## 📱 Navigation

### Admin Navigation (Sidebar)
- Dashboard
- Accounts
- Hosting
- DNS
- Email
- Databases
- Files
- Backups
- Security
- Logs
- Metrics
- Packages
- Server
- Access
- Transfers

### Customer Navigation (Sidebar)
- Dashboard
- Domains
- Email
- Databases
- Backups
- Files
- Migrations
- Security
- Metrics
- Services

---

## 🔄 Typical User Journeys

### Admin Journey
```
Login → Dashboard → View Accounts → Manage Customer → Check Metrics → Done
```

### Customer Journey
```
Login → Dashboard → Check Domains → Manage Email → View Backups → Done
```

### New Account Setup
```
Admin Login → Accounts → Create Account → Assign Package → Setup Complete
```

### Email Setup
```
Customer Login → Email → Create Mailbox → Configure Forwarding → Done
```

---

## 📝 Session Management

- **Session Storage:** Browser localStorage
- **Token Duration:** As configured in backend
- **Automatic Redirect:** If session expires, redirected to login
- **Role-based Access:** Based on authenticated user role

---

## ✅ Summary

**Main Entry Point:** `http://localhost:8080/login`

**Admin Dashboard:** `http://localhost:8080/admin/dashboard`
- 15+ pages for full hosting control

**Customer Portal:** `http://localhost:8080/customer`
- 9 pages for self-service management

**API Base:** `http://localhost:8080/api/v1/`
- RESTful backend endpoints
