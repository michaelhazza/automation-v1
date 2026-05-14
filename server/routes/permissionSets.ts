import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { permissionSetService } from '../services/permissionSetService.js';

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
  asyncHandler(async (_req, res) => {
    const rows = await permissionSetService.listPermissionsCatalogue();
    res.json(rows);
  })
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
  asyncHandler(async (req, res) => {
    const sets = await permissionSetService.listForOrg(req.orgId!);
    res.json(sets);
  })
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
  asyncHandler(async (req, res) => {
    // guard-ignore-next-line: input-validation reason="manual validation enforced: name required check, permissionKeys Array.isArray guard"
    const { name, description, permissionKeys } = req.body as {
      name?: string;
      description?: string;
      permissionKeys?: string[];
    };

    if (!name) {
      res.status(400).json({ error: 'Validation failed', details: 'name is required' });
      return;
    }

    const result = await permissionSetService.create(
      req.orgId!,
      { name, description, permissionKeys },
      req.user?.id ?? null,
    );
    res.status(201).json(result);
  })
);

/**
 * GET /api/permission-sets/:id
 * Get a single permission set with its keys.
 */
router.get(
  '/api/permission-sets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  asyncHandler(async (req, res) => {
    const ps = await permissionSetService.getById(req.orgId!, req.params.id);
    if (!ps) {
      res.status(404).json({ error: 'Permission set not found' });
      return;
    }
    res.json(ps);
  })
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
  asyncHandler(async (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    const updated = await permissionSetService.update(
      req.orgId!,
      req.params.id,
      { name, description },
      req.user?.id ?? null,
    );
    if (!updated) {
      res.status(404).json({ error: 'Permission set not found' });
      return;
    }
    res.json(updated);
  })
);

/**
 * DELETE /api/permission-sets/:id
 * Soft-delete a permission set (only if not assigned to any user/subaccount role).
 */
router.delete(
  '/api/permission-sets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.PERMISSION_SETS_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await permissionSetService.delete(
      req.orgId!,
      req.params.id,
      req.user?.id ?? null,
    );
    if (!result.found) {
      res.status(404).json({ error: 'Permission set not found' });
      return;
    }
    if (result.inUse) {
      res.status(409).json({ error: 'Cannot delete a permission set that is assigned to one or more users' });
      return;
    }
    res.json({ message: 'Permission set deleted' });
  })
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
  asyncHandler(async (req, res) => {
    const { permissionKeys } = req.body as { permissionKeys?: string[] };
    if (!Array.isArray(permissionKeys)) {
      res.status(400).json({ error: 'Validation failed', details: 'permissionKeys must be an array' });
      return;
    }

    const result = await permissionSetService.replaceItems(req.orgId!, req.params.id, permissionKeys);
    if (!result) {
      res.status(404).json({ error: 'Permission set not found' });
      return;
    }
    res.json(result);
  })
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
  asyncHandler(async (req, res) => {
    const rows = await permissionSetService.listOrgMembers(req.orgId!);
    res.json(rows);
  })
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
  asyncHandler(async (req, res) => {
    const { permissionSetId } = req.body as { permissionSetId?: string };

    if (!permissionSetId) {
      res.status(400).json({ error: 'Validation failed', details: 'permissionSetId is required' });
      return;
    }

    const result = await permissionSetService.assignOrgRole(req.orgId!, req.params.userId, permissionSetId);

    if (result.status === 'user_not_found') {
      res.status(404).json({ error: 'User not found in this organisation' });
      return;
    }
    if (result.status === 'permission_set_not_found') {
      res.status(404).json({ error: 'Permission set not found in this organisation' });
      return;
    }

    if (result.status === 'created') {
      res.status(201).json(result.row);
    } else {
      res.json(result.row);
    }
  })
);

/**
 * DELETE /api/org/members/:userId/role
 * Remove a user's org-level role (revokes all org permissions).
 */
router.delete(
  '/api/org/members/:userId/role',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.USERS_EDIT),
  asyncHandler(async (req, res) => {
    const removed = await permissionSetService.removeOrgRole(req.orgId!, req.params.userId);
    if (!removed) {
      res.status(404).json({ error: 'Role assignment not found' });
      return;
    }
    res.json({ message: 'Org role removed' });
  })
);

// ─── Current user permissions (for client-side nav filtering) ────────────────

/**
 * GET /api/my-permissions
 * Returns the current user's org-level permission keys.
 * system_admin gets a special '__system_admin__' marker.
 */
router.get(
  '/api/my-permissions',
  authenticate,
  asyncHandler(async (req, res) => {
    // guard-ignore-next-line: no-direct-role-checks reason="conditional response shaping, not access control — returns synthetic permission tokens based on role"
    if (req.user!.role === 'system_admin') {
      res.json({ permissions: ['__system_admin__'] });
      return;
    }

    const organisationId = req.orgId ?? req.user!.organisationId;
    if (!organisationId) {
      res.json({ permissions: [] });
      return;
    }

    // org_admin gets full org-level access — same as system_admin but scoped to their org
    // guard-ignore-next-line: no-direct-role-checks reason="conditional response shaping, not access control — returns synthetic permission tokens based on role"
    if (req.user!.role === 'org_admin') {
      res.json({ permissions: ['__org_admin__'] });
      return;
    }

    const keys = await permissionSetService.getMyOrgPermissions(organisationId, req.user!.id);
    res.json({ permissions: keys });
  })
);

/**
 * GET /api/subaccounts/:subaccountId/my-permissions
 * Returns the current user's effective permission keys for a specific subaccount.
 * Combines subaccount-level assignments. system_admin gets '__system_admin__'.
 */
router.get(
  '/api/subaccounts/:subaccountId/my-permissions',
  authenticate,
  asyncHandler(async (req, res) => {
    // guard-ignore-next-line: no-direct-role-checks reason="conditional response shaping, not access control — returns synthetic permission tokens based on role"
    if (req.user!.role === 'system_admin') {
      res.json({ permissions: ['__system_admin__'] });
      return;
    }

    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const keys = await permissionSetService.getMySubaccountPermissions(subaccount.id, req.user!.id);
    res.json({ permissions: keys });
  })
);

export default router;
