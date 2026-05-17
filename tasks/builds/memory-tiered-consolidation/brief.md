# Brief — Tiered memory consolidation + RRF hybrid retrieval

**Status:** DRAFT v3.1 (2026-05-18) — provenance-claim disclaimer added — spec-ready
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

## Governance invariants

Memory is data, not policy. These invariants are non-negotiable and apply across all four tiers:

1. **Advisory, not authoritative.** Retrieved memory informs agent reasoning but cannot bypass `PolicyEnvelopeResolver` enforcement. Every privileged action still passes through the existing policy gate.
2. **Procedural memory does not confer execution authority.** A stored procedure is a hint to a human-or-policy-approved workflow, never a trigger for autonomous privileged action. In v1, procedural retrieval feeds prompts only; it does not bypass approval gates.
3. **Synthesised memory remains untrusted output.** Consolidation outputs pass through the existing extraction / safety normalisation pipeline before entering the store.
4. **Consolidation cannot mutate audit history.** Tier promotion, decay, and edge inference write new rows or update mutable score columns; they never rewrite immutable provenance, citations, or original-block content.
5. **Tenant scoping is enforced at SQL.** No tier promotion, graph traversal, or RRF fusion ever crosses `organisation_id` × `subaccount_id`. RLS continues to be the canonical enforcement layer.
6. **Deletion and redaction cascade through derived data.** Memory deletion, redaction, or tenant cleanup propagates to derived memories, reinforcement records, retrieval traces, and graph edges. Inferred edges and persisted retrieval traces are never orphan survivors of a source block being removed.

## Proposed approach (for the architect to evaluate)

### Tier 1: Schema extension

Add a `tier` column to `memory_blocks` (enum: `working`, `episodic`, `semantic`, `procedural`). Working = recent observations, fast decay (default 7 days). Episodic = specific events / conversations, medium decay (30 days). Semantic = consolidated facts / learnings, slow decay (180 days). Procedural = workflows / how-to-do-X, no automatic decay.

### Tier 2: Consolidation job

Extend `server/jobs/memoryBlockSynthesisJob.ts` to promote blocks across tiers based on **multi-signal reinforcement**, not access count alone. Candidate signals (architect locks the weighting at spec): recency, reinforcement count, contradiction score, retrieval-success score, agent confidence, operator reinforcement, cross-session recurrence. Working → episodic when reinforcement crosses a low threshold. Episodic → semantic when N related episodes consolidate into a generalised fact. Episodic → procedural when the pattern is a repeatable procedure AND clears a **higher threshold** than the other tiers — procedural memory's downstream blast radius is larger, so the bar is higher. Procedural promotion may require explicit operator confirmation or stronger reinforcement signals; architect decides at spec.

### Tier 3: Ebbinghaus decay function

Decay weight = e^(-t/S) where t is time since last access and S is tier-specific strength. Higher tiers have larger S (slower decay). Reinforcement on access resets the timer.

Implementation invariants:
- **Compute decay at retrieval time, not at write time.** Avoids hot-row updates, write amplification, and audit noise.
- **Reinforcement-on-access is async or sampled, never synchronous-per-retrieval.** Prefer batched async updates or probabilistic reinforcement sampling. Every retrieval mutating a row is unacceptable at tenant scale (contention, replication traffic, distorted activity timestamps).

### Tier 4: RRF hybrid retrieval

Replace the current single-mode retrieval (in `server/services/workspaceMemoryService/retrieve.ts` and `hybridRetrieval.ts`) with RRF fusion of three retrievers:
1. **Keyword** — Postgres full-text search (existing).
2. **Vector** — pgvector cosine distance (existing).
3. **Graph** — citation / parent / related-block edges (new lightweight join).

RRF score = sum over retrievers of 1 / (k + rank_i), with k=60 (standard). Tier-weighted: working tier results get a multiplier, procedural tier results get a smaller multiplier in conversational contexts.

