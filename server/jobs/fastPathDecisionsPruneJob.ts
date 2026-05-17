/**
 * maintenance:fast-path-decisions-prune
 * Prunes fast_path_decisions rows older than 90 days across all organisations.
 * Scheduled daily at 03:30 UTC in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - Org enumeration in a short-lived withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Per-org DELETE runs in a fresh db.transaction + withOrgTx so that
 *     app.organisation_id is set and RLS policies engage for each org's work.
 *     A per-org error does not abort the surrounding sweep.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE
 *   WHERE decided_at < cutoff is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';

export type FastPathDecisionsPruneResult = PruneJobResult;

export const pruneFastPathDecisions = definePruneJob({
  source: 'fast-path-decisions-prune',
  table: 'fast_path_decisions',
  retentionDays: 90,
  cutoffColumn: 'decided_at',
});
