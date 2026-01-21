# Root Authentication Setup for Npanel

## Current Authentication System

Npanel now supports both email-based and username-based authentication:
- Regular users are stored in the `iam_users` table with email and password hash
- **NEW**: Root user can login with just username "root" (no email format required)
- User roles: ADMIN, RESELLER, CUSTOMER, SUPPORT

## How to Enable Root Login

### Option 1: System Root Username Authentication (RECOMMENDED & NOW IMPLEMENTED)

Login using just the username "root" without email format:

```bash
# Set the root password in environment
export NPANEL_ROOT_PASSWORD="your-secure-root-password"

# Login with username 'root'
curl -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "root",
    "password": "your-secure-root-password"
  }'
```

**This is now the default implementation!** The code has been updated to:
- Accept "root" as a username (not requiring email format)
- Check against `NPANEL_ROOT_PASSWORD` environment variable
- Create a virtual ADMIN user with ID "system-root"
- Work without requiring a database entry

### Option 2: Create a Root User via API

Create an admin user during initialization (uses email format):

```bash
curl -X POST http://localhost:3000/v1/install/init/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "adminEmail": "admin@localhost",
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
    "email": "admin@localhost",
    "password": "your-secure-password"
  }'
```

### Option 3: Direct Database User Creation

Connect to the database and create a user directly:

```sql
-- MySQL/MariaDB
INSERT INTO iam_users (id, email, passwordHash, role, tokenVersion, createdAt)
VALUES (
  UUID(),
  'admin@localhost',
  '$2a$12$HASH_HERE',  -- bcrypt hash of your password
  'ADMIN',
  0,
  NOW()
);
```

To generate a bcrypt hash from command line:
```bash
node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"
```
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

## Code Changes Made

### 1. Updated LoginDto (`backend/src/iam/dto/login.dto.ts`)
Changed `@IsEmail()` validator to `@IsString()` to accept both email and username formats:

```typescript
import { IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  email: string; // Can be email format (user@domain) or username (e.g., 'root')

  @IsString()
  password: string;
}
```

### 2. Updated IamService (`backend/src/iam/iam.service.ts`)
Modified `validateUser()` to support username-based root login:

```typescript
async validateUser(emailOrUsername: string, password: string): Promise<User | null> {
  // Support root username login (no email format required)
  if (emailOrUsername.toLowerCase() === 'root') {
    const rootPassword = process.env.NPANEL_ROOT_PASSWORD;
    if (rootPassword && password === rootPassword) {
      // Return a virtual root user
      return {
        id: 'system-root',
        email: 'root@system.local',
        passwordHash: '',
        role: 'ADMIN' as const,
        tokenVersion: 0,
        createdAt: new Date(),
      };
    }
    return null;
  }

  // Standard email-based user authentication
  const user = await this.users.findOne({ where: { email: emailOrUsername } });
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

## Environment Variables

To enable root authentication, add to `.env`:

```bash
# Enable system root login with username 'root'
NPANEL_ROOT_PASSWORD=your-secure-root-password
```

That's it! No other configuration needed.

## Authentication Flow (Updated)

1. User sends username/email + password to `/v1/login`
2. `IamService.validateUser()` checks:
   - If username is "root" → validate against `NPANEL_ROOT_PASSWORD`
   - Otherwise → look up in database by email
3. Returns user if credentials match
4. JwtService creates access + refresh tokens
5. Tokens sent as HTTP-only cookies
6. Client authenticated for subsequent requests

## Testing Root Login

```bash
# Export the root password
export NPANEL_ROOT_PASSWORD="my-secure-password"

# Start the Npanel backend
npm run start:prod

# Test root authentication with username
curl -c cookies.txt -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email": "root", "password": "my-secure-password"}'

# Use authenticated session
curl -b cookies.txt http://localhost:3000/v1/admin/status
```

## Security Considerations

- ✅ **Simple**: Just set `NPANEL_ROOT_PASSWORD` environment variable
- ✅ **No database changes**: Works with any existing schema
- ✅ **Username-based**: Use "root" instead of "root@localhost" or "root@domain"
- ✅ **Flexible**: Still supports regular email-based users
- ⚠️ **Important**: Use strong passwords (minimum 8 characters)
- ⚠️ **Production**: Always use HTTPS
- ⚠️ **Audit**: All login events are still logged via `AuthLoginEvent`

## Switching Between Authentication Methods

The system now supports multiple authentication methods simultaneously:

1. **System Root** (username "root"):
   - Username: `root`
   - Password: Value of `NPANEL_ROOT_PASSWORD`
   - No database entry needed

2. **Database Users** (email-based):
   - Username: `user@domain.com` (any email)
   - Password: User's bcrypt-hashed password from database
   - Can have any role (ADMIN, RESELLER, CUSTOMER, SUPPORT)

Both methods work at the same time!
