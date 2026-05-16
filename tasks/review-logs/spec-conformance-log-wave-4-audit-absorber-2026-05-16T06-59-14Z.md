# Spec Conformance Log

**Spec:** `tasks/builds/wave-4-audit-absorber/spec.md`
**Spec commit at check:** `570e4364` (locked spec; plan locked at `a0b61b5e`)
**Branch:** `claude/wave-4-audit-absorber`
**Base:** `77b70f82` (merge-base with origin/main)
**Branch HEAD:** `426871a7`
**Scope:** all spec sections (§5-§12) — operator confirmed at chunk 0 decision 6
**Changed-code set:** 38 code files + 9 doc/spec/plan artifacts + 25 skill-md renames + 5 build artifacts
**Run at:** 2026-05-16T06:59:14Z

---

## Summary

- Requirements extracted:     70
- PASS:                       68
- MECHANICAL_GAP -> fixed:    0
- DIRECTIONAL_GAP -> deferred: 2
- AMBIGUOUS -> deferred:      0
- OUT_OF_SCOPE -> skipped:    0

**Verdict:** NON_CONFORMANT (2 directional gaps — see deferred items)

> Both gaps are operator-acknowledged trade-offs from the build (one explicit in the test source comment, one structural pattern across 6 integration tests per the §4 testing-posture deviation). Neither is a missing-implementation defect; both are scope-of-test design choices the operator made during execution. Routing to `tasks/todo.md` so the deferred work is tracked rather than silently absorbed.

---

## Requirements extracted (full checklist)

### §5.1 AE1 — Critical-event await conversion

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #1 | §5.1 | `void insertExecutionEventSafe(...)` at handoff.ts:107 (eventType `tool.error`) -> `await` | PASS |
| #2 | §5.1 | `void insertOutcomeSafe(...)` at handoff.ts:128 (outcome `rejected`) -> `await` | PASS |
| #3 | §5.1 | `void insertExecutionEventSafe(...)` at handoff.ts:140 (eventType `tool.error`) -> `await` | PASS |
| #4 | §5.1 | `void insertOutcomeSafe(...)` at handoff.ts:227 (outcome `rejected`) -> `await` | PASS |
| #5 | §5.1 | `void insertExecutionEventSafe(...)` at handoff.ts:249 (eventType `tool.error`) -> `await` | PASS |
| #6 | §5.1 / chunk-0 D7 | handoff.ts:341 (outcome `accepted`) confirmed non-critical; remains `void` | PASS |
| #7 | §5.1 chunk-1 fix-up | `void insertExecutionEventSafe` at tasks.ts:575 -> `await` (W4AA-DEBT-15) | PASS |
| #8 | §5.1 chunk-1 fix-up | `void insertOutcomeSafe` at tasks.ts:693 -> `await` | PASS |
| #9 | §5.1 chunk-1 fix-up | `void insertExecutionEventSafe` at tasks.ts:711 -> `await` | PASS |

