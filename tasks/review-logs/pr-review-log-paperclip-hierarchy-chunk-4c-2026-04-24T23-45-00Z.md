# PR Review — paperclip-hierarchy Chunk 4c (delegation graph)

**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Reviewed at:** 2026-04-24T23:45:00Z
**Reviewer:** pr-reviewer (Opus 4.7)

## Files Reviewed

- `shared/types/delegation.ts`
- `server/services/delegationGraphServicePure.ts`
- `server/services/delegationGraphService.ts`
- `server/services/__tests__/delegationGraphServicePure.test.ts`
- `server/routes/agentRuns.ts`
- `client/src/components/run-trace/DelegationGraphView.tsx`
- `client/src/pages/RunTraceViewerPage.tsx`

---

## Blocking Issues

### B1. Spawn edge emitted for non-spawn parentRunId rows (spec divergence)

**File:** `server/services/delegationGraphServicePure.ts:61–68`

Spec §7.2: *"Spawn edges. `agent_runs.parentRunId` + `isSubAgent = true` define spawn parentage."* The current code emits `kind: 'spawn'` for every non-null `parentRunId` regardless of `isSubAgent`. `parentRunId` is also set on handoff-sourced runs (`agentExecutionService.ts:1226–1264`) and schedule-triggered runs (`agentScheduleService.ts:127`). Those non-sub-agent rows produce spurious spawn edges.

**Fix:** Add `row.isSubAgent` guard:
```typescript
if (row.parentRunId && row.isSubAgent && row.runId !== rootRunId) {
  edges.push({ parentRunId: row.parentRunId, childRunId: row.runId, kind: 'spawn' });
}
```
Also add a pure-test for `isSubAgent=false` + non-null `parentRunId` → no spawn edge. The existing `makeRow` helper defaults `isSubAgent: true`, so all 9 current tests incidentally pass without testing this invariant.

### B2. Client error-extraction produces `"[object Object]"` on service-thrown errors

**File:** `client/src/components/run-trace/DelegationGraphView.tsx:184–198`

`asyncHandler` wraps errors as `{ error: { code, message }, correlationId }` — `response.data.error` is an object. The catch handler does `String(... as { data: { error: string } }).data.error)` which yields `"[object Object]"`. The type assertion lies about the runtime shape.

The 404 thrown by `delegationGraphService.ts:30` produces `response.data = { error: { code: 'request_error', message: 'Agent run not found' }, correlationId: '...' }`. User sees `"[object Object]"`.

**Fix:** Read `.message` from the error object:
```typescript
const data = (err as { response?: { data?: unknown } }).response?.data;
const errField = (data as { error?: unknown } | undefined)?.error;
const message =
  typeof errField === 'string' ? errField
  : (errField as { message?: string } | undefined)?.message
  ?? 'Failed to load delegation graph';
setError(message);
```

<!-- B1 and B2 appended below -->

## Strong Recommendations

### S1. `startedAt` fallback fabricates data for pending runs

**File:** `server/services/delegationGraphService.ts:65, 118`

`startedAt: rootDetail.startedAt ? rootDetail.startedAt.toISOString() : new Date().toISOString()` — `agent_runs.started_at` is nullable. A pending run substitutes current wall-clock time, making the UI show "started just now" for queued runs and corrupting any future sort-by-startedAt.

**Fix:** Widen `DelegationGraphNode.startedAt` to `string | null` in `shared/types/delegation.ts`, emit `null` from the service, handle null in the UI. Contract change is safe — no existing clients consume this shape.

### S2. `truncated` flag is unreachable in practice

**Files:** `server/services/delegationGraphServicePure.ts:79–81`, `server/services/delegationGraphService.ts:78`

`truncated` is derived from `rows.some(r => r.hierarchyDepth >= MAX_DEPTH_BOUND)`. But the BFS stops at `MAX_DEPTH_BOUND` iterations — rows at depth ≥ MAX_DEPTH_BOUND are never fetched and can never appear in `rows`. The warning will never fire for its intended case.

