/**
 * maintenance:agent-observations-prune
 * Prunes non-pinned agent_observations rows older than 90 days across all organisations.
 * Scheduled daily at 5:30am UTC in queueService.ts.
 *
 * Execution contract (Rev 3 batching invariant):
 *   - Org enumeration via withAdminConnection.
 *   - Per-org DELETE runs in batches of 1000 rows, ordered by (created_at ASC, id ASC),
 *     looping until a batch returns 0 rows. Each batch is its own per-org transaction.
 *   - Before each batch DELETE, sets GUC app.allow_observation_mutation = 'retention_prune'
 *     inside the transaction to bypass the immutability trigger on agent_observations.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Security audit event emitted after each org's prune completes.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE WHERE
 *   created_at < cutoff AND pinned_at IS NULL is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

export type AgentObservationsPruneResult = PruneJobResult;

export const runAgentObservationsPrune = definePruneJob({
  source: 'agent-observations-prune',
  table: 'agent_observations',
  retentionDays: 90,
  cutoffColumn: 'created_at',
  batchSize: 1000,
  preDeleteGUC: { name: 'app.allow_observation_mutation', value: 'retention_prune' },
  extraWhere: 'AND pinned_at IS NULL',
  emitSecurityEvent: { event: auditEvent.agent.observationsRetentionPrune },
});
