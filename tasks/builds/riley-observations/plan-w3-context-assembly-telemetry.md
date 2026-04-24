# Wave 3 — Context-assembly telemetry

_Build: riley-observations_
_Wave: W3 — Part 5 (spec §8, lines 1490–1598)_
_Class: Standard_
_Date: 2026-04-24_
_Depends on: W1 rename (`workflow_runs` vocabulary lands first)_

## Contents

1. Orientation
2. Architect decisions — §12.5 inline
3. Event contract summary
4. File inventory
5. Test strategy
6. Reviewer checklist

---

## 1. Orientation

Part 5 of the Riley Observations spec ships a single tracing event — `context.assembly.complete` — fired after the agent-execution service finishes assembling context (briefing + beliefs + memory blocks + workspace memory + known entities) and **before** the agent loop starts. There is no UI in v1; the event is read through the existing Langfuse sink by operators debugging bad runs (spec §8.1, §8.3, §8.5).

Wave is **Standard-class, telemetry-only**. No schema changes, no new tables, no new routes, no UI. Two files edited (`server/lib/tracing.ts` + the emit site in `server/services/agentExecutionService.ts`), one new pure helper module for `gapFlags` evaluation, plus the two tests §11.2 calls out. Depends on Wave 1 having landed so the event call site references the post-rename vocabulary (`workflow_runs`, not `playbook_runs`) everywhere the assembler touches it.

The two §12.5 open questions are resolved inline in Section 2 below (both have clear defaults and neither blocks the plan).

---

## 2. Architect decisions — §12.5 inline

### 2.1 (§12.5 #18) Tracing.ts write-path latency — is the <5ms p95 target realistic?

**Assessment: realistic as specified, no mitigation required beyond what tracing.ts already does.**

`server/lib/tracing.ts` (lines 263–291) implements `createEvent` as a wrapper around Langfuse's `parent.event(...)` call. Langfuse's Node SDK enqueues events into an in-memory batch and flushes asynchronously on a background timer — the synchronous cost of `parent.event(...)` is the event-object construction + a queue push, not a network round-trip. All helpers are already fire-and-forget / fail-safe by contract (`try/catch` around the helper body, swallowed errors, `noop` return on tracing disabled — see lines 7, 180, 272–290). Measured write-path cost at the caller boundary is dominated by `safeMetadata`'s `JSON.stringify` for the oversize guard (line 168), which is O(n) in payload size; the `context.assembly.complete` payload is ~15 scalar fields + a small string array, well under any realistic threshold.

**Conclusion:** emit through the existing `createEvent('context.assembly.complete', payload)` helper with no special async wrapper. The <5ms p95 target is a natural consequence of the existing helper architecture, not something we need to engineer for. Spec §8.5 item 3 ("async, fire-and-forget, best-effort") is already satisfied by the helper's contract. The latency test in §11.2 still runs as a regression guard.

### 2.2 (§12.5 #19) `gapFlags` evaluation logic — source per flag

Each flag in the §8.4 vocabulary has a computable source at the emit site (the end of context assembly in `agentExecutionService.ts`, just before the loop-branch at line ~1106). The table below pins the evaluation mechanism per flag; all flags are evaluated in a single pure helper `evaluateGapFlags()` (see §4 File inventory — new `server/services/contextAssemblyTelemetryPure.ts`).

