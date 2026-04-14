import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import {
  subaccounts,
  subaccountCategories,
  subaccountProcessLinks,
  subaccountUserAssignments,
  processes,
  users,
  permissionSets,
} from '../db/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { configHistoryService } from '../services/configHistoryService.js';
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
  asyncHandler(async (req, res) => {
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
        includeInOrgInbox: sa.includeInOrgInbox,
        isOrgSubaccount: sa.isOrgSubaccount,
        createdAt: sa.createdAt,
        updatedAt: sa.updatedAt,
      }))
    );
  })
);

/**
 * POST /api/subaccounts
 * Create a new subaccount.
 */
router.post(
  '/api/subaccounts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_CREATE),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    // guard-ignore-next-line: input-validation reason="manual field validation enforced: name required check, status type guard, includeInOrgInbox boolean guard"
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

    await configHistoryService.recordHistory({
      entityType: 'subaccount', entityId: sa.id, organisationId,
      snapshot: sa as unknown as Record<string, unknown>,
      changedBy: req.user?.id ?? null, changeSource: 'ui',
    });

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
  })
);

/**
 * GET /api/subaccounts/:subaccountId
 * Get a single subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    res.json(sa);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId
 * Update a subaccount's name, slug, status or settings.
 */
router.patch(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, slug, status, settings, includeInOrgInbox } = req.body as {
      name?: string;
      slug?: string;
      status?: string;
      settings?: Record<string, unknown>;
      includeInOrgInbox?: boolean;
    };

    // Guard: org subaccount cannot have its status changed
    if (sa.isOrgSubaccount && status !== undefined && status !== 'active') {
      res.status(403).json({ error: 'Cannot change the status of the organisation workspace' });
      return;
    }

    await configHistoryService.recordHistory({
      entityType: 'subaccount', entityId: sa.id, organisationId: req.orgId!,
      snapshot: sa as unknown as Record<string, unknown>,
      changedBy: req.user?.id ?? null, changeSource: 'ui',
    });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (status !== undefined) update.status = status;
    if (settings !== undefined) update.settings = settings;
    if (includeInOrgInbox !== undefined) {
      if (typeof includeInOrgInbox !== 'boolean') throw { statusCode: 400, message: 'includeInOrgInbox must be a boolean' };
      update.includeInOrgInbox = includeInOrgInbox;
    }

    const [updated] = await db
      .update(subaccounts)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(subaccounts.id, sa.id))
      .returning();

    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId
 * Soft-delete a subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_DELETE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    if (sa.isOrgSubaccount) {
      res.status(403).json({ error: 'Cannot delete the organisation workspace' });
      return;
    }

    const now = new Date();
    await db.update(subaccounts).set({ deletedAt: now, updatedAt: now }).where(eq(subaccounts.id, sa.id));
    res.json({ message: 'Subaccount deleted' });
  })
);

// ─── Dev Execution Context (DEC) ──────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/dev-context
 * Return the Dev Execution Context configuration for this subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/dev-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const settings = (sa.settings ?? {}) as Record<string, unknown>;
    res.json({ devContext: settings.devContext ?? null });
  })
);

/**
 * PUT /api/subaccounts/:subaccountId/dev-context
 * Save the Dev Execution Context configuration.
 */
router.put(
  '/api/subaccounts/:subaccountId/dev-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { devContext } = req.body as { devContext: Record<string, unknown> };
    const currentSettings = (sa.settings ?? {}) as Record<string, unknown>;
    const newSettings = { ...currentSettings, devContext };

    await db.update(subaccounts).set({
      settings: newSettings,
      updatedAt: new Date(),
    }).where(eq(subaccounts.id, sa.id));

    res.json({ devContext });
  })
);

// ─── Claude Code availability ─────────────────────────────────────────────────

import { claudeCodeRunner } from '../services/claudeCodeRunner.js';

/**
 * GET /api/subaccounts/:subaccountId/claude-code-status
 * Check if Claude Code CLI is available on this machine.
 */
