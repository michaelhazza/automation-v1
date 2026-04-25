# Spec Review Iteration 4 — codebase-audit-remediation-spec

**Spec commit at start:** 1e8e68ac (after iter3)
**Iteration:** 4 of MAX_ITERATIONS=5
**Codex output:** tasks/review-logs/_spec-review-codebase-audit-remediation-iter4-codex-output.txt

## Codex findings (3 — converging)

### iter4-FINDING #1 — §3.4 P3-M13/P3-M14 mapping omits §5.7
- Mechanical. §5.7 explicitly scopes P3-M13 and P3-M14 into Phase 2 (warning-level gates), but §3.4's audit-to-spec mapping routes "P3-M1 … P3-M16" entirely to §§7–8.
- Fixed: Split the §3.4 mapping into M1–M12, M13–M14 (§5.7), M15 (§5.6), M16 (§7.3).

### iter4-FINDING #2 — `server/lib/rateLimitStore.ts` violates §1 boundary 2 / §15.2 invariant
- Mechanical (architectural rule violation). Spec's own §1 boundary 2 says lib code "calls services or wraps the DB through `withAdminConnection()` — it does not import `db` directly". §8.1's new primitive sits in `server/lib/` and uses `db` directly.
- Fixed: Moved the new primitive to `server/services/rateLimitStoreService.ts`. DB access goes through `withAdminConnection()` (system-scoped table, no org context). Updated all references throughout the spec. The thin facade `testRunRateLimit.ts` stays in `server/lib/**` but no longer imports `db` — it imports the service. Test file colocates with the service: `server/services/__tests__/rateLimitStoreService.test.ts`.

### iter4-FINDING #3 — §13.5 stale "PR-open time" wording
- Mechanical. §2.5 (concurrent-PR rule) plus iter3 cascade fixed every other reference, but §13.5 line still said "number assigned at PR-open time".
- Fixed: Updated to "number assigned at merge time per §2.5".

## Iteration 4 classification summary

- Codex findings: 3
- Rubric findings: 0
- Total: 3
- All mechanical. All auto-applied.
- mechanical_accepted: 3
- mechanical_rejected: 0
- directional: 0
- ambiguous: 0
- reclassified -> directional: 0

## Iteration 4 Summary

- Mechanical findings accepted:    3
- Mechanical findings rejected:    0
- Directional findings:            0
- Ambiguous findings:              0
- Reclassified -> directional:     0
- Autonomous decisions:            0

