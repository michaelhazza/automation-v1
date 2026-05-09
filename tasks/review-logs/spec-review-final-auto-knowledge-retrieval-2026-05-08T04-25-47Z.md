# Spec Review Final Report

**Spec:** `tasks/builds/auto-knowledge-retrieval/spec.md`
**Spec commit at start (iter 1):** `9dc2782b03b0e2362be933a8313cb3a527f62662`
**Spec commit at finish (iter 5):** `ec39dc30d5156aed3e708029a6b554e1cb20b790`
**Spec-context source:** `docs/spec-context.md` (last_reviewed_at: 2026-05-05; staleness green)
**Iterations run:** 5 of 5 (lifetime cap reached)
**Exit condition:** iteration-cap (lifetime MAX_ITERATIONS = 5 hit; loop continued producing material findings each iteration so the cap was the controlling constraint, not convergence)
**Verdict:** READY_FOR_BUILD (mechanically tight; directional review handed to operator via `chatgpt-spec-review` and `handoff.md`)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Mechanical accepted | Mechanical rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 8  | 0 | 8 | 0 | 1 (treated as mechanical: spec-vs-framing alignment) | 0 | 0 |
| 2 | 2  | 0 | 2 | 0 | 0 | 0 | 0 |
| 3 | 5  | 0 | 5 | 0 | 0 | 0 | 0 |
| 4 | 3  | 0 | 3 | 0 | 0 | 0 | 0 |
| 5 | 2  | 0 | 2 | 0 | 0 | 0 | 0 |
| **Total** | **20** | **0** | **20** | **0** | **1** | **0** | **0** |

Every finding was classified as mechanical and applied. No finding required directional adjudication or operator deferral.

---

## Mechanical changes applied

### §1 + §9 (framing alignment)
- Removed the "Phase 5 can ship before Phase 4 if gated behind a server feature mode" sentence — violates `feature_flags: only_for_behaviour_modes` (iter 1).

### §2 / §11 (observability sequencing)
- Promoted `retrieval.summary` event emission from Phase 7 to Phase 4 to satisfy brief §9 day-one requirement; only the operator-facing surfaces remain in Phase 7 (iter 1).

### §3 (extended primitives)
- `reference_documents` now also gains `active_embedding_model` (active-generation pointer) and `retrieval_version_id` (retrieval-version pointer) (iters 3, 4).

### §5 (file inventory)
- Added migration `0291a_document_promotion_audit.sql` and matching schema file (iter 1).
- Added migration `0291b_agent_execution_events_retrieval_summary_unique.sql` for terminal-event uniqueness (iter 1).
- Reserved `0292_retrieval_events.sql` as deferred (iter 2).
- Updated `0288` migration to include the new pointer columns (iters 3, 4).
- Restated `retrievalObservabilityService` phase split (Phase 4 emit, Phase 7 read aggregates) (iter 3).

### §6 (contracts)
- `AddToKnowledgeRequest` now supports all five scopes including `recurring_task` and `task_instance` (iter 1).
- `RetrievalResult` is now document-level for documents with chunk-level fan-out nested under `chunkIds`; below-threshold rejections include per-document sample (iter 4).
- Source-of-truth precedence table now declares the two-pointer split (`current_version_id` for content, `retrieval_version_id` for retrieval) and the `active_embedding_model` pointer (iters 4, 5).
- §6.7 canonicalised on `agent_execution_events` storage; "Option B" demoted to deferred reservation (iter 2).
- §6.5 promotion-transaction description tightened to match §5.5 / §8 (iter 1).

### §8 (execution model)
- Re-embed row idempotency key updated to the 3-column `(version_id, chunk_index, embedding_model)` (iter 3).
- Add-to-Knowledge promotion description tightened to make the audit-row idempotency anchor explicit and the post-commit `expiresAt` flip explicit (iter 1).

### §10 (execution-safety contracts)
- Chunk uniqueness key consistently `(version_id, chunk_index, embedding_model)` across §10.1, §10.3, §10.6 (iters 2, 3).
- `document_promotion_audit` idempotency key clarified as `UNIQUE (file_id) WHERE deleted_at IS NULL` (iter 3).
- Terminal event uniqueness now backed by partial unique index on `agent_execution_events` (iter 1).

