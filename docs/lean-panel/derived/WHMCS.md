# WHMCS Integration (Derived)

Authoritative source:
- [docs/lean-panel/LEAN_PANEL_SPEC.md](../LEAN_PANEL_SPEC.md)

## Principles
- WHMCS is the single source of truth for customers/services/subscriptions/invoices.
- The panel must not implement billing logic or handle payment data.
- All billing actions redirect back to WHMCS.

## Required integrations
- SSO deep-link from WHMCS → panel (signed, short-lived, single-use)
- Webhooks from WHMCS → panel (suspension/unsuspension, plan changes)
- Product/service mapping → internal feature flags + limits

## Enforcement
- Service suspension must be enforced on every request.
- Suspended services: read-only panel + billing redirect.

## Implementation checklist
- [ ] Finalize SSO token contract (see contract doc)
- [ ] Implement token replay protection (jti store + TTL)
- [ ] Implement webhook receiver with signature verification
- [ ] Implement mapping layer: WHMCS product → features/limits
- [ ] Implement periodic reconciliation job (drift correction)
