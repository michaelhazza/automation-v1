---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: wave-4-audit-absorber
output_location: tasks/builds/wave-4-audit-absorber/spec.md
---

# Wave 4 Session G — audit-sweep absorber + test-meta + prevention gates

Single coordinated PR closing the Wave 2 audit-sweep findings that are NOT architectural-class (those go to Session H).

Scope: 5 handoff durability items + generic pg-boss test-meta framework + 5 small test-coverage gaps + 5 small circular cycles + skill-registry runtime enumeration + 5 PA-V1 voice profile leftovers + 4 prevention gates + 4 doc rules.

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Handoff durability (5)**: AE1, AE2, AE5, MC7, MC8
- **Service-principal trace test (1)**: MC10
- **Standalone test gaps (4)**: MC2, MC3, MC4, MC11, MC12
- **Same-file duplication (1)**: DUP6
- **Small circular cycles (5)**: CD2-CD10 (CD4, CD5, CD6, CD7, CD8 — 5-min fixes each)
- **Skill registry alignment (3)**: SK1, SK2, SK3
- **PA-V1 voice profile leftovers (5)**: PA-CLEANUP-DEF-2, -3, -5, -6, -7
- **Prevention gates (4)**: PP-CD1, PP-AE2, PP-SK2, PP-MC2
- **Doc rules (4)**: PP-AE1, PP-AE3, PP-CD3, PP-MC1

**Total: ~28 items.**

## 2. Goals

1. Convert critical-event audit-trail writes (errors, outcomes, hierarchy events) from fire-and-forget to awaited. Closes AE1, AE5.
2. Decide and implement: route `executeSpawnSubAgents` through `enqueueHandoff` OR document the intentional best-effort posture in `architecture.md`. Closes AE2.
3. Author a generic pg-boss meta-test framework that iterates registered handlers and asserts idempotency under double-fire. Closes MC7.
4. Author standalone integration tests for the named v1-blocker paths: handoff durability (MC8), service-principal trace boundary (MC10).
5. Author 4 lower-priority standalone tests: idempotency-key dedup (MC2), agentRunVisibility (MC3), LLM call-site routing (MC4 — as a gate, not a test), cost-ledger retry (MC11), payload retention tier (MC12).
6. Extract the 87L same-file clone in `workflowEngine/queueLifecycle/agentStep.ts:225-307 ↔ :397-483`. Closes DUP6.
7. Fix 5 small circular cycles (CD4 notifyOperatorFanout, CD5 agentExecutionServicePure, CD6 MacroReport, CD7 mcpServer self-cycle, CD8 sandboxProviderResolver, plus the 4 govern modal cycles batched as CD9-CD10). Each is a 5-minute fix.
8. Author the runtime `Object.keys(ACTION_REGISTRY)` enumeration script. Use the output to ground SK1 (~95 candidate unmatched .md files) to an authoritative comparator. Make a product call: where do methodology-only skills live? Update the skill catalogue accordingly.
9. Resolve SK2 (naming convention drift: `calendar-create-event.md` kebab vs `create_task` snake) — document an alias map OR rename to a single convention.
10. Resolve SK3 (`UNIVERSAL_SKILL_NAMES` hand-maintained) — author bidirectional lint gate PP-SK2.
11. Close 5 PA-V1 voice profile cosmetic / observational leftovers (DEF-2, -3, -5, -6, -7).
12. Author 4 new prevention gates and add 4 doc rules.

## 3. Non-Goals

