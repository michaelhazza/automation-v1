# Dual Review Log — memory-tiered-consolidation

**Files reviewed:** branch `memory-tiered-consolidation` against `main` (~70 files, 20k+ insertions across server, migrations, audit script, UI, docs)
**Iterations run:** 3 / 3
**Timestamp:** 2026-05-18T06:39:50Z
**Codex version:** v0.125.0 (model `gpt-5.5`, approval `never`, sandbox `read-only`)
**Prior review state at entry:** spec-conformance CONFORMANT_AFTER_FIXES (1d4bbe62), adversarial CH-1+CH-2 closed (c9914bfa), pr-reviewer round 2 APPROVED after fix-loop (ca04b55d), reality-checker NEEDS_DISCUSSION resolved via spec amendment (ad04134d).

---

## Iteration 1

**Codex transcript:** `/tmp/codex_iter1_2026-05-18T06-16-57Z.txt`. Invoked `codex review --base main` (no prompt — CLI v0.125 rejects positional prompts with `--base`).

### [ACCEPT] migrations/0371_*.sql:1-3 — item_type check constraint not updated for `promote_to_procedural` (P1)
Migration 0139 enumerates the three legacy item types. 0371 adds columns + partial unique index but never drops/recreates the CHECK. Every dispatcher INSERT with `itemType: 'promote_to_procedural'` would fail with a check-constraint violation — the entire operator-approved promotion path is broken.

Fix: in 0371 added `ALTER TABLE memory_review_queue DROP CONSTRAINT IF EXISTS memory_review_queue_item_type_check; ALTER TABLE memory_review_queue ADD CONSTRAINT ... CHECK (item_type IN (...four values...));`. Down migration restores pre-0371 shape.

### [ACCEPT] hybridRetrieval.ts:420-422 — tier lens applied after final topK truncation (P2)
Spec §6 Phase 3 + §12 G1 say the tier boost affects "selected memory IDs", not just ordering. Applying the lens AFTER `slice(0, topK)` means tier-boosted entries at rank topK+1 can never enter the returned set.

Fix: moved the tier-lens block before `slice(0, topK)`. Flag-OFF path stays gated on `tierLensEnabled` so slice operates against pre-build ordering — flag-OFF byte-identity preserved.

### [ACCEPT] memoryConsolidationPromotionDispatcher.ts:88 — `LIMIT 1000` with no ORDER BY and no eligibility filter (P2)
SELECT loads non-deleted rows .limit(1000) with no ORDER BY and no SQL-side filter on procedural — waste + nondeterminism + coverage hole.

Fix (minimal scope): added `ne(consolidationTier, 'procedural')` to WHERE and `orderBy(asc(id))` for determinism. Full-population pagination deferred to `tasks/todo.md`.

### [REJECT] memoryConsolidationPromotionDispatcher.ts:206-216 — no `memory.block.promoted` LAEL event emitted (P2)
Explicit operator-approved spec deviation (2026-05-18, spec lines 69-70 and 222): event call deferred until `AppendEventInput.runId` is nullable AND `AgentExecutionSourceService` is extended. Deviation captured in `tasks/todo.md` lines 2038, 2050. Audit Check 2 reconciles emitted events against `workspace_memory_entry_tier_transitions` rows — the durable transition row IS the canonical audit trail in v1.

---

## Iteration 2

**Codex transcript:** `/tmp/codex_iter2_2026-05-18T06-26-43Z.txt`.

### [ACCEPT] migrations/0371_*.down.sql:7-9 — rollback restores narrower constraint without removing rows it forbids (P2)
The iter-1 down patch restored the narrower constraint but did NOT delete the procedural-promotion rows the up-migration's constraint allowed. Rollback would fail at the `ADD CONSTRAINT` step in any environment with queued rows.

Fix: in the down migration, after `DROP CONSTRAINT IF EXISTS`, added `DELETE FROM memory_review_queue WHERE item_type = 'promote_to_procedural';` BEFORE the `ADD CONSTRAINT` restore. Rollback is now safe regardless of queued data.

---

## Iteration 3

**Codex transcript:** `/tmp/codex_iter3_2026-05-18T06-32-00Z.txt`.

### [ACCEPT] hybridRetrieval.ts:450 — lens has no over-retrieve pool when reranker is OFF (P2)
With `RERANKER_PROVIDER=none` (default), SQL fetches `retrieveLimit = topK`, so the moved lens still has no candidates beyond rank topK to promote from. Iter-1 fix was incomplete in the default config.

Fix (minimal scope): when `tierLensEnabled === true`, bump `retrieveLimit` to `max(baseRetrieveLimit, topK * RRF_OVER_RETRIEVE_MULTIPLIER)`. The 4× matches internal CTE multipliers already used elsewhere; cost stays bounded. Flag-OFF preserves `baseRetrieveLimit` — byte-identical. Also cached the flag read into a `tierLensEnabled` local and reused it for the access-counter branch, per spec G1's per-call caching contract.

### [REJECT] memoryConsolidationPromotionDispatcher.ts:94 — fixed limit can starve later candidates (P2)
Substantively identical to iter-1 finding #3, already accepted with documented scope-limit. Spec does not require full coverage per pass in v1; production flag is OFF; staging audit Check 1 surfaces stagnation if coverage becomes a problem before flag-flip. Pagination is tracked in `tasks/todo.md`.

---

## Changes Made

- `migrations/0371_memory_review_queue_procedural_promotion.sql` — add DROP/ADD CHECK CONSTRAINT block including `promote_to_procedural` (iter 1).
- `migrations/0371_memory_review_queue_procedural_promotion.down.sql` — restore pre-0371 constraint AND delete procedural-promotion rows before re-add (iter 1 + iter 2).
- `server/services/memoryConsolidationPromotionDispatcher.ts` — add `ne(consolidationTier,'procedural')` + `orderBy(asc(id))`; new imports `ne, asc` (iter 1).
- `server/services/workspaceMemoryService/hybridRetrieval.ts` — move tier-lens block before `slice(0, topK)`; cache `tierLensEnabled`; bump `retrieveLimit` to `topK * RRF_OVER_RETRIEVE_MULTIPLIER` when flag ON (iter 1 + iter 3).
- `tasks/todo.md` — append "Deferred from dual-reviewer (Codex)" block documenting full-population pagination deferral.

Verification: `npm run lint` 0 errors (874 warnings unchanged, all pre-existing). `npm run typecheck` clean.

## Rejected Recommendations

- iter 1 — missing `memory.block.promoted` event emission. Explicit spec deviation (2026-05-18); audit Check 2 reconciles via `workspace_memory_entry_tier_transitions` rows; deferral tracked in `tasks/todo.md`.
- iter 3 — dispatcher starvation under bounded scan. Duplicate of iter-1 finding #3 already accepted with scope-limit; pagination is tracked in `tasks/todo.md`.

---

**Verdict:** APPROVED (3 iterations, 5 accepted findings fixed, 2 rejections documented with spec-deviation / scope-limit rationale)

**Commit at finish:** _set after the dual-reviewer auto-commit lands_
