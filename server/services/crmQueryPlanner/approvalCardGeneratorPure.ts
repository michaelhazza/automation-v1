// Approval card generator — pure function (spec §15.4)
// Separated from resultNormaliserPure for independent testability.

import { randomUUID } from 'crypto';
import type { QueryPlan, ExecutorResult } from '../../../shared/types/crmQueryPlanner.js';
import type { BriefApprovalCard } from '../../../shared/types/briefResultContract.js';

export interface ApprovalCardContext {
  subaccountId: string;
  defaultSenderIdentifier?: string;
}

/**
 * Generates approval cards for the given plan + exec result.
 * v1 pattern: contact-list result → single-contact crm.send_email card for top row.
 * Skips silently if no sender identifier is configured (§15.4).
 */
export function generateApprovalCards(
  plan: QueryPlan,
  execResult: ExecutorResult,
  context: ApprovalCardContext,
): BriefApprovalCard[] {
  const cards: BriefApprovalCard[] = [];

  if (
    plan.primaryEntity === 'contacts' &&
    execResult.rows.length > 0 &&
    context.defaultSenderIdentifier
  ) {
    const top = execResult.rows[0]!;
    const toContactId = String(top['id'] ?? '');
    if (!toContactId) return cards;

    cards.push({
      artefactId:        randomUUID(),
      kind:              'approval',
      summary:           `Send email to ${top['displayName'] ?? toContactId}`,
      actionSlug:        'crm.send_email',
      actionArgs: {
        from:         context.defaultSenderIdentifier,
        toContactId,
        subject:      '',
        body:         '',
        scheduleHint: 'immediate',
      },
      affectedRecordIds: [toContactId],
      riskLevel:         'low',
    });
  }

  return cards;
}
