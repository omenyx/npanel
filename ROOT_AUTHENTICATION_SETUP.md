# Root Authentication Setup for Npanel

## Current Authentication System

Npanel uses email-based authentication with the following structure:
- Users are stored in the `iam_users` table with email and password hash
- Login requires an email and password
- User roles: ADMIN, RESELLER, CUSTOMER, SUPPORT

## How to Enable Root Login

### Option 1: Create a Root User via API (Recommended)

The simplest way to enable root authentication is to create an admin user during initialization:

```bash
# During first installation, the installer will prompt for admin credentials
# Or you can call the initialization API:

curl -X POST http://localhost:3000/v1/install/init/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "adminEmail": "root@localhost",
    "adminPassword": "your-secure-password"
  }'

# Then confirm with the returned intentId
curl -X POST http://localhost:3000/v1/install/init/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "intentId": "<returned-intent-id>",
    "token": "<returned-token>"
  }'
```

Then login with:
```bash
curl -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "root@localhost",
    "password": "your-secure-password"
  }'
```

### Option 2: Modify validateUser() for System Root

To allow system root authentication without a database user, modify `iam.service.ts`:

```typescript
async validateUser(email: string, password: string): Promise<User | null> {
  // Allow system root authentication
  if (email === 'root' && password === process.env.NPANEL_ROOT_PASSWORD) {
    // Create a virtual root user
    return {
      id: 'system-root',
      email: 'root',
      passwordHash: '', // Not used for system root
      role: 'ADMIN' satisfies UserRole,
      tokenVersion: 0,
      createdAt: new Date(),
    } as User;
  }

  // Standard database user authentication
  const user = await this.users.findOne({ where: { email } });
  if (!user) {
    return null;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return null;
  }

  return user;
}
```

Then set the environment variable:
```bash
export NPANEL_ROOT_PASSWORD="your-root-password"
```

### Option 3: Enable Root via Direct Database Query

Connect to the database and create a root user directly:

```sql
-- MySQL/MariaDB
INSERT INTO iam_users (id, email, passwordHash, role, tokenVersion, createdAt)
VALUES (
  UUID(),
  'root@localhost',
  '$2a$12$HASH_HERE',  -- bcrypt hash of your password
  'ADMIN',
  0,
  NOW()
)
ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash);
```

To generate a bcrypt hash from command line:
```bash
node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"
```

## Current Code Structure

### Key Files:
- **Backend Service**: `backend/src/iam/iam.service.ts`
  - `validateUser()`: Email + password validation
  - `createInitialAdmin()`: Creates first admin user
  
- **Controller**: `backend/src/iam/iam.controller.ts`
  - `login()`: POST /v1/login endpoint
  - `initializePrepare()`, `initializeConfirm()`: Bootstrap flow

- **User Entity**: `backend/src/iam/user.entity.ts`
  - `email`: unique identifier
  - `passwordHash`: bcrypt hash
  - `role`: user role (ADMIN, RESELLER, CUSTOMER, SUPPORT)

### Authentication Flow:
1. User sends email + password to `/v1/login`
2. `IamService.validateUser()` checks database
3. Returns user if credentials match
4. JwtService creates access + refresh tokens
5. Tokens sent as HTTP-only cookies
6. Client authenticated for subsequent requests

## Environment Variables

To enable root authentication, add to `.env`:

```bash
# Option: Allow system root login
NPANEL_ROOT_PASSWORD=your-secure-root-password

# Optional: Override default root email
NPANEL_ROOT_EMAIL=root@localhost

# Optional: Set root user role (default: ADMIN)
NPANEL_ROOT_ROLE=ADMIN
```

## Implementation Recommendation

For production systems, I recommend **Option 1** (create admin user via API) because:
- ✅ Secure: Uses bcrypt hashing
- ✅ Auditable: Tracked in governance system
- ✅ Standard: Uses same authentication as regular users
- ✅ Manageable: Can be changed/reset through UI

For development/testing, **Option 2** (system root) is useful as a fallback.

## Security Considerations

- Always use strong passwords (minimum 8 characters)
- Use HTTPS in production
- Rotate root credentials regularly
- Log all authentication events (already done via `AuthLoginEvent`)
- Consider IP whitelisting for root access
- Monitor failed login attempts

## Testing Root Login

```bash
# Test authentication
curl -c cookies.txt -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email": "root@localhost", "password": "test-password"}'

# Use authenticated session
curl -b cookies.txt http://localhost:3000/v1/admin/status
```

## Questions?

For implementation of Option 2 or 3, refer to the code structure above and the main installer commit history in the repository.
