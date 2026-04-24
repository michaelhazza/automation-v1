// ---------------------------------------------------------------------------
// Centralised pg-boss job queue configuration
//
// Single source of truth for retry, backoff, expiration, and DLQ settings
// for every job type in the system.
//
// ── idempotencyStrategy ───────────────────────────────────────────────
// Sprint 2 P1.1 contract. Every job declares how duplicate enqueues are
// handled so the at-least-once delivery guarantee is safe under retry.
//
//   'singleton-key' — the enqueue site passes `singletonKey` in the
//      options bag. pg-boss dedupes at the queue layer (multiple enqueues
//      with the same singletonKey collapse into one). Used for tick jobs
//      where many upstream signals should fan in to one processor run.
//
//   'payload-key'  — the payload carries an `idempotencyKey` (or a
//      deterministic functional equivalent like `executionId`) that the
//      handler uses to guarantee at-most-once effects. Used for keyed
//      writes where the caller holds the dedup token.
//
//   'one-shot'     — the job is enqueued at most once per source event
//      (e.g. one per approval, one per rejection, one per scheduled
//      cron tick). Duplicate delivery is handled by the handler's
//      own state transitions being idempotent (UPDATE ... WHERE
//      status = 'x', etc.).
//
//   'fifo'         — every enqueue is a distinct unit of work. No
//      dedup. Handler is safe to re-run on the same payload because the
//      underlying state is the source of truth (e.g. a cleanup sweep
//      that re-reads the current DB each tick).
//
// Verified by scripts/verify-job-idempotency-keys.sh. Missing strategies
// block the build. Enqueue sites must match the declared strategy.
// ---------------------------------------------------------------------------