### §5.2 AE2 — queue-backed executeSpawnSubAgents

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #10 | §5.2 step 1 | Pre-create child `agent_runs` row in same tx as `boss.send` (Pattern A) | PASS |
| #11 | §5.2 step 1 | `makePgBossDb(tx)` adapter bridges Drizzle postgres-js client to pg-boss `Db.executeSql` | PASS |
| #12 | §5.2 step 1 | Worker reads pre-created row by id; throws on missing or unexpected-status row | PASS |
| #13 | §5.2 step 1 | Worker exits cleanly on terminal-status row (duplicate enqueue) | PASS |
| #14 | §5.2 step 2 | `enqueueHandoff` returns `{ enqueued, runId, jobId, reason? }` discriminated union | PASS |
| #15 | §5.2 step 2 | `tasks.ts:93, 757` callers migrated from boolean to `result.enqueued` | PASS |
| #16 | §5.2 step 3 | `(agentId, taskId, subaccountId)` running-row dedup returns `reason: 'duplicate'` | PASS |
| #17 | §5.2 step 3 | Parent resolves existing runId on duplicate via running-row SELECT | PASS |
| #18 | §5.2 step 4 | Happy-path result shape preserved byte-for-byte | PASS |
| #19 | §5.2 step 4 | `pollIntervalMs = 1000`; batched `WHERE id = ANY($1)` | PASS |
| #20 | §5.2 step 5 | Timeout path adds `pending: string[]` field (additive) | PASS |
| #21 | §5.2 step 6 | Partial child failure -> `success: true` | PASS |
| #22 | §5.2 step 7 | Parent-restart resume queries `WHERE parent_run_id = ?` | PASS |
| #23 | §5.2 step 8 | New event type `run.cancellation_requested` registered (critical) | PASS |
| #24 | §5.2 step 8 | Cancel API emits `run.cancellation_requested` for each child in running/pending | PASS |
| #25 | §5.2 step 8 | Cooperative observer in `agentExecutionLoop.ts:482-500` writes child `run.terminal` event | PASS |
| #26 | §5.2 step 8 | `agent_runs.status` is single source of truth | PASS |
| #27 | §5.2 step 9 | `spawn_sub_agents.md` updated for the `pending` field | PASS |
| #28 | §5.2 step 10 | `architecture.md § Agent-spawn durability (AE2 — Wave 4 Session G)` documents contract | PASS |

### §6.1 MC7 — Test-meta framework

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #29 | §6.1 | `handlerIdempotency.meta.test.ts` exists | PASS |
| #30 | §6.1 | `HANDLER_REGISTRY` fixture at `server/lib/__tests__/handlerRegistryFixture.ts` | PASS |
| #31 | §6.1 | `JOB_PAYLOAD_FIXTURES` at `server/lib/__tests__/jobPayloadFixtures.ts` | PASS |
| #32 | §6.1 | `JOB_CONFIG.idempotencyContract` discriminated union (handler_tested/external_consumer/send_only/exempt) | PASS |
| #33 | §6.1 | Every `JobName` has a verdict with required fields | PASS |
| #34 | §6.1 | Bidirectional set-equality between `JOB_CONFIG`, `HANDLER_REGISTRY`, gate | PASS |
| #35 | §6.1 | `scripts/verify-handler-registry-fixture.sh` registered in `run-all-gates.sh` | PASS |
| #36 | §6.1 acceptance | Every `handler_tested` queue passes double-fire assertion with single-fire-equivalent DB state | DIRECTIONAL_GAP |

### §6.2-§6.8 Standalone tests

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #37 | §6.2 | `handoffDurability.integration.test.ts` covers AE2's 4 scenarios | DIRECTIONAL_GAP |
| #38 | §6.3 | `servicePrincipalTraceBoundary.integration.test.ts` exists | PASS (test file + structural-only) |
| #39 | §6.4 | `idempotencyKey.dedup.test.ts` exists with behavioral assertion in skipIf block | PASS |
| #40 | §6.5 | `agentRunVisibility.integration.test.ts` exists | PASS |
| #41 | §6.7 | `costLedger.idempotency.test.ts` exists | PASS |
| #42 | §6.8 | `payloadRetention.tierBoundary.test.ts` exists | PASS |

