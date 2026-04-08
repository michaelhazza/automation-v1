import { eq, and, isNull, desc, count, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { goals, tasks, projects } from '../db/schema/index.js';

export const goalService = {
  async listGoals(organisationId: string, subaccountId: string) {
    return db
      .select()
      .from(goals)
      .where(and(
        eq(goals.organisationId, organisationId),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ))
      .orderBy(goals.position, desc(goals.createdAt));
  },

  async createGoal(
    organisationId: string,
    subaccountId: string,
    data: {
      title: string;
      description?: string;
      parentGoalId?: string;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string;
      targetDate?: string;
      position?: number;
    },
    userId?: string,
  ) {
    if (!data.title?.trim()) throw { statusCode: 400, message: 'title is required' };

    // Validate parentGoalId belongs to same subaccount
    if (data.parentGoalId) {
      const [parent] = await db
        .select()
        .from(goals)
        .where(and(
          eq(goals.id, data.parentGoalId),
          eq(goals.organisationId, organisationId),
          eq(goals.subaccountId, subaccountId),
          isNull(goals.deletedAt),
        ));

      if (!parent) throw { statusCode: 400, message: 'parentGoalId not found in this subaccount' };
    }

    const [goal] = await db.insert(goals).values({
      organisationId,
      subaccountId,
      parentGoalId: data.parentGoalId || null,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      status: data.status || 'active',
      level: data.level || 'objective',
      ownerAgentId: data.ownerAgentId || null,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      position: data.position ?? 0,
      createdBy: userId ?? null,
    }).returning();

    return goal;
  },

  async getGoal(organisationId: string, subaccountId: string, goalId: string) {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, organisationId),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!goal) throw { statusCode: 404, message: 'Goal not found' };

    // Count children
    const [childrenResult] = await db
      .select({ count: count() })
      .from(goals)
      .where(and(
        eq(goals.parentGoalId, goalId),
        eq(goals.organisationId, organisationId),
        isNull(goals.deletedAt),
      ));

    // Count linked tasks
    const [tasksResult] = await db
      .select({ count: count() })
      .from(tasks)
      .where(and(
        eq(tasks.goalId, goalId),
        eq(tasks.organisationId, organisationId),
        isNull(tasks.deletedAt),
      ));

    // Count linked projects
    const [projectsResult] = await db
      .select({ count: count() })
      .from(projects)
      .where(and(
        eq(projects.goalId, goalId),
        eq(projects.organisationId, organisationId),
        isNull(projects.deletedAt),
      ));

    return {
      ...goal,
      childrenCount: Number(childrenResult?.count ?? 0),
      linkedTasksCount: Number(tasksResult?.count ?? 0),
      linkedProjectsCount: Number(projectsResult?.count ?? 0),
    };
  },

  async updateGoal(
    organisationId: string,
    subaccountId: string,
    goalId: string,
    data: {
      title?: string;
      description?: string;
      parentGoalId?: string | null;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string | null;
      targetDate?: string | null;
      position?: number;
    },
  ) {
    const [existing] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, organisationId),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!existing) throw { statusCode: 404, message: 'Goal not found' };

    // Validate parentGoalId if being changed
    if (data.parentGoalId !== undefined && data.parentGoalId !== null) {
      if (data.parentGoalId === goalId) {
        throw { statusCode: 400, message: 'A goal cannot be its own parent' };
      }

      const [parent] = await db
        .select()
        .from(goals)
        .where(and(
          eq(goals.id, data.parentGoalId),
          eq(goals.organisationId, organisationId),
          eq(goals.subaccountId, subaccountId),
          isNull(goals.deletedAt),
        ));

      if (!parent) throw { statusCode: 400, message: 'parentGoalId not found in this subaccount' };

      // Circular reference check: walk ancestry of proposed parent (max 10 levels)
      let currentId: string | null = data.parentGoalId;
      for (let depth = 0; depth < 10 && currentId; depth++) {
        const [ancestor] = await db
          .select({ parentGoalId: goals.parentGoalId })
          .from(goals)
          .where(and(
            eq(goals.id, currentId),
            eq(goals.organisationId, organisationId),
            isNull(goals.deletedAt),
          ));

        if (!ancestor) break;
        if (ancestor.parentGoalId === goalId) {
          throw { statusCode: 400, message: 'Circular reference detected: this goal is an ancestor of the proposed parent' };
        }
        currentId = ancestor.parentGoalId;
      }
    }

    const updates: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
    if (data.title !== undefined) updates.title = data.title.trim();
    if (data.description !== undefined) updates.description = data.description?.trim() || null;
    if (data.parentGoalId !== undefined) updates.parentGoalId = data.parentGoalId || null;
    if (data.status !== undefined) updates.status = data.status;
    if (data.level !== undefined) updates.level = data.level;
    if (data.ownerAgentId !== undefined) updates.ownerAgentId = data.ownerAgentId || null;
    if (data.targetDate !== undefined) updates.targetDate = data.targetDate ? new Date(data.targetDate) : null;
    if (data.position !== undefined) updates.position = data.position;

    const [updated] = await db
      .update(goals)
      .set(updates)
      .where(eq(goals.id, goalId))
      .returning();

    return updated;
  },

  async deleteGoal(organisationId: string, subaccountId: string, goalId: string) {
    const [existing] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, organisationId),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!existing) throw { statusCode: 404, message: 'Goal not found' };

    const now = new Date();

    await db.transaction(async (tx) => {
      // Recursive CTE to find all descendant goal IDs (org-scoped)
      const descendants = await tx.execute(sql`
        WITH RECURSIVE goal_tree AS (
          SELECT id FROM goals
          WHERE id = ${goalId} AND organisation_id = ${organisationId} AND deleted_at IS NULL
          UNION ALL
          SELECT g.id FROM goals g
          INNER JOIN goal_tree gt ON g.parent_goal_id = gt.id
          WHERE g.organisation_id = ${organisationId} AND g.deleted_at IS NULL
        )
        SELECT id FROM goal_tree
      `);

      const ids = (descendants as unknown as Array<{ id: string }>).map((r) => r.id);

      if (ids.length > 0) {
        await tx.execute(sql`
          UPDATE goals SET deleted_at = ${now}, updated_at = ${now}
          WHERE id = ANY(${ids})
        `);
      }
    });
  },

  async getGoalAncestry(organisationId: string, subaccountId: string, goalId: string) {
    // Verify goal exists and belongs to this subaccount
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, organisationId),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!goal) throw { statusCode: 404, message: 'Goal not found' };

    // Recursive CTE to walk up the ancestry chain (org-scoped)
    const result = await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_goal_id, title, description, status, level, position, 0 AS depth
        FROM goals
        WHERE id = ${goalId} AND organisation_id = ${organisationId} AND deleted_at IS NULL
        UNION ALL
        SELECT g.id, g.parent_goal_id, g.title, g.description, g.status, g.level, g.position, a.depth + 1
        FROM goals g
        INNER JOIN ancestry a ON g.id = a.parent_goal_id
        WHERE g.organisation_id = ${organisationId} AND g.deleted_at IS NULL AND a.depth < 10
      )
      SELECT * FROM ancestry ORDER BY depth DESC
    `);

    // Map snake_case columns from raw SQL to camelCase for API consistency
    return (result as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
      parentGoalId: row.parent_goal_id,
      title: row.title,
      description: row.description,
      status: row.status,
      level: row.level,
      position: row.position,
      depth: row.depth,
    }));
  },
};
