# Root Authentication Setup for Npanel

## ✅ Cross-Distro Compatibility

This authentication system works on **any Linux distribution**:
- ✅ AlmaLinux, Rocky, CentOS, RHEL
- ✅ Ubuntu, Debian, Linux Mint
- ✅ Fedora, openSUSE, SUSE
- ✅ Arch, Manjaro
- ✅ Alpine Linux
- ✅ Any WSL 2 environment
- ✅ Docker containers
- ✅ Cloud VMs (AWS, DigitalOcean, etc.)

**No distro-specific dependencies!** Pure Node.js/TypeScript implementation.

## ⚡ Quick Start

Root authentication is **enabled by default** after installation:

```bash
# The installer creates a secure password automatically
# Check it:
cat /opt/npanel/backend/.env | grep NPANEL_ROOT_PASSWORD

# Example password output:
# NPANEL_ROOT_PASSWORD=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Login with just the username "root"
curl -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "root",
    "password": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
  }'
```

That's it! Works on **any Linux distro** with no additional configuration.

## Current Authentication System

Npanel now supports both email-based and username-based authentication:
- Regular users are stored in the `iam_users` table with email and password hash
- **NEW**: Root user can login with just username "root" (no email format required)
- User roles: ADMIN, RESELLER, CUSTOMER, SUPPORT

## How to Enable Root Login

### Option 1: System Root Username Authentication (RECOMMENDED & DEFAULT)

Login using just the username "root" without email format:

**Automatic Setup (Default):**
- The installer automatically generates a secure `NPANEL_ROOT_PASSWORD` 
- Stored in `.env` file at `/opt/npanel/backend/.env`
- Works immediately after installation on any distro

**Manual Setup (Any Distro):**

```bash
# Works on any Linux distro
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
- Check multiple environment variable names: `NPANEL_ROOT_PASSWORD`, `ROOT_PASSWORD`, `ADMIN_PASSWORD`
- Work on all distros without any platform-specific code
- Fallback automatically if environment variables are not set
````
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

## How It Works (Cross-Distro Architecture)

### Environment Variable Loading
The .env file is automatically loaded on **any Linux distribution** through multiple mechanisms:

#### Systemd Services (Most Common)
- Modern systemd services use `EnvironmentFile=/opt/npanel/backend/.env`
- All variables are loaded into the service process automatically
- Works on: Ubuntu 20.04+, CentOS 8+, AlmaLinux 9+, Fedora 33+, Debian 11+, etc.

#### Manual/SysVinit Startup
```bash
# Variables are exported before starting the backend
export $(grep -v '^#' /opt/npanel/backend/.env | xargs -d'\n')
npm run start:prod
```

#### Docker Containers
```dockerfile
ENV NPANEL_ROOT_PASSWORD="your-password"
# or use --env when running container
docker run -e NPANEL_ROOT_PASSWORD="your-password" ...
```

### Backend Processing (Pure Node.js)
Once loaded, the backend reads the environment variable:
```typescript
const rootPassword = 
  process.env.NPANEL_ROOT_PASSWORD ||  // Primary
  process.env.ROOT_PASSWORD ||          // Fallback 1
  process.env.ADMIN_PASSWORD;           // Fallback 2
```

This works on **any platform** where Node.js runs: Linux (all distros), macOS, Windows, WSL2, Docker, Kubernetes, cloud VMs, etc.

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
Modified `validateUser()` to support username-based root login with multiple environment variable fallbacks:

```typescript
async validateUser(emailOrUsername: string, password: string): Promise<User | null> {
  // Support root username login (no email format required)
  if (emailOrUsername.toLowerCase() === 'root') {
    // Get root password from environment, with multiple fallback options
    // Works on all distros: Linux, Windows, macOS, WSL, containers, etc.
    const rootPassword = 
      process.env.NPANEL_ROOT_PASSWORD ||  // Primary (installer uses this)
      process.env.ROOT_PASSWORD ||         // Fallback 1
      process.env.ADMIN_PASSWORD;          // Fallback 2

    if (rootPassword && rootPassword.length > 0 && password === rootPassword) {
      // Return a virtual root user (works on any distro without database)
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

  // Standard email-based user authentication (works on all distros)
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

## Environment Variables & Setup

### Automatic Setup (Recommended - Default)
The installer automatically generates a secure random password:

```bash
# After running install_npanel.sh
cat /opt/npanel/backend/.env | grep NPANEL_ROOT_PASSWORD

# Output example:
# NPANEL_ROOT_PASSWORD=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

This password is:
- ✅ Auto-generated as a 32-character hex string (cryptographically secure)
- ✅ Stored in `/opt/npanel/backend/.env` (automatically loaded by systemd)
- ✅ Works on any Linux distro, Windows, macOS, Docker, WSL2, etc.
- ✅ Persists across system reboots (in .env file)

### Setting a Custom Password
To use your own password instead of the auto-generated one:

**Method 1: Edit .env file directly (Recommended)**
```bash
sudo nano /opt/npanel/backend/.env

# Find the line: NPANEL_ROOT_PASSWORD=...
# Replace with your secure password:
NPANEL_ROOT_PASSWORD=your-secure-root-password

# Save and restart the backend service
sudo systemctl restart npanel-backend
```

**Method 2: Set environment variable (Works on any distro)**
```bash
# Temporarily (current session only)
export NPANEL_ROOT_PASSWORD="your-secure-root-password"

# Permanently (add to ~/.bashrc or ~/.profile)
echo 'export NPANEL_ROOT_PASSWORD="your-secure-root-password"' >> ~/.bashrc
source ~/.bashrc

# Then restart the backend:
sudo systemctl restart npanel-backend
```

**Method 3: Multiple environment variable names (Automatic fallback)**
The system checks in this order:
1. `NPANEL_ROOT_PASSWORD` (primary - what installer uses)
2. `ROOT_PASSWORD` (fallback)
3. `ADMIN_PASSWORD` (fallback)

Set any of these and it will work:
```bash
# Option A
export NPANEL_ROOT_PASSWORD="password123"

# Option B (if you prefer)
export ROOT_PASSWORD="password123"

# Option C (alternative name)
export ADMIN_PASSWORD="password123"
```

### Verifying the Setup
Check if root authentication is working:

```bash
# 1. Check if NPANEL_ROOT_PASSWORD is set in .env
grep NPANEL_ROOT_PASSWORD /opt/npanel/backend/.env

# 2. Test login with username "root"
curl -X POST http://localhost:3000/v1/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "root",
    "password": "YOUR_PASSWORD_HERE"
  }' | jq .

# 3. Should return a token if successful:
# {
#   "accessToken": "eyJ...",
#   "refreshToken": "eyJ...",
#   "user": {
#     "id": "system-root",
#     "email": "root@system.local",
#     "role": "ADMIN"
#   }
# }
```

### Cross-Distro Verification
Works on any Linux distro:

**Ubuntu/Debian:**
```bash
echo "NPANEL_ROOT_PASSWORD=testpass" | sudo tee /opt/npanel/backend/.env
sudo systemctl restart npanel-backend
```

**CentOS/RHEL/AlmaLinux:**
```bash
echo "NPANEL_ROOT_PASSWORD=testpass" | sudo tee /opt/npanel/backend/.env
sudo systemctl restart npanel-backend
```

**Alpine Linux:**
```bash
echo "NPANEL_ROOT_PASSWORD=testpass" | sudo tee /opt/npanel/backend/.env
sudo rc-service npanel-backend restart
```

**Manual startup (any distro):**
```bash
export NPANEL_ROOT_PASSWORD="testpass"
cd /opt/npanel/backend
npm run start:prod
```

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
