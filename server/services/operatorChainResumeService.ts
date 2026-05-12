// operatorChainResumeService.ts — impure facade for chain resume payload composition.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 5-6
//
// Reads conversation artefact pointers from operator_runs for the given task,
// decrypts the checkpoint from the parent chain link, and delegates composition
// to the pure helper.

import { eq, and, asc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { operatorRuns } from '../db/schema/index.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
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
    return db.transaction(async (tx) => {
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
};
