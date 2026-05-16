/**
 * maintenance:webhook-replay-nonce-prune
 * Prunes webhook_replay_nonces rows older than 10 minutes across all organisations.
 * Scheduled hourly in queueService.ts.
 *
 * Design note: the 10-minute prune window matches the dedup window declared in
 * the spec. A nonce row's existence (not the wall clock) is the dedup invariant
 * — the test "nonce row still present past 10 minutes is still deduped"
 * captures this. The prune job removes rows AFTER they are no longer needed
 * for dedup, keeping the table small.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS, post Wave 5 F-3 migration):
 *   - Migrated from the legacy single-statement `withAdminConnection` body to
 *     the `definePruneJob` factory so this job shares the same per-org RLS
 *     guarantees, structured logging, and outcome counters as the other 5
 *     prune jobs.
 *   - Sub-day retention is expressed via `retentionMillis: 10 * 60_000`
 *     (factory extension landed alongside this migration in Wave 5 F-3).
 *   - Per-org sequential fan-out; one org failure does not abort the sweep.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE
 *   WHERE seen_at < cutoff is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';

export type WebhookReplayNoncePruneResult = PruneJobResult;

export const runWebhookReplayNoncePrune = definePruneJob({
  source: 'webhook-replay-nonce-prune',
  table: 'webhook_replay_nonces',
  retentionMillis: 10 * 60 * 1000,
  cutoffColumn: 'seen_at',
});
