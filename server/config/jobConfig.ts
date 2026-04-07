// ---------------------------------------------------------------------------
// Centralised pg-boss job queue configuration
//
// Single source of truth for retry, backoff, expiration, and DLQ settings
// for every job type in the system.
// ---------------------------------------------------------------------------

export const JOB_CONFIG = {
  // ── Tier 1: Agent execution (user-facing, highest impact) ───────
  'agent-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-scheduled-run__dlq',
  },
  'agent-org-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-org-scheduled-run__dlq',
  },
  'agent-handoff-run': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
    deadLetter: 'agent-handoff-run__dlq',
  },
  'agent-triggered-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-triggered-run__dlq',
  },
  'execution-run': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'execution-run__dlq',
  },
  'workflow-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'workflow-resume__dlq',
  },

  // ── Tier 2: Financial / billing (data integrity critical) ──────
  'llm-aggregate-update': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'llm-aggregate-update__dlq',
  },
  'llm-reconcile-reservations': {
    expireInSeconds: 90,
  },
  'llm-monthly-invoices': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'llm-monthly-invoices__dlq',
  },
  'payment-reconciliation': {
    expireInSeconds: 300,
  },

  // ── Tier 3: Maintenance (self-healing on next schedule tick) ────
  'stale-run-cleanup': {
    expireInSeconds: 240,
  },
  'maintenance:cleanup-execution-files': {
    expireInSeconds: 300,
  },
  'maintenance:cleanup-budget-reservations': {
    expireInSeconds: 120,
  },
  'maintenance:memory-decay': {
    expireInSeconds: 600,
  },
  'llm-clean-old-aggregates': {
    expireInSeconds: 120,
  },

  // ── Tier 4: Memory enrichment (async, non-critical) ────────────
  'memory-context-enrichment': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
  },

  // ── Already configured (kept for single source of truth) ────────
  'page-integration': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  },

  // ── IEE — Integrated Execution Environment (rev 6) ──────────────
  // Spec refs: §3.1, §3.4, §11.5.5, §13.2 (reservation interplay).
  // expireInSeconds is the hard pg-boss ceiling. The worker enforces a
  // tighter MAX_EXECUTION_TIME_MS inside the loop. The 15-min reservation
  // TTL (§13.6.1.a) is comfortably above this.
  'iee-browser-task': {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'iee-browser-task__dlq',
  },
  'iee-dev-task': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'iee-dev-task__dlq',
  },
  // §12.3 + §13.6.1.a — periodic orphan and reservation cleanup
  'iee-cleanup-orphans': {
    expireInSeconds: 180,
  },
  // §11.3.5 — daily cost rollup into cost_aggregates
  'iee-cost-rollup-daily': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  },
} as const;

export type JobName = keyof typeof JOB_CONFIG;

/** Type-safe config accessor — prevents undefined lookups */
export function getJobConfig(name: JobName) {
  return JOB_CONFIG[name];
}
