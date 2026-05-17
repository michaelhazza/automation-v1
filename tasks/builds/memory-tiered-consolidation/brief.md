# Brief — Tiered memory consolidation + RRF hybrid retrieval

**Status:** DRAFT v1 (2026-05-17) — operator-captured from external repo analysis
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `memory-tiered-consolidation`
**Class:** Significant (possibly Major; architect to confirm at spec authoring)
**Source pattern:** [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) (Apache-2.0, pattern lift only — no code adoption)

## Problem

Our shipped memory system (`server/services/workspaceMemoryService/`) is a flat store. Every memory block has the same priority, the same retrieval weight, and the same decay behaviour. Operators routinely report two failures:

1. **"The agent forgot what we did last week."** Recent context gets crowded out by older memories; there is no working-memory tier that ages out fast but ranks first while fresh.
2. **"Retrieval pulls the wrong thing."** Semantic search alone misses keyword-exact matches; keyword search alone misses paraphrases. Neither catches relationships between concepts.

The agentmemory repo (89k stars in 3 months, Apache-2.0) ships a four-tier memory model (working / episodic / semantic / procedural) with Ebbinghaus decay, plus hybrid retrieval that fuses keyword + vector + graph search via Reciprocal Rank Fusion (RRF). On the LongMemEval-S benchmark they claim R@5 of 95.2% vs flat-store baselines under 70%. The pattern is well-documented and portable; the code itself is unsafe for our multi-tenant SaaS because their tenant scoping is env-var-based.

## Goal

Upgrade `workspaceMemoryService` from a flat store to a four-tier consolidation model with hybrid retrieval, preserving our existing Postgres backend, RLS tenant isolation, embedding pipeline, and decay job infrastructure.

## Proposed approach (for the architect to evaluate)

### Tier 1: Schema extension

Add a `tier` column to `memory_blocks` (enum: `working`, `episodic`, `semantic`, `procedural`). Working = recent observations, fast decay (default 7 days). Episodic = specific events / conversations, medium decay (30 days). Semantic = consolidated facts / learnings, slow decay (180 days). Procedural = workflows / how-to-do-X, no automatic decay.

### Tier 2: Consolidation job

Extend `server/jobs/memoryBlockSynthesisJob.ts` to promote blocks across tiers based on reinforcement (access count, agent-marked importance, contradiction resolution). Working → episodic on second access. Episodic → semantic when N related episodes consolidate into a generalised fact. Episodic → procedural when the pattern is a repeatable procedure.

### Tier 3: Ebbinghaus decay function

Decay weight = e^(-t/S) where t is time since last access and S is tier-specific strength. Higher tiers have larger S (slower decay). Reinforcement on access resets the timer. Implementation hint: precompute decay at retrieval time, not at write time; avoids hot-row updates.

### Tier 4: RRF hybrid retrieval

Replace the current single-mode retrieval (in `server/services/workspaceMemoryService/retrieve.ts` and `hybridRetrieval.ts`) with RRF fusion of three retrievers:
1. **Keyword** — Postgres full-text search (existing).
2. **Vector** — pgvector cosine distance (existing).
3. **Graph** — citation / parent / related-block edges (new lightweight join).

RRF score = sum over retrievers of 1 / (k + rank_i), with k=60 (standard). Tier-weighted: working tier results get a multiplier, procedural tier results get a smaller multiplier in conversational contexts.

### Tier 5: Multi-tenant safety

Every retrieval and consolidation operation MUST scope by `organisation_id` AND `subaccount_id` enforced at the SQL layer (RLS continues to apply). The architect confirms that the new tier column and any new graph-edge table inherit the existing RLS policies before merge.

## Constraints / non-goals

- **DO NOT** embed the agentmemory code or its `iii` engine. Pattern lift only.
- **DO NOT** swap embedding providers. Keep OpenAI text-embedding-3-small (`server/lib/embeddings.ts`) as-is.
- **DO NOT** introduce a new vector DB. Stay on pgvector.
- **DO NOT** break existing memory consumers. The retrieval API surface stays stable; tier and RRF are internals.
- **DO NOT** ship without a migration plan for existing flat-store blocks. Default existing blocks to `episodic` tier with a one-time backfill job; document the choice in the spec.

## Files in scope (architect locks at spec authoring)

- `server/db/schema/memoryBlocks.ts` — add `tier` column, possibly `last_accessed_at` if not present
- New migration file under `server/db/migrations/` for the tier column + default backfill
- `server/services/workspaceMemoryService/retrieve.ts` — RRF fusion
- `server/services/workspaceMemoryService/hybridRetrieval.ts` — graph retriever addition
- `server/services/workspaceMemoryService/extract.ts` — initial tier assignment on write
- `server/services/memoryBlockSynthesisService.ts` — tier promotion logic
- `server/jobs/memoryBlockSynthesisJob.ts` — extend to handle tier promotion
- `server/jobs/memoryDecayJob.ts` — tier-aware decay
- Possibly: new `server/db/schema/memoryBlockEdges.ts` for the graph layer
- Tests: pure functions for RRF scoring, decay computation, tier promotion rules

## Out of scope

- New memory write APIs for agents (the existing extract pipeline stays the input path)
- Cross-tenant memory sharing of any kind
- Memory export / import tooling
- A per-tenant UI for browsing the memory store (operator surface unchanged)
- Replacing the embedding model
- Memory-to-RAG integration with external knowledge bases

## Success criteria

1. Retrieval R@5 improves on a curated test set of 50 historical operator conversations (the spec author defines the test set during spec authoring).
2. Existing memory consumers (every site that calls `workspaceMemoryService.retrieve`) returns equivalent or better results, never worse, on the same queries.
3. Tenant isolation invariants hold under fuzz testing (no `organisation_id` or `subaccount_id` ever leaks across tier promotion or graph traversal).
4. Backfill of existing flat-store blocks completes idempotently on every existing tenant without manual intervention.

## What unblocks when this ships

- Personal Assistant agents stop asking the same context questions every conversation.
- Reporting Agents can reference decisions made weeks earlier without operator re-briefing.
- The procedural tier becomes a foundation for skill-replay (later capability: agent identifies a learned procedure and re-applies it).
- The graph retriever becomes reusable for any future feature that needs related-block discovery (e.g. cross-referenced support docs, related leads, parent-task chains).

## Concurrent safety note

This build is isolated from the other four repo-pattern lifts currently in flight. No file overlap with browser-vision-grounding, browser-hardening-primitives, or task-preview-mode. Safe to run fully concurrent with all of them.

## Provenance

External repo deep-dive 2026-05-17 surfaced agentmemory as the highest-leverage pattern from the weekly trend roundup. Operator-ratified: pattern lift only, no code adoption (Sheets row 1, column D records the decision).

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-tiered-consolidation/brief.md
```
