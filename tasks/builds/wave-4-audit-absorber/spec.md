---
status: reviewing
spec_date: 2026-05-15
last_updated: 2026-05-16
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: wave-4-audit-absorber
output_location: tasks/builds/wave-4-audit-absorber/spec.md
---

# Wave 4 Session G — audit-sweep absorber + test-meta + prevention gates

Single coordinated PR closing the Wave 2 audit-sweep findings that are NOT architectural-class (those go to Session H).

Scope: 3 handoff durability items + 1 same-file duplication + generic pg-boss test-meta framework + 6 small test/coverage gaps + 9 small circular cycles + 3 skill-registry alignment items + 5 PA-V1 voice profile leftovers + 4 prevention gates + 4 doc rules.

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Internal Quality / Build Operations |
| Capability owner | main-session (Michael) |
| Lifecycle state on launch | Growth |
| Risk surface | None. (closes existing audit findings; does not add new tenant or external surface) |
| Review cadence | on-incident-only |

## ABCd Estimate

| Dimension | Sizing |
|---|---|
| Acquire | n/a (internal hardening; no external substitute) |
| Build | M |
| Carry | S |
| decommission | S |

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Handoff durability (3)**: AE1, AE2, AE5
- **Test-meta framework (1)**: MC7
- **Standalone integration / coverage tests (6)**: MC2, MC3, MC8, MC10, MC11, MC12
- **Same-file duplication (1)**: DUP6
- **Small circular cycles (9)**: CD2, CD3, CD4, CD5, CD6, CD7, CD8, CD9, CD10
- **Skill registry alignment (3)**: SK1, SK2, SK3
- **PA-V1 voice profile leftovers (5)**: PA-CLEANUP-DEF-2, -3, -5, -6, -7
- **Prevention gates (5)**: PP-CD1, PP-AE2, PP-SK2, PP-MC2, MC4 (MC4 is implemented as a gate, not a test — see §6.6)
- **Doc rules (4)**: PP-AE1, PP-AE3, PP-CD3, PP-MC1

**Total: 37 items across 9 buckets.**

## 2. Goals

1. Convert critical-event audit-trail writes (errors, outcomes, hierarchy events) from fire-and-forget to awaited. Closes AE1, AE5.
2. Decide and implement: route `executeSpawnSubAgents` through `enqueueHandoff` OR document the intentional best-effort posture in `architecture.md`. Closes AE2. Note: this is a **semantic shift**, not a 1-line wrap — see §5.2 for the full contract change.
3. Author a generic pg-boss meta-test framework that iterates registered handlers and asserts idempotency under double-fire. Closes MC7. The handler set is enumerated from `server/config/jobConfig.ts` (`JOB_CONFIG`) — see §6.1 for the registry source-of-truth.
4. Author standalone integration tests for the named v1-blocker paths: handoff durability (MC8), service-principal trace boundary (MC10).
5. Author 4 lower-priority standalone tests: idempotency-key dedup (MC2), agentRunVisibility (MC3), cost-ledger retry (MC11), payload retention tier (MC12). MC4 is a static gate, not a test — see §6.6 and §11.5.
6. Extract the 87L same-file clone in `workflowEngine/queueLifecycle/agentStep.ts:225-307 ↔ :397-483`. Closes DUP6.
7. Fix the 9 small circular cycles CD2 through CD10 — see §8 for the per-cycle inventory. Each is a 5-minute fix.
8. Reuse the existing snapshot at `scripts/snapshots/action-registry.snapshot.json` (produced by `scripts/snapshot-action-registry.ts`) as the authoritative `ACTION_REGISTRY` comparator. Use it to ground SK1 (~95 candidate unmatched `.md` files). Make a product call: where do methodology-only skills live? Update the skill catalogue accordingly.
9. Resolve SK2 (naming convention drift: `calendar-create-event.md` kebab vs `create_task` snake) — document an alias map OR rename to a single convention.
10. Resolve SK3 (`UNIVERSAL_SKILL_NAMES` hand-maintained) — verify the existing `scripts/verify-universal-skill-sync.sh` (P7) covers the bidirectional invariant; extend only if gaps surface during chunk 0. PP-SK2 references this existing gate, not a new one.
11. Close 5 PA-V1 voice profile cosmetic / observational leftovers (DEF-2, -3, -5, -6, -7).
12. Author/seed prevention gates (4 named + MC4 = 5 total) and add 4 doc rules. Two of the gates (`verify-no-new-cycles.sh`, `verify-universal-skill-sync.sh`) already exist — see §11.

## 3. Non-Goals

