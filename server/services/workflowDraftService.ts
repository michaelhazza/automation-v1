/**
 * workflowDraftService — CRUD for workflow_drafts.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import { db } from '../db/index.js';
import { workflowDrafts } from '../db/schema/workflowDrafts.js';
import type { WorkflowDraft } from '../db/schema/workflowDrafts.js';
import type { DraftSource } from '../../shared/types/workflowStepGate.js';
import { and, eq, isNull, lt } from 'drizzle-orm';

export const workflowDraftService = {
  async findById(draftId: string, organisationId: string): Promise<WorkflowDraft | null> {
    const [row] = await db
      .select()
      .from(workflowDrafts)
      .where(
        and(
          eq(workflowDrafts.id, draftId),
          eq(workflowDrafts.organisationId, organisationId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async markConsumed(draftId: string, organisationId: string): Promise<WorkflowDraft | null> {
    const [updated] = await db
      .update(workflowDrafts)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(workflowDrafts.id, draftId),
          eq(workflowDrafts.organisationId, organisationId),
          isNull(workflowDrafts.consumedAt),
        ),
      )
      .returning();
    return updated ?? null;
  },

  async create(params: {
    sessionId: string;
    organisationId: string;
    subaccountId: string;
    payload: Record<string, unknown>;
    draftSource: DraftSource;
  }): Promise<WorkflowDraft> {
    const [row] = await db
      .insert(workflowDrafts)
      .values({
        sessionId: params.sessionId,
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        payload: params.payload,
        draftSource: params.draftSource,
      })
      .returning();
    return row;
  },

  async listUnconsumedOlderThan(olderThan: Date): Promise<WorkflowDraft[]> {
    return db
      .select()
      .from(workflowDrafts)
      .where(
        and(
          isNull(workflowDrafts.consumedAt),
          lt(workflowDrafts.createdAt, olderThan),
        ),
      );
  },
};
