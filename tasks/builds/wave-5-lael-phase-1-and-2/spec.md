# Wave 5 Session M — LAEL Phase 1 + 2 + Hermes Tier 1

**Status:** reviewing
**Spec date:** 2026-05-16
**Last updated:** 2026-05-16
**Author:** Main session (Session M)
**Build slug:** wave-5-lael-phase-1-and-2
**Class:** Significant
**Parent spec:** `tasks/live-agent-execution-log-spec.md` (LAEL canonical), `tasks/hermes-audit-tier-1-spec.md` (Hermes canonical)
**Branch:** `claude/lael-phase-1-and-2`
**Prereqs merged on main:** PR #329 (Session I' quality), #330 (Session E wave-3), #331 (Session H wave-4 HandlerContext), #332 (Session G audit-sweep)

---

## Table of contents

1. Intent
2. Lifecycle Declaration (incl. §2.1 ABCd Estimate)
3. Pre-existing state (verified 2026-05-16)
4. Phase 1 scope — remaining emission sites
5. Phase 2 scope — edit audit trail
6. Hermes Tier 1 scope
7. Cross-cutting requirements
8. Files to change — summary table
9. Testing posture
10. Chunk plan (architect-author target)
11. Deferred items
12. Self-consistency check

---

## 1. Intent

Close out the remaining LAEL Phase 1 emission gaps, add LAEL Phase 2 edit audit trail, and absorb the open Hermes Tier 1 cost-correctness item (H1 `successfulCostCents`). Two Hermes items called out in the launch prompt (H3 partial-status coupling, §6.8 errorMessage gap) appear to have already landed in prior waves — chunk-0 sweep will verify and either close them out or surface remaining work.

LAEL Phase 3 (retention tiering + cold archive) and Hermes H2 (Slack/Whisper rollup-vs-ledger asymmetry) stay v2-backlog per launch prompt.

---

## 2. Lifecycle Declaration

Per `docs/spec-authoring-checklist.md §12.1` — five required fields.

| Field | Value |
|---|---|
| Capability cluster | `agent-execution-observability` (extends existing live log) |
| Capability owner | main-session (placeholder per checklist §7.4.3 owner-placeholder rule) |
| Lifecycle state on launch | Growth (Phase 1 scaffolding already shipped via prior branch; this closes deferred-items) |
| Risk surface | None. (additive emissions + one new tenant-isolated audit table mirroring LAEL §7.5 RLS shape; no changes to tenant-isolation primitives, auth, or money-handling paths) |
| Review cadence | on-incident-only |

**Successor-of:** LAEL Phase 1 partial merge on `claude/build-agent-execution-spec-6p1nC`.
**Deprecates:** none.
**Sunset trigger:** none — capability is growing.
**Verifiability:** High — emissions verifiable via grep + targeted Vitest on Pure modules + spec-conformance.

### 2.1 ABCd Estimate

Per `docs/spec-authoring-checklist.md §12.2` — four required dimensions, S/M/L sizing only.

| Dimension | Sizing | Rationale |
|---|---|---|
| Acquire | N/A | Internal capability; no external equivalent to license |
| Build | S | Additive emission sites + one new audit table + one new cost field + frontend banner — bounded scope (10–11 chunks per §10) |
| Carry | S | Rides existing LAEL infrastructure (`appendEvent`, `tryEmitAgentEvent`, `RLS_PROTECTED_TABLES`); no new operational surface |
| decommission | S | Revert chunks individually; no data migration required (pre-production, no live data) |

---

## 3. Pre-existing state (verified 2026-05-16)

The LAEL Phase 1 scaffolding has substantially landed in prior waves. The remaining gaps are narrower than the original launch prompt assumed.

### 3.1 Already done — verified in the codebase

