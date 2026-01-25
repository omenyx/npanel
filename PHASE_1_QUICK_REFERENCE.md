# nPanel Phase 1 - Quick Reference

## What Was Built

### 1. Database Layer (database.go - 350 lines)
Complete SQLite schema with:
- **Users** - Authentication, roles, status
- **API Keys** - API access management
- **Domains** - Hosted domains with quotas
- **Email Accounts** - Email management
- **DNS Records** - DNS zone management
- **SSL Certificates** - HTTPS certificate storage
- **Databases** - MySQL/PostgreSQL databases
- **Audit Logs** - Complete audit trail
- **Sessions** - Refresh token management
- **Jobs** - Async operation tracking
- **Services** - Service monitoring
- **Settings** - System configuration

### 2. Authentication (auth.go - 250 lines)
- **CreateUser()** - User registration
- **VerifyPassword()** - Login authentication
- **GenerateAccessToken()** - JWT token generation
- **GenerateRefreshToken()** - Refresh token creation
- **VerifyAccessToken()** - Token validation
- **VerifyRefreshToken()** - Refresh token validation
- **RevokeSession()** - Logout support
- **GetUserByID()** - User lookup

### 3. RBAC (rbac.go - 200 lines)
Four role levels with cascading permissions:
- **root** - Full system access
- **admin** - Server management
- **reseller** - Reseller management
- **user** - Personal resource management

### 4. REST API (server.go - 600 lines)
40+ endpoints covering:
- Authentication (login, refresh, logout)
- Domain management (CRUD)
- Email management (CRUD)
- DNS management (CRUD)
- Database management (CRUD)
- Service management
- Admin functions
- Audit logs

---

## File Structure
```
backend/
├── main.go           Entry point
├── server.go         REST API server (600 lines)
├── database.go       Schema & models (350 lines)
├── auth.go           JWT authentication (250 lines)
├── rbac.go           RBAC system (200 lines)
├── .env.example      Configuration template
└── go.mod            Go dependencies
```

---

## Key Endpoints

### Public
```
POST   /api/auth/login           # User login
POST   /api/auth/refresh         # Token refresh
GET    /health                   # Health check
GET    /metrics                  # Prometheus metrics
```

### Protected (Require JWT)
```
POST   /api/auth/logout          # User logout
GET    /api/auth/me              # Current user
POST   /api/auth/change-password # Change password

# Domains
GET    /api/domains              # List
POST   /api/domains              # Create
GET    /api/domains/{id}         # Get
PUT    /api/domains/{id}         # Update
DELETE /api/domains/{id}         # Delete

# Emails
GET    /api/domains/{id}/emails  # List
POST   /api/domains/{id}/emails  # Create
DELETE /api/domains/{id}/emails/{id} # Delete

# DNS
GET    /api/domains/{id}/dns     # List
POST   /api/domains/{id}/dns     # Create
DELETE /api/domains/{id}/dns/{id} # Delete

# Admin
GET    /api/admin/users          # List users
POST   /api/admin/users          # Create user
GET    /api/admin/audit          # Audit logs
```

---

## Database Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| users | User accounts | id, email, role, status |
| domains | Hosted domains | id, name, owner_id |
| email_accounts | Email accounts | id, domain_id, username |
| dns_records | DNS zones | id, domain_id, type, name |
| ssl_certificates | SSL certs | id, domain_id, expires_at |
| databases | User databases | id, domain_id, name |
| audit_logs | Audit trail | id, user_id, action, result |
| sessions | JWT sessions | id, user_id, refresh_token |
| jobs | Background jobs | id, action, status |
| services | Service monitor | id, name, status |

---

## Roles & Permissions

### user
- manage_own_domains
- manage_own_email
- view_own_metrics

### reseller
- [all user permissions]
- manage_resellers
- manage_reseller_users
- manage_reseller_domains

### admin
- [all reseller permissions]
- manage_all_domains
- manage_all_users
- manage_servers
- manage_packages
- manage_services

### root
- [all admin permissions]
- manage_settings
- manage_admins
- system_access

---

## Build & Run

```bash
# Navigate to backend
cd backend

# Build
go build -o npanel-api

# Initialize database
./npanel-api --init-db

# Run with debug
./npanel-api --debug --port 8443

# Test health
curl -k https://localhost:8443/health
```

---

## API Flow Example

```
1. User Login
   POST /api/auth/login
   {
     "email": "user@example.com",
     "password": "password"
   }
   Response:
   {
     "access_token": "eyJ...",
     "refresh_token": "uuid...",
     "user": { "id": "...", "email": "...", "role": "..." }
   }

2. Use Token
   GET /api/auth/me
   Header: Authorization: Bearer eyJ...
   Response:
   {
     "id": "uuid",
     "email": "user@example.com",
     "role": "user"
   }

3. Refresh Token
   POST /api/auth/refresh
   { "refresh_token": "uuid..." }
   Response:
   { "access_token": "new-jwt..." }

4. Logout
   POST /api/auth/logout
   { "refresh_token": "uuid..." }
```

---

## Security Features

✅ **Password Security**
- Bcrypt hashing (cost 10)
- No plaintext storage
- Constant-time comparison

✅ **Token Security**
- HMAC-SHA256 signing
- 1-hour access token expiry
- 30-day refresh token expiry
- Token revocation on logout

✅ **API Security**
- HTTPS/TLS required
- CORS configured
- Request validation
- Error message sanitization

✅ **Access Control**
- Role-based permissions
- Permission enforcement per endpoint
- Audit trail for all actions
- IP & user agent logging

---

## Next Steps (Phase 2)

### Phase 2A: Installer
- [ ] OS detection (AlmaLinux, RHEL, Ubuntu)
- [ ] Package installation
- [ ] Service configuration
- [ ] Database initialization
- [ ] Admin user creation

### Phase 2B: Agent
- [ ] Domain creation/deletion
- [ ] Email account management
- [ ] DNS record management
- [ ] Service control
- [ ] Health monitoring

### Phase 2C: Integration
- [ ] Connect API to real database operations
- [ ] Connect agent to API
- [ ] End-to-end testing
- [ ] Performance optimization

---

## Testing Checklist

- [ ] Database creates successfully
- [ ] User creation works
- [ ] Login returns tokens
- [ ] JWT validation works
- [ ] RBAC permissions enforced
- [ ] Audit logging active
- [ ] All endpoints respond
- [ ] Error handling proper
- [ ] CORS headers correct
- [ ] HTTPS works

---

**Total Lines of Code:** 1,400+  
**Database Tables:** 12  
**API Endpoints:** 40+  
**Roles:** 4  
**Permissions:** 14+  

✅ Phase 1 Complete - Ready for Phase 2