router.get(
  '/api/subaccounts/:subaccountId/claude-code-status',
  authenticate,
  asyncHandler(async (_req, res) => {
    const status = await claudeCodeRunner.isAvailable();
    res.json(status);
  })
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
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await db
      .select()
      .from(subaccountCategories)
      .where(and(eq(subaccountCategories.subaccountId, req.params.subaccountId), isNull(subaccountCategories.deletedAt)));

    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/categories
 * Create a portal category.
 */
router.post(
  '/api/subaccounts/:subaccountId/categories',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/categories/:categoryId
 * Update a portal category.
 */
router.patch(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/categories/:categoryId
 * Soft-delete a portal category.
 */
router.delete(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
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
  })
);

// ─── Subaccount process links ─────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/processes
 * List all processes visible to this subaccount:
 *   - Org processes linked via subaccount_process_links
 *   - Subaccount-native processes (processes.subaccount_id = subaccountId)
 */
router.get(
  '/api/subaccounts/:subaccountId/processes',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    // Linked org processes
    const links = await db
      .select({
        linkId: subaccountProcessLinks.id,
        processId: subaccountProcessLinks.processId,
        subaccountCategoryId: subaccountProcessLinks.subaccountCategoryId,
        isActive: subaccountProcessLinks.isActive,
        linkCreatedAt: subaccountProcessLinks.createdAt,
        processName: processes.name,
        processStatus: processes.status,
        processDescription: processes.description,
        processWebhookPath: processes.webhookPath,
      })
      .from(subaccountProcessLinks)
      .innerJoin(processes, eq(processes.id, subaccountProcessLinks.processId))
      .where(eq(subaccountProcessLinks.subaccountId, req.params.subaccountId));

    // Subaccount-native processes
    const nativeProcesses = await db
      .select()
      .from(processes)
      .where(
        and(
          eq(processes.subaccountId, req.params.subaccountId),
          isNull(processes.deletedAt)
        )
      );

    res.json({
      linkedProcesses: links,
      nativeProcesses,
    });
  })
);

/**
 * POST /api/subaccounts/:subaccountId/processes
 * Link an org-level process to this subaccount.
 * Body: { processId, subaccountCategoryId? }
 */
router.post(
  '/api/subaccounts/:subaccountId/processes',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { processId, subaccountCategoryId } = req.body as { processId?: string; subaccountCategoryId?: string };

    if (!processId) {
      res.status(400).json({ error: 'Validation failed', details: 'processId is required' });
      return;
    }

    // Verify process belongs to this org
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, processId), eq(processes.organisationId, req.orgId!), isNull(processes.deletedAt)));

    if (!process) {
      res.status(404).json({ error: 'Process not found or not accessible' });
      return;
    }

    // Only org-level processes (no subaccount_id) can be linked
    if (process.subaccountId !== null) {
      res.status(400).json({ error: 'Subaccount-native processes cannot be linked; they already belong to a subaccount' });
      return;
    }

    const [link] = await db
      .insert(subaccountProcessLinks)
      .values({
        subaccountId: req.params.subaccountId,
        processId,
        subaccountCategoryId: subaccountCategoryId ?? null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    res.status(201).json(link);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/processes/:linkId
 * Update a process link (toggle isActive, change category).
 */
router.patch(
  '/api/subaccounts/:subaccountId/processes/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { isActive, subaccountCategoryId } = req.body as { isActive?: boolean; subaccountCategoryId?: string | null };

    const [link] = await db
      .select()
      .from(subaccountProcessLinks)
      .where(
        and(
          eq(subaccountProcessLinks.id, req.params.linkId),
          eq(subaccountProcessLinks.subaccountId, req.params.subaccountId)
        )
      );

    if (!link) {
      res.status(404).json({ error: 'Process link not found' });
      return;
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (isActive !== undefined) update.isActive = isActive;
    if (subaccountCategoryId !== undefined) update.subaccountCategoryId = subaccountCategoryId;

    const [updated] = await db
      .update(subaccountProcessLinks)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(subaccountProcessLinks.id, link.id))
      .returning();

    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/processes/:linkId
 * Remove a process link from this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/processes/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [link] = await db
      .select()
      .from(subaccountProcessLinks)
      .where(
        and(
          eq(subaccountProcessLinks.id, req.params.linkId),
          eq(subaccountProcessLinks.subaccountId, req.params.subaccountId)
        )
      );

    if (!link) {
      res.status(404).json({ error: 'Process link not found' });
      return;
    }

    await db.delete(subaccountProcessLinks).where(eq(subaccountProcessLinks.id, link.id));
    res.json({ message: 'Process link removed' });
  })
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
  asyncHandler(async (req, res) => {
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
  })
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
  asyncHandler(async (req, res) => {
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
  })
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
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/members/:userId
 * Remove a user's access to this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
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
  })
);

export default router;