| Item | Status | Location verified |
|---|---|---|
| `agent_execution_events` + `agent_run_prompts` + `agent_run_llm_payloads` tables + RLS + manifest | done | migrations + `server/db/schema/` + `rlsProtectedTables.ts` |
| `agentExecutionEventService` + Pure | done | `server/services/agentExecutionEventService.ts` + `*Pure.ts` |
| `agentExecutionEventEmitter` (`tryEmitAgentEvent`) | done | `server/services/agentExecutionEventEmitter.ts` |
| `agentRunPromptService` | done | `server/services/agentRunPromptService.ts` |
| `agentRunPayloadWriter` | done | `server/services/agentRunPayloadWriter.ts` |
| `shared/types/agentExecutionLog.ts` (discriminated union, all event types) | done | full taxonomy present |
| `run.started` emission | done | `server/services/agentExecutionService/runLifecycle/persistRun.ts:141` |
| `run.completed` emission | done | `runLifecycle/complete.ts:196` |
| `llm.requested` + `llm.completed` emissions + payload-row write | done | `server/services/llmRouter/routeCall.ts` (paired-emit invariant at L536–545; sites at L664, L1161, L1551, L1635) |
| `orchestrator.routing_decided` emission | done | `runLifecycle/persistRun.ts:182` |
| `prompt.assembled` emission | done | `runLifecycle/prepare.ts:561` |
| `context.source_loaded` emission | done | `runLifecycle/prepare.ts:635` |
| `clarification.requested` emission | done | `server/tools/internal/requestClarification.ts:69` |
| `AgentRunLivePage` + Timeline + EventRow + EventDetailDrawer + LayeredPromptViewer | done | `client/src/pages/AgentRunLivePage.tsx` + components |
| `GET /api/agent-runs/:runId/events` (+ prompts + llm-payloads) | done | `server/routes/agentExecutionLog.ts` |
| Hermes H3 (`hasSummary` orthogonal to `runResultStatus`) | likely done | `runLifecycle/complete.ts:106`, `:206-208` — chunk-0 confirms |
| Hermes §6.8 (`errorMessage` threaded into `extractRunInsights`) | likely done | `runLifecycle/complete.ts:476-499` (HERMES-S1 block) — chunk-0 confirms |

### 3.2 Remaining work — this build's scope

| Item | Reason still open |
|---|---|
| `memory.retrieved` emission | no calls to `tryEmitAgentEvent` in `workspaceMemoryService` / `memoryBlockService` |
| `rule.evaluated` emission | no calls in `decisionTimeGuidanceMiddleware` |
| `skill.invoked` / `skill.completed` emissions | no calls in `skillExecutor` or handlers |
| `handoff.decided` emission | no calls in `agentRunHandoffService` or handoff path |
| LAEL Phase 2 audit table + migration | `agent_execution_log_edits` does not exist; next migration number is 0367 |
| LAEL Phase 2 `triggeringRunId` plumbing on edit surfaces | not implemented |
| LAEL Phase 2 `EditedAfterBanner` component | not implemented |
| Hermes H1 `successfulCostCents` | `shared/types/runCost.ts` has no `successfulCostCents` field; `server/routes/llmUsage.ts` does not aggregate it; `RunCostPanel`/`Pure` have no branch for it |

---

## 4. Phase 1 scope — remaining emission sites

**Emission-pattern split by criticality (per LAEL §4.1):**

- **Non-critical emissions** (`memory.retrieved`, `rule.evaluated`, `skill.invoked`, `skill.completed`) go through `tryEmitAgentEvent` (fire-and-forget). The emitter swallows persistence failures into structured logs.
- **Critical emissions** (`handoff.decided` is the only one added in this build) use **awaited** `agentExecutionEventService.appendEvent` directly, mirroring the awaited pattern used by `run.completed` and `run.started`. The one-inline-retry with 50 ms backoff lives inside `appendEvent`.

The carve-out is restated at §4.4 (handoff.decided) and §7.2 (critical-event invariant). Phase 1 work is **additive only** — no existing emission is moved or renamed.

### 4.1 `memory.retrieved` — `workspaceMemoryService` + `memoryBlockService`

