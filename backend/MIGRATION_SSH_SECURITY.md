# Migration SSH Security (V1 Hardening)

## Host Key Verification

All SSH operations in the migration service enforce strict host key verification for security:

- **All SSH commands** enforce StrictHostKeyChecking=yes
  - Initial connectivity tests (echo npanel_ok)
  - cPanel version detection
  - Account discovery via whmapi1
  - Database operations
  - Rsync file transfers

### How It Works

When executing SSH commands:

`	ypescript
sshArgs.push(
  '-o',
  StrictHostKeyChecking={strictHostKey ? 'yes' : 'no'},
);
`

All callers pass strictHostKey: true, so the connection will fail if:
- The host is not in the known_hosts file
- The host key has changed
- The host key does not match

### Configuration

Optional knownHostsPath can be provided in sourceConfig to specify a custom known_hosts file:

`json
{
  "sourceConfig": {
    "host": "source.example.com",
    "sshUser": "root",
    "sshPort": 22,
    "sshKey": "-----BEGIN RSA PRIVATE KEY-----...",
    "authMethod": "key",
    "knownHostsPath": "/etc/npanel/known_hosts"
  }
}
`

If knownHostsPath is not provided, SSH uses the system default (~/.ssh/known_hosts).

### Setup Instructions

Before running a migration, ensure the source host is in known_hosts:

`ash
# Option 1: Add to default known_hosts
ssh-keyscan -p 22 source.example.com >> ~/.ssh/known_hosts 2>/dev/null

# Option 2: Create a dedicated file
mkdir -p /etc/npanel
ssh-keyscan -p 22 source.example.com > /etc/npanel/known_hosts
chmod 600 /etc/npanel/known_hosts

# Option 3: Manual entry
# Add the line from ssh-keyscan output manually
`

### Security Rationale

- Prevents man-in-the-middle (MITM) attacks
- Protects against IP spoofing and DNS hijacking
- Ensures verified communication with source hosting server
- Follows SSH best practices and security hardening guidelines

### Error Handling

If host key verification fails:

`
Host key verification failed
ssh: connect to host source.example.com port 22: Host authentication failed
`

**Solution**: Add the host to known_hosts using ssh-keyscan or configure knownHostsPath.

### Migration Job Lifecycle

1. **Connection Test**: Runs echo npanel_ok with StrictHostKeyChecking=yes
   - Fails if host key not in known_hosts  Job fails
   
2. **Verification**: Checks cPanel version, whmapi1 availability
   - All use StrictHostKeyChecking=yes  All require verified host
   
3. **Account Discovery**: Lists cPanel accounts via whmapi1
   - Requires StrictHostKeyChecking=yes  Uses verified host
   
4. **Data Transfer**: Rsync transfers files and databases
   - Uses StrictHostKeyChecking=yes  Verified secure connection

All steps share the same host key verification policy.
