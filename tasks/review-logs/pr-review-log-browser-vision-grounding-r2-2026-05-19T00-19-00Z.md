# PR Review Log — browser-vision-grounding (Round 2)

**Build slug:** browser-vision-grounding
**Round:** 2 (R1 was CHANGES_REQUESTED; R2 verifies fixes)
**HEAD at review:** d9aebb4b
**Reviewer:** pr-reviewer (Opus)
**Date:** 2026-05-19

---

**Files reviewed:**
- `server/services/visionGroundingService.ts`
- `server/services/__tests__/visionGroundingService.config.test.ts` (new)
- `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`
- `server/jobs/visionInferenceCostRollupJob.ts` (cross-check on adversarial F1 fix from `a9ed02e9`)
- `server/db/schema/ieeArtifacts.ts` (schema cross-check for B1)
- `shared/iee/failure.ts` (shape cross-check for test assertions)

Blocking: 0 / Should-fix: 0 / Consider: 0

**Verdict:** APPROVED

---

## R1 Blocker resolution

### B1 — `harvestVisionCalls` missing app-layer `organisationId` filter — RESOLVED

`server/services/visionGroundingService.ts:138-148` — the SELECT against `ieeArtifacts` now includes `eq(ieeArtifacts.organisationId, ieeRun.organisationId)` inside the `and(...)` block. Inline comment cites `DEVELOPMENT_GUIDELINES.md §1 / §9`. The column exists on `ieeArtifacts` (`organisation_id uuid notNull`) and an index on `(organisation_id, created_at)` already exists, so the filter has no negative perf impact.

## R1 Should-fix resolution

### S1+S2 — Test coverage — RESOLVED

`server/services/__tests__/visionGroundingService.config.test.ts:1-145` — 14 Vitest `it()` cases across two `describe` blocks. Hermetic env management. Coverage: `parseVisionEndpointHostPort` (7 cases) + `resolveEndpointConfig` (7 cases). HTTPS-only enforcement is now pinned by tests.

### S3 — Dead `ComputeCostCentsFn` alias in harness stub — RESOLVED

`visionDecisionLoop.ts:1-17` — dead import + alias + lint suppression all removed; header comment documents the follow-up build's value-import.

## R1 Consider items

C1 (pricing-rate replacement TODO) and C2 (IEE-DEF-7 cross-reference marker) routed to `tasks/todo.md`.

## Sanity-check on adversarial F1 fix

`server/jobs/visionInferenceCostRollupJob.ts:50-95` — platform-grain upsert now aggregates the whole table into ONE PLATFORM_SENTINEL row per day; cross-tenant clobber no longer possible. Per-run upsert correctly retains `GROUP BY organisation_id` because `run_id` is globally unique.

## Verdict

APPROVED — no remaining blockers; no should-fix; no new findings.
