import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import {
  subaccounts,
  subaccountCategories,
  subaccountTaskLinks,
  subaccountUserAssignments,
  tasks,
  users,
  permissionSets,
} from '../db/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { boardService } from '../services/boardService.js';

const router = Router();

// ─── Helper: verify subaccount belongs to the request's org ──────────────────

async function resolveSubaccount(subaccountId: string, organisationId: string) {
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)));

  if (!sa) throw { statusCode: 404, message: 'Subaccount not found' };
  return sa;
}

// ─── Subaccounts CRUD ─────────────────────────────────────────────────────────

/**
 * GET /api/subaccounts
 * List all subaccounts in the user's org.
 */
router.get(
  '/api/subaccounts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const rows = await db
        .select()
        .from(subaccounts)
        .where(and(eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)))
        .orderBy(desc(subaccounts.createdAt));

      res.json(
        rows.map((sa) => ({
          id: sa.id,
          name: sa.name,
          slug: sa.slug,
          status: sa.status,
          settings: sa.settings,
          createdAt: sa.createdAt,
          updatedAt: sa.updatedAt,
        }))
      );
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts
 * Create a new subaccount.
 */
router.post(
  '/api/subaccounts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_CREATE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const { name, slug, status, settings } = req.body as {
        name?: string;
        slug?: string;
        status?: string;
        settings?: Record<string, unknown>;
      };

      if (!name) {
        res.status(400).json({ error: 'Validation failed', details: 'name is required' });
        return;
      }

      const derivedSlug = slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      const [sa] = await db
        .insert(subaccounts)
        .values({
          organisationId,
          name,
          slug: derivedSlug,
          status: (status as 'active' | 'suspended' | 'inactive') ?? 'active',
          settings: settings ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Auto-init board config from org config (if available)
      boardService.initSubaccountBoard(organisationId, sa.id).catch(() => {
        // Non-critical: if org has no board config, skip silently
      });

      res.status(201).json({
        id: sa.id,
        name: sa.name,
        slug: sa.slug,
        status: sa.status,
        settings: sa.settings,
        createdAt: sa.createdAt,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'A subaccount with this slug already exists in this organisation' });
        return;
      }
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/subaccounts/:subaccountId
 * Get a single subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
      res.json(sa);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId
 * Update a subaccount's name, slug, status or settings.
 */
router.patch(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { name, slug, status, settings } = req.body as {
        name?: string;
        slug?: string;
        status?: string;
        settings?: Record<string, unknown>;
      };

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) update.name = name;
      if (slug !== undefined) update.slug = slug;
      if (status !== undefined) update.status = status;
      if (settings !== undefined) update.settings = settings;

      const [updated] = await db
        .update(subaccounts)
        .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
        .where(eq(subaccounts.id, sa.id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'A subaccount with this slug already exists in this organisation' });
        return;
      }
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId
 * Soft-delete a subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_DELETE),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const now = new Date();
      await db.update(subaccounts).set({ deletedAt: now, updatedAt: now }).where(eq(subaccounts.id, sa.id));
      res.json({ message: 'Subaccount deleted' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Subaccount categories ────────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/categories
 * List portal categories for a subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/categories',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const rows = await db
        .select()
        .from(subaccountCategories)
        .where(and(eq(subaccountCategories.subaccountId, req.params.subaccountId), isNull(subaccountCategories.deletedAt)));

      res.json(rows);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/categories
 * Create a portal category.
 */
router.post(
  '/api/subaccounts/:subaccountId/categories',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { name, description, colour } = req.body as { name?: string; description?: string; colour?: string };

      if (!name) {
        res.status(400).json({ error: 'Validation failed', details: 'name is required' });
        return;
      }

      const [cat] = await db
        .insert(subaccountCategories)
        .values({
          subaccountId: req.params.subaccountId,
          name,
          description: description ?? null,
          colour: colour ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json(cat);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/categories/:categoryId
 * Update a portal category.
 */
router.patch(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { name, description, colour } = req.body as { name?: string; description?: string; colour?: string };

      const [cat] = await db
        .select()
        .from(subaccountCategories)
        .where(
          and(
            eq(subaccountCategories.id, req.params.categoryId),
            eq(subaccountCategories.subaccountId, req.params.subaccountId),
            isNull(subaccountCategories.deletedAt)
          )
        );

      if (!cat) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;
      if (colour !== undefined) update.colour = colour;

      const [updated] = await db
        .update(subaccountCategories)
        .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
        .where(eq(subaccountCategories.id, cat.id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/categories/:categoryId
 * Soft-delete a portal category.
 */
router.delete(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const [cat] = await db
        .select()
        .from(subaccountCategories)
        .where(
          and(
            eq(subaccountCategories.id, req.params.categoryId),
            eq(subaccountCategories.subaccountId, req.params.subaccountId),
            isNull(subaccountCategories.deletedAt)
          )
        );

      if (!cat) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }

      const now = new Date();
      await db
        .update(subaccountCategories)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(subaccountCategories.id, cat.id));

      res.json({ message: 'Category deleted' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Subaccount task links ────────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/tasks
 * List all tasks visible to this subaccount:
 *   - Org tasks linked via subaccount_task_links
 *   - Subaccount-native tasks (tasks.subaccount_id = subaccountId)
 */
router.get(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);

      // Linked org tasks
      const links = await db
        .select({
          linkId: subaccountTaskLinks.id,
          taskId: subaccountTaskLinks.taskId,
          subaccountCategoryId: subaccountTaskLinks.subaccountCategoryId,
          isActive: subaccountTaskLinks.isActive,
          linkCreatedAt: subaccountTaskLinks.createdAt,
          taskName: tasks.name,
          taskStatus: tasks.status,
          taskDescription: tasks.description,
          taskWebhookPath: tasks.webhookPath,
        })
        .from(subaccountTaskLinks)
        .innerJoin(tasks, eq(tasks.id, subaccountTaskLinks.taskId))
        .where(eq(subaccountTaskLinks.subaccountId, req.params.subaccountId));

      // Subaccount-native tasks
      const nativeTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.subaccountId, req.params.subaccountId),
            isNull(tasks.deletedAt)
          )
        );

      res.json({
        linkedTasks: links,
        nativeTasks,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/tasks
 * Link an org-level task to this subaccount.
 * Body: { taskId, subaccountCategoryId? }
 */
router.post(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { taskId, subaccountCategoryId } = req.body as { taskId?: string; subaccountCategoryId?: string };

      if (!taskId) {
        res.status(400).json({ error: 'Validation failed', details: 'taskId is required' });
        return;
      }

      // Verify task belongs to this org
      const [task] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, req.orgId!), isNull(tasks.deletedAt)));

      if (!task) {
        res.status(404).json({ error: 'Task not found or not accessible' });
        return;
      }

      // Only org-level tasks (no subaccount_id) can be linked
      if (task.subaccountId !== null) {
        res.status(400).json({ error: 'Subaccount-native tasks cannot be linked; they already belong to a subaccount' });
        return;
      }

      const [link] = await db
        .insert(subaccountTaskLinks)
        .values({
          subaccountId: req.params.subaccountId,
          taskId,
          subaccountCategoryId: subaccountCategoryId ?? null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json(link);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'This task is already linked to the subaccount' });
        return;
      }
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/tasks/:linkId
 * Update a task link (toggle isActive, change category).
 */
router.patch(
  '/api/subaccounts/:subaccountId/tasks/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { isActive, subaccountCategoryId } = req.body as { isActive?: boolean; subaccountCategoryId?: string | null };

      const [link] = await db
        .select()
        .from(subaccountTaskLinks)
        .where(
          and(
            eq(subaccountTaskLinks.id, req.params.linkId),
            eq(subaccountTaskLinks.subaccountId, req.params.subaccountId)
          )
        );

      if (!link) {
        res.status(404).json({ error: 'Task link not found' });
        return;
      }

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (isActive !== undefined) update.isActive = isActive;
      if (subaccountCategoryId !== undefined) update.subaccountCategoryId = subaccountCategoryId;

      const [updated] = await db
        .update(subaccountTaskLinks)
        .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
        .where(eq(subaccountTaskLinks.id, link.id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/tasks/:linkId
 * Remove a task link from this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/tasks/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const [link] = await db
        .select()
        .from(subaccountTaskLinks)
        .where(
          and(
            eq(subaccountTaskLinks.id, req.params.linkId),
            eq(subaccountTaskLinks.subaccountId, req.params.subaccountId)
          )
        );

      if (!link) {
        res.status(404).json({ error: 'Task link not found' });
        return;
      }

      await db.delete(subaccountTaskLinks).where(eq(subaccountTaskLinks.id, link.id));
      res.json({ message: 'Task link removed' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Subaccount members ───────────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/members
 * List users assigned to this subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const rows = await db
        .select({
          assignmentId: subaccountUserAssignments.id,
          userId: subaccountUserAssignments.userId,
          permissionSetId: subaccountUserAssignments.permissionSetId,
          assignedAt: subaccountUserAssignments.createdAt,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
          permissionSetName: permissionSets.name,
        })
        .from(subaccountUserAssignments)
        .innerJoin(users, eq(users.id, subaccountUserAssignments.userId))
        .innerJoin(permissionSets, eq(permissionSets.id, subaccountUserAssignments.permissionSetId))
        .where(eq(subaccountUserAssignments.subaccountId, req.params.subaccountId));

      res.json(rows);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/members
 * Assign a user to this subaccount with a permission set.
 * Body: { userId, permissionSetId }
 */
router.post(
  '/api/subaccounts/:subaccountId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { userId, permissionSetId } = req.body as { userId?: string; permissionSetId?: string };

      if (!userId || !permissionSetId) {
        res.status(400).json({ error: 'Validation failed', details: 'userId and permissionSetId are required' });
        return;
      }

      // Verify user belongs to same org
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organisationId, sa.organisationId), isNull(users.deletedAt)));

      if (!user) {
        res.status(404).json({ error: 'User not found in this organisation' });
        return;
      }

      // Verify permission set belongs to same org
      const [ps] = await db
        .select({ id: permissionSets.id })
        .from(permissionSets)
        .where(and(eq(permissionSets.id, permissionSetId), eq(permissionSets.organisationId, sa.organisationId), isNull(permissionSets.deletedAt)));

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found in this organisation' });
        return;
      }

      const [assignment] = await db
        .insert(subaccountUserAssignments)
        .values({
          subaccountId: req.params.subaccountId,
          userId,
          permissionSetId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json(assignment);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'User is already assigned to this subaccount' });
        return;
      }
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/members/:userId
 * Update a member's permission set.
 * Body: { permissionSetId }
 */
router.patch(
  '/api/subaccounts/:subaccountId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { permissionSetId } = req.body as { permissionSetId?: string };

      if (!permissionSetId) {
        res.status(400).json({ error: 'Validation failed', details: 'permissionSetId is required' });
        return;
      }

      const [assignment] = await db
        .select()
        .from(subaccountUserAssignments)
        .where(
          and(
            eq(subaccountUserAssignments.subaccountId, req.params.subaccountId),
            eq(subaccountUserAssignments.userId, req.params.userId)
          )
        );

      if (!assignment) {
        res.status(404).json({ error: 'Member assignment not found' });
        return;
      }

      // Verify the new permission set belongs to the same org
      const [ps] = await db
        .select({ id: permissionSets.id })
        .from(permissionSets)
        .where(and(eq(permissionSets.id, permissionSetId), eq(permissionSets.organisationId, sa.organisationId), isNull(permissionSets.deletedAt)));

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found in this organisation' });
        return;
      }

      const [updated] = await db
        .update(subaccountUserAssignments)
        .set({ permissionSetId, updatedAt: new Date() })
        .where(eq(subaccountUserAssignments.id, assignment.id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/members/:userId
 * Remove a user's access to this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const [assignment] = await db
        .select()
        .from(subaccountUserAssignments)
        .where(
          and(
            eq(subaccountUserAssignments.subaccountId, req.params.subaccountId),
            eq(subaccountUserAssignments.userId, req.params.userId)
          )
        );

      if (!assignment) {
        res.status(404).json({ error: 'Member assignment not found' });
        return;
      }

      await db.delete(subaccountUserAssignments).where(eq(subaccountUserAssignments.id, assignment.id));
      res.json({ message: 'Member removed from subaccount' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
