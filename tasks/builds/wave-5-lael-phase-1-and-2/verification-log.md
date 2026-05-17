# Chunk 0 Preflight Verification Log

**Build slug:** wave-5-lael-phase-1-and-2
**Verified by:** Chunk 0 sweep
**Date:** 2026-05-16

---

## V1 — Hermes H3 orthogonality (`hasSummary` side-channel)

**Expected:** Closed — `hasSummary` declared at line 99; `run.terminal.summary_missing` emitted only when `!hasSummary` at lines 206-220.

**File read:** `server/services/agentExecutionService/runLifecycle/complete.ts` lines 90-225

**Findings:**
- Line 99: `const hasSummary = !!(loopResult.summary && loopResult.summary.trim().length > 0);`
- Lines 100-105: `computeRunResultStatus(finalStatus, ...)` — `hasSummary` is NOT passed; H3 orthogonality confirmed.
- Lines 106-107: Comment explicitly states `hasSummary` is no longer passed to `computeRunResultStatus`.
- Lines 206-220: `if (!hasSummary) { tryEmitAgentEvent({ payload: { eventType: 'run.terminal.summary_missing', ... } }) }` — side-channel emitted only on missing summary.

**Outcome:** CONFIRMED CLOSED. No code change needed.

---

## V2 — §6.8 `errorMessage` threading into `extractRunInsights`

**Expected:** Closed — `complete.ts:476-499` threads `errorMessage` into `extractRunInsights`.

**File read:** `server/services/agentExecutionService/runLifecycle/complete.ts` lines 470-510

**Findings:**
- Lines 476-480: `HERMES-S1` block: `const threadedErrorMessage = derivedRunResultStatus === 'failed' ? (preFinalizeRow?.errorMessage ?? null) : null;`
- Lines 481-493: When `threadedErrorMessage !== null`, emits `run.terminal.extracted_with_errorMessage` telemetry event.
- Lines 494-498: `const extractionOutcome = { runResultStatus: ..., trajectoryPassed: null, errorMessage: threadedErrorMessage };`
- Lines 499-506: `extractionOutcome` passed into `workspaceMemoryService.extractRunInsights(...)`.

**Outcome:** CONFIRMED CLOSED. `errorMessage` is threaded from `preFinalizeRow` through `extractionOutcome` into `extractRunInsights` on the normal terminal path. No code change needed.

---

## V3 — Migration number 0367

**Expected:** 0367 is free — highest existing migration is `0366_admin_role_dml_grants.sql`.

**Glob pattern:** `migrations/036*.sql`

**Findings:**
- Highest migration pair found: `0366_admin_role_dml_grants.sql` + `.down.sql`
- 0367 slot is unoccupied.

**Outcome:** CONFIRMED. Next available migration number is 0367. No concurrent session has taken this slot.

---

## V4 — HandlerContext does NOT carry `runId`

**Expected:** `handlerContextTypes.ts` contains only `workflowEngine` + `skillExecutor` wrappers; `SkillExecutionContext` carries `runId` etc.

**Files read:** `server/services/handlerContextTypes.ts` (full); `server/services/skillExecutor/context.ts` lines 1-50

**Findings — `handlerContextTypes.ts`:**
- Interface `HandlerContext` has exactly two properties: `workflowEngine` (cycle-break wrapper with `enqueueTick`, `tick`, `dispatchStep`, `startWorkflowRun`) and `skillExecutor` (cycle-break `Pick<typeof skillExecutor, 'execute'>`).
- No `runId`, `organisationId`, or `subaccountId` fields present.

**Findings — `skillExecutor/context.ts`:**
- Interface `SkillExecutionContext` carries: `runId`, `organisationId`, `subaccountId`, `agentId`, `userId`, `allowedSubaccountIds`, and many other execution-scope fields.

**Outcome:** CONFIRMED. `HandlerContext` is a pure cycle-break primitive. `SkillExecutionContext` is the execution scope carrier. The §4.3 spec claim that "HandlerContext already carries runId, organisationId, subaccountId" is INCORRECT and must be amended.

---

## V5 — Handoff dispatch location is `pipeline.ts::enqueueHandoff`

**Expected:** `agentRunHandoffService.ts` builds snapshot only; dispatch is in `skillExecutor/pipeline.ts::enqueueHandoff`.

**Files read:** `server/services/agentRunHandoffService.ts` lines 1-40; `server/services/skillExecutor/pipeline.ts` lines 1-40 + grep for `enqueueHandoff`

