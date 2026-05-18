# Spec Review Log — memory-tiered-consolidation — Iteration 2

**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md` (post-iter-1)
**Codex output:** `tasks/review-logs/_codex_memory-tiered-consolidation_iter2_2026-05-18T00-44-05Z.txt`
**Codex findings raised:** 15
**Rubric findings raised:** 0 (Codex covered the surface)

Several iter-2 findings are reactions to the iter-1 fixes — Codex correctly noticed that some iter-1 changes introduced new contradictions, and (importantly) Codex DID grep the actual repo schemas and surfaced material codebase-vs-spec mismatches (review-queue columns; memory_block_versions columns).

## Findings 1-8

### FINDING #1 — §2 ABCd decommission row still says "Nullable"
- Source: Codex. Description: §2 decommission row says "Nullable `consolidation_tier` column can be dropped" — contradicts NOT NULL DEFAULT locked in iter 1.
- Classification: **mechanical** — iter-1 residue. Disposition: **auto-apply** — change to "non-null `consolidation_tier` column".

### FINDING #2 — §2 file-count claim now stale ("~20 files")
- Source: Codex. Description: Iter-1 added files (featureFlags.ts as New, runbook as New, isValidPromotionTransition test, review-queue migration); count is now stale.
- Classification: **mechanical**. Disposition: **auto-apply** — recount or drop the claim. Going with: drop the numeric claim from §2 (the source-of-truth count is §8; §2 doesn't need to duplicate it).

### FINDING #3 — Review-queue schema mismatch (VERIFIED)
- Source: Codex. **VERIFIED** at `server/db/schema/memoryReviewQueue.ts:36-39`: column is `item_type` (not `decision_type`), and block identity is in JSONB `payload` (not a top-level `block_id` column).
- Classification: **mechanical** — load-bearing schema mismatch. The spec's `(block_id, decision_type)` partial unique index cannot exist as written.
- Disposition: **auto-apply** — three pinning choices: (a) reuse existing `item_type = 'promote_to_procedural'` (adds enum value, payload carries `blockId` + `oldTier` + signal data), define uniqueness via a generated column or a functional index on payload->>'blockId'; (b) add `decision_type` and `block_id` as new top-level columns; (c) add a `block_id uuid` column + reuse `item_type` enum. Going with **(c)**: cheapest — one new top-level column `block_id` (nullable, NULL for non-block items), `item_type = 'promote_to_procedural'` (new enum value), partial unique index `(block_id, item_type) WHERE block_id IS NOT NULL AND item_type = 'promote_to_procedural' AND status = 'pending'`. Rewrite §6 Phase 4, §8 migration, §14.6.

### FINDING #4 — memoryReviewQueueService.ts not in §8 (VERIFIED EXISTS)
- Source: Codex. **VERIFIED** that `server/services/memoryReviewQueueService.ts` exists; the spec routes approve/reject straight to the HTTP layer.
- Classification: **mechanical** — file-inventory drift. The existing service must own the approve/reject logic; route is the thin HTTP shim.
- Disposition: **auto-apply** — add `server/services/memoryReviewQueueService.ts` to §8 with "Modify — add `approvePromoteToProcedural(queueItemId, approverUserId)` and `rejectPromoteToProcedural(queueItemId, rejecterUserId, cooldownDuration)` methods; route handlers are thin wrappers." Update §6 Phase 4 to describe the call paths.

### FINDING #5 — memory_block_versions schema mismatch (VERIFIED)
- Source: Codex. **VERIFIED** at `server/db/schema/memoryBlockVersions.ts`: the column is `version` (not `version_number`), there is NO `lineage_event_type` column, the `change_source` enum is `'manual_edit' | 'seed' | 'reset_to_canonical' | 'auto_synthesis' | 'workflow_upsert'` — no `'tier_promotion'`.
- Classification: **mechanical**. Disposition: **auto-apply** — pin: (a) reference the existing `version` column (not `version_number`); (b) extend `change_source` enum with `'tier_promotion'` (Phase 4 migration); (c) optionally add a `tier_at_capture text` column to capture the new tier on the row (replayability) — recommended; (d) add the Phase 4 schema modification to §8. Update §6 Phase 4 + §14.5.

### FINDING #6 — "lineage source = prior version" not backed by writeLineageRowsForVersion contract (VERIFIED)
- Source: Codex. **VERIFIED** at `server/services/memoryBlockLineageService.ts:11-23`: `LineageEntry` requires `{ id, content, qualityScore, agentRunId }` — these are `workspace_memory_entries` (per `WriteLineageParams` JSDoc, "which workspace_memory_entries contributed"). The function does NOT accept a prior `memory_block_versions` id as a "source".
- Classification: **mechanical** — load-bearing claim without mechanism.
- Disposition: **auto-apply** — pin: for tier-promotion rows, `writeLineageRowsForVersion` is invoked with an EMPTY `cluster: []` (no workspace-memory sources because tier promotion is not a content-change event — it is a metadata event). The lineage trail for a promoted version is therefore implicit: the new `memory_block_versions` row carries `change_source = 'tier_promotion'` + `tier_at_capture`; the audit query for "what's the lineage" follows the `memory_block_id` FK back through the version history and reads the `change_source` of each. Empty `cluster` is acceptable because the existing contract `Promise<{ rowsWritten: number }>` returns 0 on empty input (verified at lineage service:65-67 — `let rowsWritten = 0` then `for (... cluster.length)` so empty cluster is a no-op return 0). Adjust §6 Phase 4 + §9.8 (5) + §14.5 accordingly.

### FINDING #7 — §11.4 row for memoryDecayJob contradicts logging-only posture
- Source: Codex. Description: §11.4 flag-ON behaviour for `memoryDecayJob` still says "updates last-access markers per tenant" — iter-1 residue (iter-1 fixed §3, §6, §11.1 but missed §11.4).
- Classification: **mechanical**. Disposition: **auto-apply** — change to "runs and emits per-tenant per-tier distribution log lines only".

### FINDING #8 — AuditCheckResult.status missing 'n/a' (introduced by iter-1 F25)
- Source: Codex. Description: Iter-1 F25 added `n/a` to Checks 1 and 2, but §9.7 `AuditCheckResult.status` type is `'pass' | 'warn' | 'fail'`. Verdict computation in §13.3 doesn't define how `n/a` participates.
- Classification: **mechanical** — iter-1 ripple. Disposition: **auto-apply** — extend `AuditCheckResult.status` to include `'n/a'`; update §13.3 overall verdict rules: `pass` requires every check `pass | n/a`; `warn` requires no `fail` and ≥ 1 `warn`; `fail` requires ≥ 1 `fail`. `n/a` is treated as "no signal contributed" — it does not block `pass`.

## Findings 9-15

### FINDING #9 — Check 2's claim of "detects missing events" not actually backed (§13 Check 2 / §14.5)
- Source: Codex. Description: §14.5 says "audit Check #2 detects any block whose `consolidation_tier` changed without a corresponding event over the audit window" but Check 2 as written only counts events per transition and applies eligibility — it does not reconcile against the actual tier-change source.
- Classification: **mechanical** — load-bearing claim without mechanism. The reconciliation IS necessary (since iter-1 moved event emission to an outbox after commit).
- Disposition: **auto-apply** — add a new sub-step to Check 2: after the event count, join `memory_block_versions` (rows with `change_source = 'tier_promotion'` in the audit window) against emitted `memory.block.promoted` events using the canonical key `(blockId, oldTier=prior version's tier_at_capture, newTier=this version's tier_at_capture, configVersion=this version's recorded config version)`. Any version row without a matching event → `fail` (auto path) or `warn` (operator-approved) with the block id surfaced.

### FINDING #10 — Operator-approve runId source unspecified (§9.5)
- Source: Codex. Description: §9.5 says operator-approved promotions emit with "the standard agent-run `runId`" — but the approve handler is an HTTP route on an operator-driven flow; there's no agent-run context.
- Classification: **mechanical** — iter-1 fix was too quick; need to pin a real correlation id.
- Disposition: **auto-apply** — change to: operator-approved emissions also use `runId = NULL` and use `queueItemId` (the `memory_review_queue.id` of the approved row) as the correlation context. `approvedByUserId` continues to identify the actor. Update §9.5 + §14.2.

### FINDING #11 — Check 5 doesn't actually verify last_accessed_at advances
- Source: Codex. Description: Iter-1 rewrote Check 5 to use traces, but that means Check 5 can pass even if `reinforcementBatch.ts` never writes anything to `memory_blocks.last_accessed_at` (a real failure mode).
- Classification: **mechanical** — under-check. Disposition: **auto-apply** — keep the trace-derived activity check as the eligibility gate, then add a sub-step: sample 10 of the blocks identified as "trace-active" and verify `memory_blocks.last_accessed_at` is within the last 7 days. Drift between trace and column = `fail` (when flag is ON).

### FINDING #12 — Phase 1 idempotency claim self-contradicts
- Source: Codex. Description: §14.1 row says "Idempotent by construction: re-running the migration is a no-op (Postgres rejects re-add of an existing column)" — re-add IS NOT a no-op; it ERRORS.
- Classification: **mechanical** — bad word choice in iter-1 fix.
- Disposition: **auto-apply** — replace the wording with: "Re-running the migration is a hard error (Postgres rejects re-add of an existing column) — this is the codebase's existing migration-runner contract; migrations run exactly once per environment per filename and are not designed to be re-runnable."

### FINDING #13 — Audit script path open in §17 but locked elsewhere
- Source: Codex. Description: §3 Goal 9, §6 Phase 5, §8, §13.1 all lock `scripts/audit/audit-memory-consolidation.ts`, but §17 still lists the path question as open.
- Classification: **mechanical**. Disposition: **auto-apply** — strike the §17 row with "Resolved at spec: locked to `scripts/audit/audit-memory-consolidation.ts` per §13.1".

### FINDING #14 — PromotionVerdict reasons missing 'invalid_transition' and 'invalid_source_tier'
- Source: Codex. Description: §14.7 requires `evaluatePromotion` to return `shouldPromote: false, reason: 'invalid_source_tier'`; dispatcher to return `'invalid_transition'`. §9.4 `PromotionVerdict` union only allows reasons `'below_threshold' | 'already_top_tier' | 'cooldown_active'`.
- Classification: **mechanical** — iter-1 ripple. Disposition: **auto-apply** — extend the union to include `'invalid_source_tier' | 'invalid_transition'`.

### FINDING #15 — Procedural precondition order conflict (§14.7)
- Source: Codex. Description: §14.7 says "a `memory_review_queue` row with `status = 'approved'` MUST exist; the approve handler enforces this within its transaction" — but the approve handler is what MARKS the row as approved. The precondition is impossible to satisfy as stated.
- Classification: **mechanical**. Disposition: **auto-apply** — rewrite the precondition: "the approve handler runs inside a single transaction: SELECT FOR UPDATE the pending row → validate transition → mint version + lineage → UPDATE memory_blocks tier → mark queue row as `approved` (all four steps inside `withOrgTx`)". The row IS approved during the same transaction as the tier write; not before.

---

## Implementation log

All 15 findings are mechanical and auto-applied. Detail per finding follows in the Edit log below the iteration summary.

## Iteration 2 Summary

- Mechanical findings accepted:  15
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set after commit step)

Codex's iter-2 pass was very high quality — it correctly noticed iter-1 ripple effects (F1, F7, F8, F14 — sections that should have been touched in iter-1 but weren't) AND grepped the actual codebase to find two material schema-shape mismatches that the spec author missed (F3 review-queue columns; F5+F6 memory_block_versions columns + lineage source contract). All 15 are real and fix material problems.


