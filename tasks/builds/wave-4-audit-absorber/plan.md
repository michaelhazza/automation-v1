---
status: ready_for_plan_gate
plan_date: 2026-05-16
last_updated: 2026-05-16
author: architect (claude opus 4.7)
spec_ref: tasks/builds/wave-4-audit-absorber/spec.md (commit 570e4364, status: locked)
scope_class: Significant
build_slug: wave-4-audit-absorber
---

# Plan — Wave 4 Session G — audit-sweep absorber

Builder contract for the locked spec. Plan presumes the spec is authoritative; this document refines chunk boundaries, pins file lists, pins contracts, and lists the operator decisions chunk 0 must surface at plan gate.

---

## Contents

1. Model-collapse check
2. Architecture Notes
3. Plan-gate questions
4. Stepwise implementation plan (chunk inventory)
5. Per-chunk detail
   - Chunk 0 — Setup & verification
   - Chunk 1 — AE1 + AE5 (await critical event writes)
   - Chunk 2 — AE2 (queue-backed spawn with Pattern A)
   - Chunk 3 — MC7 test-meta framework + handler-registry fixture + presence gate
   - Chunk 4 — MC8 + MC10 + critical-paths manifest seed
   - Chunk 5 — MC2 + MC3 + MC11 + MC12
   - Chunk 6 — MC4 gate
   - Chunk 7 — DUP6 (extract 87L clone)
   - Chunk 8 — CD2 through CD10 (conditional)
   - Chunk 9 — SK1 + SK2 + SK3 skill registry alignment
   - Chunk 10 — PA-V1 voice profile leftovers
   - Chunk 11 — Prevention gates (PP-AE2 + PP-MC2 manifest gate)
   - Chunk 12 — Doc rules
   - Chunk 13 — spec-conformance + final review pass
6. Risks & mitigations
7. Self-consistency pass
8. Executor notes

---

## 1. Model-collapse check

Asked the three §pre-plan questions:

1. **Does this decompose into ingest → extract → transform → render?** No. This build is structural hardening — await-conversions, transaction-binding extensions, gate-script authoring, fixture-map plumbing, file renames, dead-cycle verification, and doc rules. There is no data pipeline.
2. **Is each step doing something a frontier multimodal model could do in a single call?** No. Every item is a deterministic code edit / static-analysis gate / DB-shape change. No model is in the loop.
3. **Collapse alternative?** Not applicable.

**Decision: reject collapse.** Rationale: there is no model-replaceable surface here. The build's value is the durability/observability/regression-prevention contracts it pins; a single LLM call cannot pin a contract.

---

## 2. Architecture Notes

### Key decisions

**D1 — AE2 atomicity uses Pattern A (same-transaction send) via pg-boss `boss.send({db})`.**

- **Problem:** the spec §5.2 forbids the naive INSERT-then-send sequence and mandates Pattern A or Pattern B. Chunk 0 must pin one.
- **Verified feasible.** `node_modules/pg-boss/types.d.ts` lines 95-101 show `SendOptions` extends `ConnectionOptions`, which exposes `db?: Db` where `Db = { executeSql(text: string, values: any[]): Promise<{ rows: any[]; rowCount: number }> }`. The installed pinned version is `pg-boss@^9.0.3` (`package.json:73`). Pattern A is supported by the installed version.
- **Adapter shape:** the existing Drizzle transaction client (`tx` from `withOrgTx`) exposes `tx.execute(sql\`...\`)` returning `{ rows, rowCount }`. A 6-line adapter bridges the two shapes. Lives in `server/services/skillExecutor/pipeline.ts` next to `enqueueHandoff`.
- **Considered and rejected:** Pattern B (outbox row + dispatcher). Rejected because Pattern A is feasible and Pattern B introduces a new `pending_handoff_outbox` table, a new RLS manifest entry, a new dispatcher loop, and a new failure mode (orphaned outbox rows). Pattern A's surface is one helper + one extension to an existing function.
- **Rejected:** the naive INSERT-then-send fallback with compensating UPDATE — forbidden by the spec.

**D2 — `JOB_CONFIG.idempotencyContract` extends the existing config rather than introducing a new registry.**

- **Problem:** MC7 needs a per-queue verdict + comparator metadata. Two options: extend `JOB_CONFIG` or introduce a sibling map.
- **Decision:** extend `JOB_CONFIG`. Co-location is the point — the new gate already enforces that every `JobName` in `JOB_CONFIG` has a registration in `HANDLER_REGISTRY`, and extending `JOB_CONFIG` keeps "everything you need to know about queue X" in one place.
- **Considered and rejected:** a sibling `JOB_IDEMPOTENCY_CONTRACTS` constant in a separate file. Rejected — adds a second source-of-truth for queue metadata, doubles the lookup cost during gate authoring, and creates the "two parallel maps must agree" defect class the spec is trying to retire (R1).

**D3 — `HANDLER_REGISTRY` fixture is hand-maintained against a presence gate, deriving mechanically is deferred.**

- **Problem:** R1 (spec §4) names the parallel-fixture maintenance burden. Auto-derivation is possible (parse `createWorker` callsites + direct `boss.work` callsites at test bootstrap via ts-morph) but adds a startup-time AST walk and a new dependency on stable callsite shapes.
- **Decision:** hand-maintained fixture + bidirectional set-equality gate (`scripts/verify-handler-registry-fixture.sh`). The gate is the discipline; the fixture is the artefact. Acceptable per the spec's R1 risk acknowledgement.
- **Considered and rejected:** ts-morph-based auto-derivation. Rejected because it is significantly larger work, depends on stable callsite shapes (any move to a builder pattern or a factory function breaks it), and the gate already catches drift in O(1) per `JobName` at gate-run time. Future spec amendment can flip this if the fixture drifts more than once per quarter.

**D4 — `critical-paths-manifest.yml` is a NEW YAML primitive at `tasks/critical-paths-manifest.yml`; no existing manifest covers the surface.**

- **Problem:** PP-MC2 needs a single source of truth for "critical path X is covered by test/gate/wont-test."
- **Decision:** introduce a new YAML manifest with the schema in §11.4 of the spec.
- **Considered and rejected:** extending `server/config/rlsProtectedTables.ts` (wrong shape — that file is tenant-table-keyed, not critical-path-keyed); extending `JOB_CONFIG` (wrong shape — queues are a subset of critical paths); reusing the test-quality gate (wrong shape — that gate is file-extension-based, not surface-based). Per-spec §1, this is the highest-value greenfield primitive in the build.

**D5 — `voiceProfileService.ts` is at `server/services/voiceProfile/voiceProfileService.ts`, NOT `server/services/voiceProfileService.ts`.**

- **Spec discrepancy.** Spec §10.5 (PA-CLEANUP-DEF-7) cites `voiceProfileService.ts:36`; on current main the file is in a subdirectory. The spec §10.1 cites `voiceProfileServicePure.ts:128` and §10.5 cites `voiceProfileServicePure.ts:131-146` — same subdirectory issue. Chunk 0 records the path correction in the file inventory; no spec amendment needed (path drift is mechanical).

**D6 — `methodology-only .md location: docs/methodologies/` (default; operator may override at plan gate).**