**Findings — `agentRunHandoffService.ts`:**
- File header: "Reads everything the pure builder needs from Drizzle and assembles a `BuildHandoffInput`. Persists nothing — the caller (agentExecutionService) writes the resulting payload into `agent_runs.handoff_json`."
- Read-only over `agent_runs`, `agent_run_messages`, `task_activities`, `tasks`, `task_deliverables`, `review_items`.
- No dispatch logic found.

**Findings — `skillExecutor/pipeline.ts`:**
- Grep for `enqueueHandoff` confirms: `export async function enqueueHandoff(req: HandoffRequest): Promise<HandoffEnqueueResult>` at line 211.

**Outcome:** CONFIRMED. `agentRunHandoffService.ts` is a read-only snapshot builder. The actual dispatch is `enqueueHandoff` exported from `skillExecutor/pipeline.ts`. The §4.4 spec reference to `server/services/agentRunHandoffService.ts` as the dispatch point is INCORRECT and must be amended.

---

## V6 — No `*EditDrawer.tsx` for memory/policy/datasource

**Expected:** No `MemoryEditDrawer`, `MemoryBlockEditDrawer`, `PolicyRuleEditDrawer`, or `DataSourceEditDrawer` files exist — Phase 2 scope reduced to 2 entities.

**Glob patterns:** `client/src/**/*EditDrawer*`; `client/src/**/*Drawer*.tsx`

**Findings — `*EditDrawer*` glob:** No files returned.

**Findings — `*Drawer*.tsx` glob (all drawer files):**
- `PnlInFlightPayloadDrawer.tsx`
- `AutomationPickerDrawer.tsx`
- `EventDetailDrawer.tsx`
- `PnlCallDetailDrawer.tsx`
- `EditArtefactDrawer.tsx`
- `Drawer.tsx`
- `ManageMultiConnectDrawer.tsx`
- `RequestDetailDrawer.tsx`
- `IncidentDetailDrawer.tsx`

None of the named Phase 2 edit drawers (`MemoryEditDrawer`, `MemoryBlockEditDrawer`, `PolicyRuleEditDrawer`, `DataSourceEditDrawer`) exist.

**Outcome:** CONFIRMED. No edit drawers for memory-entry, policy-rule, or data-source surfaces exist. Phase 2 build scope must be reduced: the `EditedAfterBanner` + triggeringRunId plumbing applies only where edit surfaces actually exist. Backend routes confirm two-entity scope (see V7).

---

## V7 — Backend routes: memory-blocks PATCH exists; policyRules and dataSources routes do NOT

**Expected:** `server/routes/memoryBlocks.ts` exists with a PATCH route; `server/routes/policyRules.ts` and `server/routes/dataSources.ts` do not exist.

**Globs:** `server/routes/memoryBlocks.ts`; `server/routes/policyRules.ts`; `server/routes/dataSources.ts`

**Grep:** `\.patch\(|router\.patch` in `server/routes/memoryBlocks.ts`

**Findings:**
- `server/routes/memoryBlocks.ts` — EXISTS. Contains `router.patch(` at line 117. PATCH route confirmed.
- `server/routes/policyRules.ts` — DOES NOT EXIST.
- `server/routes/dataSources.ts` — DOES NOT EXIST.

**Outcome:** CONFIRMED TWO-ENTITY SCOPE. Policy-rule and data-source edit routes do not exist. Phase 2 plumbing scope for `triggeringRunId` is memory-entry route + memory-block route only. Policy-rule and data-source audit trail is deferred.

---

## Summary

| # | Item | Outcome |
|---|---|---|
| V1 | Hermes H3 `hasSummary` side-channel | CONFIRMED CLOSED — code matches spec |
| V2 | §6.8 `errorMessage` threading | CONFIRMED CLOSED — HERMES-S1 block at lines 476-499 |
| V3 | Migration 0367 free | CONFIRMED — highest is 0366 |
| V4 | HandlerContext does NOT carry runId | CONFIRMED — spec §4.3 wording was incorrect; fixed in spec amendment |
| V5 | Dispatch in `pipeline.ts::enqueueHandoff` | CONFIRMED — spec §4.4 + §8 referenced wrong file; fixed in spec amendment |
| V6 | No memory/policy/datasource `*EditDrawer.tsx` | CONFIRMED — Phase 2 frontend scope is two entities not four |
| V7 | memoryBlocks PATCH exists; policyRules + dataSources routes absent | CONFIRMED — two-entity backend scope |
