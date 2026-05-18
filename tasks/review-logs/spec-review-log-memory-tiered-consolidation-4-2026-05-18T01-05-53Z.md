# Spec Review Log — memory-tiered-consolidation — Iteration 4

**Findings:** 6. All mechanical. All stale-prose cleanup.

- F1 §8 memoryReviewQueueService row: still describes old transaction order — auto-apply align with §6 Phase 4 / §14.7 canonical order.
- F2 §18 phase-dependency check still says "Two migrations total" — auto-apply: change to "Three migrations".
- F3 §18 load-bearing claims line says `lineage_event_type` (the iter-1 wrong name) — auto-apply: change to `change_source`.
- F4 §7 phase dependency note for memory_block_versions migration omits `old_tier_at_capture` — auto-apply.
- F5 §8 memoryDecayJob.ts entry still says "materialises last-access projections" (iter-1 missed this; iter-2 caught §11.4 but not §8) — auto-apply: change to logging-only wording.
- F6 §3 Goal 5 / §18 numeric reconciliation use snake_case `reinforcement_count`/`cross_session_recurrence` — auto-apply: normalize to camelCase to match §9.3 contract.

## Iteration 4 Summary

- accepted: 6
- rejected: 0
- directional: 0
- ambiguous: 0

Trajectory: 35 → 15 → 10 → 6. Diminishing returns — next iteration will likely return zero or near-zero. Iter 5 (cap) recommended as final verification pass.
