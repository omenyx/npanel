# nPanel Build & Development Guide

## Project Structure

```
npanel/
├── installer/           # Installation tooling (Go)
├── agent/              # Local daemon (Go)
├── backend/            # REST API (Go)
├── frontend/           # React UI
├── docs/               # Documentation
├── ARCHITECTURE.md     # Architecture reference
├── DEPLOYMENT.md       # Deployment guide
├── BUILD.md            # This file
├── go.mod              # Go module file
└── README.md           # Project overview
```

## Building from Source (Linux)

### Prerequisites

```bash
# Install Go 1.23+
curl https://go.dev/dl/go1.23.linux-x64.tar.gz | tar -xz -C /usr/local

# Install build tools
sudo apt-get install -y build-essential curl git

# Or on AlmaLinux 9:
sudo dnf install -y gcc make curl git
```

### Build All Components

```bash
# Clone repository
git clone https://github.com/npanel/npanel.git
cd npanel

# Initialize Go modules
go mod tidy

# Build installer
cd installer
go build -o npanel-installer
sudo cp npanel-installer /usr/local/bin/
cd ..

# Build API server
cd backend
go build -o npanel-api
sudo cp npanel-api /opt/npanel/bin/
cd ..

# Build agent daemon
cd agent
go build -o npanel-agent
sudo cp npanel-agent /opt/npanel/bin/
cd ..

# Build UI (React)
cd frontend
npm install
npm run build
sudo cp -r build/* /opt/npanel/ui/
cd ..
```

### Build Individual Components

```bash
# Build only installer
cd installer && go build -o npanel-installer

# Build only API
cd backend && go build -o npanel-api

# Build only agent
cd agent && go build -o npanel-agent
```

## Development Setup

### Local Development

```bash
# 1. Clone repository
git clone https://github.com/npanel/npanel.git
cd npanel

# 2. Initialize Python virtual environment (for tools)
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\Activate.ps1

# 3. Install Go dependencies
go mod tidy

# 4. Download development dependencies
go get -u golang.org/x/tools/cmd/goimports

# 5. Format code
gofmt -w installer/ agent/ backend/

# 6. Run tests
go test ./...
```

### Running Components Locally

```bash
# Terminal 1: Start API server (with debug logging)
cd backend
go run main.go server.go --debug --port 8443

# Terminal 2: Start agent daemon
cd agent
sudo go run main.go agent.go --debug

# Terminal 3: Start frontend dev server
cd frontend
npm run dev  # Runs on http://localhost:3000
```

## Testing

### Unit Tests

```bash
# Test all components
go test ./...

# Test specific package
go test ./agent
go test ./backend

# Run with coverage
go test -cover ./...

# Generate coverage report
go test -cover -html=coverage.html ./...
```

### Integration Tests

```bash
# Start services
docker-compose -f tests/docker-compose.yml up -d

# Run integration tests
go test -tags=integration ./tests/...

# Cleanup
docker-compose -f tests/docker-compose.yml down
```

### Manual Testing

```bash
# Health check
curl -k https://localhost:443/health

# Agent socket (from host with agent running)
echo '{"action":"system.health","params":{}}' | \
  nc -U /var/run/npanel/agent.sock

# API endpoints
curl -k -X POST https://localhost/api/auth/login \
  -d '{"email":"admin@example.com","password":"password"}'
```

## Docker Development

### Build Docker Images

```bash
# Build all images
docker build -f Dockerfile.installer -t npanel:installer .
docker build -f Dockerfile.api -t npanel:api .
docker build -f Dockerfile.agent -t npanel:agent .

# Run containerized stack
docker-compose -f docker-compose.dev.yml up
```

### Docker Compose (Development)

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: npanel
      POSTGRES_PASSWORD: dev-password
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "8443:443"
    environment:
      DATABASE_URL: postgres://postgres:dev-password@postgres:5432/npanel
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

  agent:
    build:
      context: .
      dockerfile: Dockerfile.agent
    volumes:
      - /var/run/npanel:/var/run/npanel
    depends_on:
      - api
```

## Code Organization

### Backend Structure

```
backend/
├── main.go              # Entry point
├── server.go            # HTTP server setup
├── auth.go              # Authentication logic
├── handlers/
│   ├── domain.go       # Domain handlers
│   ├── email.go        # Email handlers
│   ├── service.go      # Service handlers
│   └── job.go          # Job handlers
├── models/
│   ├── domain.go       # Domain data model
│   ├── user.go         # User data model
│   └── job.go          # Job data model
├── middleware/
│   ├── jwt.go          # JWT authentication
│   ├── rbac.go         # Role-based access
│   └── audit.go        # Audit logging
├── agent/
│   └── client.go       # Agent communication
└── database/
    ├── migrate.go      # Database migrations
    └── queries.go      # SQL queries
```

### Agent Structure

```
agent/
├── main.go              # Entry point
├── agent.go             # Agent core
├── actions/
│   ├── domain.go       # Domain actions
│   ├── email.go        # Email actions
│   ├── service.go      # Service actions
│   └── system.go       # System actions
├── executor/
│   └── exec.go         # Command execution
└── sandbox/
    └── sandbox.go      # Sandboxing
