/**
 * server/services/optimiser/recommendations/repeatPhrase.ts
 *
 * Evaluator: repeat escalation phrase detection.
 *
 * Trigger: phrase count >= 3 (already enforced by the query module).
 *   Each returned phrase row is a candidate.
 *
 * Category: optimiser.escalation.repeat_phrase
 * Severity: info
 * Dedupe key: phrase
 *
 * F1 degradation: The action_hint links to the brand-voice configuration page
 *   with the specific phrase pre-filled IF F1 (subaccount-artefacts) has
 *   merged and a tier1 brand-voice memory block exists for this sub-account.
 *
 *   Degradation paths:
 *   1. F1 merged + brand-voice block exists:
 *      action_hint = configuration-assistant://brand-voice/<subaccountId>?phrase=<encoded>
 *   2. F1 merged but no brand-voice block:
 *      action_hint = configuration-assistant://subaccount/<subaccountId>?focus=brand-voice
 *   3. F1 not yet merged (42703 error — column "tier" does not exist):
 *      action_hint = configuration-assistant://subaccount/<subaccountId>?focus=brand-voice
 *
 * Spec: docs/sub-account-optimiser-spec.md §12 graceful degradation
 */

import type { EscalationPhrasesRow } from '../queries/escalationPhrases.js';
import type { RecommendationCandidate } from './agentBudget.js';
import { db } from '../../../db/index.js';
import { sql } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';

const CATEGORY = 'optimiser.escalation.repeat_phrase';

/**
 * Attempt to look up an F1 brand-voice tier1 memory block for the sub-account.
 *
 * Returns:
 *   { exists: true }  — F1 merged, block found
 *   { exists: false } — F1 merged, no brand-voice block
 *   { degraded: true } — F1 not yet merged (column "tier" does not exist, Postgres error 42703)
 */
export async function lookupBrandVoiceBlock(
  subaccountId: string,
): Promise<{ exists: true } | { exists: false } | { degraded: true }> {
  try {
    const result = await db.execute<{ id: string }>(sql`
      SELECT id
      FROM memory_blocks
      WHERE subaccount_id = ${subaccountId}
        AND tier = 'tier1'
        AND domain = 'brand-voice'
      LIMIT 1
    `);

    const rows = result as unknown as Array<{ id: string }>;
    return rows.length > 0 ? { exists: true } : { exists: false };
  } catch (err: unknown) {
    // Postgres error code 42703: column "tier" does not exist — F1 not merged yet
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42703') {
      logger.info('recommendations.repeatPhrase.f1_not_merged', {
        subaccountId,
        reason: 'column_tier_missing',
      });
      return { degraded: true };
    }
    // For other DB errors, propagate to the caller
    throw err;
  }
}

/**
 * Build the action_hint for a given phrase and sub-account.
 * Uses the degradation logic described in the module comment.
 */
export async function buildRepeatPhraseActionHint(
  phrase: string,
  subaccountId: string,
): Promise<string> {
  const lookup = await lookupBrandVoiceBlock(subaccountId);

  if ('degraded' in lookup || !lookup.exists) {
    // F1 not merged, or no brand-voice block — fallback
    return `configuration-assistant://subaccount/${subaccountId}?focus=brand-voice`;
  }

  // F1 merged + brand-voice block exists — include phrase param
  const encodedPhrase = encodeURIComponent(phrase);
  return `configuration-assistant://brand-voice/${subaccountId}?phrase=${encodedPhrase}`;
}

export async function evaluateRepeatPhrase(
  rows: EscalationPhrasesRow[],
  ctx: { subaccountId: string },
): Promise<RecommendationCandidate[]> {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    let action_hint: string;
    try {
      action_hint = await buildRepeatPhraseActionHint(row.phrase, ctx.subaccountId);
    } catch (err) {
      logger.warn('recommendations.repeatPhrase.action_hint_failed', {
        phrase: row.phrase,
        subaccountId: ctx.subaccountId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Degrade to the generic fallback on unexpected errors
      action_hint = `configuration-assistant://subaccount/${ctx.subaccountId}?focus=brand-voice`;
    }

    candidates.push({
      category: CATEGORY,
      severity: 'info',
      evidence: {
        phrase: row.phrase,
        count: row.count,
        sample_escalation_ids: row.sample_escalation_ids,
      },
      dedupe_key: row.phrase,
      action_hint,
    });
  }

  return candidates;
}
