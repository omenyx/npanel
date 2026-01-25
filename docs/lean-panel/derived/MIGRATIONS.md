# Migrations (Derived)

Authoritative source:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../LEAN_PANEL_SPEC.md)

## Migration goals
- Import cPanel backups (.tar.gz)
- Validate integrity before activation
- Dry-run plan generation
- Rollback support

## Job-based model
- All migrations are queued jobs (no long-running HTTP requests).
- Steps are resumable with a job ID.

## Checklist
- [ ] Backup validation (structure, size, disk availability)
- [ ] Dry-run plan + conflict report
- [ ] Execution with snapshots
- [ ] Post-run verification
- [ ] Rollback until finalize
