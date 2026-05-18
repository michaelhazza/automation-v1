# Per-Service Tier Summary — wave-6-rls-residue-and-gate-fix

**Date:** 2026-05-18
**Source:** git log + tier-categorisation.md + chunk commit messages

## Migration accounting

| Domain | Tier 1 migrated | Tier 2 guard-ignored | Tier 0 annotated | Tier 3 | Blocked-deferred |
|--------|----------------|---------------------|-----------------|--------|-----------------|
| agent-execution (Chunk 3) | 95 | 6 | 0 | 0 | 0 |
| skill-execution (Chunks 4+6+7) | 4 | 0 | 0 | 0 | 0 |
| workflow (Chunk 5) | 60 | 8 | 0 | 0 | 0 |
| billing (Chunks 4+6+7) | 6 | 2 | 0 | 0 | 0 |
| personal-assistant (Chunks 4+6+7) | 8 | 0 | 0 | 0 | 0 |
| sandbox (Chunks 8+9) | 22 | 4 | 0 | 0 | 0 |
| integration-services (Chunks 8+9) | 22 | 10 | 0 | 0 | 0 |
| jobs (Chunk 10) | 2 | 63 | 0 | 0 | 0 |
| lib (Chunk 11) | 21 | 18 | 1 | 0 | 0 |
| general-services batch A — a-e (Batch A) | ~133 | ~50 | 0 | 0 | 0 |
| general-services batch B — e-q (Batch B) | ~133 | ~50 | 0 | 0 | 0 |
| general-services batch C — r-z (Batch C) | ~116 | ~50 | 0 | 0 | 0 |
| **Total** | **~622** | **~261** | **1** | **0** | **0** |

## Notes

- "Tier 1 migrated" = callsite converted to `getOrgScopedDb()` or wrapped in `withAdminConnection()`
- "Tier 2 guard-ignored" = callsite annotated with `guard-ignore: with-org-tx-or-scoped-db` per ADR-0041 (admin/system/cross-tenant path)
- "Tier 0 annotated" = callsite in `server/lib/` using admin-context db wrapper (e.g., `adminDb`) — 1 case in `server/lib/sandboxTelemetrySequencePure.ts`
- "Already migrated" callsites (those skipped because Wave 5 had already converted them) are not counted — the gate no longer flags them
- Tier 2 count (261) is approximate from commit messages; exact count per chunk is documented in tier-categorisation.md
- Chunk 12 (this audit) added 15 additional guard-ignores for missed Tier 2 callsites (skillService.ts: 11, systemSkillHandlerValidator.ts: 1, operatorManagedBackend.ts: 3)

## Gate ratchet

- Before wave 6: `with-org-tx-or-scoped-db` baseline = 1108 (honest count after gate-fix)
- After wave 6: `with-org-tx-or-scoped-db` baseline = 0 (all violations suppressed or migrated)
- Total guard-ignore annotations (server/): 365
