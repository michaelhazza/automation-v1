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
import { and, eq, inArray } from 'drizzle-orm';
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
} from './sandboxCeilingMonitorPure.js';

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
    startedAt,
    wallClockMs,
    costCents: costCeilCents,
    monitorIntervalMs,
    templateName,
  } = job.data;

  const db = getOrgScopedDb('jobs.sandboxCeilingMonitor');

  // Step 1: Read canonical row — exit if already terminal.
  const rows = await db
    .select({
      status: sandboxExecutions.status,
      providerSandboxId: sandboxExecutions.providerSandboxId,
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

  // Step 2: Compute elapsed wall-clock.
  const startedAtMs = new Date(startedAt).getTime();
  const elapsedMs = Date.now() - startedAtMs;

  // Step 3: Check wall-clock ceiling.
  if (isWallClockCeilingTripped(elapsedMs, wallClockMs)) {
    logger.warn('sandbox.timeout', {
      sandboxExecutionId,
      wallClockMs,
      elapsedMs,
      enforcedBy: 'worker',
    });
    await markForHarvest(sandboxExecutionId, organisationId, 'timed_out', db);
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
    await markForHarvest(sandboxExecutionId, organisationId, 'cost_ceiling_hit', db);
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
 * Transition the execution row to 'harvesting' with an errorReason so the
 * harvest pipeline (C7) can classify the terminal state from the stored reason.
 * Uses optimistic WHERE predicate to race-safely skip if already harvesting.
 */
async function markForHarvest(
  sandboxExecutionId: string,
  organisationId: string,
  reason: 'timed_out' | 'cost_ceiling_hit',
  db: ReturnType<typeof getOrgScopedDb>,
): Promise<void> {
  await db
    .update(sandboxExecutions)
    .set({
      status: 'harvesting',
      terminatedAt: new Date(),
      errorReason: reason,
    })
    .where(
      and(
        eq(sandboxExecutions.id, sandboxExecutionId),
        eq(sandboxExecutions.organisationId, organisationId),
        inArray(sandboxExecutions.status, ['pending', 'running']),
      ),
    );

  logger.info('sandbox.ceiling_monitor.marked_for_harvest', {
    sandboxExecutionId,
    reason,
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