**Where:** at the **return boundary** of `_hybridRetrieve()` (workspaceMemoryService) and `getBlocksForInjection()` (memoryBlockService) — not inside the inner ranking loop. One event per retrieval phase. Architect's chunk-0 sweep confirms the exact post-Wave-4 file the retrieval boundary now lives in (likely `workspaceMemoryService/hybridRetrieval.ts` per the existing sub-folder split).

**Payload (per LAEL §5.3):**
```
{ eventType: 'memory.retrieved', critical: false,
  queryText: string, retrievalMs: number,
  topEntries: Array<{ id, score, excerpt }>,  // top-N capped at 5, score numeric, excerpt truncated to 240 chars
  totalRetrieved: number }
```

**`linkedEntity`:** `{ type: 'memory_entry', id: topEntries[0].id }` (workspaceMemoryService) or `{ type: 'memory_block', id: topEntries[0].id }` (memoryBlockService) when non-empty; `null` otherwise.

**Run-context plumbing:** both services already receive `runId` + `organisationId` + `subaccountId` in the retrieval call signatures used by the agent loop. Where they do not (utility callers), guard the emit with `runId != null` and skip silently.

**Failure mode:** non-critical — `tryEmitAgentEvent` logs and continues. Retrieval result is not gated on emission success.

### 4.2 `rule.evaluated` — `decisionTimeGuidanceMiddleware`

**Where:** after rule-match evaluation completes inside the middleware, whether or not a rule matched. One event per tool-call evaluation.

**Payload (per LAEL §5.3):**
```
{ eventType: 'rule.evaluated', critical: false,
  toolSlug: string, matchedRuleId: string | null,
  decision: 'auto' | 'review' | 'block',
  guidanceInjected: boolean }
```

**`linkedEntity`:** `{ type: 'policy_rule', id: matchedRuleId }` when a rule matched; `null` otherwise.

**Run-context:** the middleware receives the tool-call envelope which already carries `runId` + tenant scope. No new threading needed.

### 4.3 `skill.invoked` / `skill.completed` — `skillExecutor` (centralised, not per-handler)

**Where:** at the **executor boundary**, not inside individual handlers. This is the post-Wave-4 pattern: `skillExecutor` orchestrates dispatch, calls into the handler via `HandlerContext`, then returns. We emit `skill.invoked` immediately before the handler call and `skill.completed` in the existing try/finally block.

Per launch-prompt note: "Most handlers — apply uniformly via the post-Wave-4 HandlerContext (Session H broke the cycle so the executor knows its emitter)." We do not touch the 30+ handlers individually; the executor wraps them.

**Payload — invoked:**
```
{ eventType: 'skill.invoked', critical: false,
  skillSlug: string, skillName: string,
  input: unknown,                              // pre-redaction; redaction is the writer's job
  reviewed: boolean, actionId: string | null }
```

**Payload — completed:** matches LAEL §5.3 + the optional discriminator fields already accepted by `agentExecutionEventServicePure.ts:267-293` (`skillType`, `errorCode`, `provider`, `connectionKey`, `idempotent` are optional and populated where the handler returns them).

**`linkedEntity`:** `{ type: 'skill', id: skillId }`. When `skillId` is not resolvable (system-defined skills with slug-only identity), `linkedEntity: null`.

**Run-context:** `HandlerContext` already carries `runId`, `organisationId`, `subaccountId` per Session H. No new threading needed.

**Failure mode:** non-critical — `tryEmitAgentEvent` logs and continues.

### 4.4 `handoff.decided` — `agentRunHandoffService` (CRITICAL)

**Where:** at the handoff decision point — the location where the parent run resolves the target agent and persists the handoff link. Architect's chunk-0 confirms the exact post-Session-G shape; current location is `server/services/agentRunHandoffService.ts`.

**Payload (per LAEL §5.3):**
```
{ eventType: 'handoff.decided', critical: true,
  targetAgentId: string, reasonText: string,
  depth: number, parentRunId: string }
```

**`linkedEntity`:** `{ type: 'agent', id: targetAgentId }`.

