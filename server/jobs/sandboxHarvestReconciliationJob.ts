/**
 * sandboxHarvestReconciliationJob.ts — Harvest reconciliation sweep (spec B §8.4, §13.2).
 *
 * Runs every 5 minutes (cron schedule in queueService.ts). For each
 * sandbox_executions row that is stuck in a non-terminal state past its
 * wall-clock-ceiling-plus-buffer, the job re-enqueues the harvest pipeline
 * via sandboxHarvestService.runHarvestReconciliation (C7).
 *
 * Also recovers rows stuck in harvest_failed or artefact_upload_failed by
 * re-entering the harvesting phase (spec §13.1 reconciliation-recoverable exception).
 *
 * Idempotent on sandbox_execution_id: every harvest step is idempotent on
 * (sandbox_execution_id, step) so repeated runs produce the same outcome.
 *
 * Spec B §8.4, §13.1, §13.2, §22, §22.1.
 */

import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { withOrgTx } from '../instrumentation.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_HARVEST_RECONCILIATION_JOB } from '../lib/sandboxJobNames.js';
import {
  isExecutionEligibleForReconciliation,
  nextReconciliationAttempt,
  RECONCILIATION_BUFFER_MS,
} from './sandboxHarvestReconciliationPure.js';

// Recoverable terminal states: harvest or upload failed — re-enter harvesting to retry.
const RECOVERABLE_TERMINAL = ['harvest_failed', 'artefact_upload_failed'] as const;

// Stuck pre-terminal states whose worker has presumably died past the wall-clock
// ceiling-plus-buffer window. Sweep query is gated on (status, started_at) so
// any row reaching this flip is definitively orphaned — flipping to `harvesting`
// hands the row off to the harvest pipeline's reconciliation path so step 1's
// "row is already terminal" branch does not misclassify pending/running as a
// terminal SandboxTerminalState.
const STUCK_PRE_TERMINAL = ['pending', 'running'] as const;

// Page size for the reconciliation sweep.
const PAGE_SIZE = 50;

interface StuckRow {
  id: string;
  organisation_id: string;
  subaccount_id: string;
  run_id: string;
  agent_id: string;
  task_id: string;
  status: string;
  provider: string;
  provider_sandbox_id: string | null;
  template_name: string;
  template_version: string;
  started_at: string | null;
  policy_json: { ceilings?: { wallClockMs?: number } } | null;
  attempt_number: number;
  output_schema_ref?: string | null;
  credential_aliases: Array<{ alias: string; connectionId: string }>;
}