### §12 (tenant isolation)
- Predicates now named for all five scopes (org / sub-account / agent / recurring task / task instance) plus a defence-in-depth re-assertion at the ranker (iter 1).

### §13 (lifecycle)
- §13.1 split-pointer document-edit flow explicitly described (`current_version_id` flips on save; `retrieval_version_id` flips after chunking) (iter 4).
- §13.3 embedding-model upgrade flow rewritten with `active_embedding_model` atomic-flip semantics (iters 3, 4, 5).

### §15 (deferred items)
- Added the `0292_retrieval_events.sql` deferral with reservation rationale (iter 2).

### §16 (self-consistency)
- Updated load-bearing-claim mechanism descriptions to reflect the two-pointer architecture (iter 4).

### §18 (open questions)
- Question 7 (observability storage A vs B) closed — A is canonical (iter 3).

---

## Rejected findings

None. Every finding was accepted as mechanical and applied.

---

## Directional and ambiguous findings (autonomously decided)

One finding (iter 1, "observability is day-one per brief vs Phase 7 in spec") was on the boundary between mechanical and directional. Classified as mechanical because:
- The brief is the authoritative framing source (the spec must align with the brief, not vice versa).
- The fix did not introduce new scope, new tables, or new external behaviour — it shifted emission to an earlier phase that was already named in the spec.
- The fix does not contradict any baked-in framing assumption.

No findings required `tasks/todo.md` deferral. No AUTO-DECIDED items.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against five rounds of Codex review. Every load-bearing claim has a named DB-level mechanism. Every cross-section reference is consistent. Every contract has a worked example.

**The human still owns directional verification:**

1. The two-pointer pattern (`current_version_id` for content, `retrieval_version_id` for retrieval) is novel for this codebase — verify it does not conflict with existing reference-document consumers.
2. `active_embedding_model` is a per-document pointer, not global. Verify this matches the operator mental model for a multi-tenant migration to a new embedding provider.
3. The decision to emit observability events into the existing `agent_execution_events` ledger (vs a dedicated table) is canonical for v1 but non-trivial — confirm event volume won't swamp the ledger before merge.
4. Phase 5 ships UI before Phase 7 ships observability surfaces — verify the operator-facing copy in §10.5 ("Some always-available documents could not be loaded due to context limits") is acceptable in the absence of the full diagnostic surface.
5. Five-tier scope CHECK constraints on `reference_document_data_sources` are described in prose — confirm the constraint shape matches the existing scope-key conventions in this repo (`agent_data_sources` uses mutually-exclusive scope columns; this new table follows the same pattern).

These five points are the directional surface for `chatgpt-spec-review` (Step 8 of the Phase 1 pipeline) to focus on.

---

## Lifetime iteration cap reached

The spec hit `MAX_ITERATIONS = 5` (per `.claude/agents/spec-reviewer.md`). Each round produced material findings (8, 2, 5, 3, 2 — total 20) and all were applied. The loop did not converge to "two consecutive mechanical-only rounds with zero findings" because each fix exposed a subsequent cross-section consistency issue. This is normal for a spec of this size and ambition (Major scope, multi-phase, new primitives, new state machine). Further mechanical review is paused per the lifetime cap.

The spec is handed to `chatgpt-spec-review` (manual mode, operator-driven) for directional adjudication. Per `spec-coordinator` Step 7 contract, this is non-blocking: the build proceeds even if `spec-reviewer` reaches the cap.

---

## Iteration scratch logs

Raw Codex output preserved at:
- `tasks/review-logs/spec-review-codex-iter1-2026-05-08T04-25-47Z.txt`
- `tasks/review-logs/spec-review-codex-iter2-2026-05-08T04-25-47Z.txt`
- `tasks/review-logs/spec-review-codex-iter3-2026-05-08T04-25-47Z.txt`
- `tasks/review-logs/spec-review-codex-iter4-2026-05-08T04-25-47Z.txt`
- `tasks/review-logs/spec-review-codex-iter5-2026-05-08T04-25-47Z.txt`
