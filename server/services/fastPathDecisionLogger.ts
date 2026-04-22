import { db } from '../db/index.js';
import { fastPathDecisions } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { FastPathDecision } from '../../shared/types/briefFastPath.js';
import { logger } from '../lib/logger.js';

type DownstreamOutcome = 'proceeded' | 're_issued' | 'clarified' | 'abandoned' | 'user_overrode_scope';

/**
 * Logs a classifier decision to fast_path_decisions.
 * Best-effort — errors are logged but never re-thrown so Brief creation is never blocked.
 */
export async function logFastPathDecision(
  decision: FastPathDecision,
  context: {
    briefId: string;
    organisationId: string;
    subaccountId?: string;
  },
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(fastPathDecisions)
      .values({
        briefId: context.briefId,
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
      briefId: context.briefId,
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
  briefId: string,
  outcome: DownstreamOutcome,
  userOverrodeScopeTo?: FastPathDecision['scope'],
): Promise<void> {
  try {
    await db
      .update(fastPathDecisions)
      .set({
        downstreamOutcome: outcome,
        outcomeAt: new Date(),
        ...(userOverrodeScopeTo ? { userOverrodeScopeTo } : {}),
      })
      .where(eq(fastPathDecisions.briefId, briefId));
  } catch (err) {
    logger.warn('fastPathDecisionLogger.record_outcome_failed', {
      briefId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
