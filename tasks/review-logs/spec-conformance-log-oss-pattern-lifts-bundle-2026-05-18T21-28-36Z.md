# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Spec commit at check:** `89f6286a89fe986ee9ca6499c34273c7fcc5fe93` (HEAD)
**Branch:** `spec-review/oss-pattern-lifts-bundle`
**Base:** `5db9f40f883681bcded0adc99528ce87ec7c0961`
**Scope:** all-of-spec (all 7 chunks built; Significant build, single-phase per §14)
**Changed-code set:** 28 code/config/test files (35 total minus 7 docs/metadata files)
**Run at:** 2026-05-18T21:28:36Z

---

## Summary

- Requirements extracted:     34
- PASS:                       34
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT

Three previously-recorded plan-level deviations (chatgpt-plan-review) are NOT new conformance gaps — they were accepted during planning and tracked in `tasks/builds/oss-pattern-lifts-bundle/progress.md`:
1. `createWaitpoint` optional `tx?` param (Chunk 2) — required by Chunk 6 atomic approval path.
2. `maintenance:` queue prefix on `maintenance:waitpoint-expiry-sweep` — convention alignment with existing maintenance jobs.
3. `completeWaitpoint` per-input-shape kind guard (`validateCompleteInputShapeMatchesKind`) — defence-in-depth.

