import { eq, and, count, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { feedbackVotes } from '../db/schema/index.js';

const VALID_ENTITY_TYPES = ['task_activity', 'task_deliverable', 'agent_message'] as const;
const VALID_VOTES = ['up', 'down'] as const;

type EntityType = (typeof VALID_ENTITY_TYPES)[number];
type Vote = (typeof VALID_VOTES)[number];

export interface UpsertVoteData {
  entityType: string;
  entityId: string;
  vote: string;
  comment?: string;
  agentId?: string;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

export const feedbackService = {
  /**
   * Upsert a vote on an agent-generated entity.
   */
  async upsertVote(userId: string, orgId: string, data: UpsertVoteData) {
    const { entityType, entityId, vote, comment, agentId } = data;

    if (!entityType || !VALID_ENTITY_TYPES.includes(entityType as EntityType)) {
      throw { statusCode: 400, message: 'entityType must be one of: task_activity, task_deliverable, agent_message' };
    }
    if (!entityId) throw { statusCode: 400, message: 'entityId is required' };
    if (!vote || !VALID_VOTES.includes(vote as Vote)) {
      throw { statusCode: 400, message: 'vote must be up or down' };
    }

    const [row] = await db
      .insert(feedbackVotes)
      .values({
        organisationId: orgId,
        userId,
        entityType: entityType as EntityType,
        entityId,
        vote: vote as Vote,
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

    return row;
  },

  /**
   * Hard-delete a feedback vote owned by the given user.
   */
  async removeVote(feedbackId: string, userId: string, orgId: string) {
    const [existing] = await db
      .select()
      .from(feedbackVotes)
      .where(and(
        eq(feedbackVotes.id, feedbackId),
        eq(feedbackVotes.organisationId, orgId),
        eq(feedbackVotes.userId, userId),
      ));

    if (!existing) throw { statusCode: 404, message: 'Feedback vote not found' };

    await db.delete(feedbackVotes).where(eq(feedbackVotes.id, feedbackId));

    return { success: true };
  },

  /**
   * Aggregate up/down vote counts for an agent, with optional date range.
   * Also returns the 10 most recent downvotes.
   */
  async getAgentSummary(agentId: string, orgId: string, dateRange?: DateRange) {
    const conditions = [
      eq(feedbackVotes.agentId, agentId),
      eq(feedbackVotes.organisationId, orgId),
    ];

    if (dateRange?.startDate) {
      conditions.push(sql`${feedbackVotes.createdAt} >= ${new Date(dateRange.startDate)}`);
    }
    if (dateRange?.endDate) {
      conditions.push(sql`${feedbackVotes.createdAt} <= ${new Date(dateRange.endDate)}`);
    }

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
        eq(feedbackVotes.organisationId, orgId),
        eq(feedbackVotes.vote, 'down'),
      ))
      .orderBy(desc(feedbackVotes.createdAt))
      .limit(10);

    return {
      up,
      down,
      total: up + down,
      recentNegative,
    };
  },
};