export async function sandboxHarvestReconciliationHandler(): Promise<void> {
  // Admin connection for cross-org sweep — mirrors memoryDedupJob.ts pattern.
  await withAdminConnection(
    {
      source: 'jobs.sandboxHarvestReconciliation',
      reason: 'Every-5-min sweep for stuck sandbox executions',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const [{ now: dbNow }] = await tx.execute<{ now: string }>(sql`SELECT NOW() AS now`);
      const now = new Date(dbNow);
      // Deadline: wallClockMs + RECONCILIATION_BUFFER_MS since startedAt.
      // We use a conservative floor for the query: anything started > 1 minute ago
      // AND wall clock + buffer has elapsed is eligible. The per-row check below
      // validates the exact deadline per spec.
      const cutoffStartedAt = new Date(now.getTime() - RECONCILIATION_BUFFER_MS);

      const rows = (await tx.execute(sql`
        SELECT
          id,
          organisation_id,
          subaccount_id,
          run_id,
          agent_id,
          task_id,
          status,
          provider,
          provider_sandbox_id,
          template_name,
          template_version,
          started_at,
          policy_json,
          attempt_number,
          credential_aliases
        FROM sandbox_executions
        WHERE
          status = ANY(ARRAY['pending','running','harvesting','harvest_failed','artefact_upload_failed'])
          AND is_active = true
          AND started_at IS NOT NULL
          AND started_at < ${cutoffStartedAt.toISOString()}
        ORDER BY started_at ASC
        LIMIT ${PAGE_SIZE}
      `)) as unknown as StuckRow[];

      logger.info('sandbox.harvest_reconciliation.sweep_started', {
        candidateCount: rows.length,
        now: now.toISOString(),
      });

      let reconciled = 0;
      let skipped = 0;

      for (const row of rows) {
        const wallClockMs =
          (row.policy_json?.ceilings?.wallClockMs as number | undefined) ?? 0;

        const isEligible = isExecutionEligibleForReconciliation(
          {
            status: row.status,
            startedAt: row.started_at ? new Date(row.started_at) : null,
            wallClockMs,
          },
          now,
        );

        if (!isEligible) {
          skipped += 1;
          continue;
        }

        try {
          await db.transaction(async (orgTx) => {
            await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${row.organisation_id}, true)`);
            return withOrgTx(
              { tx: orgTx, organisationId: row.organisation_id, source: 'jobs.sandboxHarvestReconciliation:per-row' },
              async () => {
                await reconcileExecution(orgTx, row);
              },
            );
          });
          reconciled += 1;
        } catch (err) {
          logger.warn('sandbox.harvest_reconciliation.execution_failed', {
            sandboxExecutionId: row.id,
            organisationId: row.organisation_id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Continue to next row — per-org iteration pattern.
        }
      }

      logger.info('sandbox.harvest_reconciliation.sweep_completed', {
        candidateCount: rows.length,
        reconciled,
        skipped,
      });
    },
  );
}

/**
 * Re-enter a single stuck execution into the harvest pipeline.
 *
 * For recoverable terminal states (harvest_failed, artefact_upload_failed):
 *   atomically flip status back to 'harvesting' then invoke the harvest service.
 *
 * For pre-terminal stuck states (pending, running, harvesting):
 *   invoke the harvest service directly (it will re-check state and classify).
 *
 * Must be called inside a db.transaction with withOrgTx set so that
 * getOrgScopedDb() in the harvest pipeline resolves correctly.
 */
async function reconcileExecution(
  tx: import('../db/index.js').OrgScopedTx,
  row: StuckRow,
): Promise<void> {
  const sandboxExecutionId = row.id;
  const attempt = nextReconciliationAttempt(row.attempt_number - 1);

  // For recoverable terminal states, re-enter harvesting before invoking the pipeline.
  if ((RECOVERABLE_TERMINAL as readonly string[]).includes(row.status)) {
    await tx.execute(sql`
      UPDATE sandbox_executions
      SET
        status = 'harvesting',
        attempt_number = attempt_number + 1
      WHERE id = ${sandboxExecutionId}::uuid
        AND organisation_id = ${row.organisation_id}::uuid
        AND status = ANY(ARRAY['harvest_failed','artefact_upload_failed'])
    `);
  }

  // For stuck pre-terminal rows the worker has presumably died. Split the
  // recovery path by (status, provider_sandbox_id):
  //
  //   pending  + null     → never claimed a provider sandbox; mark terminal as
  //                         `provider_unavailable` directly (NO harvest call).
  //                         Flipping to `harvesting` here would violate the DB
  //                         CHECK `sandbox_executions_running_harvesting_needs_provider_id`
  //                         and there is nothing to harvest.
  //   running  + non-null → worker died mid-execution after start-claim; flip
  //                         to `harvesting` and invoke the harvest pipeline
  //                         (it will read provider state via the SDK).
  //   pending  + non-null → anomalous — would already have violated the paired
  //                         CHECK `provider_sandbox_id_not_pending` on write,
  //                         so this case is impossible. Skip with a warning.
  //   running  + null     → anomalous — would already have violated the
  //                         running/harvesting CHECK on write. Skip with a warning.
  //
  // Closes Phase 3 chatgpt-pr-review R2-F1.
  if ((STUCK_PRE_TERMINAL as readonly string[]).includes(row.status)) {
    if (row.status === 'pending' && row.provider_sandbox_id === null) {
      // Direct terminal write — no harvest pipeline.
      await tx.execute(sql`
        UPDATE sandbox_executions
        SET
          status = 'provider_unavailable',
          error_reason = 'sandbox_provider_unavailable',
          terminated_at = NOW(),
          attempt_number = attempt_number + 1
        WHERE id = ${sandboxExecutionId}::uuid
          AND organisation_id = ${row.organisation_id}::uuid
          AND status = 'pending'
      `);

      logger.info('sandbox.harvest_reconciliation.start_failed_terminal', {
        sandboxExecutionId,
        organisationId: row.organisation_id,
        attempt,
        priorStatus: row.status,
      });
      return;
    }

    if (row.status === 'running' && row.provider_sandbox_id !== null) {
      await tx.execute(sql`
        UPDATE sandbox_executions
        SET
          status = 'harvesting',
          attempt_number = attempt_number + 1
        WHERE id = ${sandboxExecutionId}::uuid
          AND organisation_id = ${row.organisation_id}::uuid
          AND status = 'running'
      `);
    } else {
      // Anomalous shape that the CHECK constraints should already have prevented.
      logger.warn('sandbox.harvest_reconciliation.anomalous_pre_terminal_row', {
        sandboxExecutionId,
        organisationId: row.organisation_id,
        priorStatus: row.status,
        hasProviderSandboxId: row.provider_sandbox_id !== null,
      });
      return;
    }
  }

  // Invoke the harvest reconciliation function from C7.
  // The import is dynamic to avoid circular dependency at module load time.
  const { runHarvestReconciliation } = await import('../services/sandboxHarvestService.js');

  await runHarvestReconciliation(sandboxExecutionId, attempt, {
    organisationId: row.organisation_id,
    subaccountId: row.subaccount_id,
    runId: row.run_id,
    agentId: row.agent_id,
    taskId: row.task_id,
    provider: row.provider,
    templateName: row.template_name,
    templateVersion: row.template_version,
    // outputSchemaRef: not stored on the row in V1; default to empty string
    // so the harvest pipeline uses a passthrough schema.
    outputSchemaRef: '',
    credentialAliases: row.credential_aliases,
  });

  logger.info('sandbox.harvest_reconciliation.execution_reconciled', {
    sandboxExecutionId,
    organisationId: row.organisation_id,
    attempt,
    priorStatus: row.status,
  });
}

/**
 * Register the harvest reconciliation worker with pg-boss.
 * Called from queueService.ts.
 */
export async function registerSandboxHarvestReconciliationJob(boss: PgBoss): Promise<void> {
  await boss.work(
    SANDBOX_HARVEST_RECONCILIATION_JOB,
    { teamSize: 1, teamConcurrency: 1 },
    async () => {
      try {
        await sandboxHarvestReconciliationHandler();
      } catch (err) {
        logger.error('sandbox.harvest_reconciliation.sweep_error', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  );

  logger.info('sandbox.harvest_reconciliation.handler_registered');
}
