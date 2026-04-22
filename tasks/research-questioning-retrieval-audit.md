# Retrieval Audit — Universal Brief Phase 0

**Date**: 2026-04-22  
**Branch**: `claude/implement-universal-brief-qJzP8`  
**Purpose**: Investigate the existing memory retrieval pipeline before the Brief orchestrator wires into it. Severity-labelled findings surface integration risks and gaps.

---

## Pipeline Overview

Two independent retrieval systems exist today. Both are already called in `agentExecutionService.ts` and both are RLS-aware.

| System | Primary file | Storage table |
|--------|-------------|---------------|
| **Memory Blocks** | `server/services/memoryBlockService.ts` | `memory_blocks` |
| **Workspace Memory** | `server/services/workspaceMemoryService.ts` | `workspace_memory_entries` |

Supporting modules:
- `server/services/memoryBlockServicePure.ts` — pure ranking + token-budget logic
- `server/services/workspaceMemoryServicePure.ts` — domain classification, quality scoring
- `server/lib/embeddings.js` — embedding generation + vector literal formatting
- `server/lib/reranker.js` — optional Cohere reranker
- `server/services/memoryCitationDetector.ts` — citation tracking for injected entries
- `server/services/orgMemoryService.ts` — **deprecated**, marked for Phase 2 deletion

---

## Findings

### F1 — RLS filtering is correct and consistent [PASS]

**Memory Blocks** (`memoryBlockService.ts:161-168`):
```typescript
const scopeCondition = params.subaccountId
  ? or(
      eq(memoryBlocks.subaccountId, params.subaccountId),
      isNull(memoryBlocks.subaccountId),  // org-level blocks visible to all subaccounts
    )
  : isNull(memoryBlocks.subaccountId);
```
- Always filters by `organisationId`
- Only injects `status = 'active'` blocks
- `rlsProtectedTables.ts` registers `memory_blocks` as RLS-protected

**Workspace Memory** (`workspaceMemoryService.ts:266-270`):
```typescript
const scopeFilter = includeOtherSubaccounts && orgId
  ? sql`organisation_id = ${orgId} AND deleted_at IS NULL`
  : orgId
    ? sql`organisation_id = ${orgId} AND subaccount_id = ${subaccountId} AND deleted_at IS NULL`
    : sql`subaccount_id = ${subaccountId} AND deleted_at IS NULL`;
```
- Double-scoped by default; cross-SA reads require explicit flag
- Soft-delete enforced (`deleted_at IS NULL`)
- `workspace_memory_entries` registered as RLS-protected

**Verdict**: No scope leaks. Safe to plug into Brief with no RLS changes needed.

---

### F2 — Confidence/relevance score not surfaced to the Brief caller [MEDIUM]

Memory blocks return a `score` (cosine similarity, threshold 0.65) and workspace memory returns a composite `combined_score` plus a discrete `confidence` tier (`'high' | 'medium' | 'low'`). However, neither score is included in the formatted prompt injection string returned to the orchestrator — they are used only for ranking and then discarded.

**Impact for Brief**: The Brief orchestrator cannot tell the user "this context came from a high-confidence memory entry" without adding a pass-through field to the return shape.

**Recommendation**: When wiring Brief, request the `injectedEntries` list (already returned by `getMemoryForPromptWithTracking`) and carry `confidence` alongside each entry for optional display in the Brief surface.

---

### F3 — Memory Block token budget silently evicts blocks [LOW]

`memoryBlockServicePure.ts:120-131` enforces a 4,000-token budget (`BLOCK_TOKEN_BUDGET`, `config/limits.ts:169`). Blocks are evicted in reverse-relevance order when the budget is exceeded. Explicit/protected blocks are never evicted. **No log line or counter is emitted** when eviction occurs.

**Impact for Brief**: If the Brief orchestrator injects a larger-than-usual task context, low-relevance blocks may silently disappear from the prompt with no observable signal.

**Recommendation**: Add a debug-level log in `rankBlocksForInjection` when at least one block is evicted (`evicted: true, count: N`). Not blocking for Phase 0; note for Phase 2.

---

### F4 — Workspace Memory has no token budget [MEDIUM]

`workspaceMemoryService.ts` fetches the top-K entries (`VECTOR_SEARCH_LIMIT = 5`, `config/limits.ts:395`) and injects all of them with no token-count check. With verbose entries this can silently inflate the prompt beyond the LLM's context limit.

