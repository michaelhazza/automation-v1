# Spec Review Log — memory-tiered-consolidation — Iteration 3

**Spec:** post-iter-2
**Codex output:** `tasks/review-logs/_codex_memory-tiered-consolidation_iter3_2026-05-18T00-57-48Z.txt`
**Findings:** 10. All mechanical. All iter-2 ripples.

## Findings & dispositions

- **F1** §6 Phase 4 PromotionSignals one-liner still says signals computed from `last_accessed_at` + run-history + version-recency. Conflicts with §9.3 lock. → auto-apply: replace with §9.3 wording.
- **F2** §6 Phase 5 audit script path still has fallback to `scripts/gates/`. Conflicts with §13.1 lock. → auto-apply: drop fallback.
- **F3** §6 Phase 5 says each check returns `pass | warn | fail`. §9.7 + §13.3 now include `n/a`. → auto-apply.
- **F4** §8 dispatcher row still describes UPDATE + lineage + emit, omits version mint and outbox. → auto-apply: align with §6 Phase 4 transaction.
- **F5** Transaction order inconsistency: §6 Phase 4 auto path says UPDATE then mint version; §14.7 procedural says mint version then UPDATE. → auto-apply: pick canonical order (validate → guarded UPDATE → mint version → lineage → commit → outbox emit) and apply everywhere. The auto-path ordering is correct because the UPDATE's predicate `consolidation_tier = $oldTier` is the race-loss check — if you mint the version before the UPDATE, a race-loss leaves a dangling version row. Procedural path must align.
- **F6** Check 2 reconciliation key uses prior version's `tier_at_capture as oldTier`, but content-edit versions have `tier_at_capture = null`. → auto-apply: add `old_tier_at_capture text NULL` column to `memory_block_versions` (same migration); promotion-version rows carry both `tier_at_capture` (new tier) and `old_tier_at_capture` (prior tier).
- **F7** §14.1 says LAEL uses `(run_id, sequence)` uniqueness for promoted event; §14.2 + §14.4 say canonical key is `(blockId, oldTier, newTier, configVersion)` and physical duplicates may occur. → auto-apply: rewrite §14.1 row for the event.
- **F8** §14.1 uses `'resolved'` for review-queue status; rest of spec uses `'approved' | 'rejected'`. → auto-apply.
- **F9** Migration inventory asymmetric: Phase 1 lists a `.down.sql` file separately; Phase 4 migrations describe down behavior inline. → auto-apply: add Phase 4 `.down.sql` files OR drop the Phase 1 `.down.sql` row. Going with the consistent approach: drop the explicit `.down.sql` row since the codebase's existing migration convention is up + down in the same up.sql file per `ls server/db/migrations` patterns. (Actually — let me check.)
- **F10** §9.3 JSONB-path predicate deferred to architect. Codex correctly notes this leaves a core contract under-specified. → auto-apply: pin the path against §9.6 (`memory.retrieved.topEntries[].blockId` is the persisted field name).

## Iteration 3 Summary

- accepted: 10
- rejected: 0
- directional: 0
- ambiguous: 0

This is the third consecutive mechanical-only round. All 10 fixes applied.

F9 resolution refined after checking migration convention: the repo HAS `.down.sql` files (103 of them under `migrations/`), so the right fix is to ADD explicit down rows for the Phase 4 migrations, not drop the Phase 1 down. Applied accordingly.

Stopping heuristic: three consecutive mechanical-only rounds with descending finding counts (35 → 15 → 10) — clear convergence trajectory. Running iter 4 to verify no further mechanical issues remain (cap is 5; we have budget for 2 more if needed).