| Flag | Source / check |
|---|---|
| `no_briefing` | The local `briefing` variable returned from `agentBriefingService.get(...)` is `null` / empty string (see `agentExecutionService.ts` around line 857). The existing try/catch that logs "Non-fatal" still sets this flag when the block swallows an error — the flag signals absence regardless of cause. |
| `no_beliefs` | The local `beliefs` array from `agentBeliefService.getActiveBeliefs(...)` has length 0 (around line 871). Same try/catch treatment as briefing. |
| `no_memory_blocks` | The local `memoryBlocksForPrompt` array from `memoryBlockService.getBlocksForInjection(...)` has length 0 (around line 812). Derived from `memoryBlockCount === 0` — no separate state needed. |
| `no_workspace_memory` | The local `memory` string from `workspaceMemoryService.getMemoryForPromptWithTracking(...)` is `null` / empty (around line 922–931). Derived from `workspaceMemoryLength === 0` — no separate state needed. |
| `stale_beliefs` | The `beliefs` array is non-empty AND every belief's `updatedAt` is older than 30 days from `Date.now()`. Implemented as `beliefs.length > 0 && beliefs.every(b => (Date.now() - b.updatedAt.getTime()) > 30*24*60*60*1000)`. Requires no new DB read — `updatedAt` is already returned on each belief row. |
| `missing_integration` | The agent's configured skill set references a connection (via `skill.requiredConnectionKey` or similar on the skill definition) but no matching connection is resolved on the subaccount. Evaluated by walking `skillInstructions` / authorised skills for skills that declare a connection requirement and cross-referencing the connections loaded for the run. If the connection-requirement metadata does not yet exist on skill definitions, the flag is not emitted in v1 (silent-absence vs false-positive — matches §8.7 edge 3's posture). **Deferred to architect pass at implementation time** if the declarative connection-requirement is missing on skills; otherwise computed as described. |
| `context_pressure_high` | `contextPressure > 0.9`. Pure computation from `totalTokens / contextBudget` (when `contextBudget > 0`). |
| `context_pressure_unknown` | `contextBudget === 0` per §8.7 edge 3. Source: the model's declared context window from the router's model-capabilities table; if the lookup fails or returns undefined, `contextBudget = 0` and this flag is set. |
| `workspace_memory_truncated` | The workspace-memory service's tracking result exposes whether the returned `promptText` was truncated against its budget. If the service does not yet expose that signal, an **architect-at-implementation** note applies: either (a) extend the `memoryWithTracking` return shape with a `truncated: boolean` field (preferred — one-line change at the producer) or (b) compute via `injectedEntries`' aggregated length vs a budget constant. Flag is set iff truncation occurred; `workspaceMemoryLength` reports the pre-truncation length per §8.7 edge 4. |
| `memory_retrieval_timeout` | The memory-block retrieval call (`getBlocksForInjection(...)`) either throws a timeout error or the assembly site wraps it with `Promise.race` against a timeout budget. The current code has an implicit try/catch swallow but no explicit timeout budget at the call — the implementation adds a shallow `Promise.race` with a configurable timeout constant (default e.g. 2s) and sets this flag when the race resolves on the timer rather than the service call. |
| `assembly_partial_failure` | At least one of the five sub-phases (briefing, beliefs, memory blocks, workspace memory, known entities) threw an exception caught by the existing try/catch blocks in the assembler. Tracked by a local counter incremented inside each catch clause and tested against `> 0` at emit time. Co-exists with the specific-gap flag for the failing phase (e.g. a briefing failure sets both `no_briefing` and `assembly_partial_failure`). |

All other evaluations are pure over the locals already computed during assembly — no additional DB reads, no additional service calls.

---

## 3. Event contract summary

Event name: `context.assembly.complete`. Full payload schema is pinned in spec §8.2 (lines 1496–1527) — not duplicated here to preserve single-source-of-truth. Also appears in the Contracts table at spec §9a (line 1638) with a worked example instance.

Summary shape: `{ eventType, runId, agentId, subaccountId | null, orgId, timestamp }` (identity) + `{ latencyMs, totalTokens, contextBudget, contextPressure }` (injection scale) + `{ memoryBlockCount, workspaceMemoryLength }` (memory shape) + `{ gapFlags: string[] }` (diagnostics, vocabulary per §8.4). No bodies, no per-source breakdowns, no per-skill arrays. The v2 expansion list in §8.3 is **explicitly deferred** and additive on the same event type when it ships.

Registered at compile time in `server/lib/tracing.ts`'s `EVENT_NAMES` tuple (see §4 File inventory).

---

## 4. File inventory

Total: **4 files touched** (2 edits + 1 new pure helper + 1 new test file). Plus 1 integration test file — so 5 if counting tests as separate artifacts; the plan treats them as one file each.

