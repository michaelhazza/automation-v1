# Spec Review Final Report

**Spec:** `docs/agent-intelligence-dev-spec.md`
**Spec commit at start:** `a0e6ad118b537a3585b6a852d528646c9926fe2b` (last committed; working tree carries all applied changes)
**Spec commit at finish:** working tree (uncommitted — 7 mechanical + 3 HITL-resolution edits applied since last commit)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 1 of 5
**Exit condition:** two-consecutive-codex-failures (Codex CLI failed both attempts in iteration 1 — sandbox policy + unsupported model; per agent spec, two consecutive Codex failures exit the loop)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----------------|-----------------|----------|----------|-------------|-----------|-------------|
| 1 | 0 (Codex failed) | 11 | 7 | 0 | 3 | 1 | resolved |

---

## Mechanical changes applied

All 7 mechanical changes were applied prior to the HITL checkpoint. Summarised below grouped by spec section.

### Section 0B — Query sanitisation

- Added `MAX_CLEAN_LENGTH = 500` constant (renamed from unnamed) to `queryCleanerPure.ts` contract, making the truncation bound concrete rather than implicit.

### Section 4.0C — Multi-breakpoint prompt caching

- Removed a contradictory statement that said "stable sections are cached as a single block" while also describing two cache breakpoints.

### Section 5.1A — Intent-adaptive search weights

- Fixed stale reference to `getRelevantMemories()` in the Files table that should have been `_hybridRetrieve()` (the unified path introduced by 0A).

### Section 5.1B — Profile-based RRF weight tuning

- Added missing verdict line (was unlabelled; now explicitly: BUILD IN PHASE 1).

### Section 6.2C — Hierarchical metadata

- Fixed file inventory drift: `server/db/schema/workspaceMemories.ts` was missing from the Phase 2 files table despite being modified by this item.

### Section 8.4 — Sprint plan

- Corrected a sequencing bug where Phase 0 items were listed after Phase 1 items in the Week 1 column of the sprint plan table.
- Fixed a stale reference: "verify in staging between sprints" language removed from the Risk section (project is pre-production; staged rollout posture is retired per spec-context).

---

## Rejected findings

None — all mechanical findings were accepted.

---

## Directional and ambiguous findings (resolved via HITL)

### Finding 1.1 — agent_data_sources embedding column: schema change or on-the-fly?

- **Iteration:** 1
- **Classification:** ambiguous
- **Human's decision:** apply-with-modification
- **Modification applied:**
  - Section 5.1D: removed the "stored in `agent_data_sources.embedding`" option entirely. Clarified that embedding is computed on-the-fly at rank time via `generateEmbedding(source.content)`. No schema change in Phase 1. Added latency note for agents with many eager data sources. Deferred embedding persistence to Phase 2 explicitly.
  - Section 7.3A step 3 (task context enrichment): added matching on-the-fly clarification for the lazy source embedding query.
  - `server/db/schema/agentDataSources.ts` is NOT added to the Phase 1 files table (no schema change in Phase 1).

### Finding 1.2 — Agent briefing in dynamicSuffix busts prompt cache

- **Iteration:** 1
- **Classification:** directional
- **Signal matched:** Cross-cutting signals: Change the Execution model section
- **Human's decision:** apply-with-modification
- **Modification applied:**
  - Section 6.2D: updated the integration note to place briefing injection into `stablePrefix` immediately after section 6 (Additional Instructions), before section 9 (Team roster). Added rationale: briefings update async post-run, are stable for the full run duration, and one-run staleness is acceptable. Caching efficiency (preserving 40-60% cost reduction of 0C) takes priority.
  - Section 4.0C partition table: added "Agent Briefing (added by 2D)" as a Stable row, positioned after section 6 and before section 9 in assembly order. Updated breakpoint description to include Agent Briefing in stablePrefix.

### Finding 1.3 — Team roster (section 9) classified stable but positioned between dynamic sections

- **Iteration:** 1
- **Classification:** directional
- **Signal matched:** Architecture signals: Change the interface of X
- **Human's decision:** apply-with-modification
- **Modification applied:**
  - Section 4.0C: added explicit "Assembly reorder requirement" paragraph stating that `agentExecutionService.ts` must reorder sections so section 9 (Team roster) and the Agent Briefing immediately follow sections 1-6 in the content array, before sections 7-8 and 10-14. States that the `cache_control` breakpoint is placed after section 9. Notes that without this reorder, section 9 would appear in the dynamic portion and negate cache efficiency.
  - Partition table reordered to show stable sections (1-6, Briefing, 9) before dynamic sections (7-8, 10-14) — reflects the required assembly order visually.

### Finding 1.4 — 1C (graph expansion) placed in Week 4 with Phase 2 items

- **Iteration:** 1
- **Classification:** directional
- **Signal matched:** Sequencing signals: Ship this in a different sprint
- **Human's decision:** reject
- **Reject reason:** Week 4 placement is deliberate. Graph expansion is the most speculative Phase 1 feature. Keeping it after Phase 2A (temporal validity) ships in Week 3 makes it more robust — graph nodes will have proper temporal scoping before expansion logic runs. Capacity and risk management also favour the later slot.
- **Change applied:** none.

---

## Open questions deferred by `stop-loop`

None — the loop exited on two-consecutive-Codex-failures, not a human stop-loop decision. No findings were left unresolved.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric (Codex was unavailable both attempts; all 11 rubric-sourced findings have been resolved). The human has adjudicated every directional and ambiguous finding that surfaced.

However:

- The review did not get a Codex pass. Codex was unavailable in iteration 1 (sandbox policy + unsupported model). There may be classes of finding that the rubric does not catch and that a full Codex review would surface. If the spec is used for a major build, consider re-running spec-reviewer once Codex is available (this would count as iteration 2 of 5 remaining).
- The review did not re-verify the framing assumptions. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's Implementation philosophy / Execution model / Headline findings sections before calling the spec implementation-ready.
- The review did not catch directional findings that the rubric did not see.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**Known limitation of this review:** Codex CLI failed both attempts (exit 2, sandbox policy restriction + unsupported model error). All 11 findings are rubric-sourced. The spec has been cleaned of every class of mechanical error the rubric checks — contradictions, stale language, file inventory drift, schema overlaps, sequencing bugs, load-bearing claims without contracts, unnamed primitives. The directional findings (1.1-1.3) have been resolved per human decision.

**Recommended next step:** read the spec's framing sections (first ~200 lines) one more time, confirm the headline findings match your current intent, and then invoke `architect` or start implementation.
