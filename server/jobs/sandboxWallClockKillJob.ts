/**
 * sandboxWallClockKillJob.ts — One-shot wall-clock belt-and-braces (spec B §10.2).
 *
 * Scheduled at sandbox start with startAfter = wallClockMs + buffer. If the
 * sandbox is still non-terminal when this fires, the job transitions the row to
 * 'harvesting' with errorReason='timed_out' so the harvest pipeline (C7) handles
 * the post-terminal steps. It is a no-op if the ceiling monitor already terminated.
 *
 * Idempotent on sandbox_execution_id: the WHERE predicate on status ensures only
 * one termination succeeds even if the job fires more than once.
 *
 * Spec B §10.2, §22.1.
 */

import type PgBoss from 'pg-boss';
import { and, eq, inArray } from 'drizzle-orm';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_WALL_CLOCK_KILL_JOB } from '../lib/sandboxJobNames.js';
import { resolveSandboxProvider } from '../services/sandbox/sandboxProviderResolver.js';
import type { SandboxExecutionService } from '../services/sandbox/sandboxProviderResolver.js';
import { withSandboxProvider, type ProviderDiagnosticEvent } from '../lib/withSandboxProvider.js';
import { allocateAndInsertTelemetryEvent } from '../lib/sandboxTelemetrySequencePure.js';

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

export interface SandboxWallClockKillPayload {
  sandboxExecutionId: string;
  organisationId: string;
  subaccountId: string;
  wallClockMs: number;
}

export async function sandboxWallClockKillHandler(
  job: PgBoss.Job<SandboxWallClockKillPayload>,
): Promise<void> {
  const { sandboxExecutionId, organisationId, subaccountId, wallClockMs } = job.data;

  const db = getOrgScopedDb('jobs.sandboxWallClockKill');

  // Read the current row to obtain providerSandboxId before issuing the kill.
  // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
  const rows = await db
    .select({
      status: sandboxExecutions.status,
      providerSandboxId: sandboxExecutions.providerSandboxId,
      runId: sandboxExecutions.runId,
      agentId: sandboxExecutions.agentId,
      taskId: sandboxExecutions.taskId,
      provider: sandboxExecutions.provider,
      templateName: sandboxExecutions.templateName,
      templateVersion: sandboxExecutions.templateVersion,
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
    logger.warn('sandbox.wall_clock_kill.execution_not_found', { sandboxExecutionId });
    return;
  }

  if (!['pending', 'running'].includes(row.status)) {
    logger.info('sandbox.wall_clock_kill.no_op', {
      sandboxExecutionId,
      reason: 'already_terminal_or_harvesting',
    });
    return;
  }

  // Terminate the provider sandbox before flipping the row status.
  // providerSandboxId is non-null only for running rows (pending rows never claimed a handle).
  if (row.providerSandboxId) {
    const makeTelemetryWriter = (): (event: ProviderDiagnosticEvent) => Promise<void> =>
      async (event) => {
        await allocateAndInsertTelemetryEvent(db, {
          sandboxExecutionId,
          organisationId,
          subaccountId,
          runId: row.runId,
          agentId: row.agentId,
          taskId: row.taskId,
          provider: row.provider,
          templateName: row.templateName,
          templateVersion: row.templateVersion,
          eventType: 'provider_diagnostic',
          criticality: 'info',
          payloadJson: {
            subKind: event.subKind,
            attempt: event.attempt,
            elapsedMs: event.elapsedMs,
            status: event.status,
            code: event.code,
          },
        });
      };

    try {
      await withSandboxProvider({
        phase: 'terminal',
        sandboxExecutionId,
        telemetryWriter: makeTelemetryWriter(),
        call: () => getProvider().terminate(row.providerSandboxId as string),
      });
    } catch (err) {
      logger.warn('sandbox.wall_clock_kill.provider_terminate_failed', {
        sandboxExecutionId,
        providerSandboxId: row.providerSandboxId,
        err,
      });
      // proceed with the DB UPDATE — terminate failure is non-fatal
    }
  }

  // Transition to harvesting only if still in a pre-terminal state.
  // If the ceiling monitor already terminated between the SELECT and this UPDATE,
  // the WHERE predicate matches 0 rows and this is a safe no-op.
  // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
  const result = await db
    .update(sandboxExecutions)
    .set({
      status: 'harvesting',
      terminatedAt: new Date(),
      errorReason: 'timed_out',
    })
    .where(
      and(
        eq(sandboxExecutions.id, sandboxExecutionId),
        eq(sandboxExecutions.organisationId, organisationId),
        inArray(sandboxExecutions.status, ['pending', 'running']),
      ),
    );

  const rowsUpdated = (result as unknown as { rowCount?: number })?.rowCount ?? 0;

  if (rowsUpdated > 0) {
    logger.warn('sandbox.timeout', {
      sandboxExecutionId,
      wallClockMs,
      enforcedBy: 'worker_kill_job',
      source: SANDBOX_WALL_CLOCK_KILL_JOB,
    });
  } else {
    logger.info('sandbox.wall_clock_kill.no_op', {
      sandboxExecutionId,
      reason: 'already_terminal_or_harvesting',
    });
  }
}

/**
 * Register the wall-clock kill worker with pg-boss.
 * Called from queueService.ts.
 */
export async function registerSandboxWallClockKillJob(boss: PgBoss): Promise<void> {
  const { createWorker } = await import('../lib/createWorker.js');

  await createWorker<SandboxWallClockKillPayload>({
    queue: SANDBOX_WALL_CLOCK_KILL_JOB,
    boss,
    resolveOrgContext: (job) => ({
      organisationId: job.data.organisationId,
      subaccountId: job.data.subaccountId,
    }),
    handler: sandboxWallClockKillHandler,
  });

  logger.info('sandbox.wall_clock_kill.handler_registered');
}
