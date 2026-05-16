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
//
// ── idempotencyContract ───────────────────────────────────────────────
// Wave-4 MC7 contract. Every job declares its idempotency verdict so the
// handler-registry fixture and meta-test can verify coverage.
//
//   'handler_tested'   — main app has a registered handler; comparesTables
//      names every DB table the handler writes so the meta-test can take
//      before/after snapshots.
//
//   'external_consumer' — job is produced by the main app (or an external
//      source) but consumed by a separate worker process. consumer names
//      the worker; idempotencyOwner names who is responsible for at-most-once.
//
//   'send_only'        — main app emits the job but does not consume it.
//      lifecycleState tracks maturity: experimental → transitional → permanent.
//
//   'exempt'           — intentional non-idempotency; requires reason, owner,
//      and a reviewBy date so the exemption is periodically revisited.
// ---------------------------------------------------------------------------

type Snapshot = Record<string, unknown>[];

export type IdempotencyContract =
  | { verdict: 'handler_tested'; comparesTables: string[]; normaliseColumns?: string[]; appendOnlyDelta?: number; comparator?: (a: Snapshot, b: Snapshot) => { equivalent: boolean; diff?: string } }
  | { verdict: 'external_consumer'; consumer: string; idempotencyOwner: string }
  | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'experimental' }
  | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'transitional'; reviewBy: string }
  | { verdict: 'send_only'; tracking: string; addedAt: string; lifecycleState: 'permanent'; consumer: string }
  | { verdict: 'exempt'; reason: string; owner: string; reviewBy: string };

