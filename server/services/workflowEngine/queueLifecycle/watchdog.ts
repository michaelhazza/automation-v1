import { eq, and, inArray, lt } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { workflowRuns, workflowStepRuns } from '../../../db/schema/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { logger } from '../../../lib/logger.js';
import { enqueueTick, STEP_RUN_TIMEOUT_DEFAULT_MS } from '../constants.js';
import { failStepRun } from '../stepLifecycle.js';

/**
 * Watchdog sweep — runs every 60 seconds via pg-boss cron. Self-healing
 * for the "step done but tick enqueue failed" race plus stuck-step
 * timeout enforcement. Spec §5.7.
 */
export async function watchdogSweep(): Promise<void> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-org run sweep — watchdog must enumerate all non-terminal runs regardless of org; no organisationId available at sweep entrypoint"
  const runs = await db
    .select()
    .from(workflowRuns)
    .where(
      inArray(workflowRuns.status, [
        'pending',
        'running',
        'awaiting_input',
        'awaiting_approval',
        'cancelling',
      ])
    );

  let recovered = 0;
  for (const run of runs) {
    const cutoff = new Date(Date.now() - STEP_RUN_TIMEOUT_DEFAULT_MS);
    const scopedDb = getOrgScopedDb('workflowEngine.watchdog');
    const stuck = await scopedDb
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.runId, run.id),
          eq(workflowStepRuns.status, 'running'),
          lt(workflowStepRuns.startedAt, cutoff)
        )
      );
    for (const sr of stuck) {
      await failStepRun(sr.id, 'step_timeout_watchdog');
      recovered++;
    }

    // Re-tick every non-terminal run defensively. Idempotent because
    // tick is gated by the advisory lock and singletonKey at queue level.
    await enqueueTick(run.id);
  }

  if (recovered > 0) {
    logger.info('workflow_watchdog_recovered', { event: 'watchdog.recovered', count: recovered });
  }
}