| File | Op | Purpose |
|---|---|---|
| `server/lib/tracing.ts` | Edit | Append `'context.assembly.complete'` to the `EVENT_NAMES` tuple (lines 53–86). One-line change. No new helper needed — existing `createEvent(name, metadata, options)` is the emit API per spec §8.5 item 1 and the conclusion of §2.1 above. Compile-time `EventName` type auto-updates from the tuple. |
| `server/services/agentExecutionService.ts` | Edit | Emit `context.assembly.complete` at the end of context assembly, immediately after the existing `db.insert(agentRunSnapshots)` call on line 1102–1104 and before the `// ── 8. Execute` branch on line 1106. All required payload fields are already local variables at that point: `run.id`, `request.agentId`, `request.subaccountId`, `request.organisationId`, a `contextAssemblyStartedAt` timestamp captured at the top of the assembly block, `systemPromptTokens` (line 972), the model's declared context window (looked up via existing router capabilities), `memoryBlocksForPrompt.length` (line 812), `approxTokens(memory)` (line 931). `gapFlags` computed by calling the new `evaluateGapFlags(...)` pure helper (below). Wrapped in try/catch so emission failure never blocks the run (spec §8.7 edge 5). Single call site. |
| `server/services/contextAssemblyTelemetryPure.ts` | **New** | Pure module exporting `evaluateGapFlags(input): string[]` + `computeContextPressure(totalTokens, contextBudget): { pressure: number; unknown: boolean }`. Input shape mirrors the locals at the emit site: briefing (string \| null), beliefs (array), memoryBlockCount, workspaceMemoryLength, workspaceMemoryTruncated, subPhaseFailureCount, memoryRetrievalTimedOut, contextBudget, totalTokens, missingIntegrations (array, possibly empty in v1 per §2.2). Pure, deterministic, side-effect-free; exists specifically so the unit test in §11.2 can assert each flag's evaluation in isolation without spinning an agent run. **Why new-not-extend:** no existing `*ServicePure.ts` owns context-assembly diagnostics; the five services that compute the inputs (briefing / belief / memory block / workspace memory / known entities) each own their own concern and should not learn the `gapFlags` vocabulary. Keeping the vocabulary in one pure module also makes the §8.4 enum the single source of truth for the flag list. |
| `server/services/contextAssemblyTelemetryPure.test.ts` | **New** | Unit test for `evaluateGapFlags` and `computeContextPressure`. Covers: every flag fires on its specific input (11 flags × at least one test case each); no-gap case returns empty array; `assembly_partial_failure` co-occurs with the specific failing-phase flag; `context_pressure_unknown` suppresses `context_pressure_high` per §8.7 edge 3; `stale_beliefs` only fires when beliefs array is non-empty. Pure-function tests — no DB, no Langfuse mocks. Matches `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only` per `docs/spec-context.md`. |
| `server/services/agentExecutionService.contextTelemetry.test.ts` | **New** | Integration-style test that instantiates an agent run against a mock DB + mock Langfuse sink and asserts exactly one `context.assembly.complete` event is emitted per agent-loop run (spec §8.8 #1, §11.2 integration case). Covers: successful run emits one event with all required fields populated; `assembly_partial_failure` case emits with correct `gapFlags`; sink-unavailable case lets the run continue (§8.7 edge 5); simple-reply path from Universal Brief does NOT emit (§8.7 edge 1). **Note on framing:** this edges up to the `api_contract_tests: none_for_now` line in `docs/spec-context.md` — spec §11.2 explicitly asks for the integration assertion, so the test lives here as a named exception documented against that framing, not a silent deviation. Mark the exception inline in the test's top-of-file comment. |

**Not touched:**
- No new table, no migration, no schema change. Storage reuses the existing Langfuse sink per spec §8.5 item 4.
- No new route, no UI component. §8.3 "Not in v1" forbids UI; the event is queried via existing observability tooling.
- No new pg-boss job. Event emit is synchronous-call-to-batched-async per §2.1; no queue involved.

**Primitives-reuse justification per spec-authoring-checklist §1:**
- `EVENT_NAMES` tuple in `tracing.ts` — **extended**, not replaced. New event joins the existing registry.
- `createEvent()` helper — **reused as-is**, no new emit helper invented.
- `agentBriefingService` / `agentBeliefService` / `memoryBlockService` / `workspaceMemoryService` — **reused as-is** for the data that populates the payload. No new retrieval APIs.
- New pure module (`contextAssemblyTelemetryPure.ts`) — invented because no existing pure module owns the `gapFlags` vocabulary, and consolidating the enum in one place matches the "strict enum, extensible" posture stated in §8.4.

---

## 5. Test strategy

Per spec §11.2 Part 5 (lines 1801–1805): unit test on `evaluateGapFlags` / `computeContextPressure` asserting each flag fires on its specific input and all required payload fields are populated; integration test asserting exactly one `context.assembly.complete` event per agent-loop run; latency regression test confirming the emit adds <5ms p95 to pre-loop timing (co-located in the integration test file); edge test for `assembly_partial_failure` co-occurring with the specific failing-phase flag. See §4 File inventory for the two test file names.

---

## 6. Reviewer checklist

See spec §11.3 (lines 1810–1822) for the project-wide PR checklist. The Part-5-specific reviewer flags are in §8.9 (lines 1589–1595) — reviewer should specifically check: any v1 field that's genuinely unused, any v2 deferral that would be regretted within the first week of data, any missing flag the assembler should have emitted, and whether the async-emit latency claim survives scrutiny against the tracing sink's actual write path (see §2.1 above for the architect's assessment).