export const JOB_CONFIG = {
  // ── Tier 1: Agent execution (user-facing, highest impact) ───────
  'agent-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-scheduled-run__dlq',
    idempotencyStrategy: 'payload-key' as const, // scheduled:<subaccountAgentId>:<jobId>
  },
  'agent-org-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-org-scheduled-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
  },
  'agent-handoff-run': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
    deadLetter: 'agent-handoff-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
  },
  'agent-triggered-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-triggered-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
  },
  'execution-run': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'execution-run__dlq',
    idempotencyStrategy: 'payload-key' as const, // executionId is the key
  },
  'workflow-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'workflow-resume__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per action approval
  },

  // ── Tier 2: Financial / billing (data integrity critical) ──────
  'llm-aggregate-update': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'llm-aggregate-update__dlq',
    idempotencyStrategy: 'payload-key' as const, // { idempotencyKey } in payload
  },
  'llm-reconcile-reservations': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: 'llm-reconcile-reservations__dlq',
    idempotencyStrategy: 'fifo' as const, // sweep reads current state each tick
  },
  'llm-monthly-invoices': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'llm-monthly-invoices__dlq',
    idempotencyStrategy: 'one-shot' as const, // cron, one per month-end
  },
  'payment-reconciliation': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'payment-reconciliation__dlq',
    idempotencyStrategy: 'fifo' as const,
  },

  // ── Tier 3: Maintenance (self-healing on next schedule tick) ────
  'stale-run-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 240,
    deadLetter: 'stale-run-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  'maintenance:cleanup-execution-files': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'maintenance:cleanup-execution-files__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  'maintenance:cleanup-budget-reservations': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:cleanup-budget-reservations__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  'maintenance:memory-decay': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-decay__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  // Phase 4 — ClientPulse scenario-detector (event-driven after
  // compute_churn_risk). Payload carries churnAssessmentId + subaccountId,
  // which the proposer uses to build a deterministic idempotency key so a
  // retry cannot double-propose the same intervention.
  'clientpulse:propose-interventions': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: 'clientpulse:propose-interventions__dlq',
    idempotencyStrategy: 'payload-key' as const,
  },
  // Phase 4 — hourly outcome-measurement cron. Each tick re-reads the DB
  // for pending interventions; duplicate deliveries are safe.
  'clientpulse:measure-outcomes': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'clientpulse:measure-outcomes__dlq',
    idempotencyStrategy: 'one-shot' as const,
  },
  // Sprint 2 P1.1 Layer 3 — prune tool_call_security_events per
  // organisations.security_event_retention_days. Admin-bypass job
  // (cross-org sweep), so no job-payload org context.
  'maintenance:security-events-cleanup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:security-events-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  // Sprint 3 P2.1 Sprint 3A — prune terminal agent_runs (and their
  // cascade-linked agent_run_snapshots + agent_run_messages rows) per
  // organisations.run_retention_days. Admin-bypass job (cross-org
  // sweep). Each tick re-reads the current DB state so duplicate
  // deliveries are a no-op; idempotencyStrategy: 'fifo'.
  'agent-run-cleanup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'agent-run-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  // Feature 2 — daily cleanup of expired priority feed claims
  'priority-feed-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'priority-feed-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  // Feature 4 — Slack inbound message processing
  'slack-inbound': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    idempotencyStrategy: 'payload-key' as const,
  },
  // Sprint 2 P1.2 — capture a regression_cases row when a human rejects
  // a review item. Best-effort: retries twice then gives up (skipped
  // cases are OK — regression capture is additive, not critical path).
  'regression-capture': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'regression-capture__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per rejection
  },
  // Sprint 2 P1.2 — nightly regression replay runner. Admin-bypass job
  // that fan-outs one replay processor per active case.
  'regression-replay-tick': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'regression-replay-tick__dlq',
    idempotencyStrategy: 'one-shot' as const, // weekly cron tick
  },
  'llm-clean-old-aggregates': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'llm-clean-old-aggregates__dlq',
    idempotencyStrategy: 'fifo' as const,
  },

  // ── Tier 3b: Memory deduplication (Phase 2B, daily sweep) ──────
  'maintenance:memory-dedup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-dedup__dlq',
    idempotencyStrategy: 'fifo' as const,
  },

  // ── Tier 4: Agent briefing update (event-driven, non-critical) ─
  'agent-briefing-update': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    idempotencyStrategy: 'one-shot' as const, // one per run completion
  },

  // ── Tier 4: Memory enrichment (async, non-critical) ────────────
  'memory-context-enrichment': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    idempotencyStrategy: 'singleton-key' as const, // dedup per conversation
  },

  // ── Already configured (kept for single source of truth) ────────
  'page-integration': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    idempotencyStrategy: 'payload-key' as const, // pageId + action
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
    idempotencyStrategy: 'payload-key' as const, // idempotencyKey in payload
  },
  'iee-dev-task': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'iee-dev-task__dlq',
    idempotencyStrategy: 'payload-key' as const,
  },
  // §12.3 + §13.6.1.a — periodic orphan and reservation cleanup
  'iee-cleanup-orphans': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 180,
    deadLetter: 'iee-cleanup-orphans__dlq',
    idempotencyStrategy: 'fifo' as const,
  },
  // §11.3.5 — daily cost rollup into cost_aggregates
  'iee-cost-rollup-daily': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    idempotencyStrategy: 'one-shot' as const, // daily cron
  },
  // Reviewer round 2 — Appendix A.1 reconnect hook. Emitted by the worker
  // when an iee_run reaches a terminal status. Subscribed by the main app
  // (handler optional in v1) to resume the parent agent run, post results
  // back to the agent's loop, etc. Reusing the existing pg-boss path keeps
  // the reconnection async + decoupled.
  'iee-run-completed': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'iee-run-completed__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per iee_run terminal
  },

  // ── Skill Analyzer (migration 0092) ─────────────────────────────
  // One-shot: one job per analysis session. Retry safety handled by the
  // handler itself (deletes results before re-processing). Max 1 retry
  // with 5-minute delay — long enough for transient API failures to clear.
  // expireInSeconds set to 3600 (60 min): with up to 50 skills × 180s
  // per-skill timeout at concurrency 3, worst-case is ceil(50/3) × 180s
  // ≈ 51 minutes (no-retry path). The one-shot retry-on-timeout is rare
  // enough that sizing for it would be wasteful. 3600 gives ~18% headroom
  // over the normal worst case.
  'skill-analyzer': {
    retryLimit: 1,
    retryDelay: 300,
    retryBackoff: false,
    expireInSeconds: 3600,
    deadLetter: 'skill-analyzer__dlq',
    idempotencyStrategy: 'one-shot' as const,
  },

  // ── Playbooks engine (multi-step automation, migration 0076) ────
  // Spec: tasks/playbooks-spec.md §5.6 (concurrency) + §5.7 (watchdog).
  // Tick jobs are enqueued with singletonKey: runId so multiple step
  // completions collapse into one tick. Watchdog runs every 60s as
  // self-healing for missed ticks.
  'playbook-run-tick': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'playbook-run-tick__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: runId
  },
  'playbook-watchdog': {
    retryLimit: 1,
    retryDelay: 10,
    retryBackoff: false,
    expireInSeconds: 60,
    deadLetter: 'playbook-watchdog__dlq',
    idempotencyStrategy: 'fifo' as const, // sweep reads current state
  },
  // Async dispatch queue for prompt + agent_call step types. The engine
  // tick handler enqueues onto this; a worker picks it up and runs the
  // existing agentExecutionService.executeRun synchronously.
  // Spec §5.2 dispatch case + §5.5 idempotency keys.
  'playbook-agent-step': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'playbook-agent-step__dlq',
    idempotencyStrategy: 'singleton-key' as const, // playbook-step:<sr.id>:<attempt>
  },
  // ── Sprint 4 P3.1: Bulk parent completion check ───────────────────────────
  // When a bulk child completes, it enqueues a tick on the parent to
  // check whether all children are terminal. Uses singletonKey on the
  // parent runId so multiple child completions collapse into one check.
  'playbook-bulk-parent-check': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'playbook-bulk-parent-check__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: parentRunId
  },

  // ── Canonical Data Platform P1: Connector polling ──────────────────
  // Tick job: every-minute cron that selects connections due for sync
  // and fan-outs one connector-polling-sync per connection.
  'connector-polling-tick': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 55,
    idempotencyStrategy: 'singleton-key' as const,
  },
  // Per-connection sync job: acquires a lease, runs the adapter, records
  // ingestion stats. Lease pattern handles dedup at the handler level.
  'connector-polling-sync': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'connector-polling-sync__dlq',
    idempotencyStrategy: 'singleton-key' as const,
  },
} as const;

export type JobName = keyof typeof JOB_CONFIG;

export type IdempotencyStrategy =
  | 'singleton-key'
  | 'payload-key'
  | 'one-shot'
  | 'fifo';

/** Type-safe config accessor — prevents undefined lookups */
export function getJobConfig(name: JobName) {
  return JOB_CONFIG[name];
}