**Critical-tier coordination with Session G:** `handoff.decided` is critical, so it goes through the one-inline-retry path with 50ms backoff per LAEL §4.1. Session G's awaited-write fix means the emit is awaited before the agent loop proceeds. We use `appendEvent` directly (not `tryEmitAgentEvent` which is fire-and-forget) at this site, mirroring the awaited pattern used by `run.completed` and `run.started`.

**Source service tag:** `'agentRunHandoffService'`.

### 4.5 Phase 1 — out-of-scope clarifications

- **Memory `_hybridRetrieve` is called from non-agent contexts** (e.g. admin tooling, configuration assistant). Those call sites do not pass a `runId`; the emit is skipped silently.
- **`skillExecutor` is invoked from non-agent contexts** (skill-studio sandbox, dev-context tooling). Same `runId == null` skip.
- **Concurrent emission from parallel writers** is not a v1 concern — agent loop is single-threaded per run. LAEL §4.2 already covers the deferred parallel-writer semantics.

---

## 5. Phase 2 scope — edit audit trail

### 5.1 Migration

`migrations/0367_agent_execution_log_edits.sql` creates the table per LAEL §5.8 — schema, indexes, RLS policy. The down migration drops it. Add `agent_execution_log_edits` to `server/config/rlsProtectedTables.ts` in the same migration set.

`server/db/schema/agentExecutionLogEdits.ts` is a new Drizzle schema file; re-export from `server/db/schema/index.ts`.

### 5.2 `triggeringRunId` plumbing on edit surfaces

Four edit surfaces accept an optional `triggeringRunId` query parameter and persist an audit row on save:

1. Memory entry edit
2. Memory block edit
3. Policy rule edit
4. Data-source edit

**Producer pattern:** the route handler reads `req.query.triggeringRunId` (UUID-validated), passes through to the edit service, which writes an `agent_execution_log_edits` row inside the same transaction as the entity update. If `triggeringRunId` is absent the audit row is not written.

**`before_snapshot` / `after_snapshot`:** captured where the existing edit surface already returns them (memory edit has a versioning side-table that gives us before/after cheaply); `NULL` where it does not. We do not add new snapshot-capture infrastructure in this build.

**Skill edit** is intentionally excluded from this build — system skills are not user-editable, and org/subaccount skills go through a separate review flow. Add later if a real ask lands.

### 5.3 `EditedAfterBanner` component

`client/src/components/agentRunLog/EditedAfterBanner.tsx` — surfaces when an event's linked entity was edited via an LAEL-aware edit surface and that edit carried this run as its `triggeringRunId`. Used on `AgentRunLivePage` for past runs only (no need to flash on live runs).

**Scope limitation (deliberate):** the banner shows only edits attributed to this run via `triggeringRunId` — i.e. edits the user made by clicking through from this run's log. Edits to the same linked entity made outside any run (or attributed to a different run) are **not** surfaced. This matches the data the audit table holds per §5.2 ("if `triggeringRunId` is absent the audit row is not written"). Cross-run / out-of-band edit search is in §11 Deferred items.

**Data source:** the snapshot endpoint already returns events with `linkedEntity`. The banner queries a new lightweight endpoint `GET /api/agent-runs/:runId/edits`.

**API projection (this spec):** LAEL §5.8 is authoritative for the `agent_execution_log_edits` table columns. The endpoint exposes the following projection, mapped 1:1 from those columns:

```
GET /api/agent-runs/:runId/edits →
  Array<{
    entityType: LinkedEntityType,   // from `entity_type`
    entityId: string,               // from `entity_id`
    editedAt: string,               // ISO timestamp, from `edited_at`
    editedByUserId: string,         // from `edited_by_user_id`
    editSummary: string,            // from `edit_summary` (human-readable, written by the edit surface)
  }>
```

The projection is defined in `shared/types/agentExecutionLogEdits.ts` (new — see §8) and consumed by `EditedAfterBanner`. Banner copy uses `editedByUserId` to resolve a display name via the existing user-display helper. `before_snapshot` / `after_snapshot` are NOT in the projection (deferred per §5.4 diff viewer).

