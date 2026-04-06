import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { feedbackVotes } from '../db/schema/index.js';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

const VALID_ENTITY_TYPES = ['task_activity', 'task_deliverable', 'agent_message'] as const;
const VALID_VOTES = ['up', 'down'] as const;

/**
 * POST /api/feedback
 * Upsert a vote on an agent-generated entity.
 */
router.post(
  '/api/feedback',
  authenticate,
  asyncHandler(async (req, res) => {
    const { entityType, entityId, vote, comment, agentId } = req.body as {
      entityType?: string;
      entityId?: string;
      vote?: string;
      comment?: string;
      agentId?: string;
    };

    if (!entityType || !VALID_ENTITY_TYPES.includes(entityType as any)) {
      throw { statusCode: 400, message: 'entityType must be one of: task_activity, task_deliverable, agent_message' };
    }
    if (!entityId) throw { statusCode: 400, message: 'entityId is required' };
    if (!vote || !VALID_VOTES.includes(vote as any)) {
      throw { statusCode: 400, message: 'vote must be up or down' };
    }

    const [row] = await db
      .insert(feedbackVotes)
      .values({
        organisationId: req.orgId!,
        userId: req.user!.id,
        entityType: entityType as 'task_activity' | 'task_deliverable' | 'agent_message',
        entityId,
        vote: vote as 'up' | 'down',
        comment: comment?.trim() || null,
        agentId: agentId || null,
      })
      .onConflictDoUpdate({
        target: [feedbackVotes.userId, feedbackVotes.entityType, feedbackVotes.entityId],
        set: {
          vote: sql`excluded.vote`,
          comment: sql`excluded.comment`,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json(row);
  })
);

/**
 * DELETE /api/feedback/:feedbackId
 * Hard delete a feedback vote.
 */
router.delete(
  '/api/feedback/:feedbackId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { feedbackId } = req.params;

    const [existing] = await db
      .select()
      .from(feedbackVotes)
      .where(and(
        eq(feedbackVotes.id, feedbackId),
        eq(feedbackVotes.organisationId, req.orgId!),
        eq(feedbackVotes.userId, req.user!.id),
      ));

    if (!existing) throw { statusCode: 404, message: 'Feedback vote not found' };

    await db.delete(feedbackVotes).where(eq(feedbackVotes.id, feedbackId));

    res.json({ success: true });
  })
);

/**
 * GET /api/feedback/agent/:agentId/summary
 * Aggregate up/down vote counts for an agent, with optional date range.
 * Query params: startDate, endDate (ISO strings)
 */
router.get(
  '/api/feedback/agent/:agentId/summary',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    // Build date range conditions
    const conditions = [
      eq(feedbackVotes.agentId, agentId),
      eq(feedbackVotes.organisationId, req.orgId!),
    ];

    if (startDate) {
      conditions.push(sql`${feedbackVotes.createdAt} >= ${new Date(startDate)}`);
    }
    if (endDate) {
      conditions.push(sql`${feedbackVotes.createdAt} <= ${new Date(endDate)}`);
    }

    // Aggregate counts grouped by vote type
    const voteCounts = await db
      .select({
        vote: feedbackVotes.vote,
        count: count(),
      })
      .from(feedbackVotes)
      .where(and(...conditions))
      .groupBy(feedbackVotes.vote);

    let up = 0;
    let down = 0;
    for (const row of voteCounts) {
      if (row.vote === 'up') up = Number(row.count);
      if (row.vote === 'down') down = Number(row.count);
    }

    // Recent negative feedback (last 10 downvotes)
    const recentNegative = await db
      .select({
        id: feedbackVotes.id,
        entityType: feedbackVotes.entityType,
        entityId: feedbackVotes.entityId,
        comment: feedbackVotes.comment,
        createdAt: feedbackVotes.createdAt,
      })
      .from(feedbackVotes)
      .where(and(
        eq(feedbackVotes.agentId, agentId),
        eq(feedbackVotes.organisationId, req.orgId!),
        eq(feedbackVotes.vote, 'down'),
      ))
      .orderBy(desc(feedbackVotes.createdAt))
      .limit(10);

    res.json({
      up,
      down,
      total: up + down,
      recentNegative,
    });
  })
);

export default router;