### §7-§12 (remaining areas)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #43 | §7.1 DUP6 | 87L clone extracted to `applyDecisionStepResult` private helper in `agentStep.ts` | PASS |
| #44 | §8 CD2-CD10 | All 9 cycles verified closed by post-#307 sprint (baseline cycle-count:0) per chunk-0 log | PASS |
| #45 | §9.1 SK1 | `scripts/compare-skill-md-against-registry.ts` + `skill-unmatched-report.json` | PASS |
| #46 | §9.1 SK1 | Methodology-only path `docs/methodologies/` documented in architecture.md | PASS |
| #47 | §9.2 SK2 | All 25 kebab-named skill `.md` files renamed to snake_case | PASS |
| #48 | §9.2 SK2 | `scripts/verify-skill-md-naming.sh` walks `server/skills/` recursively | PASS |
| #49 | §9.3 SK3 | Covered by existing `verify-universal-skill-sync.sh` P7 gate | PASS |
| #50 | §10.1 PA-DEF-2 | `operatorSessionInitialContextBundler.ts` adds org predicate + deterministic orderBy | PASS |
| #51 | §10.2 PA-DEF-3 | Logger-only acceptance (chunk-0 default decision) | PASS |
| #52 | §10.3 PA-DEF-5 | Doc-comment updates in 3 voice profile files | PASS |
| #53 | §10.4 PA-DEF-6 | KNOWLEDGE.md Pattern entry for column-rename grep discipline | PASS |
| #54 | §10.5 PA-DEF-7 | `ne(voiceProfiles.state, 'failed')` added (chunk-0 default option (a)) | PASS |
| #55 | §11.1 PP-CD1 | Existing `verify-no-new-cycles.sh` registered | PASS |
| #56 | §11.2 PP-AE2 | `verify-critical-event-emission-awaited.sh` authored per §5.1 invariant | PASS |
| #57 | §11.3 PP-SK2 | Existing `verify-universal-skill-sync.sh` registered | PASS |
| #58 | §11.4 PP-MC2 | `verify-critical-path-coverage.sh` + `tasks/critical-paths-manifest.yml` (v1, 5 seed entries) | PASS |
| #59 | §11.5 MC4 | `verify-llm-call-site-routes-through-router.sh` authored with allowlist | PASS |
| #60 | §12.1 PP-AE1 | architecture.md § Agent-execution audit trail (exact spec wording) | PASS |
| #61 | §12.2 PP-AE3 | DEVELOPMENT_GUIDELINES.md §8.40 (exact spec wording) | PASS |
| #62 | §12.3 PP-CD3 | KNOWLEDGE.md entry 2026-05-16 (exact spec wording) | PASS |
| #63 | §12.4 PP-MC1 | `docs/codebase-audit-framework.md § Module C` (exact spec wording) | PASS |

### §13 Acceptance

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| #64 | §13.2 | `npm run build:server` exits 0 (per progress.md G2 PASS) | PASS |
| #65 | §13.3 | `npm run lint` exits 0 (883 warnings, 0 errors) — verified in this run | PASS |
| #66 | §13.4 | All new gates registered in `run-all-gates.sh` (7 new/existing entries) | PASS |
| #67 | §13.5 | `madge --circular` count stays at 0 (baseline preserved) | PASS |
| #68 | §13.6 | Targeted Vitest passes for every authored test (per chunk G1 attempts) | PASS |
| #69 | §13.7 | `tasks/critical-paths-manifest.yml` exists with 5 seed entries | PASS |
| #70 | §13.8 | `tasks/todo.md` items closure — DEFERRED to merge commit per build flow (chunk 13 = this review) | PASS |

---

## Mechanical fixes applied

None. No mechanical gaps surfaced.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### REQ #36 — MC7 double-fire equivalence assertion not actually executed

**Spec section:** §6.1 acceptance and step 2 ("synthesise a payload ... fire the handler twice via `HANDLER_REGISTRY[name].handler`, assert single-fire-equivalent DB state per the equivalence contract below").

**Spec quote:** "framework passes against all current `JobName` entries — every queue declares a verdict; every `handler_tested` queue passes the **double-fire assertion**."

**Implementation:** `server/lib/__tests__/handlerRegistryFixture.ts` has `handler: null` for every entry (~110 queues, including ~70 `handler_tested` ones). `handlerIdempotency.meta.test.ts` step 6 is explicit: "step 6: handler_tested entries with handler=null are flagged (wiring deferred to integration phase)". The test asserts `expect(notYetWired.length).toBeGreaterThan(0)` — a pinned acknowledgement that NO handler is wired.