**Permission:** per LAEL §7 the gate is the run's view permission — the audit table inherits the same `AGENTS_VIEW` rule via `resolveAgentRunVisibility`.

### 5.4 Phase 2 — out-of-scope

- **Side-by-side diff viewer** in the banner. v1 shows "edited at X by Y, summary: Z" — clicking opens the entity's full edit history page. Structural diff rendering is deferred.
- **Cross-run edit search** ("show me every run that triggered an edit to memory M") — deferred to a follow-up search surface.

---

## 6. Hermes Tier 1 scope

### 6.1 H1 — `successfulCostCents` on `/api/runs/:runId/cost`

The current cost API returns `totalCostCents` (sum across all states including failed), which biases cost-per-call calculations on runs with retries. Add a sibling field that counts only `success` + `partial` ledger rows.

**Files touched:**

| File | Change |
|---|---|
| `shared/types/runCost.ts` | Add `successfulCostCents: number` to `RunCostResponse`. Comment block clarifies semantics: "SUM(cost_cents) WHERE status IN ('success', 'partial')". Field is always present (zero when no successful calls), matching the existing backwards-compat contract. |
| `server/routes/llmUsage.ts` | Aggregate query gains `SUM(cost_cents) FILTER (WHERE status IN ('success', 'partial')) AS successful_cost_cents` from `llm_requests_all` view. Zero default applied when row is absent. |
| `client/src/components/run-cost/RunCostPanelPure.ts` | Branch logic: when `successfulCostCents !== totalCostCents`, panel renders a secondary line `Successful: $X.XX` beneath the primary total. When equal (most common case, including the all-zero case where `total === successful === 0`), no extra line. The exact display string is fixed as `Successful: $X.XX` — tests assert this literal label. |
| `client/src/components/run-cost/RunCostPanel.tsx` | Consumes the pure module's branch output; renders the optional secondary line. |
| `client/src/components/run-cost/__tests__/RunCostPanel.test.ts` | Add Vitest cases: (a) `total === successful` (any value, including both zero) → no secondary line; (b) `successful < total` AND `successful > 0` → secondary line `Successful: $X.XX` rendered with formatted dollar value; (c) `successful === 0` AND `total > 0` → secondary line `Successful: $0.00` rendered. |

**Compatibility:** the new field is additive on the response. Existing consumers that ignore it continue to work. Existing `RunCostPanelPure` callers receive an optional new branch output and ignore it.

### 6.2 H3 — `runResultStatus='partial'` coupling to summary presence

Status verification only. Code at `runLifecycle/complete.ts:106` + `:206-208` already implements the orthogonal-field pattern: `hasSummary` is no longer passed to `computeRunResultStatus`; a side-channel event emits when `!hasSummary`. Operator confirmed in launch prompt: "Default after telemetry review: keep orthogonal."

**Chunk-0 task:** verify the implementation matches the spec posture (orthogonal, no demotion on missing summary, side-channel telemetry event present). If it does, close the item with no code change. If a gap remains, surface it as a chunk.

### 6.3 §6.8 — `errorMessage` threading into `extractRunInsights`

Status verification only. Code at `runLifecycle/complete.ts:476-499` shows a `HERMES-S1` block that threads `preFinalizeRow.errorMessage` into the `extractRunInsights` call when `derivedRunResultStatus === 'failed'`. This matches the LAEL §11.4 / Hermes §6.8 contract.

**Chunk-0 task:** confirm the threading covers the same failure paths the spec calls out (the "normal terminal path" — `runLifecycle/complete.ts` is the canonical normal-terminal path post-Session-H split). If covered, close the item. If a gap remains (e.g. an alternate finalisation path that does not read `preFinalizeRow.errorMessage`), surface it as a chunk.

### 6.4 H2 — out of scope

`H2` (Slack / Whisper rollup-vs-ledger asymmetry) stays v2-backlog per launch prompt — file-overlap with completed Session H DUP9 extraction, and the consistency risk is theoretical until those paths become hot.

