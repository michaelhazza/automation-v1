import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import {
  permissionSets,
  permissionSetItems,
  orgUserRoles,
  permissions,
  users,
} from '../db/schema/index.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';

const router = Router();

// ─── Permissions catalogue (read-only) ───────────────────────────────────────

/**
 * GET /api/permissions
 * List all available atomic permission keys (for building permission sets).
 */
router.get(
  '/api/permissions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const rows = await db.select().from(permissions);
      res.json(rows);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Permission sets CRUD ─────────────────────────────────────────────────────

/**
 * GET /api/permission-sets
 * List org's permission sets (with their permission keys).
 */
router.get(
  '/api/permission-sets',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const sets = await db
        .select()
        .from(permissionSets)
        .where(and(eq(permissionSets.organisationId, organisationId), isNull(permissionSets.deletedAt)));

      if (sets.length === 0) {
        res.json([]);
        return;
      }

      const setIds = sets.map((s) => s.id);
      const items = await db
        .select()
        .from(permissionSetItems)
        .where(inArray(permissionSetItems.permissionSetId, setIds));

      const itemsBySet = new Map<string, string[]>();
      for (const item of items) {
        const existing = itemsBySet.get(item.permissionSetId) ?? [];
        existing.push(item.permissionKey);
        itemsBySet.set(item.permissionSetId, existing);
      }

      res.json(
        sets.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          isDefault: s.isDefault,
          permissionKeys: itemsBySet.get(s.id) ?? [],
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }))
      );
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/permission-sets
 * Create a new permission set with optional initial permission keys.
 * Body: { name, description?, permissionKeys?: string[] }
 */
router.post(
  '/api/permission-sets',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const { name, description, permissionKeys } = req.body as {
        name?: string;
        description?: string;
        permissionKeys?: string[];
      };

      if (!name) {
        res.status(400).json({ error: 'Validation failed', details: 'name is required' });
        return;
      }

      const [ps] = await db
        .insert(permissionSets)
        .values({
          organisationId,
          name,
          description: description ?? null,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (permissionKeys && permissionKeys.length > 0) {
        await db.insert(permissionSetItems).values(
          permissionKeys.map((key) => ({
            permissionSetId: ps.id,
            permissionKey: key,
            createdAt: new Date(),
          }))
        );
      }

      res.status(201).json({
        id: ps.id,
        name: ps.name,
        description: ps.description,
        isDefault: ps.isDefault,
        permissionKeys: permissionKeys ?? [],
        createdAt: ps.createdAt,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/permission-sets/:id
 * Get a single permission set with its keys.
 */
router.get(
  '/api/permission-sets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const [ps] = await db
        .select()
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, req.params.id),
            eq(permissionSets.organisationId, organisationId),
            isNull(permissionSets.deletedAt)
          )
        );

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found' });
        return;
      }

      const items = await db
        .select()
        .from(permissionSetItems)
        .where(eq(permissionSetItems.permissionSetId, ps.id));

      res.json({
        id: ps.id,
        name: ps.name,
        description: ps.description,
        isDefault: ps.isDefault,
        permissionKeys: items.map((i) => i.permissionKey),
        createdAt: ps.createdAt,
        updatedAt: ps.updatedAt,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/permission-sets/:id
 * Update a permission set's name or description.
 * Body: { name?, description? }
 */
router.patch(
  '/api/permission-sets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const [ps] = await db
        .select()
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, req.params.id),
            eq(permissionSets.organisationId, organisationId),
            isNull(permissionSets.deletedAt)
          )
        );

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found' });
        return;
      }

      const { name, description } = req.body as { name?: string; description?: string };
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;

      const [updated] = await db
        .update(permissionSets)
        .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
        .where(eq(permissionSets.id, ps.id))
        .returning();

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/permission-sets/:id
 * Soft-delete a permission set (only if not assigned to any user/subaccount role).
 */
router.delete(
  '/api/permission-sets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const [ps] = await db
        .select()
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, req.params.id),
            eq(permissionSets.organisationId, organisationId),
            isNull(permissionSets.deletedAt)
          )
        );

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found' });
        return;
      }

      // Block deletion if in use by org user roles
      const [inUse] = await db
        .select({ id: orgUserRoles.id })
        .from(orgUserRoles)
        .where(eq(orgUserRoles.permissionSetId, ps.id));

      if (inUse) {
        res.status(409).json({ error: 'Cannot delete a permission set that is assigned to one or more users' });
        return;
      }

      const now = new Date();
      await db.update(permissionSets).set({ deletedAt: now, updatedAt: now }).where(eq(permissionSets.id, ps.id));
      res.json({ message: 'Permission set deleted' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Permission set items ─────────────────────────────────────────────────────

/**
 * PUT /api/permission-sets/:id/items
 * Replace the full set of permission keys for a permission set.
 * Body: { permissionKeys: string[] }
 */
router.put(
  '/api/permission-sets/:id/items',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const [ps] = await db
        .select()
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, req.params.id),
            eq(permissionSets.organisationId, organisationId),
            isNull(permissionSets.deletedAt)
          )
        );

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found' });
        return;
      }

      const { permissionKeys } = req.body as { permissionKeys?: string[] };
      if (!Array.isArray(permissionKeys)) {
        res.status(400).json({ error: 'Validation failed', details: 'permissionKeys must be an array' });
        return;
      }

      // Replace all items atomically
      await db.delete(permissionSetItems).where(eq(permissionSetItems.permissionSetId, ps.id));

      if (permissionKeys.length > 0) {
        await db.insert(permissionSetItems).values(
          permissionKeys.map((key) => ({
            permissionSetId: ps.id,
            permissionKey: key,
            createdAt: new Date(),
          }))
        );
      }

      await db.update(permissionSets).set({ updatedAt: new Date() }).where(eq(permissionSets.id, ps.id));

      res.json({ id: ps.id, permissionKeys });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Org user roles (assign permission sets to org users) ─────────────────────

