# Dual Review Log — wave-5-cleanup-and-ci-consolidation

**Files reviewed:** wave-5 branch diff against `main` (`86730eea..3f4be924` + iteration 1 fix)
**Iterations run:** 2/3
**Timestamp:** 2026-05-16T12:17:28Z
**Build slug:** `wave-5-cleanup-and-ci-consolidation`
**Branch:** `claude/wave-5-cleanup-and-ci-consolidation`
**Pre-review state:** pr-reviewer APPROVED after fixes (`pr-reviewer-wave-5-cleanup-and-ci-consolidation-2026-05-16T11-53-02Z.md`); adversarial-reviewer NO_HOLES_FOUND (`adversarial-review-log-wave-5-cleanup-and-ci-consolidation-2026-05-16T11-36-44Z.md`)
**Commit at finish:** _to be appended after commit_

---

## Iteration 1

Codex output: 2 findings, both pointed at `server/jobs/webhookReplayNoncePruneJob.ts:30-34` and the underlying `definePruneJob` factory.

### [ACCEPT] server/jobs/lib/definePruneJob.ts:137-142 (P1) — `RETURNING id` on the per-org DELETE path is incompatible with `webhook_replay_nonces` which has no `id` column

Codex finding: When the F-3 migrated job runs, `definePruneJob` issues `DELETE FROM webhook_replay_nonces ... RETURNING id`, but `webhook_replay_nonces` has no `id` column (`server/db/schema/webhookReplayNonces.ts` shows composite uniqueIndex on `organisation_id, webhook_source, nonce`). Every per-org DELETE would throw `column "id" does not exist`, the per-org catch increments `orgsFailed`, every org is reported as failed, and old nonce rows accumulate.

**Reason accepted:** Verified against the schema — the table is one of the few in the codebase that does NOT have a surrogate `id` column. The original pre-migration job used `RETURNING 1` (`git show 86730eea:server/jobs/webhookReplayNoncePruneJob.ts:48` confirms). Migrating to the factory was correct in spirit but the factory's `RETURNING id` is a categorical bug for this table. The factory's row-count semantic only needs `.length` of the result array (verified at `definePruneJob.ts:119,143`); the projected column value is unused. Fix is minimal: change `RETURNING id` → `RETURNING 1` in the non-batch path (the batch path is gated by `batchSize` and is not exercised by webhookReplayNonces). Pr-reviewer's C-1 disposition discussed the "partial failure mode" but did not catch this hard runtime failure; adversarial-reviewer's pass focused on auth/RLS/race surfaces and also missed it.

**Fix:** `server/jobs/lib/definePruneJob.ts:141-145` — `RETURNING id` → `RETURNING 1`; result typed as `Array<unknown>`; comment block explains the composite-key table case.

### [REJECT] server/jobs/webhookReplayNoncePruneJob.ts:30-34 (P2) — pg-boss retries lost because `definePruneJob` returns `{status:'failed'}` instead of throwing

Codex finding: The pre-migration job rethrew errors so pg-boss could record the job as failed and retry. The factory absorbs all failures into `{status:'failed'|'partial'}` and the pg-boss worker at `pgBossRegistrations.ts:458` (`runWebhookReplayNoncePrune().then(() => undefined)`) doesn't inspect the status, so a totally-failed sweep marks complete without retry.

**Reason rejected:**
1. The throw-on-failure semantic was a property of the *pre-factory single-statement implementation* introduced by a prior chatgpt-pr-review Round 1 R1 directive. The F-3 migration deliberately replaces that implementation wholesale with the factory pattern used by all 5 other prune jobs (`pruneFastPathDecisions`, `agentObservationsPruneJob`, `sandboxLogsPruneJob`, `sandboxTelemetryPruneJob`, `sandboxEgressAuditPruneJob`). Re-introducing `throw` for this one caller would diverge from the established factory contract.
2. The dedup invariant for this specific table is *row-existence within the 10-minute window*, not staleness. A failed sweep accumulates expired rows; the dedup logic at `server/services/webhookReplayNonceStore.ts` is not affected because expired rows past the window are no longer used for dedup decisions. The next hourly schedule tick catches up. This is the pr-reviewer C-1 disposition reasoning, which adversarial-reviewer concurred with, and which holds here.
3. If retry-loss across the factory is operationally important, that's a factory-level architectural decision affecting all 6 jobs equally — not a Wave 5 scope item. Routing it to backlog is the correct CLAUDE.md §6 "Surface, don't smuggle" treatment.

**Logged action:** no code change; rationale captured in this log for future audit.

### Verification after iteration 1

- `npm run lint` → 0 errors, 882 pre-existing warnings (unchanged delta).
- `npm run typecheck` → clean (both root + server tsconfigs).

## Iteration 2

Codex run against the same diff with the iteration-1 fix applied (uncommitted scope).

**Codex verdict:** *"The change replaces `RETURNING id` with `RETURNING 1` only in the non-batched prune path, preserving row-count semantics while allowing tables without an `id` column to be pruned. No blocking issues were found in the current diff."*

Loop terminates per the no-findings termination rule.

---

## Changes Made

- `server/jobs/lib/definePruneJob.ts` — non-batch DELETE path now uses `RETURNING 1` instead of `RETURNING id`; result row-type relaxed to `Array<unknown>`; added 4-line comment explaining the composite-key table case (webhook_replay_nonces).

## Rejected Recommendations

- **Codex P2 — restore throw-on-failure semantic for nonce prune:** rejected because (a) the factory pattern was deliberately chosen for all 6 prune jobs in W4 and re-introducing throw for one would diverge from the established contract; (b) the nonce-dedup invariant is row-existence within the 10-minute window, so accumulated unprune'd rows past the window are operationally benign (pr-reviewer C-1, adversarial-reviewer concur); (c) factory-wide retry semantics are an architectural conversation, not a Wave 5 scope item — route to backlog if pursued.

---

**Verdict:** APPROVED (2 iterations, 1 minor fix applied, 1 P2 rejected with rationale)