```

### Frontend Structure

```
frontend/
├── src/
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Domains.tsx
│   │   ├── Emails.tsx
│   │   └── Admin.tsx
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── Modal.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   └── useAPI.ts
│   ├── lib/
│   │   └── api-client.ts
│   └── App.tsx
└── public/
```

## Code Style & Standards

### Go

```bash
# Format code
gofmt -w .

# Run linter
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
golangci-lint run

# Vet code
go vet ./...
```

### TypeScript/React

```bash
# Format code
npx prettier --write src/

# Lint code
npm run lint

# Type check
npm run type-check
```

## Performance Profiling

### CPU Profiling

```bash
# Generate CPU profile
go test -cpuprofile=cpu.prof ./backend
go tool pprof cpu.prof

# In pprof:
(pprof) top      # Show top functions
(pprof) web      # Generate graph
```

### Memory Profiling

```bash
# Generate memory profile
go test -memprofile=mem.prof ./agent
go tool pprof mem.prof

(pprof) alloc_space  # Total allocated
(pprof) alloc_objects # Object count
```

## Database Development

### Schema Migrations

```bash
# Create migration
migrate create -ext sql -dir migrations -seq init_schema

# Run migrations
migrate -path migrations -database "sqlite3:npanel.db" up

# Rollback
migrate -path migrations -database "sqlite3:npanel.db" down
```

### Database Tools

```bash
# Open SQLite database
sqlite3 /var/lib/npanel/npanel.db

# Useful commands in SQLite:
.tables              # List tables
.schema users        # Show table schema
SELECT COUNT(*) FROM users;  # Query

# Export data
.output data.sql
.dump
.output stdout

# Import data
.restore data.sql
```

## Release & Packaging

### Build Release Binaries

```bash
# Build for Linux x64 (AlmaLinux 9)
GOOS=linux GOARCH=amd64 go build -o npanel-api ./backend

# Build for Linux ARM64
GOOS=linux GOARCH=arm64 go build -o npanel-api ./backend

# Create release package
mkdir -p release/npanel-{version}
cp npanel-api npanel-agent npanel-installer release/npanel-{version}/
tar -czf npanel-{version}.tar.gz release/

# Sign release
gpg --detach-sign --armor npanel-{version}.tar.gz
```

### Create Installation Script

```bash
# install.sh - Downloaded and executed by users
#!/bin/bash
set -e

echo "nPanel Installation Script"
echo "=========================="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS"
    exit 1
fi

# Download installer binary
curl -fsSL https://releases.npanel.io/npanel-installer > /tmp/npanel-installer
chmod +x /tmp/npanel-installer

# Run installer
sudo /tmp/npanel-installer
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/build.yml
name: Build & Test

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.23'
      
      - name: Build
        run: |
          cd installer && go build
          cd ../backend && go build
          cd ../agent && go build
      
      - name: Test
        run: go test ./...
      
      - name: Lint
        run: |
          go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
          golangci-lint run
```

## Debugging

### Enable Debug Logging

```bash
# All components support --debug flag
./npanel-api --debug
./npanel-agent --debug
./npanel-installer --debug
```

### View Logs

```bash
# Real-time logs
tail -f /var/log/npanel/api.log
tail -f /var/log/npanel/agent.log

# Journalctl (systemd)
journalctl -u npanel-api -f
journalctl -u npanel-agent -f
```

### GDB Debugging

```bash
# Compile with debug symbols
go build -gcflags="all=-N -l" -o npanel-api ./backend

# Debug with GDB
gdb ./npanel-api
(gdb) run --debug
(gdb) break main
(gdb) continue
```

## Contributing

### Submit Changes

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes
# Add tests
# Format code
gofmt -w .

# Commit
git commit -m "Add my feature"

# Push
git push origin feature/my-feature

# Open pull request on GitHub
```

### PR Checklist

- [ ] Code formatted (`gofmt`)
- [ ] Tests added
- [ ] Tests pass (`go test`)
- [ ] Linter passes (`golangci-lint`)
- [ ] Documentation updated
- [ ] No breaking changes

## Troubleshooting

### Build Issues

```bash
# Module not found
go mod tidy
go mod download

# Compilation errors
go build -v  # Verbose output

# Clean build
go clean -cache
go build
```

### Runtime Issues

```bash
# Check service status
systemctl status npanel-api
systemctl status npanel-agent

# Restart service
systemctl restart npanel-api

# Clear database (caution!)
rm /var/lib/npanel/npanel.db
./npanel-api --init-db
```

## Performance Targets

- API response time: <100ms (p95)
- Installer time: <5 minutes
- Memory usage: <150MB idle
- CPU usage: <1% idle
- Database queries: <10ms typical

## Next Steps

1. Start building individual components
2. Write unit tests for each package
3. Integrate components via agent socket
4. Build deployment automation
5. Create comprehensive integration tests
