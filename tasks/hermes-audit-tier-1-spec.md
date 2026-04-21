# Hermes Audit — Tier 1 Spec

**Status:** Draft, ready for implementation
**Task classification:** Significant (multiple domains: UI, memory, cost enforcement)
**Target branch:** `claude/hermes-agent-patterns-2s4eH`
**Last main integration:** `028f665` (2026-04-21) — includes `SystemPnlPage.tsx`, which retires Tier 1 item #4 from the original Hermes audit recommendation.

## Contents

1. Summary
2. Motivation — what Hermes surfaced
3. In scope / Out of scope
4. File inventory
5. Phase A — Per-run cost panel
6. Phase B — Success-gated memory promotion
7. Phase C — LLM router cost-breaker wire-up
8. Contracts (types, schemas, API shapes)
9. Testing posture
10. Verification plan
11. Rollout, risks, deferred items
12. Appendix — audit references

---

## 1. Summary

Three surgical changes that unlock value already paid for by earlier investment. Each one closes a ghosted capability surfaced by the Hermes-audit reports. None of them introduce new schema, new tables, or new product surfaces — they wire existing data through to users, gate existing code paths on existing status signals, or call an existing primitive from one more caller.

- **Phase A — Per-run cost panel.** Expose `/api/runs/:runId/cost` (already built) on the three agent-run detail pages that currently don't read it: `AgentRunHistoryPage.tsx`, `PlaybookRunDetailPage.tsx`, `RunTraceViewerPage.tsx`. Ships a shared `RunCostPanel` component that renders total spend + LLM call count + `callSite` split.
- **Phase B — Success-gated memory promotion.** Thread `runResultStatus` and the `TrajectoryDiff.pass` signal into `workspaceMemoryService.extractRunInsights()` so that successful runs produce higher-quality semantic entries (`pattern` / `decision`) and failed runs produce `issue` entries with different decay cadence. Pin the behaviour with pure tests.
- **Phase C — LLM router cost-breaker wire-up.** Call `assertWithinRunBudget()` from `llmRouter.routeCall()` immediately after each LLM cost is recorded. The breaker already exists (`server/lib/runCostBreaker.ts`, T23) and is called by Slack and Whisper services; adding the LLM path closes the dominant cost surface for runaway agent loops.

All three items share the same work-scope boundary (one backend service, one router helper, one shared React component, three page wire-ups) and the same testing substrate (`server/services/__tests__/`). They can be implemented and reviewed in a single session.

## 2. Motivation — what Hermes surfaced

The Hermes audit (Claude and ChatGPT reports, 2026-04-21) pointed at four patterns Hermes Agent gets right. Three of them turn out to be ghosted in our codebase — the infrastructure is built, the data is captured, but the value is not reaching the user:

1. **Transparent per-task cost.** Hermes's headline win is the user knowing what each task cost. The audit confirmed we capture every cost dimension in `llm_requests` and expose `/api/runs/:runId/cost`; the failure is UI-only. See `server/routes/llmUsage.ts:347`.
2. **On-success memory promotion.** Hermes claims to promote successful task outcomes to durable memory. The audit confirmed we call `extractRunInsights()` unconditionally on every completion regardless of outcome — with a generic `observation` entry, no `runResultStatus` branch, no distillation quality bump. See `server/services/agentExecutionService.ts:1305` and `workspaceMemoryService.ts:696`.
3. **Cost caps that actually cap.** Hermes exposes token/cost ceilings as first-class configuration. The audit confirmed we store `subaccountAgents.maxCostPerRunCents` and built the `runCostBreaker` primitive; but the primary cost-incurring surface (LLM calls) does not call the breaker — only Slack and Whisper services do. A runaway agentic loop today can blow past the configured cap.

The fourth audit item — a System-level P&L page — landed on main in commit `30fce22` ahead of this spec.

Tier 1 as defined here is the minimum work that makes the existing investment visible and enforceable. None of it requires new product surface, new schema, or new review cycles from reviewers outside engineering.

## 3. In scope / Out of scope

### In scope

