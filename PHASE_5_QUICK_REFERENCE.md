# Phase 5 Quick Reference Guide

**Date:** January 25, 2026  
**Status:** Ready for Execution

---

## 30-Second Overview

**Phase 5 = Hardening + Monetization + Polish**

| Track | Focus | Timeline | Owner |
|-------|-------|----------|-------|
| **Track A** | Performance isolation, auto-recovery, zero-downtime | Weeks 1-3 | Backend SRE |
| **Track B** | Reseller hierarchy, packages, WHMCS integration | Weeks 3-5 | Backend + API |
| **Track C** | Better UX, health scoring, predictable upgrades | Weeks 5-7 | Frontend + SRE |

**Performance Rule:** CPU ≤1% idle, latency unchanged, all features async

---

## Track A Features (Hardening & Scale)

### 1. cgroups v2 Resource Isolation
```
Problem: One account kills whole server
Solution: Enforce CPU 50%, RAM 512MB, IO 50MB/s per account
Timeline: Week 1-2
Success: Fork bomb contained, no impact on other accounts
```

### 2. Email Rate Limiting
```
Problem: Compromised account becomes spam relay
Solution: 500 emails/hour, 100 in 15min burst limits
Timeline: Week 2-3
Success: Spam prevented, legitimate bulk mailers can upgrade
```

### 3. Agent Watchdog
```
Problem: Agent dies, system becomes unmanageable
Solution: Separate watchdog process, auto-recovery
Timeline: Week 2-3
Success: <6 second detection, <10 second recovery
```

### 4. Graceful Reloads
```
Problem: Config changes require downtime
Solution: Fork new agent, drain old, zero downtime
Timeline: Week 3
Success: Live config updates without dropping connections
```

### 5. Config Layering
```
Problem: Upgrades overwrite custom configs
Solution: Layered system (built-in defaults + user overrides)
Timeline: Week 3
Success: Upgrade-safe config management
```

### 6. Soak Testing
```
Problem: Bugs appear after 24h under load
Solution: Automated 72-hour chaos tests
Timeline: Week 2-8 (ongoing)
Success: No crashes, memory leaks, or connection exhaustion
```

---

## Track B Features (Reseller & Billing)

### 1. Package Templates
```
Problem: All accounts identical, can't offer tiers
Solution: Basic/Pro/Enterprise packages with feature toggles
Timeline: Week 4
Success: 100+ package types, easy upgrades/downgrades
```

### 2. Quota Enforcement
```
Problem: No real limit enforcement
Solution: Real-time disk/bandwidth/email/database quotas
Timeline: Week 4-5
Success: Users warned at 80%, blocked at 100%
```

### 3. Reseller Hierarchy
```
Problem: Can't delegate account management
Solution: Admin → Reseller → Customer hierarchy
Timeline: Week 5
Success: Resellers manage 1000+ customers each
```

### 4. WHMCS API
```
Problem: No billing system integration
Solution: WHMCS-compatible provisioning API
Timeline: Week 5
Success: Automated provisioning, suspend/unsuspend, usage reporting
```

---

## Track C Features (Polish & Differentiation)

### 1. Progress Tracking
```
Problem: Restore shows nothing, user thinks it's stuck
Solution: Real-time progress, ETA, speed indicator
Timeline: Week 6
Success: Users know what's happening, realistic ETAs
```

### 2. Health Scoring
```
Problem: Migrations succeed but accounts are broken
Solution: Auto-detect issues post-migration, score 0-100
Timeline: Week 6
Success: 90% accuracy, guides users to fix problems
```

### 3. Audit Logs v2
```
Problem: Hard to read audit logs, no action relationships
Solution: Structured logs, searchable, clear cause-and-effect
Timeline: Week 6
Success: Easy to debug, comply with audit requirements
```

### 4. Smart Defaults
```
Problem: New accounts have weak security by default
Solution: SSH key required, fail2ban, secure permissions
Timeline: Week 6-7
Success: Secure by default, easy for users to verify
```

### 5. Predictable Upgrades
```
Problem: Upgrades break things, downtime required
Solution: Pre-flight checks, canary deploy, auto-rollback
Timeline: Week 7
Success: >99% upgrade success rate, <5min if issues detected
```

---

## UI/UX Changes (All Tracks)

### Dark & Light Themes
```
Light: Professional, airy (default)
Dark: Modern, reduced eye strain (opt-in)
- Toggle in settings
- Respects system preference
- Smooth transition
```

### New Logo Integration
```
Location: Header (all pages)
Variants: 
  - Light theme: nPanel_dark.svg
  - Dark theme: nPanel_light.svg
  - Icon only: nPanel_icon.svg
Size: 48px (responsive)
```

### Component Upgrades
```
Modern design system (Radix UI + Tailwind)
- Improved buttons with loading states
- Better form inputs with validation
- Card components with elevation shadows
- Modal/alert components more prominent
- Responsive grid layout (mobile-first)
- Better accessibility (WCAG 2.1 AA)
```