export const JOB_CONFIG = {
  // ── Tier 1: Agent execution (user-facing, highest impact) ───────
  'agent-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-scheduled-run__dlq',
    idempotencyStrategy: 'payload-key' as const, // scheduled:<subaccountAgentId>:<jobId>
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_run_snapshots'] } as IdempotencyContract,
  },
  'agent-org-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-org-scheduled-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },
  'agent-handoff-run': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
    deadLetter: 'agent-handoff-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_run_snapshots'] } as IdempotencyContract,
  },
  'agent-triggered-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-triggered-run__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_run_snapshots'] } as IdempotencyContract,
  },
  'execution-run': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'execution-run__dlq',
    idempotencyStrategy: 'payload-key' as const, // executionId is the key
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_execution_events', 'agent_run_messages'] } as IdempotencyContract,
  },
  'workflow-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'workflow-resume__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per action approval
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_runs', 'workflow_step_runs'] } as IdempotencyContract,
  },

  // ── Tier 2: Financial / billing (data integrity critical) ──────
  'llm-aggregate-update': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'llm-aggregate-update__dlq',
    idempotencyStrategy: 'payload-key' as const, // { idempotencyKey } in payload
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_cost_aggregates'] } as IdempotencyContract,
  },
  'llm-reconcile-reservations': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: 'llm-reconcile-reservations__dlq',
    idempotencyStrategy: 'fifo' as const, // sweep reads current state each tick
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_reservations'] } as IdempotencyContract,
  },
  'llm-monthly-invoices': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'llm-monthly-invoices__dlq',
    idempotencyStrategy: 'one-shot' as const, // cron, one per month-end
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_invoices', 'llm_cost_aggregates'] } as IdempotencyContract,
  },
  'payment-reconciliation': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'payment-reconciliation__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['stripe_events', 'org_subscriptions'] } as IdempotencyContract,
  },

  // ── Tier 3: Maintenance (self-healing on next schedule tick) ────
  'stale-run-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 240,
    deadLetter: 'stale-run-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },
  'maintenance:cleanup-execution-files': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'maintenance:cleanup-execution-files__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['execution_files'] } as IdempotencyContract,
  },
  'maintenance:cleanup-budget-reservations': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:cleanup-budget-reservations__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_reservations'] } as IdempotencyContract,
  },
  'maintenance:memory-decay': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-decay__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_entries'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['client_pulse_interventions'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['client_pulse_interventions'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['tool_call_security_events'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_run_snapshots', 'agent_run_messages'] } as IdempotencyContract,
  },
  // Feature 2 — daily cleanup of expired priority feed claims
  'priority-feed-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'priority-feed-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['priority_feed_claims'] } as IdempotencyContract,
  },
  // Feature 4 — Slack inbound message processing
  'slack-inbound': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'slack-inbound__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'agent_run_messages'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['regression_cases'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['regression_cases', 'regression_replays'] } as IdempotencyContract,
  },
  'llm-clean-old-aggregates': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'llm-clean-old-aggregates__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_cost_aggregates'] } as IdempotencyContract,
  },

  // ── Tier 3b: Memory deduplication (Phase 2B, daily sweep) ──────
  'maintenance:memory-dedup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-dedup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_entries'] } as IdempotencyContract,
  },

  // ── Tier 4: Agent briefing update (event-driven, non-critical) ─
  'agent-briefing-update': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'agent-briefing-update__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per run completion
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_briefings'] } as IdempotencyContract,
  },

  // ── Tier 4: Memory enrichment (async, non-critical) ────────────
  'memory-context-enrichment': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'memory-context-enrichment__dlq',
    idempotencyStrategy: 'singleton-key' as const, // dedup per conversation
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_entries', 'memory_blocks'] } as IdempotencyContract,
  },

  // ── Already configured (kept for single source of truth) ────────
  'page-integration': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'page-integration__dlq',
    idempotencyStrategy: 'payload-key' as const, // pageId + action
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['pages', 'page_integrations'] } as IdempotencyContract,
  },

  // ── Agentic Commerce — IEE worker round-trip (Chunk 11) ─────────────
  // Three queues: request (worker→main), response (main→worker), completion (worker→main).
  // agent-spend-request: worker emits; main app processes via proposeCharge.
  //   payload-key: correlationId is the per-request dedup token.
  // agent-spend-response: main app emits; worker picks up by correlationId.
  //   Consumed by worker — no main-app handler. payload-key: correlationId.
  // agent-spend-completion: worker emits after merchant form-fill; main app processes.
  //   one-shot: one completion per executed row (idempotent via trigger + WHERE status='executed').
  'agent-spend-request': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 45, // Must be processed within 30s deadline + margin
    deadLetter: 'agent-spend-request__dlq',
    idempotencyStrategy: 'payload-key' as const, // correlationId
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
  },
  'agent-spend-response': {
    retryLimit: 1,
    retryDelay: 2,
    retryBackoff: false,
    expireInSeconds: 35, // Response must reach worker within 30s window
    deadLetter: 'agent-spend-response__dlq',
    idempotencyStrategy: 'payload-key' as const, // correlationId
    idempotencyContract: { verdict: 'external_consumer', consumer: 'iee-worker', idempotencyOwner: 'iee-worker' } as IdempotencyContract,
  },
  'agent-spend-completion': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120, // Completion is async from the 30s round-trip
    deadLetter: 'agent-spend-completion__dlq',
    idempotencyStrategy: 'one-shot' as const, // one per executed row
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'external_consumer', consumer: 'iee-worker', idempotencyOwner: 'iee-worker' } as IdempotencyContract,
  },
  'iee-dev-task': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'iee-dev-task__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'external_consumer', consumer: 'iee-worker', idempotencyOwner: 'iee-worker' } as IdempotencyContract,
  },
  // §12.3 + §13.6.1.a — periodic orphan and reservation cleanup
  'iee-cleanup-orphans': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 180,
    deadLetter: 'iee-cleanup-orphans__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'external_consumer', consumer: 'iee-worker', idempotencyOwner: 'iee-worker' } as IdempotencyContract,
  },
  // §11.3.5 — daily cost rollup into cost_aggregates (consumed by IEE worker)
  'iee-cost-rollup-daily': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'iee-cost-rollup-daily__dlq',
    idempotencyStrategy: 'one-shot' as const, // daily cron
    idempotencyContract: { verdict: 'external_consumer', consumer: 'iee-worker', idempotencyOwner: 'iee-worker' } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'iee_runs'] } as IdempotencyContract,
  },

  // ── Skill Analyzer (migration 0092) ─────────────────────────────
  // One-shot: one job per analysis session. Handler is crash-resumable —
  // Stage 5 reads existing skill_analyzer_results rows and skips already-
  // paid LLM calls, so a re-enqueue of the same jobId costs ~0 LLM spend.
  //
  // expireInSeconds is a circuit breaker for truly-dead workers, NOT a
  // performance target. Every external call inside the handler has its own
  // per-call timeout (OpenAI embeddings 30s, classify LLM 180s, Haiku
  // routing inherits routeCall limits) so this outer cap only ever fires
  // when something has genuinely gone catastrophically wrong (SIGKILL,
  // OOM, hung fetch that somehow bypassed AbortSignal). 14400 (4 hours)
  // gives ~2× headroom above the hard 500-candidate × 45s-observed-avg
  // ceiling at concurrency 3 ≈ 7500s, without being so large that a
  // truly-dead worker holds the queue slot indefinitely. If a user hits
  // this cap they use the POST /resume endpoint — the handler picks up
  // where the previous run left off.
  //
  // NOTE: callers MUST pass getJobConfig('skill-analyzer') to boss.send()
  // so these options actually reach the queue. Prior to Apr 2026 the
  // skill-analyzer enqueue site dropped the config and pg-boss applied
  // its default 15-min expireIn, killing otherwise-healthy runs.
  'skill-analyzer': {
    retryLimit: 1,
    retryDelay: 300,
    retryBackoff: false,
    expireInSeconds: 14400,
    deadLetter: 'skill-analyzer__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['skill_analyzer_jobs', 'skill_analyzer_results'] } as IdempotencyContract,
  },

  // ── Workflows V1 — gate stall notifications (spec §5.3) ─────────
  // Three delayed jobs per gate (24h, 72h, 7d). singletonKey deduplicates
  // re-enqueues for the same gate+cadence. stale-fire guard in the handler
  // provides durable safety even if cancel races.
  'workflow-gate-stall-notify': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'workflow-gate-stall-notify__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: stall-notify-{gateId}-{cadence}
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_runs', 'workflow_step_runs'] } as IdempotencyContract,
  },

  // ── Workflows engine (multi-step automation, migration 0076) ────
  // Spec: tasks/workflows-spec.md §5.6 (concurrency) + §5.7 (watchdog).
  // Tick jobs are enqueued with singletonKey: runId so multiple step
  // completions collapse into one tick. Watchdog runs every 60s as
  // self-healing for missed ticks.
  'workflow-run-tick': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'workflow-run-tick__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: runId
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_runs', 'workflow_step_runs'] } as IdempotencyContract,
  },
  'workflow-watchdog': {
    retryLimit: 1,
    retryDelay: 10,
    retryBackoff: false,
    expireInSeconds: 60,
    deadLetter: 'workflow-watchdog__dlq',
    idempotencyStrategy: 'fifo' as const, // sweep reads current state
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_runs'] } as IdempotencyContract,
  },
  // Async dispatch queue for prompt + agent_call step types. The engine
  // tick handler enqueues onto this; a worker picks it up and runs the
  // existing agentExecutionService.executeRun synchronously.
  // Spec §5.2 dispatch case + §5.5 idempotency keys.
  'workflow-agent-step': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'workflow-agent-step__dlq',
    idempotencyStrategy: 'singleton-key' as const, // workflow-step:<sr.id>:<attempt>
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_step_runs', 'agent_runs'] } as IdempotencyContract,
  },
  // ── Sprint 4 P3.1: Bulk parent completion check ───────────────────────────
  // When a bulk child completes, it enqueues a tick on the parent to
  // check whether all children are terminal. Uses singletonKey on the
  // parent runId so multiple child completions collapse into one check.
  'workflow-bulk-parent-check': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'workflow-bulk-parent-check__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: parentRunId
    // No handler registration found (Sprint 4 P3.1 incomplete); exempt until worker is wired.
    idempotencyContract: { verdict: 'exempt', reason: 'Sprint 4 P3.1 handler not yet wired — no boss.work registration found in main app', owner: 'workflows-team', reviewBy: '2026-08-01' } as IdempotencyContract,
  },

  // ── Canonical Data Platform P1: Connector polling ──────────────────
  // Tick job: every-minute cron that selects connections due for sync
  // and fan-outs one connector-polling-sync per connection.
  'connector-polling-tick': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 55,
    deadLetter: 'connector-polling-tick__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['connector_connections'] } as IdempotencyContract,
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
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['connector_connections', 'connector_ingestion_stats'] } as IdempotencyContract,
  },

  // ── Workspace seat rollup (agents-as-employees D9) ──────────────
  // Hourly sweep: counts active workspace identities per org and writes
  // the result to org_subscriptions.consumed_seats. Each tick re-reads
  // the current DB state so duplicate deliveries are a no-op.
  'seat-rollup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'seat-rollup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['org_subscriptions'] } as IdempotencyContract,
  },

  // ── Workspace identity migration (agents-as-employees E1) ────────
  // Per-identity job dispatched by workspaceMigrationService.start().
  // Provisions on the target backend, activates the new identity, then
  // archives the source. retryLimit 5 with exponential backoff handles
  // transient Google / SMTP failures. payload-key: migrationRequestId
  // combined with actorId forms a deterministic idempotency token at
  // the provisioning layer (provisioningRequestId = migrationRequestId:actorId).
  'workspace.migrate-identity': {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'workspace.migrate-identity__dlq',
    idempotencyStrategy: 'payload-key' as const, // migrationRequestId:actorId
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workspace_identities', 'workspace_migration_requests'] } as IdempotencyContract,
  },

  // ── System monitoring (G3: system-monitor-ingest queue) ─────────
  'system-monitor-ingest': {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'system-monitor-ingest__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['system_monitor_events'] } as IdempotencyContract,
  },

  // ── Subaccount Optimiser (F2) — daily per-subaccount scan ────────
  // Runs the full 8-category optimiser scan for one subaccount. Scan
  // re-reads current DB state each tick so retries are idempotent.
  // expireInSeconds is a hard circuit-breaker; the handler has its own
  // circuit-breaker at SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD.
  'optimiser-scan': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'optimiser-scan__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['optimiser_scan_results'] } as IdempotencyContract,
  },

  // ── Pre-launch hardening D-P0-1 — GHL auto-start onboarding ─────
  // Enqueued after subaccount creation from webhook/OAuth callback.
  // singletonKey deduplicates on (organisationId, subaccountId) within
  // a 5-minute window so webhook replay cannot double-start onboarding.
  'ghl:auto-start-onboarding': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'ghl:auto-start-onboarding__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['subaccounts', 'agents'] } as IdempotencyContract,
  },

  // ── Pre-launch hardening C-P0-2 — OAuth resume restart ───────────
  // Enqueued after a successful OAuth token exchange when a pendingRunId
  // was stored on the state nonce. singletonKey on runId deduplicates
  // within a 60s window so double-click / callback retry cannot double-resume.
  'run:resumeAfterOAuth': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'run:resumeAfterOAuth__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },

  // ── auto-knowledge-retrieval — document summary generation ───────
  // Enqueued after a new reference document version is written. Makes a
  // cheap LLM call to produce a 2-3 sentence retrieval hint summary.
  // one-shot: one job per version write; idempotency guard in the handler
  // checks summaryGeneratedAt >= version.createdAt before calling the LLM.
  'document:summarise': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'document:summarise__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['reference_document_versions'] } as IdempotencyContract,
  },
  // ── auto-knowledge-retrieval — document chunk + embed ────────────
  // Enqueued after a new reference document version is written. Chunks the
  // version content, embeds all chunks via OpenAI (outside tx), then
  // atomically flips retrieval_version_id after count verification.
  // retryLimit 3: embeddings are expensive; backoff gives transient API
  // errors time to clear. expireInSeconds 300: embedding a large document
  // can take several minutes across multiple API batches.
  // one-shot: one job per version; handler's count-check + pointer-flip are
  // idempotent on retry (ON CONFLICT DO NOTHING + idempotent UPDATE).
  'document:chunk-embed': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'document:chunk-embed__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['reference_document_chunks', 'reference_document_versions'] } as IdempotencyContract,
  },
  // ── auto-knowledge-retrieval — embedding-model upgrade sweep ─────
  // Enqueued when the org's embedding model changes. Iterates documents
  // where active_embedding_model != targetEmbeddingModel and re-embeds
  // missing chunks under the new model, then atomically flips the pointer.
  // fifo: sweep re-reads current DB state each run; retries are safe because
  // ON CONFLICT DO NOTHING makes persistChunks idempotent and the pointer
  // flip is guarded by a count-match check.
  // expireInSeconds 600: up to 10 documents per invocation, each potentially
  // requiring several API batches.
  'document:reembed': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'document:reembed__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['reference_document_chunks', 'reference_document_versions'] } as IdempotencyContract,
  },
  // ── auto-knowledge-retrieval — deferred file durability flip ─────
  // Chained after document:chunk-embed success. Verifies retrieval_version_id
  // is non-null then flips execution_files.expiresAt to a far-future sentinel
  // so the promoted file is never pruned by the maintenance cleanup sweep.
  // retryLimit 5 with backoff: if retrieval_version_id is still null (embedding
  // in progress), retries with exponential backoff give the chunk-embed job
  // time to complete. Backoff series: 30 + 60 + 120 + 240 + 480 ≈ 930s total
  // retry window. expireInSeconds must exceed the full series.
  // one-shot: one job per promotion audit; idempotency guard in the handler
  // checks expiresAt threshold before issuing the UPDATE.
  'document:promotion-finalise': {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1200,
    deadLetter: 'document:promotion-finalise__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['execution_files', 'reference_document_versions'] } as IdempotencyContract,
  },
  // ── Support Desk — draft dispatch reconciliation (C11) ───────────
  // Fired when a draft enters needs_reconciliation (dispatch stalled).
  // Payload carries draftId + organisationId. The handler calls decideOutcome
  // and either resolves the draft, surfaces it for manual review, or
  // re-enqueues with exponential backoff. retryLimit 5 matches the
  // max_attempts budget in decideOutcome. payload-key: draftId is the
  // deterministic dedup token (one reconciliation sweep per draft per attempt).
  'support-draft-reconciliation': {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'support-draft-reconciliation__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['support_drafts'] } as IdempotencyContract,
  },

  // ── Phase 1 Showcase — Support Agent execution loop ─────────────────
  // Triggered on schedule or Teamwork webhook. Processes one inbox at a
  // time per (subaccount_id, inbox_id) advisory lock. Each tick is a
  // full loop over open tickets; idempotency is enforced by the
  // terminal-event predicate in list_open_tickets.
  'support-agent-run': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'support-agent-run__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey = subaccountId:inboxId
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'support_tickets'] } as IdempotencyContract,
  },

  // ── Phase 1 Showcase — run_artifacts retention sweep ────────────────
  // Daily admin-bypass job that hard-deletes S3 objects + DB rows where
  // retain_until < now(). Processes in pages of 100. Each tick re-reads
  // the current DB state so duplicate deliveries are safe no-ops.
  'run-artifacts-retention-sweep': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'run-artifacts-retention-sweep__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['run_artifacts'] } as IdempotencyContract,
  },

  // ── Phase 1 Showcase — Support Agent eval daily run ─────────────────
  // Daily eval harness: runs classify + judge scoring over the fixture set
  // and inserts one support_eval_runs row per org. singletonKey deduplicates
  // per organisationId so concurrent cron ticks collapse into one run.
  'support-eval-daily': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'support-eval-daily__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey = organisationId
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['support_eval_runs'] } as IdempotencyContract,
  },

  // ── Operator Backend (Spec D) — four lifecycle queues ────────────────────
  // operator-session-completed: terminal event from the vendor sandbox.
  // Singleton key 'operator-session-task-terminal:${agentRunId}' guards duplicate emission.
  'operator-session-completed': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'operator-session-completed__dlq',
    idempotencyStrategy: 'one-shot' as const, // event_emitted_at IS NULL guard
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['operator_runs', 'agent_runs'] } as IdempotencyContract,
  },
  // operator-session-dispatch-next-chain-link: enqueued by finaliser after completed checkpoint.
  // Backoff retry: 1 min → 5 min → 15 min via startAfter.
  'operator-session-dispatch-next-chain-link': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'operator-session-dispatch-next-chain-link__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: operator-continuation:${agentRunId}
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['operator_runs', 'agent_runs'] } as IdempotencyContract,
  },
  // operator-session-progressed: step-boundary progress updates.
  // Sole writer for last_progress_at + step_count on operator_runs.
  'operator-session-progressed': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: false,
    expireInSeconds: 30,
    deadLetter: 'operator-session-progressed__dlq',
    idempotencyStrategy: 'fifo' as const, // greatest() guards monotonicity
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['operator_runs'] } as IdempotencyContract,
  },
  // operator-task-profile-gc: 15-minute cron; reclaims stale gc_in_progress rows.
  'operator-task-profile-gc': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'operator-task-profile-gc__dlq',
    idempotencyStrategy: 'fifo' as const, // sweep re-reads current DB state
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['operator_task_profiles'] } as IdempotencyContract,
  },

  // ── operator-session-identity chunk 6 — token refresh ───────────────────
  // Per-connection refresh job. singletonKey = ${connectionId}:${refreshBucketEpochSec}
  // deduplicates rapid re-enqueues within the same 5-minute bucket.
  // retryLimit 5 with exponential backoff handles transient provider errors;
  // expireInSeconds 7200 (2h) gives ample headroom above the retry series.
  'operator-session-refresh': {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 7200,
    deadLetter: 'operator-session-refresh__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    // singletonKey: ${connectionId}:${refreshBucketEpochSec}
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['operator_connections'] } as IdempotencyContract,
  },

  // ── Spec B — Sandbox Isolation: execution-scoped pg-boss jobs (C11a) ─────
  // sandbox-harvest-reconciliation: 5-minute cron sweep that finds sandbox_executions
  // rows stuck in non-terminal states past their wall-clock-ceiling-plus-buffer
  // and re-enqueues the harvest pipeline. fifo: reads current DB state each tick.
  'sandbox-harvest-reconciliation': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 270,
    deadLetter: 'sandbox-harvest-reconciliation__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_executions'] } as IdempotencyContract,
  },
  // sandbox-ceiling-monitor: per-execution tick job that checks wall-clock and
  // estimated cost ceilings every monitorIntervalMs (default 5 s). Re-enqueues
  // itself with singletonKey = sandboxExecutionId; exits cleanly on terminal.
  // singleton-key: one in-flight monitor per execution; duplicates collapse.
  'sandbox-ceiling-monitor': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: false,
    expireInSeconds: 30,
    deadLetter: 'sandbox-ceiling-monitor__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_executions'] } as IdempotencyContract,
  },
  // sandbox-wall-clock-kill: one-shot belt-and-braces. Scheduled at sandbox
  // start with startAfter = wallClockMs + buffer. No-op if already terminal.
  'sandbox-wall-clock-kill': {
    retryLimit: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 60,
    deadLetter: 'sandbox-wall-clock-kill__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_executions'] } as IdempotencyContract,
  },
  // sandbox-artefact-purge: triggered by run soft-delete event. Physically
  // deletes artefacts from object storage; marks pointer rows purged.
  // one-shot: one per run soft-delete; handler is idempotent on objectStorageState.
  'sandbox-artefact-purge': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'sandbox-artefact-purge__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_artefacts', 'sandbox_executions'] } as IdempotencyContract,
  },

  // ── Spec B — Sandbox Isolation: retention-scoped pg-boss jobs (C11b) ─────
  // All three are daily cron jobs scheduled at distinct UTC times to avoid
  // contention. Each sweeps across all orgs; per-org failure is logged and
  // iteration continues (maintenance-job pattern). Idempotency: cutoff-scoped —
  // re-running with the same cutoff date is a no-op (matching rows already deleted).
  // fifo: sweep re-reads current DB state each tick; duplicate delivery is safe.
  //
  // Cron schedule (set in queueService.ts):
  //   sandbox-telemetry-prune  02:00 UTC — 90-day prune of sandbox_telemetry_events
  //   sandbox-logs-prune       02:30 UTC — 90-day prune of sandbox_logs (incl. soft-deleted)
  //   sandbox-egress-audit-prune 03:00 UTC — 180-day prune of sandbox_egress_audit
  'sandbox-telemetry-prune': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'sandbox-telemetry-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_telemetry_events'] } as IdempotencyContract,
  },
  'sandbox-logs-prune': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'sandbox-logs-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_logs'] } as IdempotencyContract,
  },
  'sandbox-egress-audit-prune': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 1800,
    deadLetter: 'sandbox-egress-audit-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['sandbox_egress_audit'] } as IdempotencyContract,
  },

  // ── Drift-candidate queues reconciled from handler-registry-inventory ──
  // All entries below were registered via boss.work/createWorker in the main app
  // but were absent from JOB_CONFIG. Added in Wave-4 MC7 reconciliation pass.

  // Universal Brief Phase 3 — fast_path_decisions 90-day retention pruner.
  'maintenance:fast-path-decisions-prune': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 150,
    deadLetter: 'maintenance:fast-path-decisions-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['fast_path_decisions'] } as IdempotencyContract,
  },

  // Universal Brief Phase 6 — nightly rule quality decay + auto-deprecation.
  'maintenance:rule-auto-deprecate': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 360,
    deadLetter: 'maintenance:rule-auto-deprecate__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['brief_rules'] } as IdempotencyContract,
  },

  // Universal Brief Phase 3 — nightly recalibration log for classifier drift detection.
  'maintenance:fast-path-recalibrate': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:fast-path-recalibrate__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['fast_path_recalibration_logs'] } as IdempotencyContract,
  },

  // LLM observability §12 — nightly llm_requests retention sweep.
  'maintenance:llm-ledger-archive': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:llm-ledger-archive__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_requests', 'llm_requests_archive'] } as IdempotencyContract,
  },

  // Deferred-items brief §1 — reap aged-out provisional 'started' rows every 2 minutes.
  'maintenance:llm-started-row-sweep': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:llm-started-row-sweep__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_requests'] } as IdempotencyContract,
  },

  // Skill-analyzer resilience — reap stalled mid-flight skill_analyzer_jobs rows.
  'maintenance:stale-analyzer-job-sweep': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:stale-analyzer-job-sweep__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['skill_analyzer_jobs'] } as IdempotencyContract,
  },

  // Deferred-items brief §6 — purge llm_inflight_history rows.
  'maintenance:llm-inflight-history-cleanup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:llm-inflight-history-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['llm_inflight_history'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 1 — nightly memory entry quality decay + prune (S1).
  'maintenance:memory-entry-decay': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-entry-decay__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_entries'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 1 — one-shot HNSW reindex after large prune (S1).
  'memory-hnsw-reindex': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 360,
    deadLetter: 'memory-hnsw-reindex__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_blocks'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 2 — one-shot memory-blocks embedding backfill (S6).
  'memory-blocks-embedding-backfill': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 660,
    deadLetter: 'memory-blocks-embedding-backfill__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_blocks'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 2 — clarification timeout sweep (S8).
  'maintenance:clarification-timeout-sweep': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:clarification-timeout-sweep__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },

  // Chunk E — integration block expiry sweep (every 5 minutes).
  'maintenance:blocked-run-expiry': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:blocked-run-expiry__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },

  // ExecutionBackend reconciliation — generic main-app sweep for stuck delegated runs.
  'maintenance:backend-reconciliation': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:backend-reconciliation__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 2 — weekly quality-adjust job (S4).
  'maintenance:memory-entry-quality-adjust': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:memory-entry-quality-adjust__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_entries'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 4 — weekly memory-block synthesis (S11).
  'maintenance:memory-block-synthesis': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 960,
    deadLetter: 'maintenance:memory-block-synthesis__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_blocks', 'memory_entries'] } as IdempotencyContract,
  },

  // Cached Context Infrastructure Phase 2 — bundle utilization metric computation.
  'maintenance:bundle-utilization': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 360,
    deadLetter: 'maintenance:bundle-utilization__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['context_bundle_utilization'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 4 — portfolio briefing rollup (S23).
  'maintenance:portfolio-briefing': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 960,
    deadLetter: 'maintenance:portfolio-briefing__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['portfolio_briefings'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 4 — portfolio digest rollup (S23).
  'maintenance:portfolio-digest': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 960,
    deadLetter: 'maintenance:portfolio-digest__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['portfolio_briefings'] } as IdempotencyContract,
  },

  // Memory & Briefings Phase 5 — daily protected-block divergence sweep (S24).
  'maintenance:protected-block-divergence': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 150,
    deadLetter: 'maintenance:protected-block-divergence__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_blocks'] } as IdempotencyContract,
  },

  // Agent Workspace Chunk 11 — IEE session orphan cleanup (every 5 min).
  'maintenance:iee-session-orphan-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 150,
    deadLetter: 'maintenance:iee-session-orphan-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['iee_sessions'] } as IdempotencyContract,
  },

  // Agent Workspace Chunk 11 — IEE sessions summary compaction (5am daily).
  'maintenance:iee-sessions-compact': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 150,
    deadLetter: 'maintenance:iee-sessions-compact__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['iee_sessions'] } as IdempotencyContract,
  },

  // Agent Workspace Chunk 11 — agent_observations retention prune (5:30am daily).
  'maintenance:agent-observations-prune': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 360,
    deadLetter: 'maintenance:agent-observations-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_observations'] } as IdempotencyContract,
  },

  // Agent Workspace Chunk 11 — working-time rollup compaction (6am 1st of month).
  'maintenance:working-time-rollup-compact': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 660,
    deadLetter: 'maintenance:working-time-rollup-compact__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['working_time_rollups'] } as IdempotencyContract,
  },

  // Pre-Test Hardening W3 — webhook_replay_nonces TTL prune (hourly).
  'maintenance:webhook-replay-nonce-prune': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:webhook-replay-nonce-prune__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['webhook_replay_nonces'] } as IdempotencyContract,
  },

  // Agentic Commerce — execution-window timeout sweep (every minute).
  'maintenance:execution-window-timeout': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:execution-window-timeout__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
  },

  // Agentic Commerce — approval-expiry sweep (every minute).
  'maintenance:approval-expiry': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'maintenance:approval-expiry__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
  },

  // Agentic Commerce — Stripe agent reconciliation poll (every 5 minutes).
  'maintenance:stripe-agent-reconciliation-poll': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'maintenance:stripe-agent-reconciliation-poll__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
  },

  // Agentic Commerce — shadow charge retention purge (daily 03:30 UTC).
  'maintenance:shadow-charge-retention': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'maintenance:shadow-charge-retention__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_charges'] } as IdempotencyContract,
  },

  // F3 §4 — daily fallback: evaluate pending baselines and enqueue capture jobs.
  'evaluate-all-pending-baselines': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 600,
    deadLetter: 'evaluate-all-pending-baselines__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['baselines'] } as IdempotencyContract,
  },

  // F3 §5 — per-baseline capture worker (event-driven; enqueued by subscriber + cron).
  'capture-baseline': {
    retryLimit: 2,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: 'capture-baseline__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['baselines', 'baseline_captures'] } as IdempotencyContract,
  },

  // Trust & Verification Layer — scorecard judge worker (spec §12.3).
  'scorecard:judge': {
    retryLimit: 2,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: 'scorecard:judge__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['scorecard_judgements'] } as IdempotencyContract,
  },

  // Trust & Verification Layer — forced scorecard judge (bypasses cooldown).
  'scorecard:judge:forced': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'scorecard:judge:forced__dlq',
    idempotencyStrategy: 'one-shot' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['scorecard_judgements'] } as IdempotencyContract,
  },

  // Trust & Verification Layer — bench execute worker (spec §12.4).
  'bench:execute': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 360,
    deadLetter: 'bench:execute__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['bench_runs', 'bench_results'] } as IdempotencyContract,
  },

  // Trust & Verification Layer — bench regression replay worker (spec §12.4).
  'bench:regression-replay': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 150,
    deadLetter: 'bench:regression-replay__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['bench_runs', 'bench_results'] } as IdempotencyContract,
  },

  // Trust & Verification Layer — correction pattern detector (daily sweep, spec §13.3).
  'correction:pattern-detect': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 360,
    deadLetter: 'correction:pattern-detect__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['correction_patterns'] } as IdempotencyContract,
  },

  // System Monitor — self-check (every 5 minutes).
  'system-monitor-self-check': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: false,
    expireInSeconds: 90,
    deadLetter: 'system-monitor-self-check__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['system_monitor_events'] } as IdempotencyContract,
  },

  // ClientPulse — trial expiry check (6am daily).
  'subscription-trial-check': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'subscription-trial-check__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['org_subscriptions'] } as IdempotencyContract,
  },

  // Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md §7).
  'orchestrator-from-task': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 210,
    deadLetter: 'orchestrator-from-task__dlq',
    idempotencyStrategy: 'payload-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['agent_runs', 'tasks'] } as IdempotencyContract,
  },

  // Phase 3 D.5 — GHL auto-enrol locations page (paginated background job).
  'ghl:auto-enrol-locations-page': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'ghl:auto-enrol-locations-page__dlq',
    idempotencyStrategy: 'singleton-key' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['subaccounts', 'organisations'] } as IdempotencyContract,
  },

  // OAuth state nonce cleanup — prunes expired oauth_state_nonces rows.
  'maintenance:oauth-state-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:oauth-state-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['oauth_state_nonces'] } as IdempotencyContract,
  },

  // Rate-limit bucket cleanup — prunes expired rate_limit_buckets rows.
  'maintenance:rate-limit-cleanup': {
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: false,
    expireInSeconds: 120,
    deadLetter: 'maintenance:rate-limit-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['rate_limit_buckets'] } as IdempotencyContract,
  },

  // Optimiser peer-medians nightly refresh. Underscore naming matches the
  // constant PEER_MEDIANS_QUEUE in agentScheduleService.ts.
  'refresh_optimiser_peer_medians': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'refresh_optimiser_peer_medians__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['optimiser_peer_medians'] } as IdempotencyContract,
  },

  // Memory-utility MV nightly refresh. Underscore naming matches the
  // constant MEMORY_UTILITY_QUEUE in agentScheduleService.ts.
  'refresh_memory_utility_30d': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 300,
    deadLetter: 'refresh_memory_utility_30d__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['memory_utility_mv'] } as IdempotencyContract,
  },

  // IEE browser daily cost rollup — main-app handler (distinct from
  // iee-cost-rollup-daily which is consumed by the external IEE worker).
  'iee-browser:daily-cost-rollup': {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 360,
    deadLetter: 'iee-browser:daily-cost-rollup__dlq',
    idempotencyStrategy: 'one-shot' as const, // daily cron
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['cost_aggregates', 'iee_runs'] } as IdempotencyContract,
  },

  // Workflows V1 — daily purge of unconsumed workflow_drafts older than 7 days.
  'workflow-drafts-cleanup': {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
    expireInSeconds: 360,
    deadLetter: 'workflow-drafts-cleanup__dlq',
    idempotencyStrategy: 'fifo' as const,
    idempotencyContract: { verdict: 'handler_tested', comparesTables: ['workflow_drafts'] } as IdempotencyContract,
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