- Read `/api/runs/:runId/cost` from `AgentRunHistoryPage.tsx`, `PlaybookRunDetailPage.tsx`, `RunTraceViewerPage.tsx`.
- Factor the existing `AdminAgentEditPage.tsx` cost rendering into a shared `client/src/components/run-cost/RunCostPanel.tsx`. Page-level consumers call the shared component.
- Extend the per-run cost API response to include `callSite` split (`app` vs `worker`) and LLM call count — this data already exists in `cost_aggregates` and `llm_requests`; we just surface it.
- Thread `runResultStatus` ('success' | 'partial' | 'failed') and an optional `trajectoryPassed` boolean into `extractRunInsights()`.
- Branch extraction behaviour on those signals (detailed in Phase B below).
- Call `assertWithinRunBudget` from inside `llmRouter.routeCall` after the cost row is written, once per call.
- Handle the no-`runId` case gracefully (system / analyzer callers don't have a run context and must not be blocked by the breaker).
- Unit tests for pure extraction logic, integration tests for breaker enforcement, component tests for the cost panel.

### Out of scope — do not creep

- New product surfaces (no new pages, no new routes except read-only expansion of the existing cost endpoint).
- New database tables or columns.
- Changes to the ledger shape, the router contract, or the budget reservation mechanism.
- End-client-facing cost visibility (stays agency-internal — see audit non-goal).
- "Cheaper model was available" post-call hinting (Tier 3 item #9, explicitly deferred).
- Per-task / per-run cost visible on the **end client** portal (`PortalPage.tsx` stays untouched).
- Any change to `extractEntities()` or the briefing-update pg-boss job at `agentExecutionService.ts:1329`.
- Any change to `assertWithinRunBudget`'s own signature or threshold logic — we only add a caller.
- Any change to `SystemPnlPage.tsx` — that page is already live and not in scope here.

### Non-goals — durable

- This spec does not move us toward a personal-agent framing. No changes to UI copy or marketing surfaces. Every new surface is an operator-facing affordance for an agency managing multiple sub-accounts.
- This spec does not touch the Playbooks system, recurring-task detection, or reflection loops. Those are Tier 2 and require a separate spec.

---

## 4. File inventory

Locked at spec-draft time. If a phase needs a file not on this list, stop and update the spec before editing. "New" means the file does not exist today; "modify" means an existing file is edited; "delete" is not used in this spec.

### 4.1 Phase A — Per-run cost panel

| Action | Path | Role |
|---|---|---|
| New | `client/src/components/run-cost/RunCostPanel.tsx` | Shared React component. Props: `runId: string`, `compact?: boolean`. Fetches `/api/runs/:runId/cost`, renders total spend (USD), LLM call count, `callSite` split (app vs worker) when `compact=false`. Handles loading and error states inline — no toasts, no spinners-in-toasts. |
| New | `client/src/components/run-cost/RunCostPanel.test.tsx` | Component tests using React Testing Library. Covers loading, error, zero-cost, non-zero-cost, app-only, worker-only, mixed `callSite` cases. |
| Modify | `client/src/pages/AgentRunHistoryPage.tsx` | Import and render `<RunCostPanel runId={run.id} compact />` inside each expanded run row. Replace any inline cost fetch if present. |
| Modify | `client/src/pages/PlaybookRunDetailPage.tsx` | Render `<RunCostPanel runId={runId} />` (non-compact) in the run detail header summary row. |
| Modify | `client/src/pages/RunTraceViewerPage.tsx` | Render `<RunCostPanel runId={runId} />` (non-compact) in the trace header strip. |
| Modify | `client/src/pages/AdminAgentEditPage.tsx` | Replace the inline cost fetch at `AdminAgentEditPage.tsx:1697-1702` with `<RunCostPanel runId={expandedId} compact />`. Remove the `runCosts` state map now that the component owns its fetch. |
| Modify | `server/routes/llmUsage.ts` | Extend the `/api/runs/:runId/cost` handler at line 347 to also return `callSiteBreakdown: { app: { costCents, requestCount }, worker: { costCents, requestCount } }` and `llmCallCount: number`. Data exists in `llm_requests` (columns `callSite`, `costWithMarginCents`, `runId`). No schema change. |
| Modify | `shared/types/runCost.ts` | New shared type `RunCostResponse` with fields: `entityId`, `totalCostCents`, `requestCount`, `llmCallCount`, `callSiteBreakdown`. Create the file if it doesn't exist; else add the type. |
| Modify | `server/routes/__tests__/llmUsage.test.ts` | Add tests for the extended response shape. Create the file if it doesn't exist. |

**Total: 1 new component, 1 new test file, 4 page modifications, 1 route handler modification, 1 shared type addition, 1 route test. ~500 LoC.**

### 4.2 Phase B — Success-gated memory promotion

| Action | Path | Role |
|---|---|---|
| Modify | `server/services/agentExecutionService.ts` | (a) Compute and persist `runResultStatus` when writing the run completion row (around line 1175 where `status: finalStatus` is written). Mapping: `finalStatus === 'completed' && !hadUncertainty && !errorMessage` → `'success'`; `finalStatus === 'failed' \|\| finalStatus === 'timeout' \|\| finalStatus === 'loop_detected' \|\| finalStatus === 'budget_exceeded'` → `'failed'`; else → `'partial'`. (b) Pass the computed `runResultStatus` plus any available `trajectoryPassed: boolean \| null` into the `extractRunInsights` call at line 1307. |
| Modify | `server/services/workspaceMemoryService.ts` | Extend `extractRunInsights(...)` signature at line 696 to accept an `outcome: { runResultStatus: 'success' \| 'partial' \| 'failed'; trajectoryPassed: boolean \| null }` parameter. Branch extraction behaviour per §6 Phase B below. Do NOT modify the `deduplicateEntries` or `classifyDomainTopic` helpers. |
| New | `server/services/workspaceMemoryServicePure.ts` | Extract the quality-scoring + entry-type-selection logic from `extractRunInsights` into a pure module: `scoreForOutcome(baseScore, entryType, outcome)` and `selectPromotedEntryType(rawEntryType, outcome)`. Keeps impure DB + LLM calls in the service file; moves decision logic to a file that can be tested without mocks. |
| New | `server/services/__tests__/workspaceMemoryServicePure.test.ts` | Pinned tests covering the full decision matrix: (success × each entryType) × (pass/fail/null trajectory) × (failure × each entryType). ~30-40 test cases. |
| Modify | `server/db/schema/workspaceMemories.ts` | No schema change — reuse existing `qualityScore` and `provenanceSourceType` columns. Phase B does not modify the schema. |
| Modify | `server/jobs/memoryEntryDecayJob.ts` | Branch decay rate by `entryType`: `observation` uses 7-day half-life; `pattern` + `decision` use 30-day half-life; `issue` uses 14-day half-life. Default remains today's single rate if no branch matches. |
| New | `server/jobs/__tests__/memoryEntryDecayJobPure.test.ts` | Pure test for per-entryType decay math. The existing `memoryEntryDecayJob.ts` may need a small pure extraction so the test can hit the math without the DB loop. |

**Total: 2 modifications, 2 new pure files, 2 new test files, 1 job modification. ~400 LoC. No schema migration.**

### 4.3 Phase C — LLM router cost-breaker wire-up

| Action | Path | Role |
|---|---|---|
| Modify | `server/services/llmRouter.ts` | After the cost row has been written to `llm_requests` inside `routeCall`, call `assertWithinRunBudget({ runId, subaccountAgentId, organisationId, correlationId })` when `runId` is present. Skip the call when `runId` is null (system / analyzer callers have no run context). The call is dynamic-imported to match the pattern in `sendToSlackService.ts:94`. |
| Modify | `server/lib/runCostBreaker.ts` | Unchanged signatures. Add a JSDoc line on `assertWithinRunBudget` noting `llmRouter.routeCall` as a canonical caller (after Phase C lands). |
| New | `server/services/__tests__/llmRouterCostBreaker.test.ts` | Integration test: (a) call exceeds cap → throws `FailureError` with `failure_reason='internal_error'` and `failure_detail='cost_limit_exceeded'`; (b) call within cap → succeeds; (c) call with `runId=null` → no breaker invocation; (d) breaker throw does NOT leave a non-`budget_blocked` status in `llm_requests` — the cost row is already written, the throw is post-write. |
| Modify | `server/services/llmRouter.ts` comment block | Document the post-cost-record ordering: write ledger row first, then assert budget. A pre-write check race-conditions with concurrent in-flight requests. |

**Total: 1 modification (router), 1 JSDoc tweak (breaker), 1 new integration test. ~150 LoC.**

### 4.4 Cross-cutting — documentation + KNOWLEDGE

| Action | Path | Role |
|---|---|---|
| Modify | `architecture.md` | (a) §184 row already references `runCostBreaker` for `maxCostPerRunCents`; extend to note `llmRouter.routeCall` as a caller. (b) §552 already lists `runCostBreaker` callers for Slack/Whisper; add LLM router. (c) §1407 run cost circuit breaker section — add LLM router to the caller table. |
| Modify | `KNOWLEDGE.md` | Append any gotchas encountered during implementation (per §3 of `CLAUDE.md`). |
| Modify | `CLAUDE.md` | Update the "Current focus" pointer at the top when the build lands. No changes during spec-draft. |

### 4.5 Files explicitly NOT modified

To prevent scope creep, these files are out of scope regardless of what the implementation uncovers:

- `client/src/pages/SystemPnlPage.tsx` and `client/src/pages/PortalPage.tsx` — cost surface is already shipped and end-client visibility stays out of scope.
- `server/services/agentRunHandoffService.ts` and `agentRunHandoffServicePure.ts` — the handoff reads `runResultStatus` but we only newly populate it upstream; no handoff logic changes.
- `server/services/memoryCitationDetector.ts` — Phase B writes the memory; citation scoring runs unchanged on what's written.
- `server/services/trajectoryService.ts` and `trajectoryServicePure.ts` — we consume `TrajectoryDiff.pass` as a read-only signal. No changes to trajectory evaluation logic.
- `migrations/` — no new migration files. Every field referenced in this spec already exists on its table.
- `server/db/schema/workspaceMemories.ts` — Phase B uses existing columns (`qualityScore`, `entryType`, `provenanceSourceType`, `qualityScoreUpdater`).
- `server/db/schema/agentRuns.ts` — Phase B writes to the existing `runResultStatus` column.
- `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts` — no new skills, no new actions.

---

## 5. Phase A — Per-run cost panel

### 5.1 Goal

Every page that shows a completed agent or playbook run must display, without extra clicks, how much that run cost in LLM spend. Today the endpoint is built and only `AdminAgentEditPage.tsx` consumes it; three other run-detail surfaces silently ignore the data.

### 5.2 Behaviour

The panel shows three things, top to bottom:

1. **Total cost.** USD to four decimal places when cost < $1, two decimal places when ≥ $1. Zero state: "— no LLM spend recorded".
2. **Call count + tokens.** "N LLM calls · Xk tokens in / Yk tokens out". Tokens from a new aggregation on the cost endpoint (below).
3. **Call-site split.** A two-row breakdown when `compact=false`: `app` (main Node process) and `worker` (background pg-boss workers / IEE). Each row shows cost and count. Hidden entirely in `compact=true`.

When the run has zero LLM calls, the panel still renders with the "no LLM spend recorded" state rather than hiding — the empty state is information too (confirms the run didn't silently drop cost rows).

### 5.3 Component contract

```tsx
interface RunCostPanelProps {
  runId: string;
  compact?: boolean; // default false; renders inline one-liner when true
}
```

The component owns its own fetch lifecycle — no parent is expected to thread the cost state through. This is what lets the existing `AdminAgentEditPage.tsx:1697-1702` inline fetch retire: the component replaces 6 lines of state management with a single JSX element.

### 5.4 API extension

`GET /api/runs/:runId/cost` today returns the row from `cost_aggregates` keyed as `(entityType='run', entityId=runId, periodType='run', periodKey=runId)`. Phase A extends the response with two computed fields that the UI needs and that the DB can return cheaply:

- `llmCallCount`: `COUNT(*) FROM llm_requests WHERE run_id = $1 AND status IN ('success', 'partial')`.
- `callSiteBreakdown`: `SELECT call_site, SUM(cost_with_margin_cents), COUNT(*) FROM llm_requests WHERE run_id = $1 AND status IN ('success', 'partial') GROUP BY call_site`.
- `totalTokensIn`, `totalTokensOut`: same grouping, sum of `tokens_in` / `tokens_out`.

The `cost_aggregates` row provides `totalCostCents` and `requestCount` unchanged for backwards compatibility. No schema change; one extra indexed query on `llm_requests(run_id)`.

Failed requests (`status IN ('error', 'timeout', 'parse_failure', 'aborted_by_caller', 'rate_limited', 'provider_unavailable')`) are excluded from the call count but counted toward `totalCostCents` if they recorded a cost. This matches the existing semantics of `cost_aggregates`.

### 5.5 Layout placement

| Page | Placement | Mode |
|---|---|---|
| `AgentRunHistoryPage.tsx` | Inside the expanded run row, below the status line, above the message history | `compact` |
| `PlaybookRunDetailPage.tsx` | In the run header summary row, to the right of the status badge | non-compact |
| `RunTraceViewerPage.tsx` | In the trace header strip, alongside duration + model | non-compact |
| `AdminAgentEditPage.tsx` | Replaces the inline fetch at lines 1697-1702; renders beside expanded run entries | `compact` |

No tooltip, no popover, no "learn more" link. The panel is static information, not an interactive surface.

### 5.6 Loading + error states

- Loading: skeleton placeholder matching the final layout, not a spinner. Uses the `bg-[linear-gradient(...)]` shimmer pattern already present in `AgentRunHistoryPage.tsx:1705`.
- Error: inline line "Cost data unavailable" in muted text. No toast, no retry button. A 404 or 500 on `/api/runs/:runId/cost` is rare; when it happens it's almost always a permission issue that will resolve on page reload. Don't surface it aggressively.
- Stale-while-revalidate: no revalidation. Cost is write-once-per-run after completion; there's no reason to refetch on window focus.

### 5.7 Permissions

Endpoint already verifies `run.organisationId === req.orgId` at `llmUsage.ts:354-357`. No new permission check; the component fetches with the same credentials as the host page. Sub-account-level scoping is handled by the `runId` being unguessable plus the org check.

### 5.8 Accessibility

- Numeric values rendered in a `<dl>` (description list) with `<dt>` label + `<dd>` value pairs so screen readers announce field names.
- The call-site split uses a `<table>` not a flex layout.
- All cost strings include the currency symbol (`$0.47`), not bare numbers.

### 5.9 Done criteria for Phase A

1. On `AgentRunHistoryPage.tsx` and `PlaybookRunDetailPage.tsx` and `RunTraceViewerPage.tsx`, a completed run shows total cost + call count + (for non-compact) call-site split without any extra user action.
2. `AdminAgentEditPage.tsx` no longer has an inline cost fetch; the `runCosts` state map is gone.
3. `RunCostPanel.test.tsx` passes the full matrix of states (loading, error, zero, non-zero, app-only, worker-only, mixed).
4. The extended `/api/runs/:runId/cost` response shape is covered by `llmUsage.test.ts`.
5. `npm run lint` and `npm run typecheck` pass.
6. Manual verification: open a completed run on a dev org, confirm the numbers match the System P&L page's aggregate for that run.

---

## 6. Phase B — Success-gated memory promotion

### 6.1 Goal

Distil successful agent runs into higher-quality, longer-lived semantic memory (`pattern` / `decision`) and keep failures as shorter-lived `issue` entries that feed future failure-avoidance — without introducing a new extraction pipeline or a second LLM call. One LLM call per run, same as today; the branching is entirely in post-processing.

### 6.2 Latent bug surfaced during spec draft

`agent_runs.runResultStatus` is declared on the schema (`server/db/schema/agentRuns.ts:46`) with type `'success' | 'partial' | 'failed'`, is consumed by `agentRunHandoffServicePure.ts:63`, and has test fixtures in `agentRunHandoffServicePure.test.ts`. However, **it is never written** by `agentExecutionService.ts` — `grep "runResultStatus"` across the service file returns zero matches. This is a pre-existing latent bug; Phase B cannot branch on a field that is always `null`.

Phase B fixes this in-passing. The field gets populated at the same place `status: finalStatus` is already written (around line 1175), using the derivation rule in §6.3. This is not scope creep — the field was specified to be populated; Phase B just finally populates it.

### 6.3 `runResultStatus` derivation rule

Applied at run completion inside `agentExecutionService.ts::finishLoop` where `finalStatus` is computed:

| Input | Output |
|---|---|
| `finalStatus === 'completed'` AND `!errorMessage` AND `!hadUncertainty` AND `loopResult.summary` is non-empty | `'success'` |
| `finalStatus === 'completed'` AND (`hadUncertainty` OR `errorMessage` OR empty summary) | `'partial'` |
| `finalStatus === 'failed'` OR `'timeout'` OR `'loop_detected'` OR `'budget_exceeded'` OR `'cancelled'` | `'failed'` |
| `finalStatus IN ('pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification')` | leave `null` (run not terminal) |
| `finalStatus === 'completed_with_uncertainty'` | `'partial'` |

This derivation is a pure function `computeRunResultStatus(finalStatus, hasError, hadUncertainty, hasSummary): 'success' \| 'partial' \| 'failed' \| null` and lives in a new `agentExecutionServicePure.ts` or an appropriate existing pure file. The test suite pins the full truth table.

### 6.4 `extractRunInsights` extended signature

Current signature (`workspaceMemoryService.ts:696`):

```ts
async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  taskSlug?: string,
): Promise<void>
```

New signature:

```ts
async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  outcome: {
    runResultStatus: 'success' | 'partial' | 'failed';
    trajectoryPassed: boolean | null;
  },
  taskSlug?: string,
): Promise<void>
```

The `outcome` parameter is required — callers must supply it. There is only one caller today (`agentExecutionService.ts:1307`), so breakage is contained.

`trajectoryPassed` is sourced from the nearest `trajectoryService` evaluation for the run if one exists, else `null`. The extraction path does not trigger a trajectory evaluation; it reads the already-computed verdict. When no trajectory reference exists for the run (most organic agent runs), `trajectoryPassed` is `null` and has no effect on scoring.

### 6.5 Decision matrix — entry type + quality score

The current extraction path asks the LLM to classify each insight as `observation | decision | preference | issue | pattern`. Phase B respects the LLM's classification but applies a post-processing rule that:

1. Promotes low-confidence `observation` entries to `pattern` or `decision` when the outcome signals high confidence.
2. Demotes any entry type to `issue` when the outcome is a failure.
3. Boosts `qualityScore` for successful outcomes, dampens for failures.

Full matrix:

| runResultStatus | trajectoryPassed | LLM-classified entryType | Final entryType | Quality score modifier |
|---|---|---|---|---|
| `success` | `true` | `observation` | `pattern` (promoted) | +0.20 |
| `success` | `true` | `decision` | `decision` (kept) | +0.20 |
| `success` | `true` | `pattern` | `pattern` (kept) | +0.20 |
| `success` | `true` | `preference` | `preference` (kept) | +0.15 |
| `success` | `true` | `issue` | `issue` (kept — successful run still had an issue worth recording) | +0.00 |
| `success` | `null` | `observation` | `pattern` (promoted) | +0.10 |
| `success` | `null` | `decision` | `decision` (kept) | +0.10 |
| `success` | `null` | any other | kept | +0.10 |
| `success` | `false` | any | demoted to `observation` if `pattern` / `decision` (we trusted the LLM but trajectory says otherwise) | +0.00 |
| `partial` | any | any | kept, unchanged | +0.00 |
| `failed` | any | `observation` or `pattern` or `decision` | `issue` (force demoted — a failed run cannot produce a durable pattern) | −0.10 |
| `failed` | any | `issue` | `issue` (kept) | +0.00 (failures reinforce `issue` entries without penalty) |
| `failed` | any | `preference` | dropped — do not write (a failed run should not assert a user preference) | n/a |

Quality score modifiers apply on top of the existing `scoreMemoryEntry(entry)` baseline. Final score clamped to `[0.0, 1.0]`. The `qualityScoreUpdater` field on the row is set to `'outcome_bump'` when a modifier is applied, so downstream audits can distinguish outcome-driven scores from baseline ones.

### 6.6 Decay cadence per entry type

`memoryEntryDecayJob.ts` today applies a single decay rate across all entries. Phase B branches by type:

| entryType | Half-life (days) | Rationale |
|---|---|---|
| `observation` | 7 | Raw run signal; loses relevance quickly |
| `issue` | 14 | Useful until pattern crystallises or is resolved |
| `preference` | 30 | User-stated; stable |
| `pattern` | 30 | Distilled; long-term reusable |
| `decision` | 30 | Distilled; long-term reusable |

Implementation: the decay job reads `entryType` on each row and applies the matching half-life. The existing decay formula stays intact; only the rate parameter branches. A pure test pins the math for each entry type.

### 6.7 Provenance and updater fields

Every row Phase B writes sets:

- `provenanceSourceType = 'agent_run'` (unchanged)
- `provenanceSourceId = runId` (unchanged)
- `provenanceConfidence`: `0.9` when `runResultStatus='success' && trajectoryPassed===true`; `0.7` for plain success; `0.5` for partial; `0.3` for failure. Replaces today's `null`.
- `isUnverified = runResultStatus !== 'success'` — semantically, a non-success outcome leaves memory entries in an "needs corroboration" state.
- `qualityScoreUpdater`: `'outcome_bump'` when a modifier was applied, else `'initial_score'` (unchanged).

No schema change required — all four columns already exist.

### 6.8 Short-summary guard stays intact

The existing `if (!runSummary || runSummary.trim().length < 20) return;` guard at `workspaceMemoryService.ts:704` stays as-is. Phase B adds one further guard:

```ts
if (outcome.runResultStatus === 'failed' && !runSummary.toLowerCase().includes('fail') && runSummary.length < 100) {
  return; // Short summaries on failed runs are usually truncated errors; skip.
}
```

This prevents "Request timed out." style error blobs from being captured as `issue` memory. The guard is small and removable if it proves noisy in practice.

### 6.9 Done criteria for Phase B

1. `agent_runs.runResultStatus` is populated on every terminal run — verified by a query on a seeded dev DB returning zero null rows for terminal statuses.
2. A successful run with 3 LLM-classified insights produces 3 memory entries all with `qualityScore` ≥ 0.6 + appropriate `entryType` promotion.
3. A failed run produces only `issue` entries (no `pattern` / `decision` leakage).
4. A failed run with a summary under 100 chars and no "fail" substring skips memory writes.
5. `workspaceMemoryServicePure.test.ts` covers the full decision matrix (~30 cases) and all tests pass.
6. `memoryEntryDecayJobPure.test.ts` pins per-entryType decay.
7. `npm run lint` and `npm run typecheck` pass.

---

## 7. Phase C — LLM router cost-breaker wire-up

### 7.1 Goal

A runaway agent loop cannot blow through the configured `maxCostPerRunCents` ceiling. Today it can — the breaker exists, but the LLM call path (the dominant cost surface) never invokes it. Slack and Whisper calls are correctly gated. LLM calls are not.

### 7.2 The existing primitive

`server/lib/runCostBreaker.ts` ships three exports — all unchanged by Phase C:

- `resolveRunCostCeiling(ctx)` — reads `subaccountAgents.maxCostPerRunCents` (with fallback to a system default of 100 cents).
- `getRunCostCents(runId)` — reads running spend from `cost_aggregates`.
- `assertWithinRunBudget(ctx)` — throws `FailureError('internal_error', 'cost_limit_exceeded', {...})` when spent > limit.

Callers today:

- `server/services/sendToSlackService.ts:94`
- `server/services/transcribeAudioService.ts:72`

Callers missing:

- `server/services/llmRouter.ts::routeCall` — the gap Phase C closes.

### 7.3 Where to insert the call

Inside `routeCall`, after the ledger row is successfully inserted (currently at line 777-ish of the post-call success path) and before the provider response is returned to the caller. Three ledger-write paths exist in the router: the early-fail path (~line 461), the budget-blocked path (~line 669), and the post-call path (~line 777). Phase C wires the breaker only on the post-call path — the budget-blocked path already represents a cap trip of a different kind, and the early-fail path has no cost to check against.

Pseudocode at the insertion point:

```ts
// ── 12. Write ledger (existing) ────────────────────────────────
await db.insert(llmRequests).values({ ... });

// ── 12a. Phase C — runaway-loop ceiling ────────────────────────
if (ctx.runId) {
  const { assertWithinRunBudget } = await import('../lib/runCostBreaker.js');
  await assertWithinRunBudget({
    runId: ctx.runId,
    subaccountAgentId: ctx.subaccountAgentId ?? null,
    organisationId: ctx.organisationId,
    correlationId: ctx.correlationId ?? idempotencyKey,
  });
}

// ── 13. Return to caller (existing) ───────────────────────────
return providerResponse;
```

Dynamic import matches the existing pattern in `sendToSlackService.ts` — avoids a module-cycle hazard with the router.

### 7.4 Ordering invariant — ledger write first, breaker check second

The ledger row is written **before** the breaker runs. Reasons:

1. **Cost attribution integrity.** The money was already spent with the provider; we must record it regardless of whether the breaker trips.
2. **Race safety.** A pre-write breaker check would use a stale `cost_aggregates` snapshot — concurrent in-flight requests reserve against the same run would pile onto the same "within-budget" reading and all fire. Post-write, each concurrent request's own cost row is visible to the check, and the Nth request is guaranteed to trip.
3. **Consistency with existing callers.** `sendToSlackService.ts` and `transcribeAudioService.ts` already check post-cost-record. Matching that pattern prevents the breaker from having two behaviours.

A comment block at the insertion point documents this ordering so a future refactor doesn't invert it.

### 7.5 When to skip the breaker

The breaker is skipped — not applied and not throwing — when `ctx.runId` is null. This covers:

- `sourceType === 'system'` callers (internal maintenance tasks that don't belong to any run).
- `sourceType === 'analyzer'` callers (skill analyzer rollups that operate on historical data).
- Any future system caller that legitimately has no run context.

The router's existing contract guards already enforce that `runId` is present for `sourceType === 'agent_run'` and that `ieeRunId` is present for `sourceType === 'iee'`. IEE runs are handled by mapping `ctx.ieeRunId` to the parent `runId` via the existing `iee_runs` lookup — see §7.6.

### 7.6 IEE run handling

IEE runs (`sourceType === 'iee'`) set `ieeRunId` but may or may not have `runId`. The breaker needs a `runId` to look up the per-run cost aggregate. Resolution rule:

- If `ctx.runId` is set, use it.
- Else if `ctx.ieeRunId` is set, resolve `agent_run_id` from `iee_runs` via a single indexed query.
- Else skip the breaker (should not happen per contract guards).

The resolution query is cached for the duration of the `routeCall` invocation — no need to re-resolve for each provider call in a retry chain.

### 7.7 Failure payload shape

When the breaker trips, it throws `FailureError` with:

```ts
{
  reason: 'internal_error',
  detail: 'cost_limit_exceeded',
  context: {
    spentCents: number,
    limitCents: number,
    runId: string,
    correlationId: string,
  }
}
```

This shape is already pinned by the breaker; Phase C does not change it. The caller (agent execution loop) already handles `FailureError` — a breaker trip causes the run to terminate with `finalStatus='budget_exceeded'`, which per §6.3 maps to `runResultStatus='failed'`, feeding Phase B's failure path.

### 7.8 Observability

The breaker emits `costBreaker.exceeded` structured logs (existing behaviour). Phase C adds no new log lines. The breaker trip shows up on the System P&L page's top-expensive-calls table as a run with a spike in spend immediately before termination — this is already supported by the existing dashboards.

### 7.9 Done criteria for Phase C

1. `llmRouter.routeCall` calls `assertWithinRunBudget` after every successful ledger write where `runId` is resolvable.
2. A test run with `maxCostPerRunCents=50` and a prompt that would exceed it trips the breaker within one extra call of the ceiling.
3. A system-level caller (no `runId`) is unaffected — no breaker, no error.
4. An IEE caller with only `ieeRunId` resolves to its parent `runId` and trips the breaker correctly.
5. Concurrent in-flight requests on the same run cannot collectively exceed the ceiling by more than one call's cost (at most one "overshoot" call per concurrent batch, matching the Slack/Whisper invariant).
6. `llmRouterCostBreaker.test.ts` covers the four scenarios above.
7. `npm run lint`, `npm run typecheck`, and the focused router test file all pass.

### 7.10 What Phase C does NOT do

- Does not change `maxCostPerRunCents` defaults or add new UI for configuring them.
- Does not change the breaker's signature, threshold logic, or log format.
- Does not introduce per-call cost caps (only per-run). Per-call caps are a different ceiling and out of scope.
- Does not add pre-flight cost estimation. The breaker is post-facto; pre-flight is a Tier 3 concern.
- Does not gate `sourceType='analyzer'` or `sourceType='system'` calls. Those callers are trusted internal tooling with their own observability surfaces.

---

## 8. Contracts

This section is the single source of truth for every type, API shape, and DB field touched by the spec. If an implementer introduces a shape that doesn't appear here, stop and amend the spec.

### 8.1 Shared types

**`shared/types/runCost.ts`** (new file):

```ts
export interface CallSiteBreakdownEntry {
  costCents: number;
  requestCount: number;
}

export interface RunCostResponse {
  entityId: string;                   // runId
  totalCostCents: number;
  requestCount: number;               // from cost_aggregates (existing semantics)
  llmCallCount: number;               // NEW — count of successful + partial llm_requests
  totalTokensIn: number;              // NEW
  totalTokensOut: number;             // NEW
  callSiteBreakdown: {                // NEW
    app: CallSiteBreakdownEntry;
    worker: CallSiteBreakdownEntry;
  };
}
```

Existing consumers that only read `totalCostCents` / `requestCount` are not broken — the extension is additive.

### 8.2 API shape — `GET /api/runs/:runId/cost`

**Current response (Phase A-pre):**
```json
{ "entityId": "run-uuid", "totalCostCents": 47, "requestCount": 3 }
```
or, for zero-call runs:
```json
{ "entityId": "run-uuid", "totalCostCents": 0, "requestCount": 0 }
```

**Phase A response:**
```json
{
  "entityId": "run-uuid",
  "totalCostCents": 47,
  "requestCount": 3,
  "llmCallCount": 3,
  "totalTokensIn": 12450,
  "totalTokensOut": 1820,
  "callSiteBreakdown": {
    "app": { "costCents": 47, "requestCount": 3 },
    "worker": { "costCents": 0, "requestCount": 0 }
  }
}
```

Auth: `authenticate` middleware (existing). Org scoping: the existing check at `llmUsage.ts:354-357` verifying `run.organisationId === req.orgId`. No new permission; no new middleware.

### 8.3 Service signatures

**`workspaceMemoryService.extractRunInsights`** — extended (Phase B):

```ts
interface RunOutcome {
  runResultStatus: 'success' | 'partial' | 'failed';
  trajectoryPassed: boolean | null;
}

async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  outcome: RunOutcome,
  taskSlug?: string,
): Promise<void>
```

**`workspaceMemoryServicePure` exports** (new file, Phase B):

```ts
export const HALF_LIFE_DAYS: Record<EntryType, number> = {
  observation: 7,
  issue: 14,
  preference: 30,
  pattern: 30,
  decision: 30,
};

export function selectPromotedEntryType(
  raw: EntryType,
  outcome: RunOutcome,
): EntryType | null;  // null means "drop this entry"

export function scoreForOutcome(
  baseScore: number,
  entryType: EntryType,
  outcome: RunOutcome,
): number;  // clamped to [0, 1]

export function computeProvenanceConfidence(outcome: RunOutcome): number;
```

**`agentExecutionServicePure.computeRunResultStatus`** (new helper):

```ts
export function computeRunResultStatus(
  finalStatus: string,
  hasError: boolean,
  hadUncertainty: boolean,
  hasSummary: boolean,
): 'success' | 'partial' | 'failed' | null;
```

See §6.3 for the truth table.

**`llmRouter.routeCall`** — signature unchanged (Phase C). Only body gains the breaker call.

**`runCostBreaker` exports** — signatures unchanged (Phase C). JSDoc gains a new caller entry.

### 8.4 DB field usage

No migrations. Every column referenced below exists today.

| Column | Table | Status before | Status after Phase B |
|---|---|---|---|
| `runResultStatus` | `agent_runs` | Declared, never written | Written on every terminal run |
| `qualityScore` | `workspace_memory_entries` | Written by `scoreMemoryEntry` | Written by `scoreMemoryEntry` + outcome modifier |
| `qualityScoreUpdater` | `workspace_memory_entries` | `'initial_score'` unconditionally | `'outcome_bump'` when modifier applied |
| `provenanceConfidence` | `workspace_memory_entries` | `null` unconditionally | Set per §6.7 |
| `isUnverified` | `workspace_memory_entries` | `!runId` (always `false` for run-sourced) | `runResultStatus !== 'success'` |
| `entryType` | `workspace_memory_entries` | LLM classification, unchanged | LLM classification, then promoted/demoted per §6.5 |

### 8.5 Structured log events

Phase A: no new log events.

Phase B: one new log event per extraction call:
- `memory.insights.outcome_applied` with `{ runId, runResultStatus, trajectoryPassed, entriesWritten, entriesDropped, promotedCount }`. Emitted inside `extractRunInsights` after the write batch. Useful for post-hoc audit of the promotion rate on real traffic.

Phase C: no new log events; `costBreaker.exceeded` already exists in the breaker.

### 8.6 Feature flags

None. All three phases are backwards-compatible at the API level:

- Phase A is additive on the response shape — existing consumers that destructure `{ totalCostCents, requestCount }` continue to work.
- Phase B changes an internal function signature only — there is one caller and it's updated in the same commit.
- Phase C adds a call to an existing primitive — no config switch; the breaker with a missing per-agent cap falls back to `SYSTEM_DEFAULT_MAX_COST_CENTS = 100` cents, same as today.

If we later decide a feature flag is warranted for Phase C (e.g. to soft-launch the LLM breaker on a subset of orgs), we add `organisationFeatureFlags.llmBreakerEnabled` in a follow-up commit. Not included in Phase C scope.

### 8.7 Error contracts

Phase A errors:
- 404 from `/api/runs/:runId/cost` when the run doesn't belong to the caller's org — existing behaviour.
- 500 on DB failure — existing behaviour. Component shows "Cost data unavailable" per §5.6.

Phase B errors:
- Memory extraction errors are already caught non-fatally at `agentExecutionService.ts:1314-1316`. Phase B does not change this.
- A malformed `outcome` parameter is a TypeScript error, caught at compile time.

Phase C errors:
- `FailureError({ reason: 'internal_error', detail: 'cost_limit_exceeded' })` propagates to the agent execution loop, which maps it to `finalStatus='budget_exceeded'`. This is existing behaviour for Slack/Whisper breaker trips.
- `RouterContractError` is unchanged; the new breaker call sits after contract validation.

---

## 9. Testing posture

Pattern match with the existing codebase: pure logic lives in `*Pure.ts` files and is covered by unit tests with zero mocks; impure wrappers get integration tests that hit a real DB (Postgres) and exercise the end-to-end path; React components get component tests with React Testing Library.

### 9.1 Phase A tests

**`client/src/components/run-cost/RunCostPanel.test.tsx`** (new) — component tests, RTL:

| Case | Setup | Assertion |
|---|---|---|
| Loading state | Mocked API pending | Shimmer skeleton renders; no numbers visible |
| Zero cost | API returns totalCostCents: 0 | "— no LLM spend recorded" renders |
| Non-zero cost, compact | API returns $0.47, 3 calls, compact prop | Single inline line; no table |
| Non-zero cost, full | API returns $0.47, 3 calls, app-only | Call-site table shows app row with $0.47, worker row with $0.00 |
| Mixed call-site | API returns 2 app + 1 worker | Both rows visible with correct split |
| Error state | API returns 500 | "Cost data unavailable" renders |
| 404 (run not in org) | API returns 404 | "Cost data unavailable" renders; no toast |
| `compact=false` on zero run | API returns all zeros | Empty-state copy renders, table still visible but shows all zeros |

**`server/routes/__tests__/llmUsage.test.ts`** (new or extended) — integration:

| Case | Assertion |
|---|---|
| Run with 0 LLM calls | Returns `{ totalCostCents: 0, requestCount: 0, llmCallCount: 0, callSiteBreakdown: { app: { costCents: 0, requestCount: 0 }, worker: {...} } }` |
| Run with 3 successful app calls | `llmCallCount=3`, `callSiteBreakdown.app.requestCount=3`, `.worker.requestCount=0` |
| Run with 2 success + 1 error | `llmCallCount=2` (errors excluded), `requestCount` from aggregates unchanged |
| Run with 2 app + 1 worker | Both sides populated correctly |
| Run in a different org | 404 with "Run not found" — existing behaviour |
| Token totals | `totalTokensIn` and `totalTokensOut` are sums across successful + partial rows only |

### 9.2 Phase B tests

**`server/services/__tests__/workspaceMemoryServicePure.test.ts`** (new) — pure unit tests:

- `selectPromotedEntryType`: 15 cases — 5 input entryTypes × 3 runResultStatus values, with trajectoryPassed pinned per case.
- `scoreForOutcome`: 20 cases — verify bump magnitudes and clamp behaviour at boundaries (0.0, 1.0).
- `computeProvenanceConfidence`: 4 cases — success+pass, success+null, partial, failed.
- Truth table for the full matrix in §6.5 — a parameterised test that runs every row of the matrix and verifies the final entryType + score + provenanceConfidence triple.

**`server/services/__tests__/agentExecutionServicePure.test.ts`** (new or extended) — pure unit tests:

- `computeRunResultStatus`: every row of the §6.3 table.
- Edge case: `finalStatus='completed'`, summary is empty string — expect `'partial'` (not `'success'`).
- Edge case: `finalStatus='completed'`, `hadUncertainty=true` — expect `'partial'`.

**`server/jobs/__tests__/memoryEntryDecayJobPure.test.ts`** (new) — pure unit tests:

- Half-life-based decay formula: for each entryType in `HALF_LIFE_DAYS`, verify that after `T = halfLife` days, score has decayed to `base * 0.5`.
- Decay never produces negative scores.
- Decay from a 0.0 score returns 0.0 (no lower-bound bug).

**Integration sanity check** (manual, not automated):

On a dev org, trigger a successful run with a 300-char summary and 3 obvious-insight paragraphs. Confirm:
- `agent_runs.runResultStatus = 'success'` after the run finishes.
- `workspace_memory_entries` rows for that run have `qualityScore ≥ 0.6`, `qualityScoreUpdater='outcome_bump'`, `isUnverified=false`, `provenanceConfidence=0.7 or 0.9`.
- A deliberately failing run produces only `issue` entries, `isUnverified=true`, `provenanceConfidence=0.3`.

### 9.3 Phase C tests

**`server/services/__tests__/llmRouterCostBreaker.test.ts`** (new) — integration, real DB:

| Case | Setup | Assertion |
|---|---|---|
| Within-budget call | subaccountAgent with `maxCostPerRunCents=10000`, single small call | `routeCall` returns normally; ledger row present; no throw |
| Over-budget call | subaccountAgent with `maxCostPerRunCents=10`, call that costs 15 cents | `routeCall` throws `FailureError('internal_error', 'cost_limit_exceeded', {...})`; ledger row IS present (written before the throw) |
| System-level call (no runId) | `sourceType='system'`, `runId=undefined` | No breaker invocation; `routeCall` returns normally |
| Analyzer-level call (no runId) | `sourceType='analyzer'`, `sourceId` set, no runId | Same as above |
| IEE call, runId resolvable | `sourceType='iee'`, `ieeRunId` set, parent `runId` exists in `iee_runs` | Breaker resolves and applies |
| Concurrent overshoot | 3 parallel calls on same run, each costs 40 cents, ceiling is 100 | Maximum 1 call overshoots (total spend ≤ ~140 cents); at most 2 calls succeed, at least 1 throws |
| Missing `subaccountAgentId` | Call without per-agent link | Breaker falls back to `SYSTEM_DEFAULT_MAX_COST_CENTS` (100 cents) |

Concurrency test uses real `await Promise.all([...])` against a seeded DB — not mocks. The breaker's guarantee is probabilistic at a fine grain but absolute in aggregate: concurrent requests can overshoot by at most one call's cost before all subsequent calls trip.

### 9.4 Verification commands

Per CLAUDE.md "Verification Commands":

```bash
npm run lint            # required — all three phases
npm run typecheck       # required — all three phases
npm run test -- --testPathPattern='workspaceMemory|runCost|llmRouter|memoryEntryDecay|agentExecutionServicePure'  # focused run
npm run build           # required — Phase A is client-side
```

No `npm run db:generate` because no schema change.

### 9.5 Gate order during implementation

1. Ship Phase C first. Smallest surface, enforces a cost guarantee that protects the other two phases' test runs from runaway spend.
2. Ship Phase A second. Read-only UI; doesn't touch existing behaviour; immediately visible in dev.
3. Ship Phase B last. Largest semantic change; wants the cost panel from Phase A to be visible when observing test runs.

Each phase is self-contained — one commit per phase is acceptable, though one-PR-multiple-commits is fine too. Review each phase with `pr-reviewer` before moving to the next.

### 9.6 Independent-review gate

Before marking the work done and before any PR:

1. Run `pr-reviewer` against the full set of changes. Per CLAUDE.md: "For Standard, Significant, and Major tasks — invoke `pr-reviewer` before marking done."
2. Persist the review log verbatim to `tasks/pr-review-log-hermes-tier-1-<ISO-timestamp>.md` per CLAUDE.md §"Review logs must be persisted".
3. Address blocking findings before PR creation. Non-blocking findings can be triaged into the follow-up queue.
4. `dual-reviewer` is optional and local-dev-only. Do not auto-invoke. Only run if the user explicitly asks.

---

## 10. Verification plan

End-to-end sanity walk, performed on a dev org with real seed data before declaring the spec done:

1. **Phase C sanity.** Set a dev subaccountAgent's `maxCostPerRunCents=10`. Trigger an agent run that calls an LLM. Confirm the run terminates with `finalStatus='budget_exceeded'`, `runResultStatus='failed'` (once Phase B lands), and the last `llm_requests` row is recorded with the overshoot cost.
2. **Phase A sanity.** Open `AgentRunHistoryPage`, `PlaybookRunDetailPage`, `RunTraceViewerPage`, and `AdminAgentEditPage` on the same run. All four render the `RunCostPanel` without console errors. Numbers are consistent across surfaces.
3. **Phase B sanity, happy path.** Trigger a successful multi-step run with a meaningful summary. Query `workspace_memory_entries` for that run. Confirm:
   - At least one row has `entryType='pattern'` or `'decision'`.
   - `qualityScore ≥ 0.6` on promoted rows.
   - `provenanceConfidence` is 0.7 or 0.9.
   - `isUnverified=false`.
4. **Phase B sanity, failure path.** Cancel a running agent mid-loop. Confirm the run marks `runResultStatus='failed'`. Query memory — either zero new rows (short-summary guard) or only `issue` rows.
5. **Phase B sanity, partial path.** Trigger a run that ends with `completed_with_uncertainty` (ask_clarifying_question flow). Confirm `runResultStatus='partial'`, memory entries neither promoted nor force-demoted.
6. **Regression: Phase C does not break existing callers.** Run the Slack and Whisper integration tests; confirm they still pass (they test the same breaker from a different caller).
7. **Regression: Phase A does not break System P&L.** Open the existing `/system/llm-pnl` page and verify numbers unchanged.
8. **Regression: Phase B does not break handoff.** Open an agent run's handoff JSON. Confirm `runResultStatus` is populated and the handoff service renders the new field correctly.

---

## 11. Rollout, risks, deferred items

### 11.1 Rollout

No feature flag. No phased rollout. The three phases land sequentially on the same branch, each gated by `pr-reviewer`. Once all three merge, a single deploy rolls them out to all orgs simultaneously.

Reasoning:
- Phase A is read-only — worst case is a cost panel renders incorrect numbers (visible, recoverable).
- Phase B affects new memory entries only — existing memory rows are not rewritten; a rollback would stop creating promoted entries but leave promoted ones intact with their modifiers (they remain valid — the score bumps are stored absolutes, not relative).
- Phase C enforces a ceiling that was already configurable — an org whose current runs regularly exceed `maxCostPerRunCents` will start seeing breaker trips. This is the intended behaviour (the ceiling was aspirational before; Phase C makes it real). Mitigate by checking P&L before deploy for any org whose 95th-percentile run cost approaches their configured `maxCostPerRunCents` and raising the cap first.

### 11.2 Pre-deploy checklist

1. `npm run lint && npm run typecheck && npm run test` — all green.
2. Query production: `SELECT subaccount_agent_id, MAX(cost_cents) FROM cost_aggregates WHERE entity_type='run' AND period_type='run' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;` — any agent whose top spend is within 80% of its `maxCostPerRunCents` gets flagged for manual cap review before Phase C rolls out.
3. Verify the System P&L page still loads (`/system/llm-pnl`) — smoke-test after deploy.

### 11.3 Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase C trips for a legitimately expensive production run | Medium | High (run terminates mid-work) | Pre-deploy cap review per §11.2 step 2; any agent with `maxCostPerRunCents` set at system default (100 cents = $1) is likely incorrectly configured — flag those for the org admin before deploy |
| Phase B promotes low-quality insights because the LLM classified them optimistically | Low | Low (one spurious `pattern` entry decays in 30 days) | `memoryCitationDetector` will down-weight uncited entries; decay removes unused entries; no user-facing impact unless the entry gets repeatedly injected without citation |
| Phase A shows cost that disagrees with System P&L | Low | Medium (confusing; erodes trust) | Integration test in §9.1 verifies the extended endpoint matches `cost_aggregates` totals. Manual sanity step in §10 cross-checks against the P&L page |
| `runResultStatus` derivation puts too many runs in `'partial'` | Medium | Low | The truth table is pinned in tests; if real traffic surprises us we re-tune the rule in a follow-up. No blocker |
| Concurrent LLM calls on the same run all pass the breaker check and collectively overshoot | Low | Low | Post-ledger-write ordering means each call sees its own row. Concurrency test in §9.3 verifies max one overshoot per concurrent batch |
| Dynamic import of `runCostBreaker` in a hot path adds latency | Low | Negligible | Slack and Whisper services already use the same dynamic-import pattern; Node caches the module after first load |

### 11.4 Deferred items

Explicitly NOT part of this spec; captured here as pointers for follow-up specs:

1. **Cheaper-model post-call hints (Tier 3 #9 in the audit).** The ledger has the data; the UI surface is now ready (Phase A). Next spec decides whether to surface this in `RunCostPanel` or in a new P&L drawer.
2. **Pre-flight cost estimation.** A breaker is post-facto. A pre-flight cost estimate would be more polite — "this call would push you over your cap; here are options". Requires work on the prompt-sizing side and a new confirm-or-abort flow.
3. **Per-call cost caps (separate from per-run caps).** Today we only cap per-run. A per-call cap would prevent a single runaway prompt from blowing the per-run budget in one shot. Consider after Phase C lands and we see real breaker-trip data.
4. **End-client cost visibility.** Out of scope per non-goals. Phase A's `RunCostPanel` is agency-internal only.
5. **Ledger schema extension for prompt-caching cost attribution.** Separate forthcoming spec (cached-context infrastructure brief) will extend `llm_requests` with `cacheReadInputTokens`, `cacheCreationInputTokens`, `cacheCreationEphemeral5mInputTokens`, `cacheCreationEphemeral1hInputTokens`. When that lands, Phase A's `RunCostPanel` can surface cache hit rate with a small component change. Flagged here so that spec knows `RunCostPanel` is the natural display surface.
6. **Trajectory-driven success signal automation.** Phase B reads `trajectoryPassed` as a read-only signal. Expanding trajectory evaluation to fire automatically on every run (not just IEE and integration tests) is Tier 2+ work.
7. **Scheduled reflection loop (Tier 2 of the audit).** Out of scope; needs its own spec. Will consume the cleaned-up `runResultStatus` signal landed by Phase B.
8. **Run-embedding for recurring-task detection (Tier 2 of the audit).** Out of scope; needs its own spec. Independent of Tier 1.

### 11.5 Success metric (post-deploy observation)

A week after rollout, check:

1. **Phase A adoption.** Page-view logs confirm the affected run-detail pages are hit; no error spikes from `/api/runs/:runId/cost`.
2. **Phase B health.** `SELECT entry_type, COUNT(*) FROM workspace_memory_entries WHERE created_at > now() - interval '7 days' GROUP BY 1`. Expect `pattern` + `decision` to rise as a share of total writes; expect `issue` to appear on failed runs; expect `observation` to decline (because successful runs now promote).
3. **Phase C effectiveness.** `SELECT COUNT(*) FROM llm_requests WHERE status='success' AND created_at > now() - interval '7 days' AND run_id IN (SELECT id FROM agent_runs WHERE final_status='budget_exceeded')`. Count of breaker-caused aborts is the leading indicator. Zero trips means either nobody is configured tightly enough to trip (most likely) or a bug in the caller resolution; investigate either way.

No hard numerical target. We are primarily watching the shape of the distribution change; the value is in the capability being present, not in any specific rate.

---

## 12. Appendix — audit references

### Source material

- `tasks/hermes-audit-tier-1-spec.md` (this file).
- Claude and ChatGPT audit reports delivered via chat on 2026-04-21. Not checked in; referenced here as the origin of the Tier 1 framing.
- The four Explore-agent audits run before this spec:
  - Memory + trajectory audit findings — `workspaceMemoryService.ts:696`, `agentExecutionService.ts:1305-1326`, `trajectoryService.ts`, `memoryCitationDetector.ts`.
  - Playbooks + recurring-task audit findings — `systemPlaybookTemplates`, `playbookTemplates`, `playbookTemplateVersions` tables, no recurring-task detection surfaced (out of Tier 1 scope).
  - LLM cost audit findings — `llmRequests` schema, `/api/admin/llm-pnl/*` routes, per-run cost endpoint at `llmUsage.ts:347`, org + subaccount usage routes, `orgBudgets.monthlyCostLimitCents`.
  - Orchestrator + skills audit findings — 152 skills, `orchestratorFromTaskJob.ts`, `docs/skill-gap-analysis-v2.md`, no capability packs, no scheduled reflection.

### Key references into existing code

- `server/services/workspaceMemoryService.ts:696` — `extractRunInsights` entry point.
- `server/services/agentExecutionService.ts:1175` — `runResultStatus` write site (new).
- `server/services/agentExecutionService.ts:1305-1326` — memory extraction trigger.
- `server/db/schema/agentRuns.ts:46` — `runResultStatus` column declaration.
- `server/lib/runCostBreaker.ts:111` — `assertWithinRunBudget` export.
- `server/services/llmRouter.ts:243` — `routeCall` entry point.
- `server/services/llmRouter.ts:777` — primary ledger insert site.
- `server/routes/llmUsage.ts:347` — `/api/runs/:runId/cost` handler.
- `client/src/pages/AdminAgentEditPage.tsx:1697-1702` — existing inline cost fetch (retires in Phase A).
- `client/src/pages/SystemPnlPage.tsx` — reference for styling + data presentation conventions.

### Doc references for further context

- `architecture.md` §184 — Hard ceilings + runCostBreaker caller table.
- `architecture.md` §1407 — Run cost circuit breaker deep reference.
- `CLAUDE.md` §"Key files per domain" — where to extend when adding a new LLM consumer, a new memory writer, or a new skill.
- `CLAUDE.md` §"Long Document Writing" — reason this spec was chunked.
- `docs/spec-authoring-checklist.md` — pre-author checklist. This spec completed it mentally during drafting.
