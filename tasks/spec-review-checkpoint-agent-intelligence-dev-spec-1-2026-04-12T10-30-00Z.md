# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/agent-intelligence-dev-spec.md`
**Spec commit:** `a0e6ad118b537a3585b6a852d528646c9926fe2b` (last committed; working tree has 7 mechanical fixes applied)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-12T10:30:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Note: Codex CLI failed both execution attempts (sandbox policy + unsupported model). Findings are rubric-only. Per agent spec, two Codex failures end the loop — but HITL findings are presented here for human resolution before the final report is written. Mechanical fixes (7 changes) have already been applied to the spec.

---

## Finding 1.1 — agent_data_sources embedding column: schema change or on-the-fly?

**Classification:** ambiguous
**Signal matched:** Under-specified contract + file inventory drift
**Source:** Rubric-unnamed-primitive + Rubric-file-inventory-drift
**Spec section:** Section 5.1D Two-pass context reranking for data sources

### Finding (verbatim from rubric)

Section 5.1D says "compute cosine similarity between `taskDescription` embedding and each lazy source's content embedding" and parenthetically adds "stored in `agent_data_sources.embedding` — new nullable column if not present, or computed on-the-fly." The `agent_data_sources` table has no `embedding` column. This column is NOT included in migration 0105. `server/db/schema/agentDataSources.ts` is not in the Phase 1 files table.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add `server/db/schema/agentDataSources.ts` to the Phase 1 files table as "Modify (add nullable `embedding vector(1536)` column)" and add the column to migration 0105 (moving it from Phase 1 to Phase 2 dependency). Alternatively, if on-the-fly, I would name the mechanism (e.g. "call `generateEmbedding(source.content)` at rank time, with no persistence") and note the latency implication. This is tentative — the human must choose.

### Reasoning

Phase 1 is explicitly "no migration." If the embedding column is a new schema column, it requires a migration, which either (a) pushes 1D to depend on Phase 2's migration 0105 or (b) adds a new migration for Phase 1. Both are sequencing changes. If on-the-fly, the embedding is computed at context-load time for each source — this is a latency concern for agents with many data sources, and the mechanism (which service, which function) is unspecified. The choice is non-trivial.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Phase 1 no-migration constraint is firm. Remove the stored-column option entirely. Clarify 5.1D to state: embedding is computed on-the-fly at rank time by calling the existing embedding service (e.g. generateEmbedding(source.content)) — no schema change in Phase 1. If embedding persistence is desired for performance, defer to Phase 2 with a new migration. Remove server/db/schema/agentDataSources.ts from Phase 1 files table and note the on-the-fly latency implication for agents with many data sources.
```

---

## Finding 1.2 — Agent briefing in dynamicSuffix busts prompt cache

**Classification:** directional
**Signal matched:** Cross-cutting signals: Change the Execution model section
**Source:** Rubric-invariants-not-enforced
**Spec section:** Section 6.2D (briefing placement) vs Section 4.0C (prompt partition table)

### Finding (verbatim from rubric)

Section 6.2D says the briefing is injected "At step 10 (workspace memory), prepend the briefing." Section 4.0C's partition table classifies sections 10+ as `dynamicSuffix`. This means the briefing — which changes only after each run (async, non-blocking) — is lumped with board state and workspace memory in the dynamic portion, and will cause cache misses on every run that has a briefing. This conflicts with the caching goal of 0C (40-60% prompt token cost reduction).

### Tentative recommendation (non-authoritative)

If this were mechanical, I would move the briefing injection to immediately after section 6 (Additional Instructions) in the `stablePrefix`, noting that the briefing updates infrequently relative to the run cadence and is stable for the duration of a single run. This would mean briefings only bust the stable cache when they are regenerated (post-run, async) — not on every run. This is tentative — the tradeoff between caching efficiency and briefing freshness is a product call.

### Reasoning

Two options:
- Keep briefing in dynamicSuffix (step 10): Briefing is always fresh (reflects latest run) but always busts the cache. For agents running frequently, this negates most of 0C's benefit when a briefing exists.
- Move briefing to stablePrefix (after section 6): Briefing is cached until regenerated (post-run async job). For a run starting immediately after the previous run completes, the briefing may be stale by one run — but for the vast majority of runs, it will be current. Cache efficiency is preserved.

The framing assumption is that briefings update infrequently relative to the run cadence. If agents run dozens of times per hour, this assumption may not hold.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Move briefing injection to stablePrefix, immediately after section 6 (Additional Instructions). Briefings update async post-run — they are stable for the full duration of a single run and only regenerate once after the previous run completes. One-run staleness is acceptable. Caching efficiency (preserving the 40-60% cost reduction goal of 0C) takes priority. Update 6.2D and the 4.0C partition table to reflect this placement.
```