**Gap:** the double-fire equivalence assertion (compare DB snapshots after two fires of each handler with the equivalence contract from §6.1) is not actually run. The meta-test verifies registry structural integrity (12 assertions) but never executes any handler.

**Why DIRECTIONAL not MECHANICAL:** wiring ~70 handlers into the registry requires: (a) per-handler payload synthesis covering minimum required fields with valid foreign-key references, (b) DB seeding for the org/subaccount/agent ancestry each handler reads, (c) mocking of external services (LLM router, pg-boss self-call, network egress) that handlers transitively invoke, (d) careful selection of `comparesTables` per handler against actual write surface — each of which is a design choice. This is several days of focused work, not a surgical edit.

**Suggested approach:** spec amendment retro-removing the double-fire-execution requirement from §6.1 acceptance and re-framing it as "v1 structural acceptance; double-fire execution is a v2 spec deliverable", OR a follow-up build wiring the handlers in a phased rollout (start with 2-3 representative handlers as proof, then expand). The chunk-0 R1 risk register already names this surface as future-build territory.

### REQ #37 — MC8 (and MC2/MC3/MC10/MC11/MC12) integration tests skip behavioral assertions outside NODE_ENV=integration

**Spec section:** §6.2 (and §6.3-§6.8). Spec §6.2 step 2 lists five behavioral assertions (a)-(e) against an installed pg-boss version; spec §6.4 calls for concurrent-insert collapse to single row; §6.5/§6.7/§6.8 each describe runtime behavior to assert.

**Spec quote:** "Asserts (each as an explicit test assertion against the installed pg-boss version, NOT a documentation claim): (a) on retry, the same pg-boss `job.id` is observed by the second worker invocation ..." (§6.2 step 2).

**Implementation:** every integration test guards with `describe.skipIf(process.env.NODE_ENV !== 'integration')` per `docs/testing-conventions.md § Skip-gates`. The local G1 / CI default posture is `NODE_ENV=test`, so the bodies that fire DB inserts, simulate retries, and assert behavior are entirely SKIPPED in the build's normal verification surface. The behavioral assertions exist inside the skipIf blocks (verified for MC2 — fires concurrent inserts and asserts row count) but only execute under a non-default environment.

**Gap:** the v1 verification surface for the §6.2-§6.8 behavioral contracts reduces to "the test file exists and would assert X if NODE_ENV=integration were set". The spec language reads as if these assertions are always-on; the implementation makes them opt-in.

**Why DIRECTIONAL not MECHANICAL:** this matches the spec §4 testing-posture deviation language ("scoped to these 6 integration tests"), the `docs/testing-conventions.md § Skip-gates` convention, and the operator's repeated guidance that test gates are CI-only. Flipping the gate to run behavioral assertions in CI requires (a) a real DB harness in CI with seeded org/subaccount fixtures, (b) pg-boss schema bootstrapped, (c) per-test cleanup discipline so concurrent runs do not leak. This is its own infrastructure call.

**Suggested approach:** either (a) accept the structural-only posture as documented v1 stance (route to KNOWLEDGE.md as the canonical pattern for v1 integration-style tests), OR (b) wire CI to run these tests under `NODE_ENV=integration` against the CI Postgres service. The reality-checker review pass is the natural escalation point for this decision.

---

## Files modified by this run

None.

---

## Next step

NON_CONFORMANT — 2 directional gaps must be considered by the main session before `pr-reviewer`. Both gaps are operator-acknowledged trade-offs from the build flow. Neither blocks the spec's structural acceptance criteria (§13.1-§13.8 all PASS), but both reduce the v1 verification surface relative to the spec's nominal acceptance language. Mechanical-fix re-run of `pr-reviewer` is NOT required (no files modified by this conformance check).
