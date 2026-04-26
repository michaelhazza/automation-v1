// DR3 — decideBriefApproval: records the user's approve/reject decision on a BriefApprovalCard
// artefact, emits a superseding BriefApprovalDecision via writeConversationMessage, and creates
// an audit record via actionService.proposeAction.
//
// Idempotency key: (artefactId, decision). First-commit-wins for concurrent different decisions.
// Unique-violation (23505) is caught and translated per spec §4.5.1.

import { db } from '../db/index.js';
import { tasks, conversationMessages } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { actionService } from './actionService.js';
import { writeConversationMessage } from './briefConversationWriter.js';
import type { BriefApprovalCard, BriefApprovalDecision } from '../../shared/types/briefResultContract.js';

export interface DecideBriefApprovalInput {
  artefactId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  conversationId: string;
  briefId: string;
  organisationId: string;
  subaccountId?: string;
  userId?: string;
}

export type DecideBriefApprovalResult =
  | {
      status: 'success';
      artefact: BriefApprovalDecision;
      executionId: string;
      executionStatus: BriefApprovalDecision['executionStatus'];
      idempotent: boolean;
    }
  | {
      status: 'failed';
      error: 'approval_already_decided';
      priorDecision: 'approve' | 'reject';
      priorArtefact: BriefApprovalDecision;
    }
  | { status: 'failed'; error: 'artefact_stale'; reason: string }
  | { status: 'failed'; error: 'artefact_not_found' }
  | { status: 'failed'; error: 'artefact_not_approval' };

