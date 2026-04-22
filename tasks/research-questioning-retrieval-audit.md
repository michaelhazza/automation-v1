# Retrieval Audit — Universal Brief Phase 0 (W4)

**Date**: 2026-04-22  
**Branch**: `claude/implement-universal-brief-qJzP8`  
**Spec refs**: brief §8.4, dev-spec §3.1 / §1432 Phase 0  
**Purpose**: Investigate whether the existing memory infrastructure actually reaches agents at the right moment, or whether capture is writing into a void.

---

## Audit scope

The brief §8.4 asks five specific questions. This document answers each and labels findings by severity.

| # | Brief §8.4 question | Answer location |
|---|--------------------|-----------------|
| 1 | Are `memoryBlocks` actually injected? End-to-end trace. | Q1 |
| 2 | Do `agentBeliefs` measurably influence decisions? | Q2 |
| 3 | Are `workspaceMemoryEntries` cited at expected rates? | Q3 |
| 4 | Scope resolution — subaccount / agent / org priority correct? | Q4 |
| 5 | Context bloat — is there relevance ranking? | Q5 |

Findings are labelled **CRITICAL / MODERATE / MINOR / INFO** per the brief §8.4 deliverable format.

---

## Q1 — Memory block injection end-to-end trace

**Answer: Yes, injected.** Starting from `agentExecutionService.ts:761`:

1. `agentExecutionService.ts:720-727` — `buildTaskContext()` (lines 2938-2963) constructs the retrieval query string (task title + status + priority + description + activities + deliverables)
2. `agentExecutionService.ts:761-766` — calls `memoryBlockService.getBlocksForInjection({ agentId, subaccountId, organisationId, taskContext })`
3. `memoryBlockService.ts:241-258` — DB query 1: explicit attachments for this `agentId` (from `memory_block_attachments`)
4. `memoryBlockService.ts:156-159` → `lib/embeddings.js:17` — generates a 1536-dim vector via OpenAI `text-embedding-3-small`; returns `null` on failure (graceful)
5. `memoryBlockService.ts:173-193` — DB query 2: pgvector cosine search, filtered by org + (subaccount OR org-level), `status = 'active'`, `embedding IS NOT NULL`
6. `memoryBlockServicePure.ts:107-135` — `rankBlocksForInjection` applies threshold (0.65), topK, token budget (4,000 tokens)
7. `memoryBlockService.ts:286-293` — combined candidates: protected → explicit → relevance (dedup: explicit wins over relevance for same block ID)
8. `memoryBlockService.ts:295-301` — maps to `MemoryBlockForPrompt[]`
9. `memoryBlockService.ts:767` → `memoryBlockServicePure.ts:20` — `formatBlocksForPrompt` renders markdown (`## Shared Context\n\n### {name}\n{content}`)
10. `agentExecutionService.ts:768-770` — appended to `systemPromptParts` (system prompt dynamic suffix)

### F1 — Block retrieval failure propagates and fails the run [MODERATE]

Line 761's call is **not** wrapped in try/catch. A transient `memory_blocks` query failure bubbles up to the outer handler at line 468 and fails the whole run. Compare with `agentBeliefService.getActiveBeliefs` at line 810, which **is** wrapped — the agent proceeds without beliefs on failure.

**Impact for Brief**: A Brief response to a user query could be fully blocked by a slow pgvector index rebuild or an embedding service outage.

**Recommendation**: Wrap the `getBlocksForInjection` call in try/catch matching the beliefs pattern. Emit a structured warning log; continue with empty block list.

---

## Q2 — agentBeliefs influence on decisions

**Answer: Yes, fully implemented and injected.** An earlier draft of this audit missed this entirely; `agentBeliefs` is a first-class concept in the codebase.

**Storage**: `server/db/schema/agentBeliefs.ts` — `agent_beliefs` table, unique index on `(organisationId, subaccountId, agentId, beliefKey)` enforcing one active belief per key per agent-subaccount pair.

