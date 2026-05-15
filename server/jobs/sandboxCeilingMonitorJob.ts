/**
 * sandboxCeilingMonitorJob.ts — Per-execution worker-side ceiling monitor (spec B §10.2).
 *
 * Re-enqueues itself every policy.ceilings.monitorIntervalMs (V1 default 5 s) with
 * singletonKey = sandbox_execution_id so only one monitor runs per execution.
 * Exits cleanly when the execution reaches any terminal state.
 *
 * When a ceiling is tripped the job records the terminal reason on the row and
 * transitions to 'harvesting' so the harvest pipeline (C7) handles the
 * post-terminal steps. This job never writes terminal events directly.
 *
 * Spec B §10.2, §22, §22.1, §24.2.
 */

import type PgBoss from 'pg-boss';
import { and, eq, sql } from 'drizzle-orm';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_CEILING_MONITOR_JOB } from '../lib/sandboxJobNames.js';
import { parseCurrentVersion } from '../services/sandbox/templateVersionParserPure.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  estimateSandboxCostCents,
  isWallClockCeilingTripped,
  isCostCeilingTripped,
  classifyCeilingTransition,
  type CeilingTransition,
} from './sandboxCeilingMonitorPure.js';
import { resolveSandboxProvider } from '../services/sandbox/sandboxProviderResolver.js';
import type { SandboxExecutionService } from '../services/sandbox/sandboxProviderResolver.js';
import { withSandboxProvider } from '../lib/withSandboxProvider.js';

// Side-effect imports so the provider registry is populated before getProvider() runs.
import '../services/sandbox/e2bSandbox.js';
import '../services/sandbox/localDockerSandbox.js';

let _provider: SandboxExecutionService | null = null;

function getProvider(): SandboxExecutionService {
  if (!_provider) {
    _provider = resolveSandboxProvider();
  }
  return _provider;
}

// Default monitor interval per spec §10.2.
const DEFAULT_MONITOR_INTERVAL_MS = 5_000;

// Non-terminal states: any other status value is terminal.
const NON_TERMINAL_STATES = ['pending', 'running', 'harvesting'] as const;

export interface SandboxCeilingMonitorPayload {
  sandboxExecutionId: string;
  organisationId: string;
  subaccountId: string;
  /** ISO 8601 timestamp of sandbox start (set when status transitions to running). */
  startedAt: string;
  /** Wall-clock ceiling from policy_json.ceilings.wallClockMs. */
  wallClockMs: number;
  /** Cost ceiling from policy_json.ceilings.costCents. */
  costCents: number;
  /** Monitor interval from policy_json.ceilings.monitorIntervalMs; default 5000. */
  monitorIntervalMs: number;
  templateName: string;
}

/**
 * Load max_cost_cents_per_second for the given template from
 * infra/sandbox-templates/{name}/CURRENT_VERSION.
 * Returns 0 if the file cannot be read (e.g. local dev without template files).
 */
function loadMaxCostCentsPerSecond(templateName: string): number {
  try {
    const filePath = join(
      process.cwd(),
      'infra',
      'sandbox-templates',
      templateName,
      'CURRENT_VERSION',
    );
    const content = readFileSync(filePath, 'utf8');
    const parsed = parseCurrentVersion(content);
    return parsed.max_cost_cents_per_second;
  } catch {
    return 0;
  }
}

