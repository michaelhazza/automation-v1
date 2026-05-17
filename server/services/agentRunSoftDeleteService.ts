import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { agentRuns } from '../db/schema/agentRuns.js';
import { logger } from '../lib/logger.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { SANDBOX_ARTEFACT_PURGE_JOB } from '../lib/sandboxJobNames.js';

export interface SoftDeleteResult {
  deleted: boolean;
  reason?: 'not_found' | 'already_deleted';
}

/**
 * Canonical soft-delete for agent_runs rows (spec §7.6 REQ #35).
 *
 * Sets deleted_at = NOW() on the target row, then enqueues a
 * sandbox-artefact-purge job so object-storage artefacts are cleaned up
 * asynchronously. The enqueue failure is suppression-is-success per §8.33:
 * a daily sweep is the safety net.
 *
 * §8.35: the UPDATE is gated on org scope + deleted_at IS NULL so rowCount 1
 * is the only success; rowCount 0 disambiguates not_found vs already_deleted
 * via a secondary SELECT.
 *
 * Caller must be inside `withOrgTx({organisationId})` or an org-scoped
 * middleware. Bypass: route handlers wrapped by `withOrgPermission`
 * automatically provide context.
 */
export async function softDeleteAgentRun(input: {
  runId: string;
  organisationId: string;
  subaccountId: string;
}): Promise<SoftDeleteResult> {
  const { runId, organisationId, subaccountId } = input;

  const scopedDb = getOrgScopedDb('agentRunSoftDeleteService.softDeleteAgentRun');

  const updated = await scopedDb
    .update(agentRuns)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.organisationId, organisationId),
        isNull(agentRuns.deletedAt),
      ),
    )
    .returning({ id: agentRuns.id });

  const rowCount = updated.length;

  if (rowCount > 1) {
    throw new Error(
      `softDeleteAgentRun: UPDATE matched ${rowCount} rows for runId=${runId} — expected at most 1 (PK predicate violation)`,
    );
  }

  if (rowCount === 0) {
    // Disambiguate: was the row missing, or already soft-deleted?
    const [existing] = await scopedDb
      .select({ id: agentRuns.id, deletedAt: agentRuns.deletedAt })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.organisationId, organisationId),
          isNotNull(agentRuns.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      return { deleted: false, reason: 'already_deleted' };
    }
    return { deleted: false, reason: 'not_found' };
  }

  // §8.10: state write committed above; now enqueue the side-effect.
  try {
    const boss = await getPgBoss();
    await boss.send(
      SANDBOX_ARTEFACT_PURGE_JOB,
      { runId, organisationId, subaccountId },
      { ...getJobConfig(SANDBOX_ARTEFACT_PURGE_JOB), singletonKey: runId },
    );
  } catch (error) {
    // §8.33 suppression-is-success: daily sweep is the safety net.
    logger.error('agent_run.soft_delete.purge_enqueue_failed', { runId, error });
  }

  return { deleted: true };
}