**Service**: `server/services/agentBeliefService.ts`
- `getActiveBeliefs()` (lines 77-84) — returns top-N beliefs truncated to a token budget, ordered by category + confidence desc
- `listAllActiveBeliefs()` (lines 53-71) — full list for browsing
- `mergeExtracted()` (lines 100-405) — post-run belief extraction + soft-delete when confidence drops below `BELIEFS_CONFIDENCE_FLOOR`
- `formatBeliefsForPrompt()` (lines 88-90) — renders beliefs as a prompt section

**Injection** (`agentExecutionService.ts:809-821`):
```typescript
try {
  const beliefs = await agentBeliefService.getActiveBeliefs(
    request.organisationId, request.subaccountId!, request.agentId,
  );
  if (beliefs.length > 0) {
    dynamicParts.push(`\n\n---\n## Your Beliefs\n${agentBeliefService.formatBeliefsForPrompt(beliefs)}`);
  }
} catch { /* non-fatal */ }
```

Beliefs are agent-specific (filtered by `agentId`), token-budgeted, confidence-capped, and soft-deleted on low confidence.

### F2 — Belief influence is not measured [MINOR]

Beliefs are injected but there is no downstream signal that correlates belief presence/content with run outcomes. "Measurably influence" therefore cannot be answered from data today. The citation detector (`memoryCitationDetector.ts`) does not cover beliefs.

**Recommendation**: Not blocking Phase 0. Phase 5 memory capture should consider extending citation detection to beliefs.

---

## Q3 — workspaceMemoryEntries citation rate (last 30 days)

**Answer: Unknown — cannot be measured without live DB access.**

The citation-tracking pipeline exists:
- `server/services/workspaceMemoryService.ts:865-872` — `getMemoryForPromptWithTracking` returns `injectedEntries` alongside the formatted prompt
- `server/services/memoryCitationDetector.ts` — extracts citations from LLM output and correlates against injected entries at run completion

However, this audit runs against the codebase only. Citation rate over the last 30 days requires a query against production data (`workspace_memory_entries` + run logs), which is out of scope for a Phase 0 codebase audit.

### F3 — Citation-rate dashboard is not surfaced [MINOR]

Citation data is written but there is no admin-visible surface for it today. An operator cannot answer "how often does Brief actually cite injected memory?" without writing a custom SQL query.

**Recommendation**: Future work. A simple `/system/memory-health` page with citation rate + quality-score distribution would give the operator observability without a spec of its own.

---

## Q4 — Scope resolution precedence

**Answer: There is NO subaccount > org precedence in memory block ranking. Scope is a filter, not a ranking signal.**

This is the single most important finding in the audit, and it directly contradicts the assumption stated in the brief §8.4 Q4 ("subaccount / agent / org rules in the right priority").

**What the code does** (`memoryBlockService.ts:161-168`):
```typescript
const scopeCondition = params.subaccountId
  ? or(
      eq(memoryBlocks.subaccountId, params.subaccountId),  // subaccount blocks
      isNull(memoryBlocks.subaccountId),                    // org-level blocks
    )
  : isNull(memoryBlocks.subaccountId);