---

## 7. Cross-cutting requirements

### 7.1 Permissions / RLS

- All Phase 1 emissions ride on the existing `appendEvent` / `tryEmitAgentEvent` infrastructure, which already uses `withOrgTx`. No new RLS surface.
- Phase 2 `agent_execution_log_edits` table follows the same RLS shape as LAEL §7.5 (org-isolation policy + manifest entry + verified by `verify-rls-coverage.sh`).
- Phase 2 `triggeringRunId` write path runs inside the existing edit transaction; principal context already established by the edit service.
- The new `/api/agent-runs/:runId/edits` endpoint inherits `AGENTS_VIEW` at the run's tier via `resolveAgentRunVisibility`.

### 7.2 Critical-event invariant

The only critical-tier emission added in this build is `handoff.decided`. It rides the existing one-inline-retry + structured-log-on-exhaustion contract per LAEL §4.1. Emit is awaited before the handoff service returns control to the loop (post-Session-G pattern).

### 7.3 No feature flag

Per LAEL §11.5 — `feature_flags: only_for_behaviour_modes`. Emergency disable for any single emission site is `git revert` on the chunk that added it. No env-var toggle.

### 7.4 Concurrent-session deconfliction (Wave 5)

Per launch prompt:

- **Session K** (cleanup + CI): touches `llmRouter/routeCall.ts:449` (T1 metric) + `skillExecutor/handlers/tasks.ts` (W4AA-DEBT-15 await fix). This session's `llmRouter` emissions are already merged on main (`llm.requested`/`llm.completed`); this session adds **NO new emissions** in `llmRouter`. Skill-executor emissions land at the executor boundary, not in `tasks.ts`. **Conflict risk: low.**
- **Session L** (capabilities): zero overlap.
- **Session N** (prevention gates + RLS migration on `agentExecutionService`): N migrates existing queries to `getOrgScopedDb`; M adds new emission lines (`handoff.decided` in `agentRunHandoffService`, skill emissions in `skillExecutor`, etc.). Different lines, same files possible. **Conflict resolution rule:** if M lands before N starts its same-file chunks, no conflict. If N is mid-migration when M lands, N rebases M's emission additions into the post-migration query shape.

If a real conflict surfaces during builder pipeline, the architect surfaces it; operator resolves.

---

## 8. Files to change — summary table