/**
 * GET /api/org/members
 * List all org users with their assigned permission sets.
 */
router.get(
  '/api/org/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.USERS_VIEW),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const rows = await db
        .select({
          roleId: orgUserRoles.id,
          userId: orgUserRoles.userId,
          permissionSetId: orgUserRoles.permissionSetId,
          assignedAt: orgUserRoles.createdAt,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
          permissionSetName: permissionSets.name,
        })
        .from(orgUserRoles)
        .innerJoin(users, eq(users.id, orgUserRoles.userId))
        .innerJoin(permissionSets, eq(permissionSets.id, orgUserRoles.permissionSetId))
        .where(eq(orgUserRoles.organisationId, organisationId));

      res.json(rows);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PUT /api/org/members/:userId/role
 * Assign or update a user's org-level permission set.
 * Body: { permissionSetId }
 */
router.put(
  '/api/org/members/:userId/role',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.USERS_EDIT),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const { permissionSetId } = req.body as { permissionSetId?: string };

      if (!permissionSetId) {
        res.status(400).json({ error: 'Validation failed', details: 'permissionSetId is required' });
        return;
      }

      // Verify user belongs to org
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, req.params.userId),
            eq(users.organisationId, organisationId),
            isNull(users.deletedAt)
          )
        );

      if (!user) {
        res.status(404).json({ error: 'User not found in this organisation' });
        return;
      }

      // Verify permission set belongs to org
      const [ps] = await db
        .select({ id: permissionSets.id })
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, permissionSetId),
            eq(permissionSets.organisationId, organisationId),
            isNull(permissionSets.deletedAt)
          )
        );

      if (!ps) {
        res.status(404).json({ error: 'Permission set not found in this organisation' });
        return;
      }

      // Upsert: update if exists, insert if not
      const [existing] = await db
        .select()
        .from(orgUserRoles)
        .where(
          and(
            eq(orgUserRoles.organisationId, organisationId),
            eq(orgUserRoles.userId, req.params.userId)
          )
        );

      if (existing) {
        const [updated] = await db
          .update(orgUserRoles)
          .set({ permissionSetId, updatedAt: new Date() })
          .where(eq(orgUserRoles.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db
          .insert(orgUserRoles)
          .values({
            organisationId,
            userId: req.params.userId,
            permissionSetId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        res.status(201).json(created);
      }
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/org/members/:userId/role
 * Remove a user's org-level role (revokes all org permissions).
 */
router.delete(
  '/api/org/members/:userId/role',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.USERS_EDIT),
  async (req, res) => {
    try {
      const organisationId = req.orgId!;
      const [existing] = await db
        .select()
        .from(orgUserRoles)
        .where(
          and(
            eq(orgUserRoles.organisationId, organisationId),
            eq(orgUserRoles.userId, req.params.userId)
          )
        );

      if (!existing) {
        res.status(404).json({ error: 'Role assignment not found' });
        return;
      }

      await db.delete(orgUserRoles).where(eq(orgUserRoles.id, existing.id));
      res.json({ message: 'Org role removed' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
