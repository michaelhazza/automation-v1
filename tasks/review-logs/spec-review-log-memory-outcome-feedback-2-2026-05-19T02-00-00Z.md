# Spec Review Log — memory-outcome-feedback — Iteration 2

- Date: 2026-05-19
- Spec commit at start: `5d17c42a` (iter1 output)
- Codex output: `tasks/review-logs/_codex_memory-outcome-feedback_iter2_2026-05-19T02-00-00Z.txt`
- Codex findings: 12 (all new; Codex acknowledged the framing constraint and stayed inside the spec-consistency lane)
- Rubric findings (Claude-side): 0 additional

## Dispositions

All 12 findings are mechanical consistency fixes. All 12 applied. No reclassifications. No rejections.

- **F1 — decisionId backing store.** §3.4 / §3.5 / §4.5.2 now state `decisionId === conversation_messages.id` (no new column or table).
- **F2 — `(run_id, entry_id, source)` collapses repeat approval decisions.** §10.3 adds rule (b.1): first approval signal sticks; second decision counted as `idempotent`. §18 adds the deferred per-decision-re-scoring item.
- **F3 — Cap lock + flush in same tx.** §4.6 now mandates synchronous flush rides the same `tx` that acquired the advisory lock; `recordOutcomeFeedback` accepts an explicit `tx`.
- **F4 — `written` counted at buffer time.** §4.5 step 5/6 now uses `buffered` at buffer time and resolves to final `written`/`idempotent`/`errors` after flush.
- **F5 — idempotent-only success/partial.** §10.4 / §10.5 rewritten to make `(written + idempotent) > 0` the forward-progress predicate; pure-idempotent retries → `success`.
- **F6 — Goal 1 overstates fail.** §1 G1 narrowed to "fail with reject OR rollback".
- **F7 — Derived metric needs classification breakdown.** §6.5 splits `counts.written` into `{ positive, negative }`.
- **F8 — `memory.retrieved` enrichment query.** §6.5 documents a SECOND batched query (not the §4.7 aggregator) populating last-event fields.
- **F9 — Check 9 `tier_at_apply` doesn't exist.** §14 SQL now uses `e.tier`.
- **F10 — Check 8 only checks entry_id.** §14 adds a parallel `run_id` cross-tenant scan.
- **F11 — Config normalisation ownership.** §16 moves the normalisation helper onto `server/config/memoryConsolidationConfig.ts` (was ambiguous between there and `shared/types/memoryConsolidation.ts`).
- **F12 — File count double-counts migration.** §16 separates the migration count from source-file count; ABCd Build updated.

## Iteration 2 counts

- Mechanical findings accepted:  12
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified -> directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set after auto-commit step)

This is a mechanical-only round. Per the stopping heuristic, iteration 3 must run (one more iteration to confirm two-consecutive-mechanical-only convergence).
