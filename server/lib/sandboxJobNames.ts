// ---------------------------------------------------------------------------
// sandboxJobNames.ts — canonical pg-boss queue-name string constants for
// sandbox jobs.
//
// This is a leaf module: it imports nothing from any other sandbox module.
// Consumers:
//   C8  (withSandboxProvider.ts) — enqueue side: boss.send(NAME, ...)
//   C11a (sandboxHarvestReconciliationJob.ts) — handler side: boss.work(NAME, ...)
//   C11b (sandboxRetentionJobs.ts) — handler side for retention jobs
// ---------------------------------------------------------------------------

export const SANDBOX_HARVEST_RECONCILIATION_JOB = 'sandbox-harvest-reconciliation' as const;
export const SANDBOX_CEILING_MONITOR_JOB = 'sandbox-ceiling-monitor' as const;
export const SANDBOX_WALL_CLOCK_KILL_JOB = 'sandbox-wall-clock-kill' as const;
export const SANDBOX_TELEMETRY_PRUNE_JOB = 'sandbox-telemetry-prune' as const;
export const SANDBOX_LOGS_PRUNE_JOB = 'sandbox-logs-prune' as const;
export const SANDBOX_EGRESS_AUDIT_PRUNE_JOB = 'sandbox-egress-audit-prune' as const;
export const SANDBOX_ARTEFACT_PURGE_JOB = 'sandbox-artefact-purge' as const;
