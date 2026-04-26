// DR3 — decideBriefApproval: records the user's approve/reject decision on a BriefApprovalCard
// artefact, emits a superseding BriefApprovalDecision via writeConversationMessage, and creates
// an audit record via actionService.proposeAction.
//
// Idempotency key: (artefactId, decision). First-commit-wins for concurrent different decisions.
// Unique-violation (23505) is caught and translated per spec §4.5.1.

import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks, conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
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

  // All reads/writes here run inside the request's org-scoped tx so RLS sees
  // the binding. Bare `db` would hit fail-closed policies on tasks /
  // conversations / conversation_messages.
  const tx = getOrgScopedDb('briefApprovalService');

  // 1. Stale check — brief must not be cancelled
  const [task] = await tx
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

  // 2. Validate conversation belongs to this brief (prevents cross-brief approval dispatch)
  const [conv] = await tx
    .select({ scopeId: conversations.scopeId, scopeType: conversations.scopeType })
    .from(conversations)
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organisationId, input.organisationId),
    ))
    .limit(1);

  if (!conv || conv.scopeType !== 'brief' || conv.scopeId !== input.briefId) {
    return { status: 'failed', error: 'artefact_not_found' };
  }

  // 3. JSONB scan: find the original approval card + any existing decision artefact
  const allMessages = await tx
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.conversationId, input.conversationId),
      eq(conversationMessages.organisationId, input.organisationId),
    ));

  let approvalCard: BriefApprovalCard | null = null;
  let foundArtefactWithId = false;
  let existingDecision: BriefApprovalDecision | null = null;
  let decisionMatchCount = 0;

  for (const msg of allMessages) {
    if (!Array.isArray(msg.artefacts)) continue;
    for (const a of msg.artefacts as Array<Record<string, unknown>>) {
      if (a['artefactId'] === input.artefactId) {
        foundArtefactWithId = true;
        if (a['kind'] === 'approval') {
          approvalCard = a as unknown as BriefApprovalCard;
        }
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
    // Artefact exists but is not an approval card → 422; truly absent → 404
    if (foundArtefactWithId) {
      return { status: 'failed', error: 'artefact_not_approval' };
    }
    return { status: 'failed', error: 'artefact_not_found' };
  }

  // 4. Idempotency pre-check — decision already exists
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

  // 5. Claim the approval first by writing the decision artefact. The lifecycle
  //    write-guard inside writeConversationMessage rejects with
  //    artefactsAccepted: 0 when a concurrent caller already committed a
  //    decision for this parentArtefactId — we MUST observe that signal before
  //    firing the side-effecting proposeAction call so the losing decision
  //    cannot enqueue contradictory actions for the same approval card.
  //
  //    The persisted artefact is written optimistically with executionStatus:
  //    'pending'. If proposeAction subsequently fails we patch the artefact
  //    to 'failed' below; in the common success case no second write is
  //    needed and the persisted state matches the response.
  const executionId = crypto.randomUUID();
  let executionStatus: BriefApprovalDecision['executionStatus'] = 'pending';

  const pendingDecisionArtefact: BriefApprovalDecision = {
    artefactId: executionId,
    kind: 'approval_decision',
    parentArtefactId: input.artefactId,
    status: 'final',
    decision: input.decision,
    reason: input.reason,
    executionId,
    executionStatus,
  };

  const writeResult = await writeConversationMessage({
    conversationId: input.conversationId,
    briefId: input.briefId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    role: 'assistant',
    content: '',
    artefacts: [pendingDecisionArtefact],
  });

  if (writeResult.artefactsAccepted < 1) {
    // We lost the race. Re-read the existing decision so the caller gets
    // a coherent priorArtefact. We do NOT proposeAction — the winner did
    // (or is doing) that. Re-read inside the same org-scoped tx.
    const conflictMessages = await tx
      .select({ artefacts: conversationMessages.artefacts })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.conversationId, input.conversationId),
        eq(conversationMessages.organisationId, input.organisationId),
      ));

    let winningDecision: BriefApprovalDecision | null = null;
    for (const msg of conflictMessages) {
      if (!Array.isArray(msg.artefacts)) continue;
      for (const a of msg.artefacts as Array<Record<string, unknown>>) {
        if (a['parentArtefactId'] === input.artefactId && a['kind'] === 'approval_decision') {
          winningDecision = a as unknown as BriefApprovalDecision;
        }
      }
    }

    logger.info('brief.approval.race_lost', {
      event: 'brief.approval.race_lost',
      artefactId: input.artefactId,
      attemptedDecision: input.decision,
      winningDecision: winningDecision?.decision ?? null,
      status: 'failed',
    });

    if (winningDecision) {
      // Surface as conflict (or idempotent-hit if both callers chose the same decision).
      if (winningDecision.decision === input.decision) {
        return {
          status: 'success',
          artefact: winningDecision,
          executionId: winningDecision.executionId ?? winningDecision.artefactId,
          executionStatus: winningDecision.executionStatus,
          idempotent: true,
        };
      }
      return {
        status: 'failed',
        error: 'approval_already_decided',
        priorDecision: winningDecision.decision,
        priorArtefact: winningDecision,
      };
    }
    // Defensive fallback — shouldn't happen, but treat as not-found rather
    // than masquerading as success.
    return { status: 'failed', error: 'artefact_not_found' };
  }

  // 6. We claimed the decision. Now propose the action for audit trail.
  let proposeFailed = false;
  try {
    const agentId = task.assignedAgentId;
    if (agentId) {
      // Idempotency key is keyed on artefactId only (not the decision). This
      // closes the second half of the race: even if the lifecycle write-guard
      // in writeConversationMessage misses a concurrent decision (it is a
      // read-then-insert without a DB-level constraint, so two simultaneous
      // writers can both pass), the action layer dedups on a per-card key —
      // an approve and a reject racing on the same approvalArtefactId cannot
      // both enqueue actions; the second arriving caller sees the first
      // caller's existing action row and short-circuits to isNew: false.
      await actionService.proposeAction({
        organisationId: input.organisationId,
        subaccountId: task.subaccountId ?? null,
        agentId,
        actionType: approvalCard.actionSlug,
        idempotencyKey: `approval_decision:${input.artefactId}`,
        payload: {
          ...approvalCard.actionArgs,
          decision: input.decision,
          reason: input.reason,
          approvalArtefactId: input.artefactId,
        },
        taskId: input.briefId,
      });
      // executionStatus stays 'pending' — matches the persisted optimistic
      // value, no second write needed.
    } else {
      logger.warn('brief.approval.no_agent_id', {
        artefactId: input.artefactId,
        briefId: input.briefId,
      });
      // No agent → no proposeAction call → no execution kicked off.
      proposeFailed = true;
    }
  } catch (actionErr: unknown) {
    logger.warn('brief.approval.proposeAction_failed', {
      event: 'brief.approval.proposeAction_failed',
      artefactId: input.artefactId,
      error: actionErr instanceof Error ? actionErr.message : String(actionErr),
    });
    proposeFailed = true;
  }

  if (proposeFailed) {
    executionStatus = 'failed';
    // Patch the persisted artefact's executionStatus so reads see the final
    // outcome rather than the optimistic 'pending'. Best-effort — log on
    // failure but do not flip the response status, since the user's intent
    // was captured and the action audit trail surfaces the failure.
    try {
      await tx.execute(sql`
        UPDATE conversation_messages
        SET artefacts = (
          SELECT jsonb_agg(
            CASE WHEN elem->>'artefactId' = ${executionId}
              THEN jsonb_set(elem, '{executionStatus}', '"failed"'::jsonb)
              ELSE elem
            END
          )
          FROM jsonb_array_elements(artefacts) elem
        )
        WHERE conversation_id = ${input.conversationId}::uuid
          AND organisation_id = ${input.organisationId}::uuid
          AND artefacts @> ${JSON.stringify([{ artefactId: executionId }])}::jsonb
      `);
    } catch (patchErr: unknown) {
      logger.warn('brief.approval.executionStatus_patch_failed', {
        event: 'brief.approval.executionStatus_patch_failed',
        artefactId: input.artefactId,
        executionId,
        error: patchErr instanceof Error ? patchErr.message : String(patchErr),
      });
    }
  }

  const decisionArtefact: BriefApprovalDecision = {
    ...pendingDecisionArtefact,
    executionStatus,
  };

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

