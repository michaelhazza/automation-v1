/**
 * WorkflowDraftService — workflow_drafts CRUD.
 *
 * Spec: tasks/Workflows-spec.md §3.3, §10.7.
 * Decision 14: draftSource is required; V1 callers always pass 'orchestrator'.
 *
 * Paired with: workflowDraftServicePure.ts (pure helpers).
 */

import { eq, and, lt, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowDrafts } from '../db/schema/index.js';
import type { WorkflowDraft, WorkflowDraftSource } from '../db/schema/workflowDrafts.js';
import type { WorkflowStep } from '../lib/workflow/types.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  payload: WorkflowStep[];
  sessionId: string;
  subaccountId: string;
  organisationId: string;
  draftSource: WorkflowDraftSource;
}

export type DiscardDraftResult =
  | { discarded: true }
  | { discarded: false; reason: 'already_consumed'; consumedAt: string };

// ─── Service ──────────────────────────────────────────────────────────────────

export const WorkflowDraftService = {
  /**
   * Create a new draft.
   *
   * The (subaccountId, sessionId) pair has a unique index; callers should
   * handle 23505 duplicate-key errors if re-using a session id.
   */
  async create(input: CreateDraftInput): Promise<{ id: string }> {
    const [row] = await db
      .insert(workflowDrafts)
      .values({
        sessionId: input.sessionId,
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        // The schema column is typed as Record<string,unknown>; cast through unknown.
        payload: input.payload as unknown as Record<string, unknown>,
        draftSource: input.draftSource,
      })
      .returning({ id: workflowDrafts.id });
    return { id: row.id };
  },

  /**
   * Fetch a draft by id, scoped to the organisation.
   * Returns null if not found or if the org doesn't own it.
   */
  async findById(draftId: string, organisationId: string): Promise<WorkflowDraft | null> {
    const [row] = await db
      .select()
      .from(workflowDrafts)
      .where(
        and(
          eq(workflowDrafts.id, draftId),
          eq(workflowDrafts.organisationId, organisationId)
        )
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Mark a draft as consumed by setting consumedAt = now().
   * No-ops if already consumed (idempotent — callers check state separately).
   */
  async markConsumed(draftId: string, organisationId: string): Promise<void> {
    await db
      .update(workflowDrafts)
      .set({ consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(workflowDrafts.id, draftId),
          eq(workflowDrafts.organisationId, organisationId)
        )
      );
  },

  /**
   * List unconsumed drafts older than `thresholdSeconds` seconds.
   * Used by the cleanup job (Chunk 16).
   */
  async listUnconsumedOlderThan(
    thresholdSeconds: number,
    organisationId: string
  ): Promise<WorkflowDraft[]> {
    const cutoff = new Date(Date.now() - thresholdSeconds * 1000);
    return db
      .select()
      .from(workflowDrafts)
      .where(
        and(
          eq(workflowDrafts.organisationId, organisationId),
          isNull(workflowDrafts.consumedAt),
          lt(workflowDrafts.createdAt, cutoff)
        )
      );
  },

  /**
   * Operator-side dismiss: mark a draft consumed and return the outcome.
   *
   * - If the draft is already consumed: returns { discarded: false, reason: 'already_consumed', consumedAt }
   * - If the draft doesn't exist: returns { discarded: false, reason: 'already_consumed', ... } — callers
   *   distinguish via a prior findById; the route layer returns 404 in that case.
   * - On success: returns { discarded: true }
   */
  async discardDraft(draftId: string, organisationId: string): Promise<DiscardDraftResult> {
    const draft = await WorkflowDraftService.findById(draftId, organisationId);
    if (!draft) {
      // Route layer distinguishes not-found from consumed; return a sentinel
      // that the route converts to 404.
      return { discarded: false, reason: 'already_consumed', consumedAt: new Date(0).toISOString() };
    }
    if (draft.consumedAt !== null) {
      return {
        discarded: false,
        reason: 'already_consumed',
        consumedAt: draft.consumedAt.toISOString(),
      };
    }
    await WorkflowDraftService.markConsumed(draftId, organisationId);
    return { discarded: true };
  },
};