```
Both subaccount-level AND org-level blocks are fetched in one query, then ranked **by cosine similarity only** (`memoryBlockServicePure.ts:107-135`). An org-level block with similarity 0.85 outranks a subaccount-level block with similarity 0.80.

**What precedence DOES exist in ranking** (memoryBlockServicePure.ts:107-135):
1. **Protected** blocks (e.g., `config-agent-guidelines`) — always included
2. **Explicit attachments** — always included, bypass token budget
3. **Relevance matches** — ranked by cosine similarity, filtered by threshold (0.65), capped at topK

No agent-scope tier exists for relevance retrieval. Agent-specific blocks only exist via `memory_block_attachments.agentId` (explicit attachments — tier 2 above).

### F4 — Subaccount vs org precedence absent [CRITICAL]

**Impact for Brief**: A user types a request in subaccount context. Their subaccount's "Learned Rule" (stored as a memory block with `subaccountId` set) may NOT be preferred over an org-wide block with slightly higher similarity. The brief's W3 promise ("capture a rule at this subaccount and it applies here") is technically supported at the filter level but **not** enforced at the ranking level.

This is the silent-failure mode the brief warned about in §8.4: "Capture without retrieval is a silent failure mode." A user captures a rule, it gets stored correctly, similarity is high-but-not-highest, it is silently ranked below an org block, and the user cannot tell why.

**Recommendation (blocks Phase 5 W3 memory capture)**: Before Phase 5 ships, either:
- (a) Add a scope-boost term to the ranking formula: e.g., subaccount blocks get +0.10 added to similarity, org blocks get no boost. Trivially tunable constant.
- (b) Rank in two passes: subaccount-tier blocks first (up to N), then org-tier fills remaining budget.

Option (a) is simpler and matches the existing "recency boost" pattern in `workspaceMemoryService.ts:385-399`.

### F4b — No agent-specific relevance tier [MODERATE]

Even explicit attachment is the only agent-level lever. There is no "retrieve blocks most relevant to *this* agent's role" ranking. Two agents in the same subaccount with different roles retrieve the same block set for the same query.

**Recommendation**: Consider adding agent-role as a metadata filter or boost in Phase 6+. Not blocking for Brief v1.

---

## Q5 — Context bloat and relevance ranking

**Answer: Partially mitigated. Memory blocks enforce a token budget; workspace memory does not.**

**Memory Blocks** (`memoryBlockServicePure.ts:120-131`):
- Token budget: `BLOCK_TOKEN_BUDGET = 4,000` tokens (`config/limits.ts:169`)
- Eviction strategy: drop lowest-relevance blocks when budget exceeded
- Explicit/protected blocks never evicted
- **No log when eviction occurs** — silent

**Workspace Memory** (`workspaceMemoryService.ts`):
- Top-K = 5 entries (`VECTOR_SEARCH_LIMIT`, `config/limits.ts:395`)
- **No token budget check** — all 5 retrieved entries injected regardless of size
- Implicit floor via RRF `MIN_SCORE = 0.005`

**Entities**: hard cap of 10 (`MAX_PROMPT_ENTITIES`, `config/limits.ts:253`).

### F5 — Workspace memory has no token budget guard [MODERATE]

A verbose insight entry (~500 tokens) multiplied by top-K=5 = 2,500 tokens injected silently, on top of memory blocks (4,000) and beliefs and task context. For Brief chat turns where the user query alone is already multi-turn context, this compounds.

**Recommendation**: Apply the same `approxTokenCount` guard used in `memoryBlockServicePure.ts` to the workspace memory injection path before Phase 2 (where Brief starts actually routing prompts through this pipeline).

### F6 — Silent eviction on memory blocks [MINOR]

`rankBlocksForInjection` drops blocks without logging. An operator investigating "why didn't my block appear?" has no signal.

**Recommendation**: Add a debug-level log line when one or more blocks are evicted. One-line fix.

---

## Additional findings (outside brief §8.4 questions)

### F7 — RLS filtering is correct and consistent [PASS]

Both memory block and workspace memory queries filter by `organisationId` and (when applicable) `subaccountId`. Workspace memory additionally filters `deleted_at IS NULL`. `rlsProtectedTables.ts` registers both tables. No scope leak observed. **Safe to plug into Brief with no RLS changes.**

### F8 — Confidence tier not surfaced on memory block injection [MODERATE]

`memoryBlockService` computes a similarity score and filters by threshold, but does not propagate the score into the returned `MemoryBlockForPrompt` shape. `workspaceMemoryService.getMemoryForPromptWithTracking` DOES return a discrete `confidence` tier per entry (`'high' | 'medium' | 'low'` at lines 1068-1072).

**Impact for Brief**: The Brief orchestrator cannot display "high-confidence memory retrieved" for memory blocks — only for workspace memory.

**Recommendation**: Extend `MemoryBlockForPrompt` to carry `{ similarityScore, confidence }` in Phase 5. Low-effort additive change.

### F9 — Citation tracking must be explicitly re-registered for Brief [MODERATE]

`memoryCitationDetector` is registered as a post-run hook in `agentExecutionService.ts`. If the Brief orchestrator (Phase 2+) does not replicate this registration, injected memory entries' citation counts will never increment — degrading quality-score feedback over time.

**Recommendation**: Add explicit integration test in Phase 2 that proves the citation detector runs at Brief completion. Spec callout in Phase 1.

### F10 — orgMemoryService is deprecated but not removed [INFO]

`server/services/orgMemoryService.ts` is marked for Phase 2 deletion. Nothing new should import it. Confirm before the Phase 2 ship.

### F11 — No cross-system dedup between memory_blocks and workspace_memory_entries [MINOR]

Memory blocks dedup by block ID; workspace memory dedups via RRF `GROUP BY r.id`. There is no cross-system dedup: the same factual content stored in both tables is injected twice. Low probability in practice today; higher risk once Brief's W3 capture flow (Phase 5) can write to both.

---

## Severity summary

| # | Finding | Severity | Blocks Phase 0? | Blocks Phase 5 (W3)? |
|---|---------|----------|-----------------|----------------------|
| F1 | Block retrieval failure fails the run | MODERATE | No | **Strongly recommended** |
| F2 | Belief influence not measured | MINOR | No | No |
| F3 | Citation-rate dashboard absent | MINOR | No | No |
| **F4** | **No subaccount > org precedence in ranking** | **CRITICAL** | No | **YES — must fix** |
| F4b | No agent-specific relevance tier | MODERATE | No | No (v1 accepts) |
| F5 | Workspace memory has no token budget | MODERATE | No | **Yes** |
| F6 | Silent eviction on memory blocks | MINOR | No | No |
| F7 | RLS correct | PASS | — | — |
| F8 | Confidence not surfaced on memory blocks | MODERATE | No | No |
| F9 | Citation tracking must be re-registered | MODERATE | No | **Yes** |
| F10 | orgMemoryService deprecated | INFO | No | No |
| F11 | No cross-system dedup | MINOR | No | No |

---

## Recommendations for §8.3.3 scope (provenance sufficiency)

The brief §8.4 asks whether provenance alone suffices or retrieval fixes are also needed. **Retrieval fixes are required.** Provenance explains "this rule applied because X"; it cannot explain "this rule didn't apply because a higher-scored org block displaced it" — which is exactly what F4 causes today.

**Minimum set to ship before W3 (Phase 5) is trustworthy:**
1. Fix F4 — scope-boost term in ranking (+0.10 for subaccount blocks). Critical.
2. Fix F5 — token budget on workspace memory injection. Moderate.
3. Fix F9 — wire citation detector into Brief orchestrator. Moderate; prevents silent quality degradation.
4. Fix F1 — wrap memory block fetch in try/catch. Moderate; prevents cascading failures.

Provenance work (W3c, Phase 8) should come AFTER these fixes, so the signals it emits reflect a sound ranking foundation rather than today's similarity-only ordering.

---

## Integration points for the Brief orchestrator (Phase 2+)

When the Brief orchestrator is built, it will call these entry points with `organisationId + subaccountId` from the run context and `taskContext` from the brief query:

```
memoryBlockService.getBlocksForInjection({ organisationId, subaccountId, taskContext, agentId })
workspaceMemoryService.getMemoryForPromptWithTracking(organisationId, subaccountId, taskContext, domain)
workspaceMemoryService.getEntitiesForPrompt(subaccountId, organisationId)
agentBeliefService.getActiveBeliefs(organisationId, subaccountId, agentId)
```

Carry forward into the Brief orchestrator:
- `injectedMemoryEntries` — for citation detector registration at run completion (F9)
- Per-entry `confidence` tier — for optional Brief surface display (F8)
- Token-budget eviction counts — for observability (F6)