---

## Finding 1.3 — Team roster (section 9) classified stable but positioned between dynamic sections

**Classification:** directional
**Signal matched:** Architecture signals: Change the interface of X
**Source:** Rubric-load-bearing-claims
**Spec section:** Section 4.0C multi-breakpoint caching, prompt partition table

### Finding (verbatim from rubric)

The prompt partition table in 4.0C classifies section 9 (Team roster) as Stable and includes it in `stablePrefix`. The current assembly order is: sections 1-8, then 9 (team roster), then 10-14. Anthropic's caching caches the content array from the start up to the last `cache_control` breakpoint. If section 9 is appended to the content array after the dynamic sections (7-8), the cache breakpoint after section 6 is what gets cached — section 9 would end up in the dynamicSuffix unless the prompt assembly code is changed to reorder the sections. The spec does not describe this reordering.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a note to Section 4.0C saying "The prompt assembly in `agentExecutionService.ts` must reorder sections so that section 9 (Team roster) immediately follows sections 1-6 in the content array, before sections 7-8 and 10-14. The cache_control breakpoint is placed after section 9 in the array." This makes the implementation requirement explicit. This is tentative — the decision to reorder the assembly is an architecture change.

### Reasoning

The reordering is implied by the partition but never stated. Without the reorder, section 9 (team roster) will either (a) appear in the dynamic portion (losing cache efficiency) or (b) require non-trivial changes to the prompt assembly loop in agentExecutionService.ts. The spec should either (a) accept that team roster goes in dynamic, or (b) explicitly describe the reorder. This affects what the implementer needs to do.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add an explicit note to Section 4.0C: "The prompt assembly in agentExecutionService.ts must reorder sections so that section 9 (Team roster) immediately follows sections 1-6 in the content array, before sections 7-8 and 10-14. The cache_control breakpoint is placed after section 9 in the array. This reorder is required for section 9 to be included in the stablePrefix cache."
```

---

## Finding 1.4 — 1C (graph expansion) placed in Week 4 with Phase 2 items

**Classification:** directional
**Signal matched:** Sequencing signals: Ship this in a different sprint
**Source:** Rubric-sequencing
**Spec section:** Section 8.4 Suggested sprint plan

### Finding (verbatim from rubric)

Item 1C (graph expansion) is placed in Week 4 alongside 2C (hierarchical metadata) and 2D (agent briefings). But 1C's only dependency is Phase 0 (specifically 0A, unified retrieval), which ships in Week 1. All other Phase 1 items (1A, 1B, 1D) ship in Week 2. There is no stated reason in the spec for deferring 1C to Week 4 — it appears to be capacity planning.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would move 1C to Week 2 alongside 1A/1B/1D, making the sprint plan match the dependency graph more directly. This is tentative — the Week 4 placement may be deliberate (capacity, risk management, wanting 2A's temporal validity before graph expansion).

### Reasoning

Moving 1C to Week 2 would tighten the sprint plan. Keeping it in Week 4 may be intentional (graph expansion is the most speculative Phase 1 feature and may be lower priority than briefings/state summaries). The human should confirm whether the Week 4 placement is deliberate or an oversight.

### Decision

```
Decision: reject
Reject reason (if reject): Week 4 placement is deliberate. Graph expansion is the most speculative Phase 1 feature. Keeping it after Phase 2A (temporal validity) ships in Week 3 makes it more robust — graph nodes will have proper temporal scoping before expansion logic runs. Capacity and risk management also favour the later slot.
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and — since Codex failed both attempts — will write the final report directly (loop exits per "two consecutive Codex failures" rule).

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately.