- No CD1 super-cycle break (Session H scope — architectural).
- No DUP1-5 / DUP7-9 extractions (Session H scope — UI extractions).
- No FE1, FE4, FE5+FE6 frontend complexity (Session H scope — visual review).
- No LAEL, Hermes, iee-browser, OSI-DEF future-state work — all v2-backlog per Wave 1/2 operator decisions.
- No drive-by lint cleanup outside the items above.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary` per `docs/spec-context.md`. New tests authored in this build run via Vitest per `docs/testing-conventions.md`.
- The 7 fire-and-forget `void insertExecutionEventSafe` callsites in `server/services/agentExecutionService/.../handoff.ts` (or wherever the file lives post-#314 split) are the AE1 surface. Architect's chunk-0 sweep confirms locations.
- The generic test-meta framework lives at `server/lib/__tests__/handlerMeta.test.ts` (or equivalent). It introspects the pg-boss handler registry (likely `server/lib/createWorker.ts` or a sibling) and runs each through a double-fire idempotency assertion.
- `executeSpawnSubAgents` route through `enqueueHandoff` is the right answer per Wave 2 audit; operator confirms during chunk 0. Default: route through; document as a behaviour change in `architecture.md` § agent-spawn durability.
- SK1's "where do methodology-only skills live" needs an explicit operator decision. Default: methodology-only `.md` files live in `docs/methodologies/` (or similar), out of the `actionRegistry` source tree, and the runtime enumeration script greps both locations. Architect surfaces the decision during chunk 0.
- The 5 small circular cycles are independent. Each chunk handles 1-2 of them.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.
## 5. Items — Handoff durability (AE1, AE2, AE5)

### 5.1. AE1 — Fire-and-forget `void insertExecutionEventSafe` writes

Fix: convert the critical-event subset (errors, terminal outcomes) to `await`. Keep non-critical events (progress pings, intermediate state) fire-and-forget.

Files: `server/services/agentExecutionService/.../handoff.ts` (architect confirms post-split location). Original audit cited lines 107, 128, 140, 227, 249, 340, 449.

Acceptance: every error and outcome emission is awaited. Targeted Vitest covering a forced-rollback scenario confirms no row is dropped.

### 5.2. AE2 — `executeSpawnSubAgents` not queue-backed

Fix: route through `enqueueHandoff` (default per chunk-0 operator decision) OR document the intentional best-effort posture.

Default plan: route through `enqueueHandoff`. The 1-line change wraps the existing `Promise.all(executeRun(...))` call in an enqueue.

Acceptance: worker restart mid-spawn no longer loses children silently. Targeted Vitest with a forced mid-spawn restart confirms recovery.

### 5.3. AE5 — Critical-severity error-path emissions also fire-and-forget

Fix: at minimum `await` the critical-severity emissions (hierarchy errors, cross-subtree spawn errors, delegation-out-of-scope). Already in scope of AE1's fix pattern.

Acceptance: same as AE1.

## 6. Items — Test-meta framework + standalone tests

### 6.1. MC7 — pg-boss handler idempotency meta-test

Fix: author `server/lib/__tests__/handlerIdempotency.meta.test.ts`. Introspect the handler registry, run each through a double-fire scenario, assert side-effect-equivalent.

Approach:
1. Read the registered handlers from `createWorker.ts`'s registry (architect confirms registry shape during chunk 0).
2. For each handler, set up a mock job, fire twice with identical payload, assert the resulting DB state is identical to a single-fire baseline.
3. Mark handlers exempt by name + reason in a per-handler `idempotencyExempt: true` flag, surfaced in the test output.

Acceptance: framework passes against all current handlers. New handlers added in future automatically covered.

### 6.2. MC8 — Handoff durability under simulated worker restart

Fix: author `server/lib/__tests__/handoffDurability.integration.test.ts`. Forcibly terminate the worker mid-handoff; restart; assert handoff completes or is correctly recovered.

Acceptance: targeted Vitest passes. Pairs with AE1/AE2 fixes.

### 6.3. MC10 — Three-tier service-principal trace boundary

Fix: author `server/lib/__tests__/servicePrincipalTraceBoundary.integration.test.ts`. Assert the three-tier agent model's trace boundary is preserved across hops (no service-principal leak between tiers).

Acceptance: targeted Vitest passes.

### 6.4. MC2 — Idempotency-key dedup test

Fix: author `server/lib/__tests__/idempotencyKey.dedup.test.ts`. Concurrent insert against the unique constraint must collapse to a single row.

Acceptance: targeted Vitest passes.

### 6.5. MC3 — `agentRunVisibility.ts` integration test

Fix: author `server/services/__tests__/agentRunVisibility.integration.test.ts`. Cover the impure read path.

Acceptance: targeted Vitest passes.

### 6.6. MC4 — Gate proving every LLM call site routes through `llmRouter`

Fix: author `scripts/verify-llm-call-site-routes-through-router.sh`. Grep for direct OpenAI/Anthropic SDK imports outside `server/services/llmRouter/`; flag any non-allowlisted occurrence.

Acceptance: gate exits 0 against current main with an explicit baseline allowlist.

### 6.7. MC11 — Cost-ledger increments-once under retry

Fix: author `server/services/__tests__/costLedger.idempotency.test.ts`.

Acceptance: targeted Vitest passes.

### 6.8. MC12 — LLM payload retention tier boundary transition

Fix: author `server/services/__tests__/payloadRetention.tierBoundary.test.ts`.

Acceptance: targeted Vitest passes.

## 7. Items — Same-file duplication (DUP6)

### 7.1. DUP6 — 87L clone in `workflowEngine/queueLifecycle/agentStep.ts:225-307 ↔ :397-483`

Fix: extract the duplicated block into a private helper at the top of the file. Both callsites delegate.

Acceptance: file LOC drops by ~87. `verify-duplicate-blocks.sh` baseline drops.
## 8. Items — Small circular cycles (CD2-CD10)

5-minute fixes each. Architect's chunk-0 sweep confirms cycle locations against `references/import-graph/`.

- **CD2** — `agentExecutionService ↔ agentExecutionLoop ↔ executionBackends` triangle. Move offending types from `executionBackends/options.ts` to a pure-types-only module.
- **CD3** — `workflowEngineService` post-split residual cycles via `queueLifecycle/dispatch`. Specific edge fix; full break is Session H scope.
- **CD4** — `notifyOperatorFanoutService ↔ channels`. Three-line fix.
- **CD5** — `agentExecutionServicePure` inverted import. Move type to a downstream-only module.
- **CD6** — `MacroReport.tsx` server template cycle. Remove the server-side import path.
- **CD7** — `mcpServer.ts` self-cycle. Bug-fix.
- **CD8** — `sandboxProviderResolver` provider-imports-impl. Invert.
- **CD9-CD10** — 4 govern modal cycles (`*Tab.tsx ↔ *Modal.tsx`). Lift shared types to a sibling.

Acceptance: each named cycle is gone from `madge --circular` output. Closed by PP-CD1 gate seeding.

## 9. Items — Skill registry (SK1-SK3)

### 9.1. SK1 — Ground the ~95-unmatched-skill count

Fix: author a runtime enumeration script that calls `Object.keys(ACTION_REGISTRY)` at boot and writes the authoritative list to `references/action-registry-snapshot.json`. Compare against the on-disk `.md` files. Surface the true unmatched count.

Operator decision (chunk 0): where do methodology-only `.md` files live? Default: `docs/methodologies/` is a separate tree, NOT compared against `actionRegistry`.

Acceptance: snapshot file exists; unmatched count is grounded; operator decision documented in `architecture.md` § skill registry conventions.

### 9.2. SK2 — Naming convention drift (kebab vs snake)

Fix: pick one convention. Default: snake_case (matches `actionRegistry` keys). Rename the 1 known kebab `.md` (`calendar-create-event.md` → `calendar_create_event.md`). Add a gate: `verify-skill-md-naming.sh` rejects kebab-style.

Acceptance: gate exits 0 against current main after rename.

### 9.3. SK3 — `UNIVERSAL_SKILL_NAMES` hand-maintained

Fix: covered by PP-SK2 bidirectional lint gate (§11.3). After the gate lands, hand-maintenance becomes enforced rather than aspirational.

## 10. Items — PA-V1 voice profile leftovers

### 10.1. PA-CLEANUP-DEF-2 — `operatorSessionInitialContextBundler` missing app-layer `organisationId` predicate

File: `server/services/operatorSessionInitialContextBundler.ts:80-90`.

Fix: add `eq(voiceProfilesTable.organisationId, input.organisationId)` predicate. RLS already enforces; this is defense-in-depth per DEVELOPMENT_GUIDELINES.md §1.

Acceptance: predicate present.

### 10.2. PA-CLEANUP-DEF-3 — Nightly voice profile refresh has no durable audit row

File: `server/jobs/voiceProfileRefreshJob.ts:46, 48`.

Decision (chunk 0): emit a `voice.profile.refreshed` event row OR document the V1 acceptance of logger-only.

Default: emit the durable row. Closes the audit gap.

### 10.3. PA-CLEANUP-DEF-5 — Stale doc comments referencing old column names

Files: `voiceProfileServicePure.ts:128`, `voiceProfileRefreshJob.ts:15`, `operatorSessionService.ts:90-91`.

Fix: one-line doc updates. Cosmetic only.

### 10.4. PA-CLEANUP-DEF-6 — KNOWLEDGE.md rule: column-rename grep discipline

Fix: append a Pattern entry to `KNOWLEDGE.md`: "When planning a column rename, grep BOTH camelCase Drizzle field names AND any snake_case literals in select projections AND any spec-referenced provisioning code paths that write the column."

Acceptance: entry appended.

### 10.5. PA-CLEANUP-DEF-7 — Failed voice profiles re-derived nightly

File: `server/jobs/voiceProfileRefreshJob.ts:35-45` + `voiceProfileServicePure.ts:131-146` + `voiceProfileService.ts:36`.

Decision (chunk 0): pick one of three options the spec-conformance log proposes. Default: option (a) — add `ne(voiceProfiles.state, 'failed')` to the nightly candidate query. Smallest change, respects state-machine intent.

Acceptance: failed profiles no longer re-derived nightly.

## 11. Items — Prevention gates

### 11.1. PP-CD1 — `npm run check:circular` baselined warn-gate

Fix: author `scripts/verify-no-new-cycles.sh` (or extend the existing one) to use `madge --circular` with the current main baseline (73 server + 4 client cycles). Any net-new cycle fails the PR.

Acceptance: gate seeded against current main; fails on a forced new cycle.

### 11.2. PP-AE2 — `verify-critical-event-emission-awaited.sh`

Fix: gate flags any `void insertExecutionEventSafe(` or `void insertCriticalAuditEvent(` callsite outside an explicit `// guard-ignore-await: <reason>` annotation.

Acceptance: gate seeded; passes after AE1+AE5 fixes land.

### 11.3. PP-SK2 — Bidirectional `UNIVERSAL_SKILL_NAMES ↔ ACTION_REGISTRY.isUniversal` lint

Fix: gate compares both sources, fails if they diverge.

Acceptance: gate seeded; passes against current main.

### 11.4. PP-MC2 — `verify-critical-path-coverage.sh`

Fix: gate reads `tasks/critical-paths-manifest.yml` (authored as part of this build), asserts each critical path names a test, gate, or documented `wont-test`.

Acceptance: manifest exists; gate seeded; passes against current main.

## 12. Items — Doc rules

### 12.1. PP-AE1 — Audit-trail durability invariants in architecture.md

Append to `architecture.md` under the agent-execution area: "Critical audit-trail events (error, terminal outcome, hierarchy event) MUST be awaited. Non-critical events MAY be fire-and-forget but the audit log explicitly accepts loss-on-restart for that subset."

### 12.2. PP-AE3 — DEVELOPMENT_GUIDELINES.md rule

Append to §8: "Handoff dispatch paths must agree on durability posture. Synchronous `Promise.all(executeRun)` is forbidden for spawn paths; route through `enqueueHandoff`."

### 12.3. PP-CD3 — KNOWLEDGE.md pattern

Append: "Post-split file size can drop without resolving the underlying cycle or durability semantics. Verify cycles and audit-trail awaiting separately from LOC checks."

### 12.4. PP-MC1 — Module C codebase-audit-framework rule

Append to `docs/codebase-audit-framework.md` § Module C: "Every named critical path must declare a test, a gate, or a documented `wont-test` rationale. The audit-runner Module C output references the canonical manifest at `tasks/critical-paths-manifest.yml`."
## 13. Acceptance Criteria

A build is complete when ALL of the following hold:

1. Every item in §5-§12 is either implemented per its fix description OR explicitly v2-deferred with rationale logged in `tasks/todo.md`.
2. `npm run build:server` exits 0.
3. `npm run lint` exits 0.
4. All new gates exit 0 against current main (baselines accept current state).
5. `madge --circular` count drops by the 5 named cycles in §8.
6. Targeted Vitest passes for every authored test (test-meta + standalone).
7. `tasks/critical-paths-manifest.yml` exists with every critical path declared.
8. `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit.

## 14. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: scope verification + file-set sweep + operator decisions (SK1 methodology location, PA-CLEANUP-DEF-7 option choice) + plan write
- **Chunk 1**: AE1 + AE5 (await critical-event writes)
- **Chunk 2**: AE2 (route spawn through enqueueHandoff)
- **Chunk 3**: Test-meta framework (MC7)
- **Chunk 4**: Standalone v1-blocker tests (MC8, MC10) + critical-paths-manifest
- **Chunk 5**: Lower-priority tests (MC2, MC3, MC11, MC12)
- **Chunk 6**: MC4 gate (verify-llm-call-site-routes-through-router.sh)
- **Chunk 7**: DUP6 same-file extraction
- **Chunk 8**: 5 small circular cycles
- **Chunk 9**: SK1 runtime enumeration + SK2 rename + SK3 (handled by PP-SK2)
- **Chunk 10**: PA-V1 voice profile leftovers (DEF-2/3/5/6/7)
- **Chunk 11**: Prevention gates (PP-CD1, PP-AE2, PP-SK2, PP-MC2)
- **Chunk 12**: Doc rules (PP-AE1, PP-AE3, PP-CD3, PP-MC1)
- **Chunk 13**: spec-conformance + pr-reviewer + final review pass

## 15. Out of Scope

The following stay v2-backlog and are NOT addressed in this build:

- **CD1 super-cycle architectural fix** — Session H scope. The handler-injection refactor is significantly larger than the 5 small cycles in §8.
- **DUP1-DUP5, DUP7-DUP9** — UI/service extractions, Session H scope.
- **FE1, FE4, FE5+FE6** — frontend complexity, Session H scope.
- **LAEL Phases 1-3** — Wave 5 scope per operator decision 2026-05-15.
- **PA-V2 chunks 5+** — Wave 5 scope per operator decision 2026-05-15.
- **Hermes Tier 1, iee-browser IEE-DEF-*, OSI-DEF-2..13, SANDBOX-DEF-EGRESS-MECH, SANDBOX-F1, 5 not-feasible items** — post-lockdown v2 per Wave 1/2 operator decisions.
