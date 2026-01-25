# nPanel - Production-Grade Hosting Control Panel

**nPanel** is a production-ready hosting control panel with WHM/cPanel-level functionality, designed for performance, security, and ease of deployment.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Browser / API Client                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTPS
                    ┌────────────▼────────────┐
                    │   nPanel API (Go)       │
                    │  - REST endpoints       │
                    │  - RBAC + Auth          │
                    │  - Job orchestration    │
                    └────────────┬────────────┘
                                 │ Unix Socket / mTLS
                    ┌────────────▼────────────┐
                    │  Local Agent (Go)       │
                    │  - Runs as root         │
                    │  - Allow-listed actions │
                    │  - System integration   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  OS / Services          │
                    │  - systemd              │
                    │  - Linux kernel         │
                    └─────────────────────────┘
```

## Components

- **installer/** - Safe, idempotent deployment tooling (Go)
- **agent/** - Privileged system agent daemon (Go)
- **backend/** - REST API server (Go or Node.js)
- **frontend/** - React SPA with Nginx
- **docs/** - Architecture & deployment guides

## Quick Start

```bash
curl -fsSL https://npanel.io/install.sh | bash
```

Or with binary:
```bash
./npanel-installer
```

## Key Design Principles

✓ Lightweight & async-first
✓ Agent-based architecture (API never executes shell)
✓ Principle of least privilege
✓ cgroups v2 resource protection
✓ Full audit logging
✓ Zero-config first run
✓ Clean uninstall capability

## Target OS

- **Primary:** AlmaLinux 9
- **Secondary:** RHEL 9, Ubuntu 22.04+

## Requirements

- 2+ CPU cores
- 2GB+ RAM
- 10GB+ disk space
- Port 443 available (HTTPS)
- Port 8006+ for services

## Status

🚀 Building production-grade components...

## License

See LICENSE file
