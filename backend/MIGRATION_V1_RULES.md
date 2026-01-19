# Migration V1 Rules (Locked)

1) Database Import Rules
- All imported cPanel databases are owned by the single service-scoped MySQL user.
- Original cPanel DB users/grants are not recreated 1:1.
- Database names are preserved when possible; prefix or adjust on collision.
- Enforce plan.maxDatabases before import; exceed → fail migration.

2) Mailbox Rules
- Mailboxes are recreated with new generated passwords.
- Original passwords/hashes are not reused.
- Log note: "Mailbox passwords reset during migration".

3) Domain Scope
- Only the primary domain is provisioned in V1.
- Addon/parked domains are detected and logged; not provisioned.
- No vhosts/DNS created for addon domains.

4) Plan Synthesis
- Use deterministic imported_<hash> HostingPlan when source package does not match existing.
- Persist synthesized plans as first-class HostingPlan records.

