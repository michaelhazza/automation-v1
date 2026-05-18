# Reality Check Log — oss-pattern-lifts-bundle

| Field | Value |
|---|---|
| Build slug | oss-pattern-lifts-bundle |
| Branch | spec-review/oss-pattern-lifts-bundle |
| HEAD | 8f207f3b |
| Timestamp (UTC) | 2026-05-18T22:40:00Z |
| Reviewer | reality-checker (read-only, evidence-classification) |

Summary count: Verified: 8 / Unverified: 0
**Verdict:** READY

---

## Per-criterion evidence classification

### Criterion 1 — Generalised primitive replaces both hand-rolled implementations, gated by `WAITPOINT_PRIMITIVE_ENABLED` default false
**Classification:** deterministic check. `server/lib/env.ts:81-85`; `agentExecutionLoop.ts:874`; `agentResumeService.ts:60`; `dispatch.ts:563`; `reviewService.ts:209`. Both call sites flip together. Spec-conformance REQ 30-33 PASS. Verified.

### Criterion 2 — Three kinds encoded by DB CHECK + service-layer validation
**Classification:** deterministic check. `migrations/0379_waitpoints_primitive.sql:32-39` (five CHECK constraints); `waitpointServicePure.ts:35-72`, `:93-109`. Spec-conformance REQ 1, 2, 7, 8 PASS. Verified.

### Criterion 3 — `completeWaitpoint` dual input shape with optional `tx?`
**Classification:** deterministic check. `waitpointService.ts:114-118` (signature); `:119-123` (resolution); `:221-230` (tx vs own-tx); OAuth caller `agentResumeService.ts:91`; approval caller `reviewService.ts:230`. Spec-conformance REQ 11-14, 31, 33 PASS. Verified.

### Criterion 4 — 5-minute `waitpoint-expiry-sweep` performs per-kind cleanup
**Classification:** deterministic check. `waitpointExpirySweepJob.ts:31-47`; `jobConfig.ts:1050-1058`; `pgBossRegistrations.ts:305, 684`; `waitpointService.ts:264-277` (bulk UPDATE); OAuth cleanup `:303-406` with `assertValidTransition` at `:351`; approval cleanup `:408-515` with `buildFailStepRunColumnSet` + `sendWithTx('workflow-run-tick', ..., { singletonKey: workflowRunId, useSingletonQueue: true })`. Spec-conformance REQ 18-25, 28-29 PASS. Verified.

### Criterion 5 — Three telemetry events emitted plus expired_no_run/expired_no_step
**Classification:** deterministic check. `waitpointService.ts:97-105` (created), `:233-237` (completed), `:399-405`/`:498-504` (expired), `:305-310`/`:337-343` (expired_no_run), `:413-419`/`:444-453`/`:506-513` (expired_no_step). Verified.

### Criterion 6 — Per-kind queue contract enforced by CHECK + service validators
**Classification:** deterministic check. DB CHECKs `waitpoints_oauth_requires_resume_queue` (`:36-37`) and `waitpoints_approval_forbids_resume_queue` (`:38-39`); service validators `waitpointServicePure.ts:36-72`; OAuth completion `:185-213` with JOB_CONFIG runtime guard at `:196-201`; approval branch `:215-216` Path B comment. Spec-conformance REQ 15-17 PASS. Verified.

### Criterion 7 — Documented in `architecture.md` and `KNOWLEDGE.md`
**Classification:** deterministic check. `architecture.md:1395-1460` (Waitpoint Primitive section, anchor `waitpoint-primitive`); `KNOWLEDGE.md:3057-3064` (Trigger.dev decision entry). Spec-conformance REQ 34 PASS. Verified.

### Criterion 8 — Execution-safety contracts (§15)
**Classification:** log excerpt + deterministic check. State-based idempotency `:130-136`; closed-set 0-row mapping `:142-176`; first-commit-wins via optimistic predicate; no-silent-partial-success via SAVEPOINT-per-row at `:301` (all four `continue` paths release at `:311, :344, :420, :452`, end-of-iteration RELEASE at `:519`, `ROLLBACK TO SAVEPOINT row_sp` at `:521` before logger.warn at `:522`); OAuth resume dedup via `singletonKey: runId` at `:208` + `jobConfig.ts:1449`. pr-review-log round 3 APPROVED — round 1 closed B1-B6, round 2 raised rB1, round 3 confirmed rB1 CLOSED at `8f207f3b`. Adversarial L1/L2 closed via pr-reviewer B1/B2/rB1. Verified.

---

## Deferred items acknowledged (not gating)

- 3 Should-fix carry-forward: pgBossTxSend ON CONFLICT predicate width vs pg-boss partial unique indexes; `sql.raw` UUID interpolation footgun at `waitpointService.ts:316-325`; missing SAVEPOINT-per-row recovery test.
- 2 Consider items: dead `let` declarations at `agentExecutionLoop.ts:871-872`; flag-flip rollback runbook documentation.
- 2 pre-existing `meta: cardContent as any` lint warnings — pre-date this build, routed to tasks/todo.md.

All deferred items surfaced in `progress.md` and pr-review-log round 3; none block stated criteria.

**Verdict:** READY
