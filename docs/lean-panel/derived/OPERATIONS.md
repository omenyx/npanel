# Operations (Derived)

Authoritative source:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../LEAN_PANEL_SPEC.md)

## Deployment targets
- Fresh AlmaLinux / Ubuntu installs
- Single-node Docker (Compose)

## Operability principles
- Idempotent install scripts
- Clear health/readiness endpoints
- Safe privileged actions via allowlisted task runner

## Checklist
- [ ] systemd units for API + agent
- [ ] Nginx config templates + reload workflow
- [ ] Postgres init and migrations
- [ ] Backup/restore scripts
- [ ] Update script with rollback