### UX Improvements
```
Dashboard: 1-screen overview (vs information overload)
Domain creation: 3 steps (vs 5 screens)
Email accounts: 2 steps (vs 4 screens)
- Clearer action buttons
- Fewer clicks overall
- Confirmation before destruction
- Helpful error messages
```

---

## Implementation Checklist

### Week 1-2 (Track A Foundation)
- [ ] cgroups v2 agent code
- [ ] Email rate limiting
- [ ] Agent watchdog service
- [ ] 24-hour soak test
- **Gate 1 Approval**

### Week 3 (Track A Continuation)
- [ ] Graceful reload mechanism
- [ ] Config layering system
- [ ] Performance baseline established
- **Gate 2 Checkpoint**

### Week 4-5 (Track B)
- [ ] Package template CRUD API
- [ ] Quota enforcement algorithm
- [ ] Reseller hierarchy schema
- [ ] WHMCS API endpoints
- **Gate 2 Approval**

### Week 6 (Track C Foundation)
- [ ] Progress tracking API/WebSocket
- [ ] Health score calculation
- [ ] Audit log v2 schema
- [ ] Smart defaults configuration

### Week 7 (Track C Completion)
- [ ] Upgrade framework
- [ ] Pre-flight checks
- [ ] Canary deployment logic
- [ ] Auto-rollback mechanism
- **Gate 3 Approval**

### Week 8 (Integration & Rollout)
- [ ] Cross-track testing
- [ ] 72-hour chaos soak
- [ ] Performance regression test
- [ ] Security audit (all features)
- [ ] Feature gates verified
- **Gate 4: Production Approved**

---

## Feature Gating Commands

```bash
# List all features
curl -H "Authorization: Bearer $TOKEN" \
  https://api.npanel.local/api/admin/features

# Enable feature
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"enabled": true}' \
  https://api.npanel.local/api/admin/features/cgroups_enabled

# Monitor feature impact (auto-disable if regression)
# Dashboard: /admin/monitoring/features
```

---

## Performance Gates

```
METRIC                    THRESHOLD         ACTION
─────────────────────────────────────────────────────
Idle CPU                  > 1.5%           Disable feature
API Latency (p99)         > 210ms (±5%)    Investigate
Memory usage              > 2% increase     Disable feature
Email throughput          < 100/sec        Rollback
Uptime                    < 99.95%         Investigate
Error rate                > 0.1%           Escalate
```

**Auto-disable rule:** If any metric exceeds threshold for >5 minutes, feature disabled automatically

---

## Security Testing

**Required for each Phase 5 feature:**
- [ ] 50+ attack vectors tested
- [ ] Privilege escalation vectors: 0
- [ ] Data isolation verified
- [ ] Permission bypass scenarios tested
- [ ] Resource exhaustion scenarios tested
- [ ] Audit trail covers all actions

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| cgroups breaks on kernel 5.1 | Medium | High | Only deploy 5.3+, fallback rlimit |
| WHMCS API integration fails | Low | High | Comprehensive testing, adapter |
| Performance regression >5% | Low | High | Auto-disable feature, investigate |
| Reseller quota bypass | Low | High | Enforce at agent level |
| Upgrade rollback fails | Very Low | Critical | Dual-agent pattern + pre-flight |

---

## Success Criteria

✅ All 47 Phase 4 requirements still met  
✅ Performance metrics within bounds  
✅ 72-hour soak test passed (no crashes)  
✅ Security audit: 0 new vulnerabilities  
✅ Resellers can provision accounts automatically  
✅ Users prefer nPanel UX over cPanel  
✅ Hosting providers rate upgrades as reliable  

---

## Key Docs

| Document | Use Case |
|----------|----------|
| PHASE_5_MASTER_SPECIFICATION.md | Complete technical details (50+ pages) |
| PHASE_5_UI_UX_MODERNIZATION.md | Design system, components, logo |
| PHASE_5_IMPLEMENTATION_EXECUTION_GUIDE.md | Week-by-week tasks + code examples |
| PHASE_5_PROJECT_KICKOFF.md | Executive summary + timeline |
| **This file** | Quick reference |

---

## Contacts

- **Architecture Questions:** architecture@npanel.local
- **Backend Implementation:** backend@npanel.local
- **Frontend/UX:** frontend@npanel.local
- **Security Review:** security@npanel.local
- **DevOps/SRE:** ops@npanel.local

---

## Quick Start

1. **Read:** PHASE_5_PROJECT_KICKOFF.md (10 min)
2. **Review:** PHASE_5_MASTER_SPECIFICATION.md (1-2 hours)
3. **Plan:** PHASE_5_IMPLEMENTATION_EXECUTION_GUIDE.md (30 min)
4. **Design:** PHASE_5_UI_UX_MODERNIZATION.md (30 min)
5. **Code:** Start with Task 1.1 (cgroups v2)

---

## Version

- **Date:** 2026-01-25
- **Status:** APPROVED FOR EXECUTION
- **Next Update:** End of Week 1