- No CD1 super-cycle break (Session H scope — architectural).
- No DUP1-5 / DUP7-9 extractions (Session H scope — UI extractions).
- No FE1, FE4, FE5+FE6 frontend complexity (Session H scope — visual review).
- No LAEL, Hermes, iee-browser, OSI-DEF future-state work — all v2-backlog per Wave 1/2 operator decisions.
- No drive-by lint cleanup outside the items above.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary` per `docs/spec-context.md`. New tests authored in this build run via Vitest per `docs/testing-conventions.md`.
- **Testing-posture deviation declared explicitly.** `docs/spec-context.md` says `runtime_tests: pure_function_only`. This build authors **6 integration-style runtime tests** (MC2, MC3, MC8, MC10, MC11, MC12) covering v1-blocker correctness gaps that pure-function unit tests cannot exercise (worker restart, three-tier trace boundary, idempotency-key collapse under concurrent insert, cross-tier visibility, retry-incrementing ledger, retention-tier transition). The deviation is **scoped to these 6 tests**. New non-pure tests outside this list remain a directional question for spec-coordinator. The integration tests use existing primitives (`agentExecutionEventService`, `withOrgTx`, the org-scoped DB harness) rather than new test infrastructure. Static gates remain the primary verification surface for the rest of this build.
- The 7 fire-and-forget callsites in `server/services/skillExecutor/handlers/handoff.ts` (post-#314 split location, verified at lines 107, 128, 140, 227, 249, 268, 341) are the AE1+AE5 surface. Architect's chunk-0 sweep re-verifies line numbers against current main.
- The generic test-meta framework lives at `server/lib/__tests__/handlerIdempotency.meta.test.ts`. The handler enumeration source-of-truth is `server/config/jobConfig.ts` (`JOB_CONFIG`, exported as `JobName` union) — `createWorker.ts` is the worker factory and consumes `JOB_CONFIG`, it does not own a registry. There is **no central `server/jobs/index.ts`**: registrations are spread across `createWorker(...)` callsites in `server/jobs/*.ts` and a small number of direct `boss.work(...)` callsites invoked from `server/index.ts` (or sibling startup paths). Chunk 0 inventories the registrations and emits an importable map (see §6.1).
- `executeSpawnSubAgents` routes through `enqueueHandoff` per §5.2 (queue durably, block internally, preserve LLM-visible result shape). The contract is pinned in §5.2 — chunk 0 verifies feasibility but does not re-decide the contract.
- SK1's "where do methodology-only skills live" needs an explicit operator decision. Default: methodology-only `.md` files live in `docs/methodologies/` (or similar), out of the `actionRegistry` source tree, and the unmatched-skill enumeration consumes the existing `scripts/snapshots/action-registry.snapshot.json` as the comparator. Architect surfaces the decision during chunk 0.
- The 9 small circular cycles (§8) are independent. Each chunk handles 1-3 of them.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.
## 5. Items — Handoff durability (AE1, AE2, AE5)

### 5.1. AE1 — Fire-and-forget `void insertExecutionEventSafe` / `void insertOutcomeSafe` writes

**Critical-event invariant (load-bearing — feeds PP-AE2 gate at §11.2).** The critical event class covers ALL of:

- Any `insertExecutionEventSafe(...)` call where `payload.critical === true` OR `payload.eventType` matches `^tool\.error$|^run\.terminal$|^hierarchy\..+$|^delegation\..+$`.
- Any `insertOutcomeSafe(...)` call where `outcome === 'rejected' | 'failed'` (rejected delegation outcomes are durability-critical because they encode the LLM-visible refusal reason).
- Any future `insertCriticalAuditEvent(...)` call (function name reserved for the gate; if the spec authors that helper during chunk 0, all callsites are await-mandated by definition).

Fix: convert every callsite matching the invariant from `void <fn>(...)` to `await <fn>(...)`. Keep non-critical events (progress pings, intermediate state, `tool.invoked` pre-error) fire-and-forget.

Files: `server/services/skillExecutor/handlers/handoff.ts`. Verified callsites on current main (architect re-verifies during chunk 0): lines 107, 128, 140, 227, 249, 268, 341. Of these, 107/140/249 are `insertExecutionEventSafe` (event types `tool.error`); 128/227/341 are `insertOutcomeSafe` with `outcome: 'rejected'`. All seven are critical per the invariant above and convert to `await`.

Acceptance: every callsite matching the invariant is awaited. Targeted Vitest at `server/services/__tests__/handoffCriticalEventDurability.test.ts` covers a forced-rollback scenario; no critical row is dropped. PP-AE2 gate (§11.2) seeded against current main passes after this fix lands.

### 5.2. AE2 — `executeSpawnSubAgents` not queue-backed

**Semantic context (load-bearing — affects LLM tool-call contract).** `executeSpawnSubAgents` is currently a **synchronous** skill handler — it spawns 2-3 child runs via `Promise.all(executeRun(...))`, awaits all children to completion, and returns the aggregated child results to the LLM tool-call boundary. Routing through `enqueueHandoff` would flip this to fire-and-return-queued. The earlier draft of this spec offered both options as alternatives; that ambiguity is removed below.

**Chosen contract: queue durably, block internally, return the existing result-shaped response.** This preserves the LLM-visible tool-call contract (callers get the same `{ success, children: [...] }` shape they get today) while gaining worker-restart durability. The semantic change is invisible to the LLM; the durability change is internal.

Fix:

1. Each sub-task is enqueued via `enqueueHandoff` with idempotency key `${parentRunId}:${index}:${normalisedTitle}` where `index` is the 0-based ordinal of the sub-task in the input array and `normalisedTitle` is the sub-task title with whitespace collapsed and lowercased. The `index` component prevents key collisions when two sub-tasks share a title; the `normalisedTitle` component preserves human-readable diagnosability. `Promise.all(executeRun(...))` is replaced with `Promise.all(enqueueHandoff(...))` to obtain the child `runId`s.
2. After enqueue, the parent handler polls `agent_runs.status` for each child `runId` via a single batched query (one `WHERE id = ANY($1)` lookup, not N separate queries). **Cadence:** `pollIntervalMs = 1000` (1-second fixed interval; no backoff; the only total wait bound is `context.timeoutMs`). Loop continues until every child reaches a terminal status from `shared/runStatus.ts:TERMINAL_RUN_STATUSES` OR the outer timeout fires.
3. Once all children are terminal, the parent collects `agent_runs.result` rows and returns the existing `{ success, children: [{ runId, result, status, error? }] }` shape to the LLM.
4. **Timeout:** the parent's outer timeout (existing `context.timeoutMs`, default 300s, see handoff.ts:155-160) bounds the entire wait. If the timeout fires before all children terminate, the parent returns `{ success: false, error: 'spawn_timeout', children: [<terminal-so-far>], pending: [<runIds-still-in-flight>] }`. The pending children continue to execute under the worker's own retry policy — the parent does not cancel them.
5. **Partial failure:** if some children fail and others succeed, the parent returns `{ success: false, error: 'partial_child_failure', children: [...] }` with each child's individual result/error. This matches today's behaviour where any child error propagates to the parent.
6. **Idempotency under parent-restart.** If the parent itself crashes between enqueue and poll-completion, the parent's resume path uses existing primitives: query `SELECT id, status FROM agent_runs WHERE parent_run_id = $parentRunId` (existing `runs.parent_run_id` linkage), then resume the same poll-loop in step 2 against the returned child IDs. No new schema is needed. The enqueue idempotency key (#1) ensures a parent re-spawn does not double-enqueue: pg-boss collapses the second enqueue to the same `singletonKey` and returns the existing job ID.
7. **`actionRegistry`** entry for `spawn_sub_agents` is unchanged — the tool description still promises synchronous-style results.
8. **`architecture.md` § agent-spawn durability** documents the new posture in the same PR.

Acceptance: worker restart mid-spawn no longer loses children silently. Targeted Vitest at `server/services/__tests__/spawnSubAgentsDurability.integration.test.ts` covers (a) worker restart after enqueue but before children start, (b) worker restart mid-child-execution, (c) parent timeout with one child still pending, (d) parent restart with children mid-execution. All four scenarios assert correct `{ success, children, pending? }` shape.

### 5.3. AE5 — Critical-severity error-path emissions also fire-and-forget

Already covered by §5.1 — AE5's "hierarchy errors, cross-subtree spawn errors, delegation-out-of-scope" all match the critical-event invariant declared in §5.1. AE5 ships as part of AE1's pattern application; no separate fix.

Acceptance: same as AE1.

## 6. Items — Test-meta framework + standalone tests

### 6.1. MC7 — pg-boss handler idempotency meta-test

Fix: author `server/lib/__tests__/handlerIdempotency.meta.test.ts`. Enumerate the handler set, run each through a double-fire scenario, assert side-effect-equivalent.

**Registry source-of-truth.** `createWorker.ts` is a worker factory, not a registry. The handler set is derived from two coordinated sources:

1. **Queue catalogue:** `server/config/jobConfig.ts` exports `JOB_CONFIG: Record<JobName, JobOptions>` and the `JobName` union — this is the closed set of pg-boss queues recognised by the system.
2. **Handler registration:** registrations are spread across multiple `createWorker(...)` callsites in `server/jobs/*.ts` (and a small number of direct `boss.work(...)` callsites). There is **no central `server/jobs/index.ts`** — the bootstrap currently calls each registration site individually from `server/index.ts` (or sibling startup paths).

Architect's chunk 0 produces **two coordinated artifacts**:

1. **`tasks/builds/wave-4-audit-absorber/handler-registry-inventory.md`** — human-readable inventory enumerating, for each `JobName` in `JOB_CONFIG`, the registration callsite (or "no registration in main app — see verdict below"). For human review and PR diffing.
2. **`server/lib/__tests__/handlerRegistryFixture.ts`** — importable TypeScript map exporting `HANDLER_REGISTRY: Record<JobName, { handler: HandlerFn | null; registrationSite: string }>`. The meta-test imports this. The fixture is the mechanically-importable source-of-truth; the markdown file mirrors it for review.

The two artifacts must agree (one entry per `JobName`); a gate (PP-MC2 catalogue or a sibling) verifies bidirectional set equality at CI time.

**Per-queue verdict (load-bearing — required for every entry in `JOB_CONFIG`).** Each `JobName` carries one of four verdicts in a new `idempotencyContract` field added to its `JOB_CONFIG` entry:

- `handler_tested` — main-app handler exists; the meta-test double-fires it and asserts side-effect equivalence. No additional required fields.
- `external_consumer` — no main-app handler; the queue is consumed by an external worker process (e.g. `agent-spend-response` consumed by the worker, not the main app). **Required fields:** `consumer: <name>`, `idempotencyOwner: <handle>`. The meta-test SKIPS but the gate fails if either field is missing.
- `send_only` — main app emits to this queue but does not consume it (the consumer is unknown / TBD / future). **Required fields:** `tracking: <todo-link>`, `addedAt: <YYYY-MM-DD>`. The meta-test SKIPS; the gate flags any `send_only` entry whose `addedAt` is older than 90 days for re-classification.
- `exempt` — handler exists but is intentionally non-idempotent (rare). **Required fields:** `reason: string` (≤140 chars), `owner: <handle>`, `reviewBy: <YYYY-MM-DD>`. The meta-test SKIPS with the rationale surfaced.

**No `idempotencyExempt` overload:** the four-verdict scheme replaces the earlier "single exempt flag" idea. `idempotencyExempt` is removed from this spec.

**Contract location:** `server/config/jobConfig.ts`, alongside the other per-queue options.

Approach:
1. Import `JOB_CONFIG` and `HANDLER_REGISTRY` (the fixture map at `server/lib/__tests__/handlerRegistryFixture.ts`).
2. For each `JobName`, branch on `idempotencyContract.verdict`:
   - `handler_tested`: synthesise a payload (chunk 0 produces `server/lib/__tests__/jobPayloadFixtures.ts` covering each handler's minimum payload shape), fire the handler twice via `HANDLER_REGISTRY[name].handler`, assert single-fire-equivalent DB state.
   - `external_consumer` / `send_only` / `exempt`: emit a SKIP with the verdict + rationale.
3. Gate fails if any `JobName` lacks an `idempotencyContract` entry.
4. Gate fails if any verdict is missing its required fields per the schema above.
5. Gate fails if `send_only.addedAt` is older than 90 days.
6. Gate fails if `HANDLER_REGISTRY` does not have an entry for every `JobName` (and vice versa).

Acceptance: framework passes against all current `JobName` entries — every queue declares a verdict; every `handler_tested` queue passes the double-fire assertion. New queues added in future fail the gate until a verdict is declared.

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

### 6.6. MC4 — (moved to §11.5 — MC4 is a static gate, not a test)

See §11.5 for the gate definition. This subsection is retained as a navigation anchor.

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
## 8. Items — Small circular cycles (CD2 through CD10, subject to chunk-0 verification)

**Verification status (load-bearing):** the existing gate baseline at `scripts/.gate-baselines/circular-deps.txt` is `cycle-count:0`. The CD2-CD10 inventory below comes from the Wave 2 audit log, which was captured BEFORE the post-#307 cycle-cleanup sprint that brought the count to 0. Some or all of CD2-CD10 may already be closed in current main.

**Chunk 0 produces a verification log** at `tasks/builds/wave-4-audit-absorber/cycle-verification-log.md` recording, for each CD-N item, one of:

- `verified open: <madge --circular output excerpt naming the cycle>` — the cycle is genuinely still in current main; chunk 8 fixes it.
- `verified closed by <commit-sha>` — the cycle was closed by an earlier commit; the item is dropped from §8 with no further action.

If all 9 items verify as closed, §8 is empty and chunk 8 is removed from the chunk inventory in §14.

5-minute fixes each (for any item that verifies open). Architect's chunk-0 sweep confirms cycle locations against `references/import-graph/` and against `npx madge --circular --json server/ client/ shared/ worker/` on current main.

- **CD2** — `agentExecutionService ↔ agentExecutionLoop ↔ executionBackends` triangle. Move offending types from `executionBackends/options.ts` to a pure-types-only module.
- **CD3** — `workflowEngineService` post-split residual cycles via `queueLifecycle/dispatch`. Specific edge fix; full break is Session H scope.
- **CD4** — `notifyOperatorFanoutService ↔ channels`. Three-line fix.
- **CD5** — `agentExecutionServicePure` inverted import. Move type to a downstream-only module.
- **CD6** — `MacroReport.tsx` server template cycle. Remove the server-side import path.
- **CD7** — `mcpServer.ts` self-cycle. Bug-fix.
- **CD8** — `sandboxProviderResolver` provider-imports-impl. Invert.
- **CD9** — 2 of 4 govern modal cycles (`*Tab.tsx ↔ *Modal.tsx`, first pair). Lift shared types to a sibling.
- **CD10** — 2 of 4 govern modal cycles (`*Tab.tsx ↔ *Modal.tsx`, second pair). Lift shared types to a sibling.

Acceptance: every CD-N item that verified open in chunk 0 is gone from `madge --circular` output after chunk 8 lands. PP-CD1 gate (§11.1) continues to enforce the `cycle-count:0` baseline (the baseline is already at the floor; cycle-fix work in §8 either confirms it or, if any cycles verified open and were not closed, the gate fails until they are).

## 9. Items — Skill registry (SK1-SK3)

### 9.1. SK1 — Ground the ~95-unmatched-skill count

Fix: **reuse the existing snapshot infrastructure.** The snapshot at `scripts/snapshots/action-registry.snapshot.json` (produced by `scripts/snapshot-action-registry.ts`) already enumerates `ACTION_REGISTRY` keys and is regenerated as part of repo tooling.

Author **one new comparator script** at `scripts/compare-skill-md-against-registry.ts` that:

1. Reads the existing snapshot (`scripts/snapshots/action-registry.snapshot.json`) — the authoritative key set.
2. Reads on-disk `.md` skill files via the existing skill-loading conventions in `server/skills/` (and the methodology tree per the chunk-0 operator decision).
3. Emits a structured report (`tasks/builds/wave-4-audit-absorber/skill-unmatched-report.json`) listing: (a) `.md` files with no registry entry, (b) registry entries with no `.md` file, (c) methodology-only files (per the chunk-0 path decision) excluded from both buckets.

Operator decision (chunk 0): where do methodology-only `.md` files live? Default: `docs/methodologies/` is a separate tree, NOT compared against `actionRegistry`. The comparator's exclusion path is configurable via a CLI flag so the decision is contained in one place.

Acceptance: comparator script exists; unmatched count is grounded; operator decision documented in `architecture.md` § skill registry conventions. No new snapshot infrastructure is added (the existing `snapshot-action-registry.ts` + `action-registry.snapshot.json` remain the single source of truth for `ACTION_REGISTRY` keys).

### 9.2. SK2 — Naming convention drift (kebab vs snake)

Fix: pick one convention. Default: snake_case (matches `actionRegistry` keys). Add a gate: `verify-skill-md-naming.sh` rejects kebab-style after rename.

**Inventory (current main, verified by chunk 0 against `server/skills/*-*.md`):** there are **16 kebab-named skill files**, not 1. The audit-log's "1 known kebab" was a mis-cite. The current set:

```
server/skills/calendar-create-event.md
server/skills/calendar-find-free-slot.md
server/skills/calendar-get-event.md
server/skills/calendar-list-events.md
server/skills/calendar-respond-to-invite.md
server/skills/calendar-update-event.md
server/skills/ea-daily-briefing.md
server/skills/ea-home-widget-summary.md
server/skills/ea-inbox-triage.md
server/skills/ea-meeting-prep.md
server/skills/slack-list-channels.md
server/skills/slack-post-dm.md
server/skills/slack-post-message.md
server/skills/slack-read-channel.md
server/skills/slack-search-messages.md
server/skills/slack-summarise-thread.md
```

Chunk 0 re-verifies the inventory against current main and produces a `tasks/builds/wave-4-audit-absorber/skill-rename-inventory.md`. For each file: rename to snake_case OR mark with a documented exception (e.g. external-tool naming convention pinned for vendor parity — Slack/Calendar API method names use kebab in some integrations).

**Default decision (chunk 0 may override):** rename ALL 16 to snake_case. The gate `scripts/verify-skill-md-naming.sh` enforces snake-only after the rename; any kebab-name file fails the gate unless explicitly allowlisted with rationale in `server/skills/.naming-allowlist.json`.

**`actionRegistry` cross-check (load-bearing):** rename in the `.md` file requires no change to `actionRegistry` keys (which are already snake_case). Skill loaders that read `.md` filenames must be checked for hardcoded kebab references — chunk 0 includes a grep sweep for `calendar-`, `ea-`, `slack-` literals in `server/services/` to surface any breakage.

Acceptance: gate exits 0 against current main after the rename + allowlist authoring; no skill loader breakage; allowlist (if any) carries a per-entry rationale.

### 9.3. SK3 — `UNIVERSAL_SKILL_NAMES` hand-maintained

Fix: covered by PP-SK2 bidirectional lint gate (§11.3). After the gate lands, hand-maintenance becomes enforced rather than aspirational.

## 10. Items — PA-V1 voice profile leftovers

### 10.1. PA-CLEANUP-DEF-2 — `operatorSessionInitialContextBundler` missing app-layer `organisationId` predicate

File: `server/services/operatorSessionInitialContextBundler.ts:80-90` (current main: query already filters by `ownerUserId`, `state='ready'`, `optOutAt IS NULL`; `organisationId` predicate is the missing defense-in-depth layer).

**Query contract after fix (full predicate set):**

```ts
.where(and(
  eq(voiceProfilesTable.ownerUserId, input.ownerUserId),
  eq(voiceProfilesTable.organisationId, input.organisationId),  // NEW — defense-in-depth
  eq(voiceProfilesTable.state, 'ready'),
  isNull(voiceProfilesTable.optOutAt),
))
.orderBy(desc(voiceProfilesTable.lastDerivedAt))
.limit(1)
```

**Uniqueness assumption:** at most one `(ownerUserId, organisationId, state='ready')` row per owner per org. If the schema does not yet enforce this via a partial unique index, the `orderBy(desc(lastDerivedAt)).limit(1)` deterministically picks the freshest profile under the assumption. Architect verifies the schema constraint during chunk 0; if absent, files a follow-up to add it (out of scope here, but flagged).

Fix: add `organisationId` predicate AND deterministic ordering as shown. RLS already enforces the org boundary; the app-layer predicate is defense-in-depth per DEVELOPMENT_GUIDELINES.md §1.

Acceptance: predicate present; ordering deterministic. Verified by code review on the PR. No new test is added — this would exceed the 6-integration-test scope declared in §4. (No existing static gate covers app-layer org predicates on reads against `voice_profiles`; defense-in-depth is enforced by review for now.)

### 10.2. PA-CLEANUP-DEF-3 — Nightly voice profile refresh has no durable audit row

File: `server/jobs/voiceProfileRefreshJob.ts:46, 48`.

Decision (chunk 0): emit a `voice.profile.refreshed` event row OR document the V1 acceptance of logger-only.

**Default plan: log-only acceptance.** This is NOT an agent-execution event (it is a maintenance job, not a run-scoped event), so `agentExecutionEventService` is the wrong primitive. The repo does not currently have a separate "system maintenance audit stream"; introducing one here is out of scope for this build (it would add a new table, a new RLS policy, and a new manifest entry — all directional). The logger-only posture is an acceptable V1 stance; if observability gaps surface in production, a follow-up adds a `system_maintenance_events` table as its own mini-spec.

**Operator override path:** if chunk 0 decides the durable row is required for v1, the contract is:

- **Event stream:** new column `voice_profiles.last_refresh_attempted_at: timestamptz` + new boolean `last_refresh_succeeded`. Both written atomically inside the per-row try/catch in `voiceProfileRefreshJob`.
- **No new table.** This is the minimum-change contract — observability via the row state, not a separate event stream.
- **Migration:** chunk 10 ships the migration if and only if operator picks this path during chunk 0.

Acceptance: chunk 0 decision recorded in `architecture.md` § voice profile refresh; either logger-only (default) is documented as intentional, or the column-extension migration is in the chunk inventory.

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

### 11.1. PP-CD1 — Cycle-regression gate (existing — no new gate authored)

The gate `scripts/verify-no-new-cycles.sh` **already exists** (P11, hard-error since 2026-05-15) and is wired into `scripts/run-all-gates.sh`. Baseline at `scripts/.gate-baselines/circular-deps.txt` is `cycle-count:0`. The 73-server+4-client cycle count cited in earlier audit notes was pre-baseline-seeding history; the current baseline is 0.

Fix this build applies: **none new** — the gate is in place. After §8 fixes land, the cycle count must remain at `cycle-count:0`. The baseline is NOT regenerated; the existing baseline already represents the floor.

If chunk 0 finds the gate is missing a class of cycle the audit cared about (e.g. it skips `worker/` or doesn't enumerate `shared/`), the spec amendment authored during chunk 0 names the specific extension. Otherwise this item is satisfied by the existing gate.

Acceptance: existing gate continues to pass against current main after §8 changes; no net-new cycle regressions.

### 11.2. PP-AE2 — `verify-critical-event-emission-awaited.sh`

Fix: new gate. Flags any call matching the §5.1 critical-event invariant if invoked as `void <fn>(...)`:

- `void insertExecutionEventSafe(...)` where the payload literal contains `critical: true` OR `eventType` matches `^tool\.error$|^run\.terminal$|^hierarchy\..+$|^delegation\..+$`.
- `void insertOutcomeSafe(...)` where the call literal contains `outcome: 'rejected'` or `outcome: 'failed'`.
- `void insertCriticalAuditEvent(...)` (any callsite, unconditionally — the function name is reserved for await-mandated emissions).

The gate uses ripgrep with multi-line patterns; non-trivial AST shapes (e.g. `outcome` interpolated from a variable) are conservatively flagged and require an explicit `// guard-ignore-await: <reason>` annotation on the line above.

**Out of scope for the gate:** dynamic dispatch through a wrapper function (the wrapper is the boundary; if the wrapper is awaited, all sites are covered). The gate documents this limitation explicitly so authors do not assume it tracks indirect calls.

Acceptance: gate seeded against post-AE1+AE5 main; passes; fails on a forced `void insertOutcomeSafe({outcome: 'rejected', ...})` regression.

### 11.3. PP-SK2 — Bidirectional `UNIVERSAL_SKILL_NAMES ↔ ACTION_REGISTRY.isUniversal` lint (existing — no new gate authored)

The gate `scripts/verify-universal-skill-sync.sh` **already exists** (P7, hard-error since 2026-05-15) and is wired into `scripts/run-all-gates.sh`. It asserts bidirectional set equality between `UNIVERSAL_SKILL_NAMES` (`server/config/universalSkills.ts`) and `ACTION_REGISTRY` entries with `isUniversal: true`.

Fix this build applies: **none new** — the gate is in place. SK3's "hand-maintained" risk is already enforced.

If chunk 0 finds the gate is missing a case (e.g. it doesn't catch a particular drift mode), the spec amendment authored during chunk 0 names the specific extension. Otherwise this item is satisfied by the existing gate.

Acceptance: existing gate continues to pass against current main; SK3 closed by the existing enforcement.

### 11.4. PP-MC2 — `verify-critical-path-coverage.sh`

Fix: new gate + new manifest. The manifest is the contract.

**`tasks/critical-paths-manifest.yml` schema (load-bearing — gate enforces this shape):**

```yaml
# tasks/critical-paths-manifest.yml — single source of truth for critical-path coverage.
# Every entry MUST declare exactly one of: test_path, gate_path, OR wont_test_rationale.
version: 1
critical_paths:
  - id: <kebab-case-id>          # required, unique
    description: <one-line>      # required
    surface: <agent-execution | tenant-isolation | sandbox | data-retention | skill-registry | other>
    coverage:                    # exactly one of the three keys below
      test_path: <relative-path-to-vitest-file>
      # OR
      gate_path: <relative-path-to-scripts/verify-*.sh>
      # OR
      wont_test_rationale: <one-paragraph reason; reviewer-approved>
    last_verified: <YYYY-MM-DD>  # required; gate fails if older than 180 days
```

The gate (`scripts/verify-critical-path-coverage.sh`) parses the YAML, asserts:

1. Every `critical_paths[].coverage` declares exactly one of the three keys.
2. Every `test_path` resolves to an existing file.
3. Every `gate_path` resolves to an existing file AND the path matches `scripts/verify-*.sh` or `scripts/gates/*.sh`.
4. Every `last_verified` is within the last 180 days.

The initial manifest is authored during chunk 4 (pairs with MC8/MC10) seeded with the v1-blocker paths the Wave 2 audit named. Architect's chunk 0 enumerates the seed list.

Acceptance: manifest exists with at least the v1-blocker seed entries; gate exits 0 against current main.

### 11.5. MC4 — `verify-llm-call-site-routes-through-router.sh`

(Moved here from §6.6 because MC4 is a static gate, not a runtime test.)

Fix: new gate. Greps for direct OpenAI/Anthropic SDK imports outside `server/services/llmRouter/`; flags any non-allowlisted occurrence.

Allowlist: chunk 0 enumerates the legitimate exceptions (e.g. the SDK-typed test fixtures, the LLM router itself). Anything else is a gate failure.

Acceptance: gate exits 0 against current main with the explicit baseline allowlist.

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

1. Every item in §5-§12 is **resolved** per its fix description. "Resolved" means one of:
   - **Implemented in this PR** per the default fix described in the section.
   - **Implemented per chunk-0 operator override** for the three operator-decision items (SK1 methodology location, PA-CLEANUP-DEF-3 event-row decision, PA-CLEANUP-DEF-7 option choice). For each, the spec defines a default; the operator may pick a documented alternative during chunk 0. The decision is recorded in `tasks/builds/wave-4-audit-absorber/progress.md` and applied in this PR. The originating `tasks/todo.md` item is closed when the decision is recorded AND the corresponding code/doc change ships.
   - **No-op (verified-closed)** for any CD-N cycle item that chunk 0's verification log marks `verified closed by <sha>`. The originating `tasks/todo.md` item is closed when the verification log ships in the PR.

   AE2's contract is pinned in §5.2 and must ship — it is NOT eligible for deferral. Any other deferral (an item in §5-§12 not resolved by one of the three paths above) requires a formal spec amendment that explicitly removes the item from scope; a runtime decision to skip is not sufficient.
2. `npm run build:server` exits 0.
3. `npm run lint` exits 0.
4. All new gates exit 0 against current main (baselines accept current state). Existing gates (`verify-no-new-cycles.sh`, `verify-universal-skill-sync.sh`) continue to exit 0.
5. `madge --circular` count is `0` (the existing baseline). For every CD-N item that chunk 0's verification log marked `verified open`, chunk 8 closes it and the count is preserved. Items marked `verified closed by <sha>` are not addressed here.
6. Targeted Vitest passes for every authored test (test-meta + standalone). The 6-integration-test deviation declared in §4 is the full set; no further runtime tests are added in this build.
7. `tasks/critical-paths-manifest.yml` exists with at least the chunk-0-enumerated v1-blocker seed entries.
8. `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit.

## 14. Chunks (14 entries: chunk 0 setup + chunks 1-13 build)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: scope verification + file-set sweep + operator decisions (SK1 methodology location, PA-CLEANUP-DEF-3 event-row decision, PA-CLEANUP-DEF-7 option choice, MC4 allowlist enumeration, SK2 rename-vs-allowlist per file) + handler-registry-inventory + cycle-verification-log + skill-rename-inventory + plan write
- **Chunk 1**: AE1 + AE5 (await critical-event writes per §5.1 invariant)
- **Chunk 2**: AE2 (route spawn through enqueueHandoff per §5.2 contract)
- **Chunk 3**: Test-meta framework (MC7) — `JOB_CONFIG`-backed enumeration
- **Chunk 4**: Standalone v1-blocker tests (MC8, MC10) + initial `critical-paths-manifest.yml` seed
- **Chunk 5**: Lower-priority tests (MC2, MC3, MC11, MC12)
- **Chunk 6**: MC4 gate (`verify-llm-call-site-routes-through-router.sh`) — see §11.5
- **Chunk 7**: DUP6 same-file extraction
- **Chunk 8**: 9 small circular cycles (CD2-CD10 per §8)
- **Chunk 9**: SK1 comparator + SK2 rename + SK3 (already enforced by existing PP-SK2 gate)
- **Chunk 10**: PA-V1 voice profile leftovers (DEF-2/3/5/6/7)
- **Chunk 11**: Prevention gates (PP-AE2 new; PP-CD1 + PP-SK2 already exist; PP-MC2 new + manifest)
- **Chunk 12**: Doc rules (PP-AE1, PP-AE3, PP-CD3, PP-MC1)
- **Chunk 13**: spec-conformance + pr-reviewer + final review pass

## 15. Deferred Items

This build closes the items listed in §1 in full. The following are **explicitly deferred** with named successor scope:

- **CD1 super-cycle architectural fix** — Session H scope. The handler-injection refactor is significantly larger than the 9 small cycles in §8. Reason: requires new abstraction; out of audit-absorber scope.
- **DUP1, DUP2, DUP3, DUP4, DUP5, DUP7, DUP8, DUP9** — Session H scope (UI/service extractions). Reason: each requires its own architecture call, not a tidy-up.
- **FE1, FE4, FE5, FE6** — Session H scope (frontend complexity). Reason: visual review required; out of audit-absorber scope.
- **LAEL Phases 1-3** — Wave 5 scope per operator decision 2026-05-15. Reason: future-state scope.
- **PA-V2 chunks 5+** — Wave 5 scope per operator decision 2026-05-15. Reason: future-state scope.
- **Hermes Tier 1, iee-browser IEE-DEF-\***, **OSI-DEF-2..13, SANDBOX-DEF-EGRESS-MECH, SANDBOX-F1, 5 not-feasible items** — post-lockdown v2 per Wave 1/2 operator decisions. Reason: future-state or not-feasible-yet.
- **HandlerContext interface design** — Session H scope. SK1-3 are designed to work without it; if HandlerContext is required for any item in this build, the requirement is a spec amendment trigger.
- **System maintenance audit stream** (only relevant if PA-CLEANUP-DEF-3 chunk-0 decision picks the durable-row path) — out of scope here; would be its own mini-spec with table + RLS policy + manifest entry.