| File | Phase | Change | New / Modify |
|---|---|---|---|
| `server/services/workspaceMemoryService/retrieve.ts` (or `hybridRetrieval.ts` — chunk-0 confirms) | P1 | emit `memory.retrieved` at hybrid-retrieval return boundary | Modify |
| `server/services/memoryBlockService.ts` | P1 | emit `memory.retrieved` at `getBlocksForInjection` return boundary | Modify |
| `server/services/middleware/decisionTimeGuidanceMiddleware.ts` | P1 | emit `rule.evaluated` after match evaluation | Modify |
| `server/services/skillExecutor.ts` | P1 | emit `skill.invoked` before dispatch + `skill.completed` in try/finally | Modify |
| `server/services/agentRunHandoffService.ts` | P1 | emit `handoff.decided` (critical, awaited) at the handoff decision point | Modify |
| `migrations/0367_agent_execution_log_edits.sql` + `.down.sql` | P2 | new table + RLS policy + indexes per LAEL §5.8 | New |
| `server/db/schema/agentExecutionLogEdits.ts` | P2 | Drizzle schema for the new table | New |
| `server/db/schema/index.ts` | P2 | re-export the new schema | Modify |
| `server/config/rlsProtectedTables.ts` | P2 | manifest entry for `agent_execution_log_edits` | Modify |
| `server/routes/memory.ts` | P2 | memory entry route — accept optional `triggeringRunId` query param; pass to edit service | Modify |
| `server/routes/memoryBlocks.ts` (chunk-0 confirms exact filename) | P2 | memory block route — accept optional `triggeringRunId` query param; pass to edit service | Modify |
| `server/routes/policyRules.ts` (chunk-0 confirms exact filename) | P2 | policy rule route — accept optional `triggeringRunId` query param; pass to edit service | Modify |
| `server/routes/dataSources.ts` (chunk-0 confirms exact filename) | P2 | data-source route — accept optional `triggeringRunId` query param; pass to edit service | Modify |
| `server/services/workspaceMemoryService.ts` (chunk-0 confirms entry-point file) | P2 | memory entry edit path — write `agent_execution_log_edits` row inside the existing edit transaction when `triggeringRunId` is supplied | Modify |
| `server/services/memoryBlockService.ts` | P2 | memory block edit path — same transactional audit-row write | Modify |
| `server/services/policyRuleService.ts` (chunk-0 confirms entry-point file) | P2 | policy rule edit path — same transactional audit-row write | Modify |
| `server/services/dataSourceService.ts` (chunk-0 confirms entry-point file) | P2 | data-source edit path — same transactional audit-row write | Modify |
| `server/routes/agentExecutionLog.ts` | P2 | new `GET /api/agent-runs/:runId/edits` endpoint — inline-only (simple SELECT with `AGENTS_VIEW` guard via `resolveAgentRunVisibility`); no new pure helper required | Modify |
| `shared/types/agentExecutionLogEdits.ts` | P2 | new — `AgentExecutionLogEdit` response type matching the API projection defined in §5.3 | New |
| `client/src/components/agentRunLog/EditedAfterBanner.tsx` | P2 | new component (LAEL §6.5 P2) | New |
| `client/src/pages/AgentRunLivePage.tsx` | P2 | render `EditedAfterBanner` for past runs only | Modify |
| `client/src/pages/agentMemory/MemoryEditDrawer.tsx` (or equivalent — chunk-0 confirms) | P2 | pass `?triggeringRunId=` through edit surface link | Modify |
| `shared/types/runCost.ts` | H1 | add `successfulCostCents` field | Modify |
| `server/routes/llmUsage.ts` | H1 | aggregate `successful_cost_cents` filter | Modify |
| `client/src/components/run-cost/RunCostPanelPure.ts` | H1 | branch logic for secondary-line render | Modify |
| `client/src/components/run-cost/RunCostPanel.tsx` | H1 | consume pure-module branch | Modify |
| `client/src/components/run-cost/__tests__/RunCostPanel.test.ts` | H1 | three new test cases per §6.1 | Modify |
| `architecture.md` | doc-sync | one-line update under agent-execution-observability noting Phase 2 audit trail + H1 field | Modify |
| `docs/capabilities.md` | doc-sync | bump customer-facing language under "Agent Supervision" if Phase 2 changes the surface from the customer perspective; otherwise no change | Modify (conditional) |
| `KNOWLEDGE.md` | doc-sync | append lesson if a finding from chunk-0 sweep is non-obvious | Modify (conditional) |

---

## 9. Testing posture

Per CLAUDE.md test-gate policy + `references/test-gate-policy.md`: pure-function Vitest only for new logic; static gates run in CI; no E2E or API-contract tests in this build.

| Module | Test |
|---|---|
| `RunCostPanelPure` | three cases per §6.1 (equal, less, zero) |
| Any new pure helper added to `agentExecutionEventServicePure` (unlikely — taxonomy already covers our events) | one case per branch |

No new tests on emission sites — they go through the existing `agentExecutionEventServicePure` validator which is already covered.

---

## 10. Chunk plan (architect-author target)

Architect's chunk-0 sweep MUST:

