import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { fastPathDecisions } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import type { FastPathDecision } from '../../shared/types/taskFastPath.js';
import { logger } from '../lib/logger.js';

type DownstreamOutcome = 'proceeded' | 're_issued' | 'clarified' | 'abandoned' | 'user_overrode_scope';

/**
 * Logs a classifier decision to fast_path_decisions.
 * Best-effort — errors are logged but never re-thrown so Brief creation is never blocked.
 */
export async function logFastPathDecision(
  decision: FastPathDecision,
  context: {
    taskId: string;
    organisationId: string;
    subaccountId?: string;
  },
): Promise<string | null> {
  try {
    const scopedDb = getOrgScopedDb('fastPathDecisionLogger.logFastPathDecision');
    const [row] = await scopedDb
      .insert(fastPathDecisions)
      .values({
        taskId: context.taskId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId ?? null,
        decidedRoute: decision.route,
        decidedScope: decision.scope,
        decidedConfidence: String(decision.confidence),
        decidedTier: decision.tier,
        secondLookTriggered: decision.secondLookTriggered,
        metadata: {
          keywords: decision.keywords ?? [],
          reasoning: decision.reasoning ?? null,
        },
      })
      .returning({ id: fastPathDecisions.id });

    return row?.id ?? null;
  } catch (err) {
    logger.warn('fastPathDecisionLogger.log_failed', {
      taskId: context.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Records the downstream outcome when a Brief closes.
 * Best-effort — errors do not surface to the caller.
 */
export async function recordFastPathOutcome(
  taskId: string,
  organisationId: string,
  outcome: DownstreamOutcome,
  userOverrodeScopeTo?: FastPathDecision['scope'],
): Promise<void> {
  try {
    const scopedDb = getOrgScopedDb('fastPathDecisionLogger.recordFastPathOutcome');
    await scopedDb
      .update(fastPathDecisions)
      .set({
        downstreamOutcome: outcome,
        outcomeAt: new Date(),
        ...(userOverrodeScopeTo ? { userOverrodeScopeTo } : {}),
      })
      .where(and(
        eq(fastPathDecisions.taskId, taskId),
        eq(fastPathDecisions.organisationId, organisationId),
      ));
  } catch (err) {
    logger.warn('fastPathDecisionLogger.record_outcome_failed', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
