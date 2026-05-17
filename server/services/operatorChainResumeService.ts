// operatorChainResumeService.ts — impure facade for chain resume payload composition.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 5-6
//
// Reads conversation artefact pointers from operator_runs for the given task,
// decrypts the checkpoint from the parent chain link, and delegates composition
// to the pure helper.

import { eq, and, asc, isNull, desc, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import { operatorRuns, agentRuns } from '../db/schema/index.js';
import { decideFreshProfileRestartAllowed } from './freshProfileRestartPredicatePure.js';
import {
  composeResumePayload,
  type ResumePayload,
  type ConversationArtefactPointer,
} from './operatorChainResumeServicePure.js';
import { decryptAgentRunPayloadJson, type EncryptedJson } from './agentRunPayloadEncryptionService.js';
import type { CheckpointPayload } from '../../shared/types/checkpointPayload.js';

export type { ResumePayload };

export const operatorChainResumeService = {
  /**
   * Composes the resume payload for the next chain link.
   *
   * Reads all non-superseded operator_runs for the task's current attempt,
   * collects conversation artefact pointers, decrypts the checkpoint from
   * the parent chain link, and delegates to composeResumePayload.
   */
  async composeResumePayload(
    orgId: string,
    subaccountId: string,
    agentRunId: string,
    parentChainLinkId: string,
    currentAttemptNumber: number,
  ): Promise<ResumePayload> {
    // operator_runs is dual-GUC RLS'd — open a nested SAVEPOINT and set both
    // org + subaccount GUCs (authenticate only sets the org one).
    return getOrgScopedDb('operatorChainResumeService.composeResumePayload').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      // Read the parent chain link (needed for its checkpoint and brief ref).
      const [parentLink] = await tx
        .select()
        .from(operatorRuns)
        .where(eq(operatorRuns.id, parentChainLinkId))
        .limit(1);

      if (!parentLink) {
        throw new Error(
          `operatorChainResumeService: parentChainLinkId ${parentChainLinkId} not found`,
        );
      }

      if (!parentLink.checkpointPayload) {
        throw new Error(
          `operatorChainResumeService: parentChainLinkId ${parentChainLinkId} has no checkpointPayload`,
        );
      }

      // Decrypt checkpoint payload (encrypted-at-rest per spec §3.14 item 10).
      const checkpoint = decryptAgentRunPayloadJson(
        parentLink.checkpointPayload as EncryptedJson,
      ) as CheckpointPayload;

      // Collect conversation artefact pointers for the current attempt, ordered by chainSeq.
      const allLinks = await tx
        .select({
          id: operatorRuns.id,
          chainSeq: operatorRuns.chainSeq,
        })
        .from(operatorRuns)
        .where(
          and(
            eq(operatorRuns.agentRunId, agentRunId),
            eq(operatorRuns.attemptNumber, currentAttemptNumber),
            isNull(operatorRuns.supersededByAttempt),
          ),
        )
        .orderBy(asc(operatorRuns.chainSeq));

      // Build artefact pointer list using operator-conversation-link artefact convention.
      // The artefact id follows the naming convention from spec §3.14 item 6.
      const conversationArtefactPointers: ConversationArtefactPointer[] = allLinks.map((link) => ({
        artefactId: `operator-conversation-link-${link.id}`,
        chainSeq: link.chainSeq,
      }));

      return composeResumePayload({
        agentRunId,
        originalTaskBriefRef: checkpoint.original_task_brief_ref,
        conversationArtefactPointers,
        checkpoint,
        attemptNumber: currentAttemptNumber,
      });
    });
  },

  async readAgentRunForTask(agentRunId: string, orgId: string) {
    const scopedDb = getOrgScopedDb('operatorChainResumeService.readAgentRunForTask');
    const [run] = await scopedDb
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        organisationId: agentRuns.organisationId,
        subaccountId: agentRuns.subaccountId,
        assignedUserId: agentRuns.assignedUserId,
        operatorChainFailureCount: agentRuns.operatorChainFailureCount,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, agentRunId), eq(agentRuns.organisationId, orgId)))
      .limit(1);
    return run ?? null;
  },

  async resetChainFailureCount(agentRunId: string, orgId: string): Promise<{ updated: boolean }> {
    const scopedDb = getOrgScopedDb('operatorChainResumeService.resetChainFailureCount');
    const result = await scopedDb
      .update(agentRuns)
      .set({ operatorChainFailureCount: 0 })
      .where(
        and(
          eq(agentRuns.id, agentRunId),
          eq(agentRuns.organisationId, orgId),
          eq(agentRuns.status, 'paused_chain_failure'),
        ),
      )
      .returning({ id: agentRuns.id });
    return { updated: result.length > 0 };
  },

  async accumulateBudgetExtension(
    agentRunId: string,
    orgId: string,
    extensionMinutes: number,
  ): Promise<{ updated: boolean }> {
    const scopedDb = getOrgScopedDb('operatorChainResumeService.accumulateBudgetExtension');
    const result = await scopedDb
      .update(agentRuns)
      .set({
        perTaskBudgetExtensionMinutes: sql`${agentRuns.perTaskBudgetExtensionMinutes} + ${extensionMinutes}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.id, agentRunId),
          eq(agentRuns.organisationId, orgId),
          eq(agentRuns.status, 'paused_budget_exceeded'),
        ),
      )
      .returning({ id: agentRuns.id });
    return { updated: result.length > 0 };
  },

  async executeFreshProfileRestart(
    agentRunId: string,
    orgId: string,
    subaccountId: string,
    taskStatus: string,
  ): Promise<{
    priorAttemptNumber: number;
    newAttemptNumber: number;
    priorChainSeqCount: number;
    predicate: ReturnType<typeof decideFreshProfileRestartAllowed>;
  }> {
    // operator_runs is dual-GUC RLS'd — see composeResumePayload above.
    return getOrgScopedDb('operatorChainResumeService.executeFreshProfileRestart').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [latestChainLink] = await tx
        .select({
          failureReason: operatorRuns.failureReason,
          failedMidStep: operatorRuns.failedMidStep,
          attemptNumber: operatorRuns.attemptNumber,
          chainSeq: operatorRuns.chainSeq,
        })
        .from(operatorRuns)
        .where(and(eq(operatorRuns.agentRunId, agentRunId), eq(operatorRuns.organisationId, orgId), isNull(operatorRuns.supersededByAttempt)))
        .orderBy(desc(operatorRuns.chainSeq))
        .limit(1);

      const predicate = decideFreshProfileRestartAllowed({
        taskStatus,
        latestChainLinkFailureClass: null,
        latestChainLinkFailureReason: latestChainLink?.failureReason ?? null,
      });

      const priorAttempt = latestChainLink?.attemptNumber ?? 1;
      const newAttempt = priorAttempt + 1;

      if (predicate.allowed) {
        await tx
          .update(operatorRuns)
          .set({ supersededByAttempt: newAttempt })
          .where(and(eq(operatorRuns.agentRunId, agentRunId), eq(operatorRuns.organisationId, orgId), isNull(operatorRuns.supersededByAttempt)));
      }

      return {
        priorAttemptNumber: priorAttempt,
        newAttemptNumber: newAttempt,
        priorChainSeqCount: latestChainLink?.chainSeq ?? 0,
        predicate,
      };
    });
  },
};