**Fix:** Track truncation in the BFS walker: set `truncated = true` when the loop exits because `depth === MAX_DEPTH_BOUND && frontier.length > 0`. Pass the boolean into `assembleGraphPure` as an explicit input rather than deriving it from `hierarchyDepth`.

### S3. Two sequential queries where one suffices

**File:** `server/services/delegationGraphService.ts`

Root-check query (fetches only `id`) is immediately followed by a second query that re-selects the same row plus agent name. Combine into one `innerJoin` query: `const [rootDetail] = await db.select({...}).from(agentRuns).innerJoin(agents,...).where(eq(agentRuns.id, runId))`. Removes one round-trip and eliminates the unreachable `if (rootDetail)` dead-code branch at line 55 (which would silently drop the root from the graph if somehow falsy).

### S4. Missing tests for the BFS layer

**File:** `server/services/delegationGraphService.ts` has no test.

BFS walk, visited-set cycle-protection, and 404 handling are only in the impure layer. Missing cases:
- Cycle (`A → B → A`) terminates within MAX_DEPTH_BOUND and returns distinct runIds only.
- Foreign-org run (RLS exclusion) throws `{ statusCode: 404, message: 'Agent run not found' }`.
- 7-level chain: walks exactly 6 levels, 7th level absent, `truncated === true` (after S2 fix).

<!-- S1–S7 appended below -->

### S5. Root node inbound-edge guard is in wrong layer

**File:** `server/services/delegationGraphService.ts:68–69`

Root row is pushed with `parentRunId: null, handoffSourceRunId: null`. The pure function guards spawn emission with `row.runId !== rootRunId`, but NOT handoff emission. A root run with real `handoffSourceRunId` would emit an inbound handoff edge — it doesn't only because the service pre-nulls. This makes `assembleGraphPure` non-composable.

**Fix:** Pass real root pointers to `assembleGraphPure`, add `row.runId !== rootRunId` guard to the handoff branch too. Add test: "root with `handoffSourceRunId` → no inbound handoff edge."

### S6. `_orgId` parameter is unused — pick one convention

**File:** `server/services/delegationGraphService.ts:19`

`buildForRun(runId, _orgId)` silences lint via underscore but never references `_orgId`. Either drop the param (update route call site) or add a defensive ALS-vs-param assertion. The `connectorPollingService.ts:32` `_organisationId` pattern is the one precedent — pick one convention and document it.

### S7. Dedup last-write-wins assumption is untested

**File:** `server/services/__tests__/delegationGraphServicePure.test.ts:163–178`

Test asserts last-write-wins (Agent B over Agent A) but pure module comment says "shouldn't differ in practice." If they truly shouldn't differ, an assertion-equality check would catch real data bugs; if they can differ, document why last-write is correct. Non-blocking; current behaviour is defensible.

---

## Non-Blocking Improvements

- **N1:** `DelegationGraphNode`/`Edge` types duplicated in client vs `shared/types/delegation.ts` — import from shared instead.
- **N2:** Tab label "Delegation Graph" (title case) vs spec §8.2 "Delegation graph" (sentence case) — cosmetic inconsistency.
- **N3:** `StatusDot` misses terminal statuses (`timeout`, `cancelled`, `loop_detected`, `budget_exceeded`, etc.) — consider `isTerminalRunStatus`.
- **N4:** Edge-label arrow style (solid/dashed/dotted per spec §8.2) is only represented by text colour today — CSS border styling on the tree connector would match spec intent. V1 deferral is reasonable.
- **N5:** `DelegationGraphView` uses relative `../../lib/api` instead of project alias `@/lib/api`.
- **N6:** `agentRuns.ts` uses `await import(...)` for `delegationGraphService` — a leaf module with no cycle risk; convert to static import.

---

## Verdict

**BLOCKED** — two blocking issues (B1: spec-divergent spawn-edge emission for non-sub-agent rows; B2: client error extraction produces `"[object Object]"` for all thrown service errors). Both are localised fixes. Strong recommendations S1/S2 are correctness-adjacent (fabricated timestamps, unreachable truncation flag) and should be addressed in the same pass. S3–S7 are quality improvements for the follow-up.

