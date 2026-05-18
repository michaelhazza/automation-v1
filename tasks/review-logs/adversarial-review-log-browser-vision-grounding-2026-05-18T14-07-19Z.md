# adversarial-reviewer — browser-vision-grounding

**Build:** browser-vision-grounding
**Branch:** main (post-Phase-2 close)
**Date:** 2026-05-18
**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes, 4 worth-confirming)

---

## Closed in-branch

### F1 — confirmed-hole, MEDIUM — cost_aggregates cross-tenant clobber

**Location:** `server/jobs/visionInferenceCostRollupJob.ts` (platform-grain upsert).

**Issue:** `cost_aggregates` UNIQUE constraint is `(entity_type, entity_id, period_type, period_key)`. The platform-grain upsert used `entity_type='source_type', entity_id='vision_inference'` (CONSTANT across orgs). A per-org GROUP BY produced one row per org per day; the second org's INSERT clobbered the first via `ON CONFLICT DO UPDATE`. Attack: org A runs 1000 vision calls / day; org B's 2-call rollup runs after; org A's aggregate is overwritten — runCostBreaker would miss daily-spend ceiling enforcement. Mirror: B could land on top of A and inflate B's apparent spend.

**Fix applied:** Commit `a9ed02e9`. Removed `organisation_id` from the platform-grain GROUP BY, aggregate the whole table into ONE row per day, attributed to `PLATFORM_SENTINEL` (`00000000-0000-0000-0000-000000000001`). Matches the existing convention in `server/services/costAggregateService.ts:101,124,131` for `source_type` / `platform` / `provider` entity types. Per-run rows are unaffected (run_id is globally unique).

---

## Routed to backlog (V1-deferred — follow-up build, full harness wiring)

### F2 — likely-hole, LOW — `subaccountId` cross-tenant attempt at harvest

**Location:** `server/services/visionGroundingService.ts:197` (`subaccountId: rec.subaccountId ?? ieeRun.subaccountId ?? null`).

**Issue:** `rec` deserialized from `vision_calls.json` (in-sandbox artefact). When the follow-up build wires the real harvest, `rec.subaccountId` originates from harness code. The schema FK `subaccount_id uuid REFERENCES subaccounts(id)` only enforces existence, not org-scope. A compromised harness could write a foreign-org subaccount UUID; RLS gates on `organisation_id` (safe) but `subaccount_id` would silently land in `vision_inference_calls`.

**Status:** Unreachable in V1 — `fetchArtifactBytes` is a loud-failure stub. Routed to `tasks/todo.md` as **BVG-ADV-F2**: in the follow-up wiring, verify `rec.subaccountId` belongs to `ieeRun.organisationId` before writing; fall back to `ieeRun.subaccountId` on mismatch and log `vision.harvest.subaccount_cross_tenant_attempt`.

### F3 — likely-hole, LOW — `VisionCallRecord[]` parsed without Zod

**Location:** `server/services/visionGroundingService.ts:160` (`records = JSON.parse(rawJson) as VisionCallRecord[]`).

**Issue:** Bare type cast. In the follow-up build: unbounded `actionType` (text column, no max length); negative `costCents` would deflate aggregates; unknown `modelId` triggers the parity warning but the insert proceeds with the harness-supplied value.

**Status:** Unreachable in V1. Routed to `tasks/todo.md` as **BVG-ADV-F3**: add `z.array(VisionCallRecordSchema).parse(records)` before the insert loop. Bounded integer ranges; max length on text fields.

---

## Worth-confirming (V1-acceptable, validate before follow-up)

### W1 — `_ieeShared.ts` orchestrator GUC propagation

The `db.transaction` at `agentRunFinalizationService.ts:195` opens WITHOUT a preceding `setOrgGUC` for IEE backends. `harvestVisionCalls` sets the GUC inside its own first statement (`SET LOCAL` is transaction-scoped, so this persists for the rest of the tx). Pre-existing pattern — not introduced by this diff. Behaviour confirmed correct for the harvest path. The pre-existing `loadTerminalState` / parent `agentRuns` SELECT path is annotated with `guard-ignore-next-line` for the cross-backend transaction. Acceptable for V1 — not actioning.

### W2 — Cost-parity check is advisory, not enforced

`visionGroundingService.ts:170-191`: server-side parity check logs `vision.harvest.cost_parity_mismatch` but the harness-supplied `costCents` is used for the DB insert regardless. By spec §8.4 design (harness is source-of-truth). Acceptable for V1 (harness is stub). Follow-up build should decide whether server formula wins on mismatch above a threshold.

### W3 — `sandboxRunTask` parameter logging for `visionEndpointToken`

Confirm `sandboxExecutionService` / `e2bSandbox` does not log the full options struct (which contains `visionEndpointToken`) at the call site. V1 stub never invokes the real sandbox; confirm before follow-up wiring.

### W4 — No vision-call frequency cap per tenant

No per-hour / per-day vision rate limit at dispatch. `ceilings.costCents` on the sandbox policy bounds per-task cost. V1 stub never spawns real inference. Add vision-specific tenant frequency caps before follow-up.

---

## STRIDE summary

| Vector | Status |
|---|---|
| Spoofing | n/a — no new routes or auth surface |
| Tampering | F1 (closed) |
| Repudiation | minor — no per-harvest audit event; pg-boss job state is sufficient for V1 |
| Information disclosure | F2 / F3 deferred to follow-up; redaction contract documented |
| Denial of service | W4 deferred to follow-up |
| Elevation of privilege | n/a — `decisionMode` is Zod-validated at schema parse |

---

## Files reviewed

`migrations/0378_vision_inference_calls.sql`, `migrations/0378_vision_inference_calls.down.sql`, `server/config/rlsProtectedTables.ts`, `server/db/schema/visionInferenceCalls.ts`, `server/db/schema/index.ts`, `server/services/visionGroundingService.ts`, `server/services/executionBackends/_ieeShared.ts`, `server/jobs/visionInferenceCostRollupJob.ts`, `infra/sandbox-templates/iee-browser/harness/index.ts`, `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`, `shared/types/visionActions.ts`, `shared/visionInferencePricing.ts`, `shared/iee/failureReason.ts`, `shared/types/sandbox.ts`, `shared/iee/jobPayload.ts`, `server/services/agentExecutionService/types.ts`, `server/services/agentExecutionService/backendDispatch.ts`, `server/services/skillParserServicePure.ts`, `server/lib/orgScoping.ts`, `server/lib/adminDbConnection.ts`, `server/services/agentRunFinalizationService.ts`, `migrations/0024_llm_router.sql`, `migrations/0272_cost_aggregates_rls_and_spend_dims.sql`.