**Impact for Brief**: Brief conversations may have longer task-context strings than regular agent runs; the risk is higher here than in the existing agent path.

**Recommendation**: Apply the same `approxTokenCount` budget guard used in `memoryBlockServicePure.ts` to the workspace memory injection path before the Brief orchestrator wires in. Not blocking for Phase 0; required before Phase 2 memory injection.

---

### F5 — Retrieval logging is partial [LOW]

**Logged**: Entry counts, outcome-promotion stats, and OpenTelemetry spans (`memory.recall.query`, `memory.inject.build`).

**Not logged**:
- Which specific entries were retrieved (only count + top similarity)
- Token-budget eviction events (F3)
- Reranker invocation or score changes
- Query intent classification decision

**Impact for Brief**: Brief's retrieval audit requirement (spec §W4) calls for per-query observability. The span infrastructure exists; it just needs richer payloads.

**Recommendation**: Extend the `memory.recall.query` span to include `topEntries: [{id, score, excerpt}]` before Phase 2. Already noted in `tasks/todo.md` as LAEL-P1-2 (`memory.retrieved` emission site).

---

### F6 — Citation tracking is wired but must be explicitly re-registered for Brief [MEDIUM]

`memoryCitationDetector.ts` extracts citations from the LLM output and correlates them against the `injectedEntries` list returned by `getMemoryForPromptWithTracking`. This is currently registered in `agentExecutionService.ts` as a post-run hook.

The Brief orchestrator will be a separate execution path. If citation tracking is not explicitly wired there, injected memory entries will never have their citation counts incremented — degrading quality-score feedback over time.

**Impact for Brief**: Memory quality degrades silently if citation feedback is missing.

**Recommendation**: When building the Brief orchestrator (Phase 2+), replicate the citation detector registration. Add a spec note in Phase 1 to prevent accidental omission.

---

### F7 — `orgMemoryService.ts` is deprecated but not removed [INFO]

Marked for Phase 2 deletion. Poses no risk to Brief as long as nothing new imports it.

**Recommendation**: Confirm no Brief code imports `orgMemoryService` before Phase 2. Deletion is already tracked.

---

### F8 — Deduplication coverage gap between the two systems [LOW]

Memory Blocks dedup by ID (`memoryBlockServicePure.ts:74-88`; explicit wins over relevance). Workspace Memory relies on RRF's `GROUP BY r.id` for natural dedup. There is no cross-system dedup: the same factual content stored in both `memory_blocks` and `workspace_memory_entries` will be injected twice.

**Impact for Brief**: Low probability in practice today; higher risk if Brief's memory-capture feature (Phase 3+) writes to both tables.

**Recommendation**: Note for Brief memory-capture spec. No action needed in Phase 0.

---

## Integration Points for the Brief Orchestrator

When the Brief orchestrator is built (Phase 2+), it will call these entry points with `organisationId + subaccountId` from the run context and `taskContext` from the brief query:

```
memoryBlockService.getBlocksForInjection({ organisationId, subaccountId, taskContext })
workspaceMemoryService.getMemoryForPromptWithTracking(organisationId, subaccountId, taskContext, domain)
workspaceMemoryService.getEntitiesForPrompt(subaccountId, organisationId)
```

Return values to carry forward:
- `injectedMemoryEntries` — for citation detector registration at run completion
- `confidence` tier per entry — for optional Brief surface display (F2)

No RLS changes are needed (F1). Token budget guard needed on workspace memory path before wiring (F4).

---

## Summary Table

| Finding | Severity | Blocking Phase 0? | Blocking Phase 2? |
|---------|----------|-------------------|-------------------|
| F1 — RLS correct | PASS | No | No |
| F2 — Confidence not surfaced | MEDIUM | No | No (display feature) |
| F3 — Block eviction silent | LOW | No | No |
| F4 — Workspace memory no token budget | MEDIUM | No | **Yes** |
| F5 — Retrieval logging partial | LOW | No | No |
| F6 — Citation tracking not auto-wired | MEDIUM | No | **Yes** |
| F7 — orgMemoryService deprecated | INFO | No | No |
| F8 — Cross-system dedup gap | LOW | No | No |