- **Problem:** SK1 needs a place to put `.md` files that are methodology references rather than `ACTION_REGISTRY` skills.
- **Recommendation:** `docs/methodologies/` (the spec's default). Co-located with other product docs; clearly outside `server/skills/`; no impact on the action-registry comparator (the comparator excludes the path via a CLI flag).
- **Considered:** `server/skills/_methodology/` (in-tree but underscore-prefixed). Rejected — pollutes the skill loader's scan path and forces the loader to learn about a special prefix; pure docs belong in `docs/`.

**D7 — `outcome: 'accepted'` at handoff.ts:341 is NOT critical; the §5.1 invariant covers only `rejected`/`failed`.**

- **Spec re-verification finding.** AE1 re-verification against current `server/services/skillExecutor/handlers/handoff.ts` shows line 341 is `void insertOutcomeSafe({outcome: 'accepted', ...})` for accepted spawn targets — not a rejected outcome. Per the §5.1 critical-event invariant (rejected/failed outcomes only), line 341 is **explicitly non-critical** and remains fire-and-forget. The spec §5.1 lists "128/227/341 are `insertOutcomeSafe` with `outcome: 'rejected'`" — that classification is wrong for line 341. **Plan-gate question 4 — see §3 below.**

### Patterns selected

- **Composition of an existing helper** (D2, D3): extend `JOB_CONFIG` with a discriminated-union `idempotencyContract`; extend `enqueueHandoff` with two new optional return fields. No inheritance.
- **Adapter** (D1): the pg-boss `Db` interface is bridged to Drizzle's transaction client via a small adapter at the `enqueueHandoff` call site. Adapter pattern justified because two external interfaces (pg-boss `Db.executeSql` vs Drizzle `tx.execute`) need bridging.
- **No new state machine.** The lifecycle invariant in §5.2 step 8 is the existing run state machine plus one new event type (`run.cancellation_requested`). Existing `shared/runStatus.ts` enum is unchanged.

### What I deliberately did NOT do

- **No new tables.** Pattern A obviates the `pending_handoff_outbox` table the spec's Pattern B would require. The optional `voice_profiles.last_refresh_*` columns ship only if operator picks PA-CLEANUP-DEF-3 path (b) at plan gate (default: logger-only, no columns).
- **No HandlerContext interface.** Out of scope per spec §15. Every contract designed to work without it.
- **No central `server/jobs/index.ts`.** Per spec §4 explicit statement; registrations stay distributed across `server/jobs/*.ts`, `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`, `server/services/agentScheduleService.ts`, `server/lib/*Job.ts`, and `server/index.ts`. The `HANDLER_REGISTRY` fixture is the test-only consolidation.

---

## 3. Plan-gate questions (recommend defaults; operator confirms)

1. **SK1 — methodology-only `.md` location.** Default: `docs/methodologies/` (new directory; chunk 9 creates it empty if no files migrate). Alternatives: `server/skills/_methodology/` (in-tree), or "no methodology-only path — all `.md` files are registry-bound." **Recommendation: default.** Decision recorded in `progress.md` and applied via the comparator CLI flag at chunk 9.

2. **PA-CLEANUP-DEF-3 — durable audit row vs logger-only.** Default: **logger-only acceptance** (spec §10.2). No new column, no new table. Alternative: add `last_refresh_attempted_at: timestamptz` and `last_refresh_succeeded: boolean` to `voice_profiles` via a new migration in chunk 10. **Recommendation: default.** Rationale: maintenance-job observability via row state is a different pattern than the run-scoped audit stream; introducing it here is a directional choice spec §10.2 explicitly defers to a future mini-spec.

3. **PA-CLEANUP-DEF-7 — failed voice profile filter option.** Default: **option (a) — `ne(voiceProfiles.state, 'failed')`** added to the nightly candidate query. Alternatives: option (b) a small back-off TTL (`AND (failedAt IS NULL OR failedAt < now() - interval 'X')`) or option (c) state-machine cleanup. **Recommendation: default.** Smallest change; respects state-machine intent; consistent with the spec's stated preference.

4. **AE1 — outcome at handoff.ts:341.** Verified non-critical (`outcome: 'accepted'`). **Recommendation: leave as fire-and-forget; PP-AE2 gate (chunk 11) does NOT flag it because the gate pattern is restricted to `outcome: 'rejected' | 'failed'`.** This is a no-op for chunk 1 but explicit in the spec re-verification log so future readers don't relitigate. Operator confirms.

5. **Plan-gate confirmation: 5 critical-paths-manifest seed entries.** Chunk 4 seeds the manifest with the v1-blocker paths the Wave 2 audit named. Recommended seed list: (a) handoff durability (MC8 test), (b) service-principal trace boundary (MC10 test), (c) cycle-floor invariant (existing `verify-no-new-cycles.sh` gate), (d) handler-registry coverage (new `verify-handler-registry-fixture.sh` gate from chunk 3), (e) critical-event durability (new `verify-critical-event-emission-awaited.sh` gate from chunk 11). Operator may extend.

6. **Closure-set scope at chunk 13.** Spec §1 totals **37 items across 9 buckets**. Caller-supplied note in the planning request says "14 tasks/todo.md items closing in this PR." **Recommendation: close all 37 per spec §1.** The "14" likely refers to a narrower v1-blocker subset; chunk 13's closure list ships the wider spec-defined set unless operator narrows it explicitly.

---

## 4. Stepwise implementation plan

The spec §14 declares 14 chunks (chunk 0 setup + chunks 1-13). I preserve that decomposition. Chunk-by-chunk dependencies are forward-only.

### Chunk inventory

| # | Chunk | Spec sections | Dependencies | Module shape |
|---|---|---|---|---|
| 0 | Setup & verification | §1-§4, §5-§12 (verification reads) | none | Builds 5 inventory artifacts; no code change |
| 1 | AE1 + AE5 — await critical event writes | §5.1, §5.3 | C0 | `handoff.ts` callsites become awaited |
| 2 | AE2 — queue-backed spawn with Pattern A | §5.2 | C0, C1 | `enqueueHandoff` extended; `executeSpawnSubAgents` rewritten |
| 3 | MC7 — test-meta framework + handler-registry fixture + gate | §6.1 | C0 | `JOB_CONFIG.idempotencyContract` + `HANDLER_REGISTRY` + meta-test + presence gate |
| 4 | MC8 + MC10 + critical-paths manifest seed | §6.2, §6.3, §11.4 (seed only) | C2, C3 | Two integration tests + new YAML manifest |
| 5 | MC2 + MC3 + MC11 + MC12 — lower-priority tests | §6.4, §6.5, §6.7, §6.8 | C0 | Four Vitest files (`__tests__/` siblings) |
| 6 | MC4 — `verify-llm-call-site-routes-through-router.sh` | §11.5 | C0 | New static gate |
| 7 | DUP6 — extract 87L clone | §7.1 | C0 | In-file private helper in `agentStep.ts` |
| 8 | CD2-CD10 — cycle fixes (conditional on chunk 0 verification log) | §8 | C0 | Skipped if all 9 verify closed; else type-extraction edits |
| 9 | SK1 + SK2 + SK3 — skill registry alignment | §9.1, §9.2, §9.3 | C0 | New comparator script + 25 file renames + naming gate |
| 10 | PA-V1 voice profile leftovers (DEF-2/3/5/6/7) | §10.1-§10.5 | C0 | Predicate edits + KNOWLEDGE/doc edits |
| 11 | Prevention gates (PP-AE2 new; PP-MC2 manifest gate) | §11.1-§11.4 | C1, C2, C4 | Two new gate scripts + manifest gate |
| 12 | Doc rules (PP-AE1, PP-AE3, PP-CD3, PP-MC1) | §12.1-§12.4 | C1, C2, C8 | Four documentation appends |
| 13 | spec-conformance + final review pass | §13 | all prior | No code; review-only |

If chunk 0's cycle-verification-log marks all 9 of CD2-CD10 as `verified closed by <sha>`, **chunk 8 is removed from the inventory** and chunks 9-13 renumber by one. Plan-gate confirms after chunk 0 ships its inventory.

### Conservative re-grouping check

Are any chunks too small to be independent, or too large to be one logical responsibility?

- **Chunk 5 (4 tests)** sits at the spec-stated soft cap (≤5 files OR ≤1 logical responsibility). All four tests share the same logical responsibility ("standalone lower-priority correctness tests") and run independently. Kept as one chunk.
- **Chunk 11 (3 gates: PP-AE2 new + PP-MC2 manifest + a meta-gate for the manifest)** is 3 net-new files in `scripts/`. Same logical responsibility ("prevention gate scripts"). Kept as one.
- **Chunk 9 (SK1 comparator + SK2 rename of 25 files + SK3 verification + new naming gate)** is the chunk most likely to feel large. 25 file renames are mechanical and ship as one logical responsibility ("skill registry alignment"). The new comparator and the new naming gate are both single files. Kept as one. If during execution chunk 9 looks oversized, split into 9a (rename + naming gate) and 9b (comparator + methodology decision).

---

## 5. Per-chunk detail

### Chunk 0 — Setup & verification

**Public interface this chunk exposes:** five evidence artifacts under `tasks/builds/wave-4-audit-absorber/` consumed by chunks 1-13 to ground their work.

**What stays hidden behind it:** the verification logic itself (one-shot `madge`, ts-morph walks, recursive globs, snapshot reads). Future chunks read the artifacts, not the verification mechanics.

**Files to create:**
- `tasks/builds/wave-4-audit-absorber/cycle-verification-log.md` — for CD2 through CD10: each marked `verified open: <madge --circular excerpt>` or `verified closed by <commit-sha>`. Ground truth: `npx madge --circular --json server/ client/ shared/ worker/` against current HEAD. Cross-reference against `scripts/.gate-baselines/circular-deps.txt` (current value `cycle-count:0`).
- `tasks/builds/wave-4-audit-absorber/handler-registry-inventory.md` — for each `JobName` in `JOB_CONFIG` (from `server/config/jobConfig.ts`, ~70 entries), the registration callsite OR `verdict: external_consumer | send_only | exempt`. Source: recursive grep for `createWorker({ queue: '...'` and `boss.work('...'` across `server/jobs/**`, `server/services/**`, `server/lib/**`, `server/index.ts`. Also enumerate queues registered via `createWorker`/`boss.work` that are NOT in `JOB_CONFIG` — these are drift candidates the meta-test must surface. Initial scan from this planning session shows at least: `maintenance:fast-path-decisions-prune`, `maintenance:rule-auto-deprecate`, `maintenance:fast-path-recalibrate`, `maintenance:llm-ledger-archive`, `maintenance:llm-started-row-sweep`, `maintenance:stale-analyzer-job-sweep`, `maintenance:llm-inflight-history-cleanup`, `maintenance:memory-entry-decay`, `memory-hnsw-reindex`, `memory-blocks-embedding-backfill`, `maintenance:clarification-timeout-sweep`, `maintenance:blocked-run-expiry`, `maintenance:backend-reconciliation`, `maintenance:memory-entry-quality-adjust`, `maintenance:memory-block-synthesis`, `maintenance:bundle-utilization`, `maintenance:portfolio-briefing`, `maintenance:portfolio-digest`, `maintenance:protected-block-divergence`, `maintenance:iee-session-orphan-cleanup`, `maintenance:iee-sessions-compact`, `maintenance:agent-observations-prune`, `maintenance:working-time-rollup-compact`, `maintenance:webhook-replay-nonce-prune`, `maintenance:execution-window-timeout`, `maintenance:approval-expiry`, `maintenance:stripe-agent-reconciliation-poll`, `maintenance:shadow-charge-retention`, `evaluate-all-pending-baselines`, `capture-baseline`, `scorecard:judge`, `scorecard:judge:forced`, `bench:execute`, `bench:regression-replay`, `correction:pattern-detect`, `workflow-drafts-cleanup`, `system-monitor-self-check`, `voice-profile-refresh`, `gmail-inbox-poll`, `calendar-lookahead`, `iee-browser-daily-rollup`. Chunk 0 enumerates the complete set; chunk 3 reconciles by either (a) adding the queue to `JOB_CONFIG` with an `idempotencyContract` or (b) documenting it as an external_consumer/send_only/exempt entry.
- `tasks/builds/wave-4-audit-absorber/skill-rename-inventory.md` — verified 25 kebab-named files exist (16 top-level under `server/skills/` + 9 under `server/skills/support/`). Each entry: rename target (snake_case form) OR allowlist-exception with rationale. Default per file: rename. Also includes the chunk-0 grep sweep result for `calendar-`, `ea-`, `slack-` literals across `server/services/**` — confirmed during planning: no hits in `server/services/`. Chunk 0 extends the sweep to `server/lib/**` and any `server/skills/index.ts` if it exists.
- `tasks/builds/wave-4-audit-absorber/handler-registry-fixture-seed.md` — preliminary draft of `HANDLER_REGISTRY` entries (one per `JobName`) for chunk 3 to consume. The corresponding TypeScript fixture file `server/lib/__tests__/handlerRegistryFixture.ts` is created in chunk 3, not chunk 0.
- `tasks/builds/wave-4-audit-absorber/skill-unmatched-preview.md` — initial output of running the comparator dry-run logic against `scripts/snapshots/action-registry.snapshot.json` and on-disk `.md` files. Used by chunk 9 to size the rename + methodology-tree decision.

**Operator decisions captured in `progress.md` Section "Chunk 0 decisions":**
1. SK1 methodology-only path (default `docs/methodologies/`)
2. PA-CLEANUP-DEF-3 durable row vs logger-only (default logger-only)
3. PA-CLEANUP-DEF-7 filter option (default option (a) — `ne(state, 'failed')`)
4. AE1 line-341 confirmation (default keep fire-and-forget; gate pattern excludes `accepted`)
5. SK2 rename-vs-allowlist per file (default rename all 25)
6. MC4 allowlist enumeration (chunk 0 enumerates legitimate exceptions; chunk 6 seeds the gate)

**Module shape:** evidence-only chunk. No public TS interface; consumers read markdown.

**Contracts:** the five markdown artifacts and the progress-decision section. Format per artifact above.

**Error handling:** if madge fails to run, exit with the same error envelope the production gate uses — do not invent a partial inventory. If a `JOB_CONFIG` entry has no callsite hit, mark `MISSING_REGISTRATION` and surface it as a chunk-3 input; do not silently default to `exempt`.

**Test considerations:** none — inventory chunk. Subsequent chunks rely on the inventory's accuracy.

**Dependencies:** none.

**Verification commands:**
- `npm run lint`
- `npm run typecheck` (no source change, but verifies the snapshot of types the inventory cites)
- `npx madge --circular --json server/ client/ shared/ worker/` (raw output saved into the cycle-verification log)

**Acceptance criteria:** all five artifacts ship; operator decisions recorded; chunk-8 inclusion/exclusion verdict surfaced at plan gate; chunk-3 has a complete reconciliation list of in-`JOB_CONFIG` vs registered-but-not-in-`JOB_CONFIG` queues.

---

### Chunk 1 — AE1 + AE5 (await critical event writes)

**Public interface this chunk exposes:** none new. The change is internal — five callsites in `handoff.ts` are converted from `void` to `await`. Callers of `executeSpawnSubAgents` and the related handoff paths see the same return shape.

**What stays hidden behind it:** the failure-propagation contract change. A `tool.error` event-emit failure now surfaces to the parent run loop instead of being silently dropped on restart. The caller-visible behaviour is unchanged for successful paths; the error path now reports correctly instead of swallowing.

**Files to modify:**
- `server/services/skillExecutor/handlers/handoff.ts` — convert `void` to `await` at the 5 verified critical callsites (107, 128, 140, 227, 249). Line 341 remains `void` (verified `outcome: 'accepted'`, non-critical per §5.1 invariant — see plan-gate question 4).

**Contracts:**
- Critical-event invariant per spec §5.1 (unchanged). The chunk only changes call-site posture, not the invariant.
- Function signatures unchanged for `insertExecutionEventSafe`, `insertOutcomeSafe`.

**Error handling:**
- Awaited callsite errors propagate naturally to the surrounding `try/catch` in `executeSpawnSubAgents` (line 260). Existing catch returns `{ success: false, error: ... }`.
- Existing critical-event helpers (`insertExecutionEventSafe`, `insertOutcomeSafe`) already implement log-and-swallow internally; awaiting them surfaces durability failures (DB unavailable) into the run loop where they belong. Per spec, this is the desired behaviour.

**Test considerations (reviewer):**
- AE1 verification is via the static gate in chunk 11 (`verify-critical-event-emission-awaited.sh`), seeded against post-chunk-1 main. The gate's pattern set is the §5.1 invariant.
- The 6-integration-test scope in spec §4 does NOT include an AE1 runtime test. The previously-named `handoffCriticalEventDurability.test.ts` is withdrawn per spec §5.1.

**Dependencies:** chunk 0 (re-verification log).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Acceptance:** every `void` at lines 107/128/140/227/249 becomes `await`; line 341 untouched.

---

### Chunk 2 — AE2 (queue-backed spawn with Pattern A)

**Public interface this chunk exposes:**
- Extended `enqueueHandoff(req)` return shape: `Promise<{ enqueued: boolean; runId: string | null; jobId: string | null; reason?: 'duplicate' | 'no_link' | 'depth_cap' | 'no_sender' | 'send_failed' }>` (per spec §5.2 step 2).
- New cancellation event type `run.cancellation_requested` emitted by the existing cancel API (already documented as critical in spec §5.1 invariant; the chunk wires it into the cancel endpoint).
- Worker handler accepts payload field `runId` (when set, the worker reads the pre-created `agent_runs` row by id instead of inserting; per §5.2 step 1 "Worker-side guard").

**What stays hidden behind it:**
- The Drizzle-to-pg-boss `Db` adapter (private to `pipeline.ts`).
- The same-transaction send invariant (the caller of `enqueueHandoff` is told only "enqueued or duplicate-skipped"; the atomicity is internal).
- The pre-create-then-send sequence inside the `withOrgTx` block.
- The parent-side poll loop's 1-second cadence implementation (private to `executeSpawnSubAgents`).
- The cooperative-cancellation propagation logic (cancel-API → emit `run.cancellation_requested` events per tracked child runId, resolved via `WHERE parent_run_id = $parentRunId AND status IN ('running', 'pending')`).

**Files to create:** (none)

**Files to modify:**
- `server/services/skillExecutor/pipeline.ts` — extend `enqueueHandoff` per §5.2 step 1+2: pre-create `agent_runs` row with `status: 'pending'`, `parent_run_id`, `parentSpawnRunId` inside the same `withOrgTx(...)` that calls `boss.send(..., { db: adapter })`. Add the 6-line `Db` adapter (`{ executeSql: async (text, values) => { const r = await tx.execute(sql.raw(text, values)); return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 }; } }`). Replace `Promise<boolean>` return with the new structured shape.
- `server/services/skillExecutor/handlers/handoff.ts` — rewrite `executeSpawnSubAgents` STEP 10 ("Execute spawn") per §5.2 fix:
  - Replace `Promise.all(executeRun(...))` with `enqueueHandoff(...)` per sub-task; collect each enqueue result.
  - For `{ enqueued: false, reason: 'duplicate' }`, resolve existing `runId` via `SELECT id FROM agent_runs WHERE agentId AND taskId AND subaccountId AND status IN ('running', 'pending')`.
  - Poll-loop: `pollIntervalMs = 1000`, single batched `WHERE id = ANY($1)`, bounded by `context.timeoutMs`.
  - Result construction: include `task_id` (verified at lines 319, 332 in current main); preserve the existing byte-for-byte shape on the happy path.
  - Timeout path: return existing shape PLUS new `pending: string[]` field (the only LLM-visible additive shape change per §5.2 step 5).
- `server/services/skillExecutor/handlers/tasks.ts` — line 93 and line 757 callers migrate from `result === true` boolean check to `result.enqueued === true` per §5.2 step 2.
- `server/jobs/agentHandoffRunJob.ts` (or the existing worker file for `agent-handoff-run` — chunk 0 confirms exact path during inventory) — worker handler accepts payload field `runId`. If present, assert `status: 'pending'`; if missing, log critical error and fall back to today's insert behaviour (defence-in-depth for the forbidden-fallback edge case).
- `server/services/agentRunService.ts` (or wherever the cancel API lives — chunk 0 confirms) — when `agent_runs.status` is set to `'cancelled'` by operator, emit `run.cancellation_requested` event for each child resolved via `WHERE parent_run_id = $parentRunId AND status IN ('running', 'pending')`. The event is `await`-emitted per the chunk-1 invariant.
- `server/services/agentExecutionService.ts` (cooperative-cancel observer) — child-side: at each phase boundary, check `agent_runs.status` for parent; if `'cancelled'`, write own `run.terminal` event with `status: 'cancelled'` and exit. Existing cooperative-cancel pattern in the run loop is reused; this chunk adds the parent-status check, not a new state machine.
- `server/config/actionRegistry/core.ts` — update the `spawn_sub_agents` entry's description/result schema to mention the additive `pending` field on the timeout path.
- `architecture.md` § agent-spawn durability — add new subsection documenting: pre-create child run, extended `enqueueHandoff` return, per-child poll, `pending` field on timeout, lifecycle invariant per §5.2 step 8. Same PR.

**Module shape sanity:** public interface = three things (extended return shape, new event type, payload field). Hidden = adapter, atomicity contract, poll loop, cancel propagation. Hidden > public — deep chunk.

**Contracts:**
- `HandoffEnqueueResult = { enqueued: true; runId: string; jobId: string } | { enqueued: false; runId: null; jobId: null; reason: 'duplicate' | 'no_link' | 'depth_cap' | 'no_sender' | 'send_failed' }` (Discriminated union; `enqueued` is the discriminator.)
- `SpawnSubAgentsResult` (happy path) = `{ success: true; results: Array<{ title, status, summary, task_id, agent_run_id, tokens_used, error? }>; total_tokens: number; total_duration_ms: number }` (byte-for-byte unchanged).
- `SpawnSubAgentsResult` (timeout path) = `{ success: false; error: 'spawn_timeout'; results: Array<...terminal...>; pending: string[]; total_tokens: number; total_duration_ms: number }` (additive).
- Adapter contract: `PgBossDb = { executeSql(text: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> }` per `node_modules/pg-boss/types.d.ts` line 4-6.
- New event type: `run.cancellation_requested` (event-stream-only, not a status). Receiver-side idempotency per spec §5.1: multiple events for same `runId` collapse to a single cancel decision.

**Error handling:**
- If `boss.send({db})` throws inside the `withOrgTx` block, the entire transaction rolls back. The pre-created `agent_runs` row never commits. `enqueueHandoff` catches the throw and returns `{ enqueued: false, reason: 'send_failed', runId: null, jobId: null }`. No compensating UPDATE needed.
- If the worker receives a job with `runId` but the row is missing (impossible under Pattern A; defensive coverage for the forbidden-fallback edge case), the worker logs `critical` and re-creates the row to maintain forward progress.
- If the worker receives a job with `runId` but the row is in a terminal status, the worker treats it as a duplicate enqueue and exits cleanly.
- Parent-side poll-loop timeout returns the additive `pending` shape; children continue under pg-boss's retry policy per §5.2 step 8.

**Test considerations (reviewer):**
- Chunk 4 (`handoffDurability.integration.test.ts`) covers all four AE2 scenarios per spec §5.2 acceptance: (a) worker restart pre-children-start, (b) worker restart mid-child, (c) parent timeout with pending child, (d) parent restart mid-execution. The `handoffDurability` test is the verification surface for AE2; no separate AE2 test.
- Reviewer to check: the Drizzle `tx.execute(sql.raw(...))` adapter actually round-trips pg-boss's `executeSql` calls without losing parameters. Manual trace through one `boss.send({db: adapter})` call in development is sufficient — the adapter is small and read-once.

**Dependencies:** chunk 0 (Pattern A verification), chunk 1 (the new `run.cancellation_requested` event is awaited per the chunk-1-confirmed invariant).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance:** `enqueueHandoff` returns structured shape; `executeSpawnSubAgents` no longer uses `Promise.all(executeRun)`; pre-created child rows + same-tx send; parent poll-loop + 1s cadence; timeout returns `pending` field; cooperative-cancel propagates via `run.cancellation_requested`; `actionRegistry` and `architecture.md` updated.

---

### Chunk 3 — MC7 test-meta framework + handler-registry fixture + presence gate

**Public interface this chunk exposes:**
- `idempotencyContract` field added per `JOB_CONFIG[jobName]` entry. Discriminated union with verdict `'handler_tested' | 'external_consumer' | 'send_only' | 'exempt'` and per-verdict required fields per spec §6.1.
- `HANDLER_REGISTRY: Record<JobName, { handler: HandlerFn | null; registrationSite: string }>` exported from `server/lib/__tests__/handlerRegistryFixture.ts`. Test-only.
- `scripts/verify-handler-registry-fixture.sh` — bidirectional set-equality gate.

**What stays hidden behind it:**
- The per-verdict comparator logic inside the meta-test (default normaliser + table snapshot + multiset equality for append-only tables).
- The per-handler payload synthesis (lives in `server/lib/__tests__/jobPayloadFixtures.ts`).
- The `send_only` lifecycle-state cadence enforcement (gate-internal date math).

**Files to create:**
- `server/lib/__tests__/handlerIdempotency.meta.test.ts` — the meta-test per §6.1 step 1-6.
- `server/lib/__tests__/handlerRegistryFixture.ts` — the importable map. Seeded from chunk 0's `handler-registry-fixture-seed.md`.
- `server/lib/__tests__/jobPayloadFixtures.ts` — minimum-payload synthesiser per `handler_tested` JobName.
- `scripts/verify-handler-registry-fixture.sh` — new gate. Asserts bidirectional set equality between `JOB_CONFIG`, `HANDLER_REGISTRY`, and `handler-registry-inventory.md`. Also enforces per-verdict required fields (spec §6.1).

**Files to modify:**
- `server/config/jobConfig.ts` — add `idempotencyContract` field to every entry (~70 entries). Most are `handler_tested` with default `comparesTables: ['agent_runs']` (placeholder; the chunk-0 inventory + handler diff trace inform the correct table set per queue). External consumers (`agent-spend-response`) marked `external_consumer`; send-only queues (any from chunk 0's drift list with no registration) marked `send_only` with `lifecycleState: 'experimental' | 'transitional' | 'permanent'`.
- `scripts/run-all-gates.sh` — register `verify-handler-registry-fixture.sh` in the gate list.

**Module shape sanity:** public interface = three things (config field, fixture, gate). Hidden = the comparator's normaliser, the per-handler payload synthesis, the cadence math. Hidden > public — deep chunk despite the size.

**Contracts:**

```ts
// In server/config/jobConfig.ts, per-queue type extension
type IdempotencyContract =
  | { verdict: 'handler_tested'; comparesTables: string[]; normaliseColumns?: string[]; appendOnlyDelta?: number; comparator?: (a: Snapshot, b: Snapshot) => { equivalent: boolean; diff?: string } }
  | { verdict: 'external_consumer'; consumer: string; idempotencyOwner: string }
  | (
      | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'experimental' }
      | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'transitional'; reviewBy: string }
      | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'permanent'; consumer: string }
    )
  | { verdict: 'exempt'; reason: string; owner: string; reviewBy: string };
```

```ts
// In server/lib/__tests__/handlerRegistryFixture.ts
import type { JobName } from '../../config/jobConfig.js';
type HandlerFn = (job: { id: string; data: unknown }) => Promise<void>;
export const HANDLER_REGISTRY: Record<JobName, { handler: HandlerFn | null; registrationSite: string }> = {
  'agent-handoff-run': { handler: agentHandoffRunHandler, registrationSite: 'server/services/agentScheduleService.ts' },
  // ... ~70 entries
};
```

**Error handling:**
- Meta-test failures emit per-JobName diagnostics: `[JobName] verdict=<verdict> diff=<...>`.
- Gate failures enumerate which side of the bidirectional check failed (`JOB_CONFIG ∋ X but HANDLER_REGISTRY ∌ X`).
- `send_only` cadence violations: `experimental` past 90d emits warning (non-blocking, surfaces in CI output); `transitional` past `reviewBy` fails; `permanent` always passes the cadence check (still requires `consumer`).

**Test considerations (reviewer):**
- Reviewer to confirm `comparesTables: string[]` declarations actually cover each handler's DB-write surface. Per spec §6.1 C1: completeness of the declared set is a review responsibility in v1, not a gate check.
- Reviewer to confirm any queue with `appendOnlyDelta > 0` documents why the second fire writes a new row (i.e. the handler is intentionally not idempotent in count, only in content).
- Reviewer to confirm every `external_consumer` / `send_only` / `exempt` verdict has its required fields filled.

**Dependencies:** chunk 0 (inventory).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/lib/__tests__/handlerIdempotency.meta.test.ts`
- `bash scripts/verify-handler-registry-fixture.sh`

**Acceptance:** meta-test passes; gate passes; every `JobName` has a verdict; every verdict has its required fields; bidirectional set-equality holds.

---

### Chunk 4 — MC8 + MC10 + critical-paths manifest seed

**Public interface this chunk exposes:**
- `tasks/critical-paths-manifest.yml` — new YAML manifest at the repo root's `tasks/` directory.
- Two new integration tests: `server/lib/__tests__/handoffDurability.integration.test.ts` and `server/lib/__tests__/servicePrincipalTraceBoundary.integration.test.ts`.

**What stays hidden behind it:**
- The pg-boss test harness setup (uses the existing `NODE_ENV=integration` skip-gate pattern per `docs/testing-conventions.md`).
- The simulated worker-restart mechanic (`process.kill` on a forked worker followed by re-import; details internal to the test).

**Files to create:**
- `server/lib/__tests__/handoffDurability.integration.test.ts` — four scenarios per spec §6.2.
- `server/lib/__tests__/servicePrincipalTraceBoundary.integration.test.ts` — three-tier trace-boundary assertion per spec §6.3.
- `tasks/critical-paths-manifest.yml` — seed entries per plan-gate question 5.

**Files to modify:** (none)

**Module shape sanity:** public interface = two tests + one manifest. Hidden = the harness + the simulation mechanic. Acceptable depth — the tests are the contract.

**Contracts:**
- Manifest schema per spec §11.4. Seed list per plan-gate question 5.
- Tests use `describe.skipIf(process.env.NODE_ENV !== 'integration')` per `docs/testing-conventions.md`.
- AE2 acceptance assertions per spec §6.2 step 2 (a)-(e): job identity preserved, `retrycount === 1`, retry stops at `retryLimit`, payload-key idempotency, no duplicate event rows.

**Error handling:** test failures emit per-scenario diagnostics. Manifest gate (chunk 11) enforces schema.

**Test considerations (reviewer):**
- Reviewer to confirm tests honour the `static_gates_primary` deviation declared in spec §4 — these are the 2nd and 3rd of the 6-test scope (MC8, MC10 of the MC2/MC3/MC8/MC10/MC11/MC12 set).
- Reviewer to confirm tests do NOT introduce new test infrastructure beyond the existing `withOrgTx`, `agentExecutionEventService`, and integration-test harness.

**Dependencies:** chunks 2 (AE2 contract), 3 (registry fixture for handler simulation).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/lib/__tests__/handoffDurability.integration.test.ts`
- `npx vitest run server/lib/__tests__/servicePrincipalTraceBoundary.integration.test.ts`

**Acceptance:** both tests pass against current main; manifest exists with ≥5 seed entries; chunk-11 manifest-shape gate is wired but not yet authored (chunk 11's responsibility).

---

### Chunk 5 — MC2 + MC3 + MC11 + MC12

**Public interface this chunk exposes:** four new Vitest files at the locations spec §6.4-§6.8 cite.

**What stays hidden behind it:** test setup + assertion mechanics. These are leaf nodes.

**Files to create:**
- `server/lib/__tests__/idempotencyKey.dedup.test.ts` — MC2 per spec §6.4.
- `server/services/__tests__/agentRunVisibility.integration.test.ts` — MC3 per spec §6.5.
- `server/services/__tests__/costLedger.idempotency.test.ts` — MC11 per spec §6.7.
- `server/services/__tests__/payloadRetention.tierBoundary.test.ts` — MC12 per spec §6.8.

**Files to modify:** (none)

**Contracts:** each test uses Vitest (`import { test, expect } from 'vitest'`) per `docs/testing-conventions.md`. Each integration-style test guards with `describe.skipIf(process.env.NODE_ENV !== 'integration')`.

**Module shape sanity:** four leaf tests. Each is its own logical responsibility within a shared meta-responsibility ("v1-blocker correctness coverage tests"). Re-split deferred — if chunk 5 reviews as too large, split into 5a (MC2+MC3) and 5b (MC11+MC12).

**Error handling:** test failures emit per-case diagnostics.

**Test considerations (reviewer):**
- Reviewer to confirm tests honour the 6-test deviation declared in spec §4 — these are the 4 remaining of the 6 (MC2, MC3, MC11, MC12).
- Reviewer to confirm no test mutates module-level state at import time per I-7b in `docs/testing-conventions.md`.
- Reviewer to confirm tests that mutate `process.env` restore it (I-8b).

**Dependencies:** chunk 0.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/lib/__tests__/idempotencyKey.dedup.test.ts`
- `npx vitest run server/services/__tests__/agentRunVisibility.integration.test.ts`
- `npx vitest run server/services/__tests__/costLedger.idempotency.test.ts`
- `npx vitest run server/services/__tests__/payloadRetention.tierBoundary.test.ts`

**Acceptance:** four tests pass against current main.

---

### Chunk 6 — MC4 gate (`verify-llm-call-site-routes-through-router.sh`)

**Public interface this chunk exposes:** one new gate script.

**What stays hidden behind it:** the rg/grep pattern logic and the allowlist baseline.

**Files to create:**
- `scripts/verify-llm-call-site-routes-through-router.sh` — greps for direct OpenAI/Anthropic SDK imports outside `server/services/llmRouter/`. Allowlist seeded from chunk 0's enumeration (SDK-typed test fixtures, the LLM router itself, etc.).

**Files to modify:**
- `scripts/run-all-gates.sh` — register the new gate.

**Contracts:** gate exits 0 against current main with the allowlist; exits 1 on any non-allowlisted occurrence. Allowlist entries follow the existing `# baseline-allow` convention per `DEVELOPMENT_GUIDELINES.md §5`.

**Error handling:** gate failures enumerate each non-allowlisted occurrence with file:line.

**Test considerations (reviewer):**
- Reviewer to confirm the allowlist is the smallest possible (no drive-by exceptions).
- Reviewer to confirm the gate's regex handles import variants (`import OpenAI from`, `import { Anthropic } from`, dynamic imports).

**Dependencies:** chunk 0 (allowlist enumeration).

**Verification commands:**
- `bash scripts/verify-llm-call-site-routes-through-router.sh` (the gate itself; allowed because it's the local-verification step for the chunk that authored it)
- `npm run lint`

**Acceptance:** gate exits 0 against current main.

---

### Chunk 7 — DUP6 (extract 87L clone)

**Public interface this chunk exposes:** none new. Refactor internal to one file.

**What stays hidden behind it:** the duplicated context-overflow-handle + step-runs-update + skip-set-insert + workflow-context-update sequence. Now exists once instead of twice.

**Files to modify:**
- `server/services/workflowEngine/queueLifecycle/agentStep.ts` — extract the clone (`:225-307 ↔ :397-483` per spec §7.1) into a private helper at the top of the file. Both call sites delegate. File LOC drops ~87.

**Module shape sanity:** one in-file private helper. Public interface unchanged. Hidden = the unified sequence. Acceptable.

**Contracts:** the extracted helper takes the call-site's `(sr, step, run, ctx, stepOutput, def, skipSet)` as arguments. Pure transform-and-write; no new control-flow.

**Error handling:** the catch-context-overflow path is preserved exactly. The helper returns `void` when overflow fires (and the call site returns); otherwise commits.

**Test considerations (reviewer):**
- Reviewer to confirm both call sites delegate to the helper with the same arg shape.
- Reviewer to confirm the existing `verify-duplicate-blocks.sh` baseline (or `jscpd`-based gate) drops by the expected 87 LOC.

**Dependencies:** chunk 0.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Acceptance:** file LOC drops by ~87; duplicate-blocks gate reports the clone closed.

---

### Chunk 8 — CD2 through CD10 cycle fixes (conditional)

**Public interface this chunk exposes:** none new. Chunk is conditional on chunk 0's verification log.

**What stays hidden behind it:** for each verified-open cycle, the type-extraction / inverted-import fix.

**Files to modify (only if chunk 0 marks the corresponding cycle `verified open`):**
- **CD2:** `server/services/executionBackends/options.ts` types extracted to a pure-types-only module (likely `server/services/executionBackends/optionsTypes.ts` or co-located in `shared/types/`).
- **CD3:** `server/services/workflowEngine/queueLifecycle/dispatch.ts` specific edge fix per spec §8.
- **CD4:** `server/services/notifyOperatorFanoutService.ts` ↔ `channels` 3-line fix.
- **CD5:** `server/services/agentExecutionServicePure.ts` inverted import — move type to downstream-only module.
- **CD6:** `client/src/pages/MacroReport.tsx` — remove server-side import path.
- **CD7:** `server/services/mcpServer.ts` self-cycle bug-fix.
- **CD8:** `server/services/sandboxProviderResolver.ts` invert provider-imports-impl direction.
- **CD9:** govern modal cycles pair 1 — lift shared types to a sibling module.
- **CD10:** govern modal cycles pair 2 — lift shared types to a sibling module.

**Module shape sanity:** each fix is a 1-5 line edit. The chunk's logical responsibility is "small cycle fixes"; per-cycle scope is small enough to batch.

**Contracts:** no public API changes; only import-graph edits.

**Error handling:** `npx madge --circular --json server/ client/ shared/ worker/` after the chunk must report ≤ baseline (0). Per CD-N item that was `verified open`, the cycle is gone.

**Test considerations (reviewer):**
- Reviewer to confirm each cycle is genuinely closed (not just moved or re-keyed).
- Reviewer to confirm no new cycle was introduced by the fixes.

**Dependencies:** chunk 0 (verification log determines whether this chunk ships at all).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx madge --circular --json server/ client/ shared/ worker/` (must report ≤ baseline)

**Acceptance:** every `verified open` CD-N is gone; existing baseline (`cycle-count:0`) is preserved.

**If chunk 0 marks all 9 as `verified closed by <sha>`, this chunk is REMOVED from the inventory.** Note: the current baseline at `scripts/.gate-baselines/circular-deps.txt` is `cycle-count:0` (seeded 2026-05-14), which strongly suggests most or all of CD2-CD10 are already closed. Chunk 0's madge run is the authoritative check.

---

### Chunk 9 — SK1 + SK2 + SK3 skill registry alignment

**Public interface this chunk exposes:**
- `scripts/compare-skill-md-against-registry.ts` — new comparator script per spec §9.1.
- `tasks/builds/wave-4-audit-absorber/skill-unmatched-report.json` — comparator output.
- 25 file renames in `server/skills/` (16 top-level + 9 in `support/`) per spec §9.2 inventory.
- `scripts/verify-skill-md-naming.sh` — new gate that walks `server/skills/` recursively and rejects kebab unless allowlisted.
- `server/skills/.naming-allowlist.json` (created only if any file is allowlisted; default per spec §9.2: rename all 25, no allowlist entries).
- `docs/methodologies/` — new empty directory (only created if operator selects the default at plan-gate question 1).

**What stays hidden behind it:**
- The comparator's set-difference logic (snapshot keys ↔ on-disk `.md` filenames).
- The exclusion-path CLI flag for methodology files.
- The naming gate's regex.

**Files to create:**
- `scripts/compare-skill-md-against-registry.ts`
- `scripts/verify-skill-md-naming.sh`
- `docs/methodologies/.gitkeep` (only if chunk 0 operator decision picks the default)
- `server/skills/.naming-allowlist.json` (only if any file ships with an allowlist entry; default empty)

**Files to modify/rename:**
- The 25 kebab-named files per spec §9.2 inventory:
  - `server/skills/calendar-create-event.md` → `server/skills/calendar_create_event.md`
  - `server/skills/calendar-find-free-slot.md` → `server/skills/calendar_find_free_slot.md`
  - `server/skills/calendar-get-event.md` → `server/skills/calendar_get_event.md`
  - `server/skills/calendar-list-events.md` → `server/skills/calendar_list_events.md`
  - `server/skills/calendar-respond-to-invite.md` → `server/skills/calendar_respond_to_invite.md`
  - `server/skills/calendar-update-event.md` → `server/skills/calendar_update_event.md`
  - `server/skills/ea-daily-briefing.md` → `server/skills/ea_daily_briefing.md`
  - `server/skills/ea-home-widget-summary.md` → `server/skills/ea_home_widget_summary.md`
  - `server/skills/ea-inbox-triage.md` → `server/skills/ea_inbox_triage.md`
  - `server/skills/ea-meeting-prep.md` → `server/skills/ea_meeting_prep.md`
  - `server/skills/slack-list-channels.md` → `server/skills/slack_list_channels.md`
  - `server/skills/slack-post-dm.md` → `server/skills/slack_post_dm.md`
  - `server/skills/slack-post-message.md` → `server/skills/slack_post_message.md`
  - `server/skills/slack-read-channel.md` → `server/skills/slack_read_channel.md`
  - `server/skills/slack-search-messages.md` → `server/skills/slack_search_messages.md`
  - `server/skills/slack-summarise-thread.md` → `server/skills/slack_summarise_thread.md`
  - `server/skills/support/add-internal-note.md` → `server/skills/support/add_internal_note.md`
  - `server/skills/support/approve-draft.md` → `server/skills/support/approve_draft.md`
  - `server/skills/support/classify-ticket.md` → `server/skills/support/classify_ticket.md`
  - `server/skills/support/find-customer-history.md` → `server/skills/support/find_customer_history.md`
  - `server/skills/support/list-open-tickets.md` → `server/skills/support/list_open_tickets.md`
  - `server/skills/support/propose-reply.md` → `server/skills/support/propose_reply.md`
  - `server/skills/support/read-thread.md` → `server/skills/support/read_thread.md`
  - `server/skills/support/reject-draft.md` → `server/skills/support/reject_draft.md`
  - `server/skills/support/set-status.md` → `server/skills/support/set_status.md`
- `architecture.md` § skill registry conventions — document the operator decision for SK1 methodology path.
- `scripts/run-all-gates.sh` — register `verify-skill-md-naming.sh`.

**Module shape sanity:** public interface = one comparator + one gate + 25 renames + one optional directory + one optional config. Hidden = the comparator's logic. The 25 renames are mechanical; the chunk's depth comes from the comparator. Within the soft cap; if review surfaces concerns, split per the chunk-inventory note above.

**Contracts:**
- Comparator output JSON: `{ unmatched_md_files: string[]; unmatched_registry_entries: string[]; methodology_excluded: string[]; total_md_files: number; total_registry_entries: number }`.
- Naming-allowlist JSON: `Record<string, { rationale: string; addedAt: string }>`.
- Gate output: per-file diagnostic line, exit 1 on any non-allowlisted kebab.

**Error handling:**
- Comparator: fails loudly if `scripts/snapshots/action-registry.snapshot.json` is missing (requires `npm run build:server && npx tsx scripts/snapshot-action-registry.ts` first).
- Naming gate: per-file diagnostic with rename suggestion.
- Skill loader breakage: chunk 0's grep sweep confirmed no hits in `server/services/**`; chunk 9 extends the sweep to `server/lib/**` and any `server/skills/index.ts` if present. If any new hit is found, surface as a chunk-9 sub-task (rename the literal or expand the skill loader's filename normaliser).

**Test considerations (reviewer):**
- Reviewer to confirm no `actionRegistry` keys changed (they're already snake_case; renames are on `.md` files only).
- Reviewer to confirm the comparator output is empty for unmatched registry entries (every `ACTION_REGISTRY` slug has a corresponding `.md` file).
- Reviewer to confirm the naming gate exits 0 against post-rename main.

**Dependencies:** chunk 0 (inventory + operator decision on methodology path).

**Verification commands:**
- `npm run build:server` (refresh `dist/` for snapshot read)
- `npx tsx scripts/compare-skill-md-against-registry.ts` (comparator dry-run)
- `bash scripts/verify-skill-md-naming.sh`
- `npm run lint`

**Acceptance:** all 25 kebab files renamed (or allowlisted with rationale); naming gate exits 0; comparator produces a structured report; methodology path documented in `architecture.md`.

---

### Chunk 10 — PA-V1 voice profile leftovers

**Public interface this chunk exposes:** none new. Internal predicate fixes + doc-comment updates + KNOWLEDGE.md append.

**What stays hidden behind it:** the defense-in-depth org predicate, the failed-state filter, and the deterministic ordering.

**Files to modify:**
- `server/services/operatorSessionInitialContextBundler.ts:80-90` — add `eq(voiceProfilesTable.organisationId, input.organisationId)` predicate AND `.orderBy(desc(voiceProfilesTable.lastDerivedAt))` per spec §10.1.
- `server/jobs/voiceProfileRefreshJob.ts:26-31` — add `ne(voiceProfiles.state, 'failed')` to the candidate `WHERE` clause (default option (a) per spec §10.5). Path correction from spec §10.5: chunk 0 verifies exact lines against current HEAD; this plan applies the predicate to the existing `and(...)` inside `tx.select(...).from(voiceProfiles).where(...)` (currently lines 26-31).
- `server/services/voiceProfile/voiceProfileServicePure.ts:131-146` — confirm `shouldRefresh` does not need a parallel filter (it already short-circuits on `refreshPolicy === 'manual'`); add doc comment naming the new state-filter responsibility. **Path-corrected from spec §10.5 `server/services/voiceProfileServicePure.ts:131-146`.**
- `server/services/voiceProfile/voiceProfileService.ts` (path-corrected from spec §10.5 `server/services/voiceProfileService.ts:36`) — verify no parallel re-derive path; add doc comment if any. Chunk 0 confirms the exact line.
- `server/services/voiceProfile/voiceProfileServicePure.ts:128` — one-line doc-comment update per spec §10.3 (path-corrected).
- `server/jobs/voiceProfileRefreshJob.ts:15` — one-line doc-comment update per spec §10.3.
- `server/services/operatorSessionService.ts:90-91` — one-line doc-comment update per spec §10.3.
- `KNOWLEDGE.md` — append new Pattern entry per spec §10.4: "When planning a column rename, grep BOTH camelCase Drizzle field names AND any snake_case literals in select projections AND any spec-referenced provisioning code paths that write the column."
- `architecture.md` § voice profile refresh — document the PA-CLEANUP-DEF-3 operator decision (default: logger-only acceptance) per chunk-0 decision.
- (Only if operator selects PA-CLEANUP-DEF-3 path (b) at plan gate) — new migration `migrations/<NNNN>_voice_profile_refresh_state.sql` adding `last_refresh_attempted_at: timestamptz` and `last_refresh_succeeded: boolean` to `voice_profiles`; corresponding Drizzle schema change in `server/db/schema/voiceProfiles.ts`. Default decision: do NOT ship this migration.

**Module shape sanity:** 5-8 files, all single-line or single-block edits. Within the soft cap.

**Contracts:**
- Updated query for `operatorSessionInitialContextBundler` per spec §10.1: 4 predicates + `.orderBy(desc(lastDerivedAt)).limit(1)`.
- Updated query for `voiceProfileRefreshJob` per spec §10.5: existing `and(...)` extended with `ne(voiceProfiles.state, 'failed')`.

**Error handling:**
- Per spec §10.1, the schema does not currently enforce unique `(ownerUserId, organisationId, state='ready')` — the deterministic ordering picks the freshest. Chunk 10 flags this for a follow-up but does not ship the partial unique index (out of scope).

**Test considerations (reviewer):**
- Reviewer to confirm the new predicates do not change current behaviour for legitimate single-row matches (defense-in-depth, not behaviour-change).
- Reviewer to confirm KNOWLEDGE.md entry is appended (not edited).
- Reviewer to confirm `architecture.md` decision section names the chunk-0 operator choice.

**Dependencies:** chunk 0 (operator decisions PA-CLEANUP-DEF-3 and PA-CLEANUP-DEF-7).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Acceptance:** all 5 PA-V1 items closed; doc comments updated; KNOWLEDGE.md appended; `architecture.md` decision recorded.

---

### Chunk 11 — Prevention gates (PP-AE2 + PP-MC2 manifest gate)

**Public interface this chunk exposes:** two new gate scripts plus registration in `run-all-gates.sh`.

**What stays hidden behind it:** the ripgrep/grep patterns and per-line allowlist logic.

**Files to create:**
- `scripts/verify-critical-event-emission-awaited.sh` — PP-AE2 per spec §11.2. Flags `void <fn>(...)` for the §5.1 invariant set (`insertExecutionEventSafe` critical/eventType-matching, `insertOutcomeSafe` with rejected/failed, `insertCriticalAuditEvent` unconditional). Conservatively flags non-AST shapes; supports `// guard-ignore-await: <reason>` line annotation.
- `scripts/verify-critical-path-coverage.sh` — PP-MC2 per spec §11.4. Parses `tasks/critical-paths-manifest.yml` per the §11.4 schema; enforces (1) `version: 1`, (2) required fields per entry, (3) exactly-one-coverage-key, (4) `test_path` resolves, (5) `gate_path` matches `scripts/verify-*.sh` or `scripts/gates/*.sh` and resolves, (6) `last_verified` within 180 days.

**Files to modify:**
- `scripts/run-all-gates.sh` — register the two new gates.

**Notes on existing gates per spec §11.1 and §11.3:**
- PP-CD1: `scripts/verify-no-new-cycles.sh` exists; chunk verifies it still exits 0 after chunks 7+8 land. No new code in chunk 11.
- PP-SK2: `scripts/verify-universal-skill-sync.sh` exists; chunk verifies it still exits 0. No new code in chunk 11.

**Module shape sanity:** two new gates. Public interface = the gate scripts. Hidden = pattern logic and allowlist.

**Contracts:**
- PP-AE2 pattern: ripgrep multiline for `void insertExecutionEventSafe(...)` AND payload-literal contains `critical: true` OR `eventType` matches `^tool\.error$|^run\.terminal$|^hierarchy\..+$|^delegation\..+$|^run\.cancellation_requested$`. Also: `void insertOutcomeSafe(...)` AND call-literal contains `outcome: 'rejected'|'failed'`. Also: `void insertCriticalAuditEvent(...)` unconditional.
- PP-MC2 manifest schema per spec §11.4 (six checks).

**Error handling:**
- PP-AE2 conservative-flag mode: if the payload's `eventType` is interpolated rather than literal, flag and require `// guard-ignore-await: <reason>` annotation on the line above. Documented limitation per spec §11.2.
- PP-MC2 per-entry diagnostic on failure.

**Test considerations (reviewer):**
- Reviewer to confirm PP-AE2 exits 0 against post-chunk-1 main (the AE1 fixes ship the gate's baseline).
- Reviewer to confirm PP-AE2 exits 1 on a forced `void insertOutcomeSafe({outcome: 'rejected', ...})` regression.
- Reviewer to confirm PP-MC2 exits 0 against the chunk-4-seeded manifest.

**Dependencies:** chunk 1 (PP-AE2 seeded against post-AE1 main), chunk 2 (the AE2 fixes do not add a new `void` critical emission), chunk 4 (manifest exists for PP-MC2 to validate).

**Verification commands:**
- `bash scripts/verify-critical-event-emission-awaited.sh` (the gate itself; allowed because it's the local-verification step for the chunk that authored it)
- `bash scripts/verify-critical-path-coverage.sh` (same allowance)
- `npm run lint`

**Acceptance:** both new gates exit 0 against current main; both gates registered in `run-all-gates.sh`.

---

### Chunk 12 — Doc rules

**Public interface this chunk exposes:** four documentation appends; no code surface.

**What stays hidden behind it:** the rationale chunks in each doc.

**Files to modify:**
- `architecture.md` — append PP-AE1 per spec §12.1: "Critical audit-trail events (error, terminal outcome, hierarchy event) MUST be awaited. Non-critical events MAY be fire-and-forget but the audit log explicitly accepts loss-on-restart for that subset." Place under the agent-execution area (suggested section: § agent-execution audit trail).
- `DEVELOPMENT_GUIDELINES.md` — append PP-AE3 per spec §12.2: "Handoff dispatch paths must agree on durability posture. Synchronous `Promise.all(executeRun)` is forbidden for spawn paths; route through `enqueueHandoff`." Place in §8 development discipline as §8.40 or next available number (chunk 0 confirms current numbering during inventory).
- `KNOWLEDGE.md` — append PP-CD3 per spec §12.3: "Post-split file size can drop without resolving the underlying cycle or durability semantics. Verify cycles and audit-trail awaiting separately from LOC checks."
- `docs/codebase-audit-framework.md` — append PP-MC1 per spec §12.4 under § Module C: "Every named critical path must declare a test, a gate, or a documented `wont-test` rationale. The audit-runner Module C output references the canonical manifest at `tasks/critical-paths-manifest.yml`."

**Module shape sanity:** four documentation appends. Each is single-paragraph. Within the soft cap.

**Contracts:** the four exact-text appends per spec §12.

**Error handling:** n/a — doc edits.

**Test considerations (reviewer):**
- Reviewer to confirm each append uses the spec's exact wording.
- Reviewer to confirm `DEVELOPMENT_GUIDELINES.md` numbering is the next available integer.
- Reviewer to confirm KNOWLEDGE.md entry is appended at the end with the correct format (date, category, title).

**Dependencies:** chunks 1, 2, 8 (so the rules are anchored to code that already enforces them).

**Verification commands:**
- `npm run lint`

**Acceptance:** four appends ship with spec-exact wording; appropriate doc sections updated.

---

### Chunk 13 — spec-conformance + final review pass

**Public interface this chunk exposes:** the merge-ready PR.

**What stays hidden behind it:** the review/triage logic.

**Files to create/modify:**
- `tasks/builds/wave-4-audit-absorber/progress.md` — final status. Records every chunk's completion, every operator decision, every closed `tasks/todo.md` item.
- `tasks/todo.md` — mark 37 items closed per spec §1: AE1, AE2, AE5, MC2, MC3, MC4, MC7, MC8, MC10, MC11, MC12, DUP6, SK1, SK2, SK3, PA-CLEANUP-DEF-2/-3/-5/-6/-7, PP-CD1, PP-AE2, PP-SK2, PP-MC2, PP-AE1, PP-AE3, PP-CD3, PP-MC1, and any CD-N items that chunk 8 closed (per chunk 0's verification log). Total: 37 items per spec §1. Mark each `[status:closed:pr:<num>]`. **Closure-set scope is plan-gate question 6 — operator confirms 37 vs the narrower "14" callers cited.**
- (No source code changes in this chunk; review-only.)

**Module shape sanity:** review chunk; no code surface.

**Contracts:**
- spec-conformance returns `CONFORMANT` (or `CONFORMANT_AFTER_FIXES` with the fixes routed back to chunks 1-12).
- pr-reviewer returns `APPROVED` (or `NEEDS_WORK` routed back to relevant chunks).
- reality-checker per `CLAUDE.md` review pipeline § GRADED matrix (Significant → mandatory) — caller supplies the implementer's stated criteria and the evidence (test outputs, gate outputs, manifest content).
- dual-reviewer auto-invoked when Codex is available; `REVIEW_GAP` if unavailable.

**Error handling:** any review failure routes the finding to the chunk that owns the surface; chunk 13 does not silently absorb fixes.

**Test considerations:** chunk 13 IS the test-considerations check. Reviewer artifacts persist to `tasks/review-logs/wave-4-audit-absorber/`.

**Dependencies:** chunks 0-12.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client` (if any chunk touched the client surface — chunk 8 may touch `client/src/pages/MacroReport.tsx` for CD6 if open)

**Acceptance:** spec-conformance + pr-reviewer + reality-checker + dual-reviewer (or REVIEW_GAP) all pass; `tasks/todo.md` items closed per plan-gate scope decision; `progress.md` complete; chatgpt-pr-review handled by finalisation-coordinator in Phase 3.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **R1 — Pattern A adapter shape diverges from pg-boss's `Db` contract.** A pg-boss minor-version upgrade changes the `executeSql` shape, breaking the adapter silently. | Pin `pg-boss` minor version in `package.json` (already at `^9.0.3`; if minor-version churn becomes a concern, tighten to `~9.0.3`). The chunk-3 meta-test's `handler_tested` verdict on `agent-handoff-run` provides an integration-style canary. Future spec amendment: add a static gate `verify-pg-boss-db-adapter-shape.sh` that greps for the adapter pattern and confirms the type signature still matches pg-boss's exported `Db` interface. |
| **R2 — `HANDLER_REGISTRY` fixture drifts.** Authors add a queue and forget to update the fixture. | `scripts/verify-handler-registry-fixture.sh` enforces bidirectional set-equality between `JOB_CONFIG`, `HANDLER_REGISTRY`, and `handler-registry-inventory.md`. New `JobName` → gate fails until fixture has an entry. Acknowledged: this is the R1 risk in the spec's risk register; the gate is the discipline. |
| **R3 — Chunk-3 cliff: ~70 `JobName` entries each need an `idempotencyContract` verdict.** Worst case, several queues legitimately need `external_consumer` or `send_only` verdicts and the chunk slows. | Chunk 0's inventory artifact pre-classifies each queue's likely verdict, so chunk 3 is mostly mechanical transcription. If a verdict is genuinely ambiguous mid-chunk-3, log it as `exempt` with `reason: 'pending classification — see <progress.md anchor>'` and resolve in chunk 13. Gate accepts `exempt` with a rationale. |
| **R4 — AE2 introduces a parent-restart race the spec doesn't anticipate.** Parent crashes between INSERT and `boss.send` commit. | Pattern A's transactional invariant rules this out: same `withOrgTx(...)` boundary means the INSERT and the send commit atomically. Parent crash before commit = nothing happens. Parent crash after commit = pg-boss has the job, worker picks it up. Tested by chunk 4 scenario (d). |
| **R5 — `run.cancellation_requested` event is emitted but the child never observes it (child is between phase boundaries).** | Cooperative-cancel pattern (spec §5.2 step 8): authoritative state is `agent_runs.status`, not the event. If child misses the event, parent's next status read still sees `'cancelled'` and exits at the next phase boundary. The event is a fast-path signal, not the authoritative cancellation channel. |
| **R6 — Skill rename breaks an unscanned downstream caller.** chunk 0's grep sweep covers `server/services/**` (no hits) but may miss `server/lib/**`, `scripts/**`, or generated artifacts. | Chunk 0 extends the sweep to all `server/**` and `scripts/**` for the kebab patterns `calendar-`, `ea-`, `slack-`. Build verification (`npm run build:server`) catches any TS-resolvable breakage. Allowlist exists as fallback for files that legitimately reference kebab forms (none expected). |
| **R7 — Critical-paths manifest's 180-day staleness check fires immediately on entries seeded today.** | Manifest entries seeded in chunk 4 are dated `last_verified: 2026-05-16`. Gate's 180-day window means first failure ~2026-11-12. Operators must re-verify entries periodically; the staleness check is the discipline. |
| **R8 — Chunk-8 unconditional inclusion if any single CD-N is `verified open`.** A single open cycle pulls the full chunk into scope. | Acceptable. Chunk 8's per-cycle fixes are independent; the chunk's responsibility is "small cycle fixes" and one open cycle still triggers the chunk's existence. If chunk 0 marks zero cycles open, chunk 8 is dropped wholesale. |
| **R9 — Spec §10 line numbers diverge from current main.** Spec cites `server/services/voiceProfileService.ts` and `server/services/voiceProfileServicePure.ts`; both files are actually at `server/services/voiceProfile/` subdirectory. | Chunk 0 verifies the exact paths and lines and updates chunk 10's file-list mapping; no spec amendment needed. Path drift recorded in plan §Architecture Notes D5. |
| **R10 — `tasks/critical-paths-manifest.yml` consumed by audit-runner Module C before chunk 4 ships.** | Chunk 12's PP-MC1 doc rule explicitly points at the manifest; if audit-runner consumes it before chunk 4 lands, the existing Module C continues to work (no breakage) but doesn't reference the manifest. Sequence: chunk 4 (create) → chunk 11 (gate it) → chunk 12 (doc-rule it). Forward-only dependency. |
| **R11 — Queues registered in main but missing from `JOB_CONFIG`.** Initial scan found ~40 such queues (the `maintenance:*` cluster, scorecard/bench/correction queues, etc.). Chunk 3 must reconcile every one or the meta-test gate fails. | Chunk 0's inventory pre-enumerates all such queues with proposed verdicts. Chunk 3 either adds them to `JOB_CONFIG` (most likely) or marks them with `send_only` / `external_consumer` / `exempt`. The reconciliation is the work; the gate is the discipline. If the reconciliation surfaces more than ~10 surprises, plan-gate operator confirms whether to scope a follow-up rather than absorb it into chunk 3. |

---

## 7. Self-consistency pass

Walked the spec end-to-end against this plan and confirmed:

- **Goals (§2) ↔ chunks.** Every goal maps to a chunk:
  - Goal 1 (AE1, AE5 awaits) → chunk 1. ✓
  - Goal 2 (AE2 contract) → chunk 2. ✓
  - Goal 3 (MC7 meta-test) → chunk 3. ✓
  - Goal 4 (MC8, MC10 tests) → chunk 4. ✓
  - Goal 5 (MC2, MC3, MC11, MC12 + MC4 as gate not test) → chunks 5, 6. ✓
  - Goal 6 (DUP6 extract) → chunk 7. ✓
  - Goal 7 (CD2-CD10 cycle fixes) → chunk 8 (conditional on chunk 0 verification). ✓
  - Goal 8 (SK1 comparator + methodology decision) → chunk 9. ✓
  - Goal 9 (SK2 naming) → chunk 9. ✓
  - Goal 10 (SK3 verify-existing-gate) → chunk 11's gate-verify step + chunk 0 inventory note. ✓
  - Goal 11 (PA-V1 5 items) → chunk 10. ✓
  - Goal 12 (5 gates + 4 doc rules) → chunks 6, 11, 12. ✓

- **Pinned contracts (§5.2, §6.1, §6.2) ↔ chunks.** Every pinned contract is implemented:
  - AE2 transactional invariant (Pattern A) → chunk 2.
  - AE2 lifecycle invariant + cooperative cancel → chunk 2.
  - Parent-cancellation semantics → chunk 2.
  - Handler equivalence contract + per-verdict required fields → chunk 3.
  - `send_only` lifecycleState enum cadence → chunk 3 (gate).
  - MC8 explicit pg-boss retry assertions → chunk 4.

- **Single-source-of-truth claims.** Every "X is the SoT" claim survives:
  - `JOB_CONFIG` is the SoT for queue catalogue → chunk 3 extends it, no parallel registry.
  - `HANDLER_REGISTRY` is the test-time SoT for handler functions → chunk 3 creates it; gate enforces bidirectionality.
  - `tasks/critical-paths-manifest.yml` is the SoT for critical-path coverage → chunk 4 seeds; chunk 11 gates.
  - `scripts/snapshots/action-registry.snapshot.json` remains the SoT for `ACTION_REGISTRY` keys → chunk 9 reuses, does not duplicate.
  - `agent_runs.status` is the SoT for any run's lifecycle state → spec §5.2 step 8; chunk 2 respects.

- **Execution-model claims.** All AE2 paths described as queued; the `actionRegistry` description in chunk 2 updates the LLM-visible shape (only the `pending` field is additive). No inline-vs-queued contradictions.

- **Counts reconciliation:**
  - Spec §1 totals: 37 items across 9 buckets → plan closes 37 items in chunk 13.
  - 14 `tasks/todo.md` items (caller-supplied number) → plan-gate question 6 surfaces the discrepancy; default is to close all 37 per spec §1.
  - 6 integration tests (spec §4) → chunks 4 (2) + 5 (4) = 6 ✓.
  - 25 kebab-named skill files (spec §9.2) → chunk 9 rename inventory = 25 ✓.
  - 14 chunks (chunk 0 + chunks 1-13) → plan §4 = 14 ✓.
  - 5 prevention gates (4 named + MC4 = 5 total per spec §1) → chunks 6 (MC4) + 11 (PP-AE2 + PP-MC2) + verified-existing (PP-CD1, PP-SK2) = 5 ✓.

- **Load-bearing claims have named mechanisms:**
  - "AE2 Pattern A" → pg-boss `boss.send({db})` + Drizzle adapter (chunk 2).
  - "single-fire-equivalent DB state" → default normaliser + per-handler `comparesTables` + multiset equality (chunk 3).
  - "Pre-create child run in parent" → INSERT inside `withOrgTx` (chunk 2).
  - "Cycle-count: 0 preserved" → `verify-no-new-cycles.sh` (existing, verified by chunk 8).
  - "Critical-event invariant enforced" → `verify-critical-event-emission-awaited.sh` (chunk 11).

- **No phase-backward dependencies.** Chunk N never depends on chunk N+k's outputs.

- **No prose-vs-inventory drift.** Every file mentioned in per-chunk detail appears in that chunk's "Files to create/modify" list.

---

## 8. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

**One exception, explicit:** the chunks that author new gate scripts (chunks 6 and 11) run THEIR OWN single gate locally as a sanity check (`bash scripts/verify-llm-call-site-routes-through-router.sh` for chunk 6; `bash scripts/verify-critical-event-emission-awaited.sh` and `bash scripts/verify-critical-path-coverage.sh` for chunk 11). This is the local-verification step for the chunk that authored the gate, not a sweep across other gates. CI runs the full gate suite as the pre-merge gate.

**Tests use Vitest.** Every test authored in this plan uses `import { test, expect } from 'vitest'` per `docs/testing-conventions.md`. Integration-style tests guard with `describe.skipIf(process.env.NODE_ENV !== 'integration')`. No `node:test`, no `node:assert`, no handwritten harnesses. The 6 integration tests are the full deviation scope per spec §4 — no 7th runtime test without a spec amendment.

**Per-chunk verification commands** are listed in each chunk's "Verification commands" section. They cover only lint, typecheck, build (when relevant), and targeted Vitest for tests authored in THAT chunk.

**Operator gate.** Plan-gate is the operator's review of this document. Subsequent execution switches to Sonnet per `CLAUDE.md` § "Model guidance per phase". No execution begins until plan-gate clears.

**Branch hygiene.** Current branch `claude/wave-4-audit-absorber`. Per `CLAUDE.md` §8.9, multi-chunk work uses one integration branch and one PR to main. This plan ships as one PR.

**Six plan-gate decisions to confirm before execution starts:** see §3 above. Defaults are recommended; operator may override per-question. Decisions are recorded in `progress.md` and propagated into chunk 0's setup artifacts.