**Graph edge governance (architect locks at spec):** edge creation rules (who/what creates edges, explicit vs inferred), directionality, edge-confidence scoring, deletion semantics, contradiction handling, cycle handling, traversal-depth ceiling, and per-node fan-out cap. Inferred edges (if used) must carry confidence scores and be distinguishable from explicit edges. Graph traversal is bounded; no unbounded BFS.

### Tier 5: Multi-tenant safety

Every retrieval and consolidation operation MUST scope by `organisation_id` AND `subaccount_id` enforced at the SQL layer (RLS continues to apply). The architect confirms that the new tier column and any new graph-edge table inherit the existing RLS policies before merge.

## Operational constraints

Hybrid retrieval must remain bounded and predictable under tenant-scale workloads. The spec defines explicit ceilings for:

- **Graph traversal depth** and per-node fan-out cap.
- **Per-tier retrieval caps** and overall candidate-set ceiling before RRF fusion.
- **Retrieval latency budget** (p95 target; see success criteria).
- **Synthesis batch limits** for the consolidation job.

## Determinism & replayability

Agents grounded in this memory must be debuggable months later. The spec locks:

- **Versioned retrieval configuration.** Tier multipliers, RRF k, and per-retriever weighting are stored as a versioned config (not hardcoded); every retrieval records the config version it ran against.
- **Traceable retrieval decisions.** For each agent run, the top-k candidate set, per-retriever ranks, and final RRF scores are persisted (or recomputable from persisted seeds) so a run can be replayed with identical ordering.

## Rollout & rollback

Because this change reshapes retrieval ranking globally, the rollout is gated:

- **Behaviour flag required.** Hybrid retrieval and tier-aware decay ship behind a behaviour flag and stay flagged until validated against the curated evaluation set.
- **Rollback restores flat retrieval without schema rollback.** Flipping the flag off must return retrieval ordering to today's behaviour using the existing keyword+vector path. The `tier` column and any new graph-edge tables remain in place (unused) so we never need to reverse a migration to recover.

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
- Procedural memory granting autonomous execution authority (procedures feed prompts; they do not bypass approval or policy gates in v1)

## Success criteria

1. Retrieval R@5 improves on a curated test set of 50 historical operator conversations (the spec author defines the test set during spec authoring).
2. Existing memory consumers (every site that calls `workspaceMemoryService.retrieve`) preserve API compatibility and pass the regression evaluation set. Any degraded query class must be documented, justified, and accepted before flag flip.
3. Tenant isolation invariants hold under fuzz testing (no `organisation_id` or `subaccount_id` ever leaks across tier promotion or graph traversal).
4. Backfill of existing flat-store blocks completes idempotently on every existing tenant without manual intervention.
5. **p95 retrieval latency stays within budget.** Architect locks the number at spec; baseline is current `workspaceMemoryService.retrieve` p95. Hybrid retrieval must not materially slow agents.
6. **Retrieval is replayable.** Given the same query, the same memory store, and the same retrieval-config version, RRF ordering reproduces identically.

## What unblocks when this ships

- Personal Assistant agents stop asking the same context questions every conversation.
- Reporting Agents can reference decisions made weeks earlier without operator re-briefing.
- The procedural tier becomes a foundation for skill-replay (later capability: agent identifies a learned procedure and re-applies it).
- The graph retriever becomes reusable for any future feature that needs related-block discovery (e.g. cross-referenced support docs, related leads, parent-task chains).

## Concurrent safety note

This build is isolated from the other four repo-pattern lifts currently in flight. No file overlap with browser-vision-grounding, browser-hardening-primitives, or task-preview-mode. Safe to run fully concurrent with all of them.

## Provenance

External repo deep-dive 2026-05-17 surfaced agentmemory as the highest-leverage pattern from the weekly trend roundup. Operator-ratified: pattern lift only, no code adoption (Sheets row 1, column D records the decision).

External performance and popularity claims (89k stars, R@5 95.2% on LongMemEval-S, flat-store baselines under 70%) are provenance context only; spec acceptance must rely on our own curated evaluation set, regression results, and tenant-safety tests.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-tiered-consolidation/brief.md
```