export async function decideBriefApproval(
  input: DecideBriefApprovalInput,
): Promise<DecideBriefApprovalResult> {
  const startMs = Date.now();

  logger.info('brief.approval.received', {
    event: 'brief.approval.received',
    artefactId: input.artefactId,
    decision: input.decision,
    userId: input.userId,
    orgId: input.organisationId,
    conversationId: input.conversationId,
  });

  // 1. Stale check — brief must not be cancelled
  const [task] = await db
    .select({ status: tasks.status, assignedAgentId: tasks.assignedAgentId, subaccountId: tasks.subaccountId })
    .from(tasks)
    .where(and(eq(tasks.id, input.briefId), eq(tasks.organisationId, input.organisationId)))
    .limit(1);

  if (!task) {
    return { status: 'failed', error: 'artefact_not_found' };
  }

  if (task.status === 'cancelled') {
    logger.info('brief.approval.stale', {
      event: 'brief.approval.stale',
      artefactId: input.artefactId,
      reason: 'cancelled_brief',
      status: 'failed',
    });
    return { status: 'failed', error: 'artefact_stale', reason: 'cancelled_brief' };
  }

  // 2. JSONB scan: find the original approval card + any existing decision artefact
  const allMessages = await db
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.conversationId, input.conversationId),
      eq(conversationMessages.organisationId, input.organisationId),
    ));

  let approvalCard: BriefApprovalCard | null = null;
  let existingDecision: BriefApprovalDecision | null = null;
  let decisionMatchCount = 0;

  for (const msg of allMessages) {
    if (!Array.isArray(msg.artefacts)) continue;
    for (const a of msg.artefacts as Array<Record<string, unknown>>) {
      if (a['artefactId'] === input.artefactId && a['kind'] === 'approval') {
        approvalCard = a as unknown as BriefApprovalCard;
      }
      if (a['parentArtefactId'] === input.artefactId && a['kind'] === 'approval_decision') {
        decisionMatchCount++;
        existingDecision = a as unknown as BriefApprovalDecision;
      }
    }
  }

  // Artefact-ID collision is a hard failure — surfaces as HTTP 500 (data-integrity red flag)
  if (decisionMatchCount > 1) {
    logger.error('brief.approval.artefact_id_collision', {
      event: 'brief.approval.artefact_id_collision',
      artefactId: input.artefactId,
      orgId: input.organisationId,
      matchCount: decisionMatchCount,
    });
    throw Object.assign(new Error('artefact_id_collision'), { statusCode: 500 });
  }

  if (!approvalCard) {
    return { status: 'failed', error: 'artefact_not_found' };
  }

  // 3. Idempotency pre-check — decision already exists
  if (existingDecision) {
    if (existingDecision.decision === input.decision) {
      logger.info('brief.approval.idempotent_hit', {
        event: 'brief.approval.idempotent_hit',
        artefactId: input.artefactId,
        executionId: existingDecision.executionId,
        status: 'success',
      });
      return {
        status: 'success',
        artefact: existingDecision,
        executionId: existingDecision.executionId ?? existingDecision.artefactId,
        executionStatus: existingDecision.executionStatus,
        idempotent: true,
      };
    }
    logger.info('brief.approval.conflict', {
      event: 'brief.approval.conflict',
      artefactId: input.artefactId,
      priorDecision: existingDecision.decision,
      attemptedDecision: input.decision,
      status: 'failed',
    });
    return {
      status: 'failed',
      error: 'approval_already_decided',
      priorDecision: existingDecision.decision,
      priorArtefact: existingDecision,
    };
  }

  // 4. Attempt proposeAction for audit trail; determine executionStatus from outcome
  const executionId = crypto.randomUUID();
  let executionStatus: BriefApprovalDecision['executionStatus'] = 'failed';

  try {
    const agentId = task.assignedAgentId;
    if (agentId) {
      await actionService.proposeAction({
        organisationId: input.organisationId,
        subaccountId: task.subaccountId ?? null,
        agentId,
        actionType: approvalCard.actionSlug,
        idempotencyKey: `approval_decision:${input.artefactId}:${input.decision}`,
        payload: {
          ...approvalCard.actionArgs,
          decision: input.decision,
          reason: input.reason,
          approvalArtefactId: input.artefactId,
        },
        taskId: input.briefId,
      });
      executionStatus = 'pending';
    } else {
      logger.warn('brief.approval.no_agent_id', {
        artefactId: input.artefactId,
        briefId: input.briefId,
      });
    }
  } catch (actionErr: unknown) {
    logger.warn('brief.approval.proposeAction_failed', {
      event: 'brief.approval.proposeAction_failed',
      artefactId: input.artefactId,
      error: actionErr instanceof Error ? actionErr.message : String(actionErr),
    });
    executionStatus = 'failed';
  }

  // 5. Write decision artefact (captures user intent regardless of proposeAction outcome)
  const decisionArtefact: BriefApprovalDecision = {
    artefactId: executionId,
    kind: 'approval_decision',
    parentArtefactId: input.artefactId,
    status: 'final',
    decision: input.decision,
    reason: input.reason,
    executionId,
    executionStatus,
  };

  try {
    await writeConversationMessage({
      conversationId: input.conversationId,
      briefId: input.briefId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [decisionArtefact],
    });
  } catch (writeErr: unknown) {
    // 23505 unique_violation: two concurrent requests passed the pre-check simultaneously.
    // Re-fetch and classify as idempotent or conflict.
    if (isUniqueViolation(writeErr)) {
      const raced = await refetchDecisionArtefact(input.conversationId, input.organisationId, input.artefactId);
      if (!raced) throw writeErr; // should not happen; re-throw to surface as 500
      if (raced.decision === input.decision) {
        logger.info('brief.approval.idempotent_hit', {
          event: 'brief.approval.idempotent_hit',
          artefactId: input.artefactId,
          executionId: raced.executionId,
          status: 'success',
        });
        return {
          status: 'success',
          artefact: raced,
          executionId: raced.executionId ?? raced.artefactId,
          executionStatus: raced.executionStatus,
          idempotent: true,
        };
      }
      logger.info('brief.approval.conflict', {
        event: 'brief.approval.conflict',
        artefactId: input.artefactId,
        priorDecision: raced.decision,
        attemptedDecision: input.decision,
        status: 'failed',
      });
      return {
        status: 'failed',
        error: 'approval_already_decided',
        priorDecision: raced.decision,
        priorArtefact: raced,
      };
    }
    logger.error('brief.approval.failed', {
      event: 'brief.approval.failed',
      artefactId: input.artefactId,
      executionId,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      status: 'failed',
    });
    throw writeErr;
  }

  const latencyMs = Date.now() - startMs;
  logger.info('brief.approval.dispatched', {
    event: 'brief.approval.dispatched',
    artefactId: input.artefactId,
    executionId,
    latencyMs,
  });
  logger.info('brief.approval.completed', {
    event: 'brief.approval.completed',
    artefactId: input.artefactId,
    executionId,
    latencyMs,
    status: 'success',
    executionStatus,
  });

  return {
    status: 'success',
    artefact: decisionArtefact,
    executionId,
    executionStatus,
    idempotent: false,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === '23505'
  );
}

async function refetchDecisionArtefact(
  conversationId: string,
  organisationId: string,
  parentArtefactId: string,
): Promise<BriefApprovalDecision | null> {
  const messages = await db
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.conversationId, conversationId),
      eq(conversationMessages.organisationId, organisationId),
    ));
  for (const msg of messages) {
    if (!Array.isArray(msg.artefacts)) continue;
    for (const a of msg.artefacts as Array<Record<string, unknown>>) {
      if (a['parentArtefactId'] === parentArtefactId && a['kind'] === 'approval_decision') {
        return a as unknown as BriefApprovalDecision;
      }
    }
  }
  return null;
}