1. **Verify the H3 + §6.8 status claims in §3.1 + §6.2 + §6.3.** Read the actual code at the cited lines. If either is genuinely closed, drop the chunk for it. If a gap remains, write a chunk for it. Either outcome is fine; the spec is explicit about the verification step.
2. **Confirm the exact emission-call shape used by the post-Wave-4 codebase.** Check whether the codebase uses `tryEmitAgentEvent(...)` (fire-and-forget) or `await appendEvent(...)` at established critical-emission sites; align chunk plan accordingly.
3. **Confirm migration number.** Highest existing migration in `migrations/` was `0366` at branch-cut; `0367` is the expected slot. If a concurrent Wave 5 session has taken it, bump by one and note in chunk-0 spec edit.
4. **Confirm `HandlerContext` carries `runId` + tenant scope in the post-Session-H shape.** This is the load-bearing assumption for §4.3 skill emissions.
5. **Confirm `AgentRunLivePage` frontend integration surface** for the `EditedAfterBanner`. Component slot needs to exist.

Proposed chunk decomposition (architect refines):

- **Chunk 0** — sweep, verify, edit spec (always-on prep; no production code change).
- **Chunk 1** — `memory.retrieved` emissions (workspace + block).
- **Chunk 2** — `rule.evaluated` emission.
- **Chunk 3** — `skill.invoked` + `skill.completed` emissions.
- **Chunk 4** — `handoff.decided` emission (critical, awaited).
- **Chunk 5** — Phase 2 migration + schema + RLS manifest.
- **Chunk 6** — Phase 2 `triggeringRunId` plumbing on edit surfaces (routes + edit services) + the `/edits` endpoint + `shared/types/agentExecutionLogEdits.ts`.
- **Chunk 7** — Phase 2 `EditedAfterBanner` component + `AgentRunLivePage` integration.
- **Chunk 8** — H1 `successfulCostCents` (type + route + panel + pure + tests).
- **Chunk 9** — (conditional) H3 + §6.8 remediation if chunk-0 finds gaps. One or two sub-chunks depending on which gap surfaces; absent entirely if both items are verified closed.
- **Chunk 10** — doc-sync (architecture.md; capabilities.md only if surface changes).

**Chunk count reconciliation:** chunks 0–8 + 10 are always-on (10 chunks); chunk 9 is conditional. **Minimum 10 chunks; maximum 11 if H3 + §6.8 both need remediation chunks.** This matches the §2.1 ABCd "Build = S" sizing (bounded scope).

---

## 11. Deferred items

Per `docs/spec-authoring-checklist.md §7`, this section is the single source of truth for deferrals.

- **LAEL Phase 3** (retention tiering + cold archive + restore) — `[status:v2-backlog]`. Spec § §9 / §9.1. Ships when payload storage cost > threshold.
- **Hermes H2** (Slack / Whisper rollup-vs-ledger asymmetry) — `[status:v2-backlog]`. File-overlap risk with completed DUP9 extraction; theoretical consistency risk until those paths become hot.
- **LAEL deferred items 1–6** from canonical spec §9 — admin-visible drop/gap metrics, trigger-based FK enforcement, `run.created` event, causal grouping, deeper layer attributions, per-run kill-switch — all stay deferred.
- **Skill edit audit trail** — Phase 2 covers memory, rule, data-source. Skills are excluded because system skills are not user-editable and org/subaccount skills go through a separate review flow.
- **Diff viewer in `EditedAfterBanner`** — v1 shows summary + link to entity history; structural diff deferred.
- **Cross-run edit search** — deferred to a follow-up search surface.

---

## 12. Self-consistency check

| Goal | Mechanism |
|---|---|
| Close LAEL-P1-1 (`llm.requested`/`llm.completed`) | already merged — `llmRouter/routeCall.ts` (§3.1). Verified by chunk-0. |
| Close LAEL-P1-2 (memory / rule / skill / handoff emissions) | §4.1–§4.4 |
| Close LAEL-P2 (edit audit trail) | §5 |
| Close Hermes H1 | §6.1 |
| Verify/close Hermes H3 + §6.8 | §6.2 + §6.3 (chunk-0 verification) |
| No new permission key | reuses `AGENTS_VIEW` per LAEL §7 |
| No feature flag | per `commit_and_revert` rollout |
| RLS coverage | new table in manifest in same migration |
| Concurrent-session deconfliction | §7.4 (K, L, N coordination) |

---

*End of spec — Wave 5 Session M.*
