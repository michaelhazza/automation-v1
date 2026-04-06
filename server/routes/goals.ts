import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { goals, tasks, projects } from '../db/schema/index.js';
import { eq, and, isNull, desc, count, sql } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/goals
 * List all goals for a subaccount (flat list — client builds tree).
 */
router.get(
  '/api/subaccounts/:subaccountId/goals',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const rows = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.organisationId, req.orgId!),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ))
      .orderBy(goals.position, desc(goals.createdAt));

    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/goals
 * Create a goal.
 */
router.post(
  '/api/subaccounts/:subaccountId/goals',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { title, description, parentGoalId, status, level, ownerAgentId, targetDate, position } = req.body as {
      title?: string;
      description?: string;
      parentGoalId?: string;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string;
      targetDate?: string;
      position?: number;
    };

    if (!title?.trim()) throw { statusCode: 400, message: 'title is required' };

    // Validate parentGoalId belongs to same subaccount and check for cycles
    if (parentGoalId) {
      const [parent] = await db
        .select()
        .from(goals)
        .where(and(
          eq(goals.id, parentGoalId),
          eq(goals.organisationId, req.orgId!),
          eq(goals.subaccountId, subaccountId),
          isNull(goals.deletedAt),
        ));

      if (!parent) throw { statusCode: 400, message: 'parentGoalId not found in this subaccount' };
    }

    const [goal] = await db.insert(goals).values({
      organisationId: req.orgId!,
      subaccountId,
      parentGoalId: parentGoalId || null,
      title: title.trim(),
      description: description?.trim() || null,
      status: status || 'active',
      level: level || 'objective',
      ownerAgentId: ownerAgentId || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      position: position ?? 0,
      createdBy: req.user?.id ?? null,
    }).returning();

    res.status(201).json(goal);
  })
);

/**
 * GET /api/subaccounts/:subaccountId/goals/:goalId
 * Get a single goal with children count, linked tasks count, linked projects count.
 */
router.get(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [goal] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, req.orgId!),
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
        eq(goals.organisationId, req.orgId!),
        isNull(goals.deletedAt),
      ));

    // Count linked tasks
    const [tasksResult] = await db
      .select({ count: count() })
      .from(tasks)
      .where(and(
        eq(tasks.goalId, goalId),
        eq(tasks.organisationId, req.orgId!),
        isNull(tasks.deletedAt),
      ));

    // Count linked projects
    const [projectsResult] = await db
      .select({ count: count() })
      .from(projects)
      .where(and(
        eq(projects.goalId, goalId),
        eq(projects.organisationId, req.orgId!),
        isNull(projects.deletedAt),
      ));

    res.json({
      ...goal,
      childrenCount: Number(childrenResult?.count ?? 0),
      linkedTasksCount: Number(tasksResult?.count ?? 0),
      linkedProjectsCount: Number(projectsResult?.count ?? 0),
    });
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/goals/:goalId
 * Update a goal.
 */
router.patch(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [existing] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, req.orgId!),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!existing) throw { statusCode: 404, message: 'Goal not found' };

    const { title, description, parentGoalId, status, level, ownerAgentId, targetDate, position } = req.body as {
      title?: string;
      description?: string;
      parentGoalId?: string | null;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string | null;
      targetDate?: string | null;
      position?: number;
    };

    // Validate parentGoalId if being changed
    if (parentGoalId !== undefined && parentGoalId !== null) {
      // Cannot set self as parent
      if (parentGoalId === goalId) {
        throw { statusCode: 400, message: 'A goal cannot be its own parent' };
      }

      // Validate parent exists in same subaccount
      const [parent] = await db
        .select()
        .from(goals)
        .where(and(
          eq(goals.id, parentGoalId),
          eq(goals.organisationId, req.orgId!),
          eq(goals.subaccountId, subaccountId),
          isNull(goals.deletedAt),
        ));

      if (!parent) throw { statusCode: 400, message: 'parentGoalId not found in this subaccount' };

      // Circular reference check: walk ancestry of proposed parent (max 10 levels)
      let currentId: string | null = parentGoalId;
      for (let depth = 0; depth < 10 && currentId; depth++) {
        const [ancestor] = await db
          .select({ parentGoalId: goals.parentGoalId })
          .from(goals)
          .where(and(eq(goals.id, currentId), isNull(goals.deletedAt)));

        if (!ancestor) break;
        if (ancestor.parentGoalId === goalId) {
          throw { statusCode: 400, message: 'Circular reference detected: this goal is an ancestor of the proposed parent' };
        }
        currentId = ancestor.parentGoalId;
      }
    }

    const updates: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (parentGoalId !== undefined) updates.parentGoalId = parentGoalId || null;
    if (status !== undefined) updates.status = status;
    if (level !== undefined) updates.level = level;
    if (ownerAgentId !== undefined) updates.ownerAgentId = ownerAgentId || null;
    if (targetDate !== undefined) updates.targetDate = targetDate ? new Date(targetDate) : null;
    if (position !== undefined) updates.position = position;

    const [updated] = await db
      .update(goals)
      .set(updates)
      .where(eq(goals.id, goalId))
      .returning();

    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/goals/:goalId
 * Soft-delete a goal and cascade to children (in transaction).
 */
router.delete(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [existing] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, req.orgId!),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!existing) throw { statusCode: 404, message: 'Goal not found' };

    const now = new Date();

    await db.transaction(async (tx) => {
      // Recursive CTE to find all descendant goal IDs
      const descendants = await tx.execute(sql`
        WITH RECURSIVE goal_tree AS (
          SELECT id FROM goals WHERE id = ${goalId} AND deleted_at IS NULL
          UNION ALL
          SELECT g.id FROM goals g
          INNER JOIN goal_tree gt ON g.parent_goal_id = gt.id
          WHERE g.deleted_at IS NULL
        )
        SELECT id FROM goal_tree
      `);

      const ids = (descendants.rows as Array<{ id: string }>).map((r) => r.id);

      if (ids.length > 0) {
        await tx.execute(sql`
          UPDATE goals SET deleted_at = ${now}, updated_at = ${now}
          WHERE id = ANY(${ids})
        `);
      }
    });

    res.json({ success: true });
  })
);

/**
 * GET /api/subaccounts/:subaccountId/goals/:goalId/ancestry
 * Return full ancestor chain from this goal up to root (for agent context injection).
 */
router.get(
  '/api/subaccounts/:subaccountId/goals/:goalId/ancestry',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    // Verify goal exists and belongs to this subaccount
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(
        eq(goals.id, goalId),
        eq(goals.organisationId, req.orgId!),
        eq(goals.subaccountId, subaccountId),
        isNull(goals.deletedAt),
      ));

    if (!goal) throw { statusCode: 404, message: 'Goal not found' };

    // Recursive CTE to walk up the ancestry chain
    const result = await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_goal_id, title, description, status, level, position, 0 AS depth
        FROM goals
        WHERE id = ${goalId} AND deleted_at IS NULL
        UNION ALL
        SELECT g.id, g.parent_goal_id, g.title, g.description, g.status, g.level, g.position, a.depth + 1
        FROM goals g
        INNER JOIN ancestry a ON g.id = a.parent_goal_id
        WHERE g.deleted_at IS NULL AND a.depth < 10
      )
      SELECT * FROM ancestry ORDER BY depth DESC
    `);

    res.json(result.rows);
  })
);

export default router;
