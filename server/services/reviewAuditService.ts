import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reviewAuditRecords, actions } from '../db/schema/index.js';
import { collapseOutcome } from './outcomeLearningService.js';

// ---------------------------------------------------------------------------
// Review Audit Service — records every human decision on a gated action.
// Modelled after CrewAI's HumanFeedbackResult pattern.
// Writes the audit record synchronously, then fires outcome-collapse async.
// ---------------------------------------------------------------------------

export interface ReviewAuditInput {
  actionId: string;
  organisationId: string;
  subaccountId: string;
  agentRunId?: string | null;
  toolSlug: string;
  agentOutput: Record<string, unknown>;
  decidedBy: string;
  decision: 'approved' | 'rejected' | 'edited' | 'timed_out';
  rawFeedback?: string;
  editedArgs?: Record<string, unknown>;
  proposedAt: Date;
  majorAcknowledged?: boolean;
  majorReason?: 'irreversible' | 'cross_subaccount' | 'cost_per_action' | 'cost_per_run';
  ackText?: string;
  ackAmountMinor?: number;
  ackCurrencyCode?: string;
}

export const reviewAuditService = {
  /**
   * Record a human decision on a review-gated action.
   * Inserts synchronously, then fires the LLM outcome-collapse asynchronously.
   */
  async record(input: ReviewAuditInput): Promise<void> {
    const decidedAt = new Date();
    const waitDurationMs = decidedAt.getTime() - input.proposedAt.getTime();

    const [row] = await db
      .insert(reviewAuditRecords)
      .values({
        actionId: input.actionId,
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        agentRunId: input.agentRunId ?? null,
        toolSlug: input.toolSlug,
        agentOutput: input.agentOutput,
        decidedBy: input.decidedBy,
        decision: input.decision,
        rawFeedback: input.rawFeedback ?? null,
        editedArgs: input.editedArgs ?? null,
        majorAcknowledged: input.majorAcknowledged ?? false,
        majorReason: input.majorReason ?? null,
        ackText: input.ackText ?? null,
        ackAmountMinor: input.ackAmountMinor ?? null,
        ackCurrencyCode: input.ackCurrencyCode ?? null,
        proposedAt: input.proposedAt,
        decidedAt,
        waitDurationMs,
      })
      .returning({ id: reviewAuditRecords.id });

    // Fire outcome-collapse async — does not block the approval response
    collapseOutcomeAsync(row.id, input.decision, input.rawFeedback).catch((err) => {
      console.error('[ReviewAudit] Outcome collapse failed for record', row.id, err);
    });

    // If the human edited the args, write a lesson to workspace memory
    if (input.decision === 'edited' && input.editedArgs && input.agentRunId) {
      collapseOutcome({
        toolSlug: input.toolSlug,
        originalArgs: input.agentOutput,
        editedArgs: input.editedArgs,
        agentRunId: input.agentRunId,
        agentId: input.agentOutput['agentId'] as string ?? 'unknown',
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
      }).catch((err) => console.error('[ReviewAudit] Fire-and-forget audit failed:', err));
    }
  },
};

// ---------------------------------------------------------------------------
// Outcome collapse — classifies free-text feedback into a typed outcome.
// Uses claude-haiku-4-5 (cheapest model) for the classification call.
// Result is written back to the review_audit_records row.
// ---------------------------------------------------------------------------

const OUTCOME_OPTIONS = ['approved', 'rejected', 'needs_revision'] as const;
type CollapsedOutcome = (typeof OUTCOME_OPTIONS)[number];

async function collapseOutcomeAsync(
  auditRecordId: string,
  decision: string,
  rawFeedback?: string,
): Promise<void> {
  const collapsed = await collapseToOutcome(rawFeedback ?? '', decision);

  await db
    .update(reviewAuditRecords)
    .set({ collapsedOutcome: collapsed })
    .where(eq(reviewAuditRecords.id, auditRecordId));
}

async function collapseToOutcome(
  rawFeedback: string,
  decision: string,
): Promise<CollapsedOutcome> {
  // Short-circuit: empty feedback or clear binary decision
  if (!rawFeedback || rawFeedback.trim().length === 0) {
    return decision === 'approved' ? 'approved' : 'rejected';
  }

  // Simple lexical classifier — avoids an LLM call for obvious cases
  const lower = rawFeedback.toLowerCase();
  if (/(change|update|revise|fix|amend|modify|adjust|different|instead|not quite)/i.test(lower)) {
    return 'needs_revision';
  }
  if (/(looks good|approved|lgtm|perfect|yes|great|go ahead|proceed|correct)/i.test(lower)) {
    return 'approved';
  }
  if (/(no|reject|decline|stop|don't|do not|block|refuse|cancel)/i.test(lower)) {
    return 'rejected';
  }

  // Ambiguous — use the binary decision as ground truth
  if (decision === 'approved' || decision === 'edited') return 'approved';
  return 'rejected';
}