All three are correctly reflected in the implementation and in the spec where the spec was updated during plan review.

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 1 | schema | §4.1 `waitpoints` table | PASS | `migrations/0379_waitpoints_primitive.sql:17-40`; `server/db/schema/waitpoints.ts:19-40` |
| 2 | schema | §4.1 5 CHECK constraints | PASS | `migrations/0379_waitpoints_primitive.sql:30-39` — status, kind, oauth-requires-bound-run, oauth-requires-resume-queue, approval-forbids-resume-queue |
| 3 | schema | §4.1 2 indexes (org_status + bound_run partial) | PASS | `migrations/0379_waitpoints_primitive.sql:42-45` |
| 4 | schema | §4.2 RLS policy with FORCE + org predicate | PASS | `migrations/0379_waitpoints_primitive.sql:47-49` |
| 5 | config | §12 `rlsProtectedTables.ts` entry | PASS | `server/config/rlsProtectedTables.ts` waitpoints entry |
| 6 | config | §7.1 `WAITPOINT_PRIMITIVE_ENABLED` env var | PASS | `server/lib/env.ts:81`; `docs/env-manifest.json` |
| 7 | export | §5.1 `createWaitpoint` params + return shape | PASS | `server/services/waitpointService.ts:44-103` |
| 8 | behavior | §5.1 service-layer validation | PASS | `server/services/waitpointServicePure.ts:35-72` (validateCreateWaitpointParams) |
| 9 | behavior | §5.1 plaintext generation (32 bytes hex) | PASS | `server/services/waitpointServicePure.ts:26-28` |
| 10 | behavior | §5.1 `id = tokenHash`, `expires_at` computation | PASS | `server/services/waitpointService.ts:50-65` |
| 11 | export | §5.2 `completeWaitpoint` dual input shape | PASS | `server/services/waitpointService.ts:109-118` |
| 12 | behavior | §5.2 optional `tx?` param | PASS | `server/services/waitpointService.ts:111-112, 211-219` |
| 13 | behavior | §5.2 optimistic UPDATE predicate (status pending + expires_at > now) | PASS | `server/services/waitpointService.ts:125-132` |
| 14 | behavior | §5.2 closed-set 0-rows mapping (completed → already_completed; expired/missing → 410) | PASS | `server/services/waitpointService.ts:143-171` |
| 15 | behavior | §5.2 OAuth resume_queue non-null runtime guard | PASS | `server/services/waitpointService.ts:180-188` |
| 16 | behavior | §5.2 OAuth `sendWithTx` enqueue with queueOptions | PASS | `server/services/waitpointService.ts:189-202` |
| 17 | behavior | §5.2 approval path: NO enqueue (Path B) | PASS | `server/services/waitpointService.ts:203-205` (comment + branch coverage) |
| 18 | export | §5.3 `expireWaitpoints` returns `{expiredCount}` | PASS | `server/services/waitpointService.ts:236-484` |
| 19 | behavior | §5.3 / §16 invariant: `SET LOCAL ROLE admin_role` first | PASS | `server/services/waitpointService.ts:250` |
| 20 | behavior | §5.3 invariant: every downstream SELECT/UPDATE carries org predicate | PASS | `server/services/waitpointService.ts:294-339, 386-431` |
| 21 | behavior | §5.3 oauth cleanup: predicate-checked agent_runs UPDATE with `assertValidTransition` semantics | PASS | `server/services/waitpointService.ts:323-368` (uses predicate-guarded UPDATE per builder note; equivalent fail-closed) |
| 22 | behavior | §5.3 approval cleanup: workflow_step_runs fail + `workflow-run-tick` enqueue | PASS | `server/services/waitpointService.ts:417-457` |
| 23 | behavior | §5.3 `waitpoint.expired_no_run` / `waitpoint.expired_no_step` silent-discard logs | PASS | `server/services/waitpointService.ts:284-318, 374-413, 466-473` |
| 24 | export | §5.3 F5 `buildFailStepRunColumnSet` pure helper | PASS | `server/services/workflowEngine/stepLifecyclePure.ts:35-47` |
| 25 | refactor | §5.3 F5 `failStepRunInternal` consumes helper | PASS | `server/services/workflowEngine/stepLifecycle.ts:50` (with source-of-truth anchor comment) |
| 26 | file | §6.1 `agent-run-resume-from-waitpoint` job + resumable-state check | PASS | `server/jobs/agentRunResumeFromWaitpointJob.ts` |
| 27 | config | §6.1 jobConfig + worker registration | PASS | `server/config/jobConfig.ts:1445-1451`; `pgBossRegistrations.ts:1039-1043` |
| 28 | file | §6.2 `waitpoint-expiry-sweep` job + duration log | PASS | `server/jobs/waitpointExpirySweepJob.ts` |
| 29 | config | §6.2 jobConfig + worker (teamSize:1, teamConcurrency:1) + 5-min cron schedule | PASS | `server/config/jobConfig.ts:1050-1058`; `pgBossRegistrations.ts:305, 684` |
| 30 | behavior | §7.2 OAuth CREATE gated by `WAITPOINT_PRIMITIVE_ENABLED` | PASS | `server/services/agentExecutionLoop.ts:874-885` |
| 31 | behavior | §7.2 OAuth COMPLETE gated, pre-fetches bound_run_id, calls `completeWaitpoint({plaintext, organisationId})` | PASS | `server/services/agentResumeService.ts:60-91` |
| 32 | behavior | §7.3 Approval CREATE gated, opens tx wrapping createWaitpoint + metadataJson.waitpointId write + awaiting_approval UPDATE | PASS | `server/services/workflowEngine/queueLifecycle/dispatch.ts:563-571+` |
| 33 | behavior | §7.3 Approval COMPLETE inside existing tx — four-step ordering (claim → re-read → completeWaitpoint → transition + resume) | PASS | `server/services/reviewService.ts:209-243` |
| 34 | docs | §13 `architecture.md` waitpoint section + `KNOWLEDGE.md` Trigger.dev entry | PASS | `architecture.md:1395-1396`; `KNOWLEDGE.md:3057` |

---

## Telemetry events (§9) — verified emitted

- `waitpoint.created` — `waitpointService.ts:92-100` (post-insert).
- `waitpoint.completed` — `waitpointService.ts:222-227` (post-tx-commit).
- `waitpoint.expired` (oauth) — `waitpointService.ts:361-368`.
- `waitpoint.expired` (approval) — `waitpointService.ts:458-465`.
- `waitpoint.expired_no_run` — `waitpointService.ts:284-289, 311-318`.
- `waitpoint.expired_no_step` — `waitpointService.ts:374-381, 405-412, 466-473`.

---

## Mechanical fixes applied

None. Verdict is CONFORMANT with zero gaps.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

---

## Files modified by this run

None (verdict CONFORMANT — no fixes applied).

---

## Next step

CONFORMANT — no gaps. Proceed to `pr-reviewer`.