export async function sandboxCeilingMonitorHandler(
  job: PgBoss.Job<SandboxCeilingMonitorPayload>,
): Promise<void> {
  const {
    sandboxExecutionId,
    organisationId,
    subaccountId,
    // `startedAt` retained on the payload for backwards-compat with prior queue
    // entries but no longer consumed: elapsed time is computed DB-side from
    // `sandbox_executions.started_at` to avoid mixing Node wall-clock and DB
    // time (T1-R2 — KNOWLEDGE.md DB-anchored-time invariant).
    wallClockMs,
    costCents: costCeilCents,
    monitorIntervalMs,
    templateName,
  } = job.data;

  const db = getOrgScopedDb('jobs.sandboxCeilingMonitor');

  // Step 1: Read canonical row + DB-anchored elapsed-ms — exit if already terminal.
  // Elapsed time is computed inside the SQL using `NOW() - started_at` so both
  // endpoints are DB-anchored (mirrors `inboundRateLimiter` and
  // `agentWorkingTimeService` invariants in KNOWLEDGE.md — wall-clock from
  // Node's `Date.now()` is forbidden in correctness-sensitive paths because
  // cross-instance clock skew or NTP drift would change billing + timeout
  // outcomes). `elapsed_ms` is NULL when started_at is NULL (status='pending'
  // pre-claim); the transition classifier handles that branch directly.
  const rows = await db
    .select({
      status: sandboxExecutions.status,
      providerSandboxId: sandboxExecutions.providerSandboxId,
      elapsedMs: sql<string | null>`(EXTRACT(EPOCH FROM (NOW() - ${sandboxExecutions.startedAt})) * 1000)::bigint`,
    })
    .from(sandboxExecutions)
    .where(
      and(
        eq(sandboxExecutions.id, sandboxExecutionId),
        eq(sandboxExecutions.organisationId, organisationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    logger.warn('sandbox.ceiling_monitor.execution_not_found', { sandboxExecutionId });
    return;
  }

  if (!NON_TERMINAL_STATES.includes(row.status as typeof NON_TERMINAL_STATES[number])) {
    logger.info('sandbox.ceiling_monitor.already_terminal', {
      sandboxExecutionId,
      status: row.status,
    });
    return;
  }

  // Step 2: Decode DB-anchored elapsed (bigint returned as string for safety).
  // When started_at is NULL (pending row pre-claim), elapsed_ms is null — the
  // classifier short-circuits to 'start_failed' before any ceiling math runs.
  const elapsedMs = row.elapsedMs !== null ? Number(row.elapsedMs) : 0;

  // Step 3: Check wall-clock ceiling.
  if (isWallClockCeilingTripped(elapsedMs, wallClockMs)) {
    logger.warn('sandbox.timeout', {
      sandboxExecutionId,
      wallClockMs,
      elapsedMs,
      enforcedBy: 'worker',
    });
    await applyCeilingTransition(
      sandboxExecutionId,
      organisationId,
      classifyCeilingTransition(row.status, row.providerSandboxId, 'timed_out'),
      db,
      row.providerSandboxId,
    );
    return;
  }

  // Step 4: Check cost ceiling via upper-bound estimator (spec §10.2).
  const maxCostCentsPerSecond = loadMaxCostCentsPerSecond(templateName);
  const estimatedCostCents = estimateSandboxCostCents(elapsedMs, maxCostCentsPerSecond);

  if (isCostCeilingTripped(estimatedCostCents, costCeilCents)) {
    logger.warn('sandbox.cost_ceiling_hit', {
      sandboxExecutionId,
      costCeilCents,
      estimatedCostCents,
      enforcedBy: 'worker',
    });
    await applyCeilingTransition(
      sandboxExecutionId,
      organisationId,
      classifyCeilingTransition(row.status, row.providerSandboxId, 'cost_ceiling_hit'),
      db,
      row.providerSandboxId,
    );
    return;
  }

  // Step 5: Neither ceiling tripped — re-enqueue with singletonKey (spec §22.1).
  const boss = await getPgBoss();
  const interval = monitorIntervalMs > 0 ? monitorIntervalMs : DEFAULT_MONITOR_INTERVAL_MS;

  await boss.send(
    SANDBOX_CEILING_MONITOR_JOB,
    { ...job.data, subaccountId },
    {
      singletonKey: sandboxExecutionId,
      startAfter: Math.ceil(interval / 1000),
    },
  );
}

/**
 * Apply the classifier-decided transition to the execution row.
 *
 * `harvesting`    — the row was in `running` AND had a provider_sandbox_id, so
 *                   moving to `harvesting` is legal under
 *                   `sandbox_executions_running_harvesting_needs_provider_id`.
 *                   Race-safe WHERE predicate narrows to `running` only.
 * `start_failed`  — the row was in `pending` AND had a NULL provider_sandbox_id;
 *                   the sandbox never claimed a provider handle. The only legal
 *                   terminal transition is `provider_unavailable` direct — DO
 *                   NOT route through harvesting (that would violate the CHECK
 *                   constraint and there is nothing to harvest).
 * `noop`          — already in `harvesting` or unexpected state; skip silently.
 *
 * Closes Phase 3 chatgpt-pr-review R2-F1 (CHECK constraint violation on
 * pending→harvesting flip).
 */
async function applyCeilingTransition(
  sandboxExecutionId: string,
  organisationId: string,
  transition: CeilingTransition,
  db: ReturnType<typeof getOrgScopedDb>,
  providerSandboxId: string | null,
): Promise<void> {
  if (transition.kind === 'noop') {
    logger.info('sandbox.ceiling_monitor.transition_noop', {
      sandboxExecutionId,
      rationale: transition.rationale,
    });
    return;
  }

  if (transition.kind === 'harvesting') {
    // Terminate the provider sandbox before flipping the row status.
    // providerSandboxId is non-null for harvesting transitions per classifyCeilingTransition.
    if (providerSandboxId) {
      try {
        await withSandboxProvider({
          phase: 'terminal',
          sandboxExecutionId,
          call: () => getProvider().terminate(providerSandboxId),
        });
      } catch (err) {
        logger.warn('sandbox.ceiling_monitor.provider_terminate_failed', {
          sandboxExecutionId,
          providerSandboxId,
          err,
        });
        // proceed with the DB UPDATE — terminate failure is non-fatal
      }
    }

    await db
      .update(sandboxExecutions)
      .set({
        status: 'harvesting',
        terminatedAt: new Date(),
        errorReason: transition.reason,
      })
      .where(
        and(
          eq(sandboxExecutions.id, sandboxExecutionId),
          eq(sandboxExecutions.organisationId, organisationId),
          // Race-safe predicate: only running rows with non-null
          // provider_sandbox_id may move to harvesting (paired with the
          // application-level classifier — defence in depth against the CHECK).
          eq(sandboxExecutions.status, 'running'),
        ),
      );

    logger.info('sandbox.ceiling_monitor.marked_for_harvest', {
      sandboxExecutionId,
      reason: transition.reason,
    });
    return;
  }

  // transition.kind === 'start_failed' — pending + null provider_sandbox_id.
  // Terminal write straight to `provider_unavailable`; no harvest pipeline.
  await db
    .update(sandboxExecutions)
    .set({
      status: transition.terminalStatus,
      terminatedAt: new Date(),
      errorReason: transition.errorReason,
    })
    .where(
      and(
        eq(sandboxExecutions.id, sandboxExecutionId),
        eq(sandboxExecutions.organisationId, organisationId),
        // Race-safe predicate: only pending rows take this terminal short-cut.
        eq(sandboxExecutions.status, 'pending'),
      ),
    );

  logger.info('sandbox.ceiling_monitor.marked_start_failed', {
    sandboxExecutionId,
    terminalStatus: transition.terminalStatus,
    errorReason: transition.errorReason,
  });
}

/**
 * Register the ceiling monitor worker with pg-boss.
 * Called from queueService.ts.
 */
export async function registerSandboxCeilingMonitorJob(boss: PgBoss): Promise<void> {
  const { createWorker } = await import('../lib/createWorker.js');

  await createWorker<SandboxCeilingMonitorPayload>({
    queue: SANDBOX_CEILING_MONITOR_JOB,
    boss,
    resolveOrgContext: (job) => ({
      organisationId: job.data.organisationId,
      subaccountId: job.data.subaccountId,
    }),
    handler: sandboxCeilingMonitorHandler,
  });

  logger.info('sandbox.ceiling_monitor.handler_registered');
}
