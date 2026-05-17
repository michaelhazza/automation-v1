import { eq, and, isNull, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  permissionSets,
  permissionSetItems,
  orgUserRoles,
  permissions,
  users,
  subaccountUserAssignments,
} from '../db/schema/index.js';
import type { Permission } from '../db/schema/permissions.js';
import type { PermissionSet } from '../db/schema/permissionSets.js';
import type { OrgUserRole } from '../db/schema/orgUserRoles.js';
import { configHistoryService } from './configHistoryService.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PermissionSetWithKeys {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  permissionKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePermissionSetInput {
  name: string;
  description?: string;
  permissionKeys?: string[];
}

export interface UpdatePermissionSetInput {
  name?: string;
  description?: string;
}

export interface OrgMemberRow {
  roleId: string;
  userId: string;
  permissionSetId: string;
  assignedAt: Date;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string | null;
  permissionSetName: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const permissionSetService = {
  /**
   * List all available atomic permission keys (global catalogue, no org scope).
   */
  async listPermissionsCatalogue(): Promise<Permission[]> {
    return getOrgScopedDb('permissionSetService.listPermissionsCatalogue').select().from(permissions);
  },

  /**
   * List all active permission sets for an org, including their permission keys.
   */
  async listForOrg(orgId: string): Promise<PermissionSetWithKeys[]> {
    const listScopedDb = getOrgScopedDb('permissionSetService.listForOrg');
    const sets = await listScopedDb
      .select()
      .from(permissionSets)
      .where(and(eq(permissionSets.organisationId, orgId), isNull(permissionSets.deletedAt)));

    if (sets.length === 0) return [];

    const setIds = sets.map((s) => s.id);
    const items = await listScopedDb
      .select()
      .from(permissionSetItems)
      .where(inArray(permissionSetItems.permissionSetId, setIds));

    const itemsBySet = new Map<string, string[]>();
    for (const item of items) {
      const existing = itemsBySet.get(item.permissionSetId) ?? [];
      existing.push(item.permissionKey);
      itemsBySet.set(item.permissionSetId, existing);
    }

    return sets.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      isDefault: s.isDefault,
      permissionKeys: itemsBySet.get(s.id) ?? [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  },

  /**
   * Get a single permission set with its keys. Returns null if not found.
   */
  async getById(orgId: string, id: string): Promise<PermissionSetWithKeys | null> {
    const getByIdScopedDb = getOrgScopedDb('permissionSetService.getById');
    const [ps] = await getByIdScopedDb
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.id, id),
          eq(permissionSets.organisationId, orgId),
          isNull(permissionSets.deletedAt)
        )
      );

    if (!ps) return null;

    const items = await getByIdScopedDb
      .select()
      .from(permissionSetItems)
      .where(eq(permissionSetItems.permissionSetId, ps.id));

    return {
      id: ps.id,
      name: ps.name,
      description: ps.description,
      isDefault: ps.isDefault,
      permissionKeys: items.map((i) => i.permissionKey),
      createdAt: ps.createdAt,
      updatedAt: ps.updatedAt,
    };
  },

  /**
   * Create a new permission set with optional initial permission keys.
   * Records config history after insert.
   */
  async create(
    orgId: string,
    data: CreatePermissionSetInput,
    actorId: string | null,
  ): Promise<{ id: string; name: string; description: string | null; isDefault: boolean; permissionKeys: string[]; createdAt: Date }> {
    const createScopedDb = getOrgScopedDb('permissionSetService.create');
    const [ps] = await createScopedDb
      .insert(permissionSets)
      .values({
        organisationId: orgId,
        name: data.name,
        description: data.description ?? null,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const permissionKeys = data.permissionKeys ?? [];

    if (permissionKeys.length > 0) {
      await createScopedDb.insert(permissionSetItems).values(
        permissionKeys.map((key) => ({
          permissionSetId: ps.id,
          permissionKey: key,
          createdAt: new Date(),
        }))
      );
    }

    await configHistoryService.recordHistory({
      entityType: 'permission_set',
      entityId: ps.id,
      organisationId: orgId,
      snapshot: { ...ps, permissionKeys } as unknown as Record<string, unknown>,
      changedBy: actorId,
      changeSource: 'ui',
    });

    return {
      id: ps.id,
      name: ps.name,
      description: ps.description,
      isDefault: ps.isDefault,
      permissionKeys,
      createdAt: ps.createdAt,
    };
  },

  /**
   * Update a permission set's name or description.
   * Records pre-mutation config history snapshot before applying the update.
   * Returns null if not found.
   */
  async update(
    orgId: string,
    id: string,
    data: UpdatePermissionSetInput,
    actorId: string | null,
  ): Promise<PermissionSet | null> {
    const updateScopedDb = getOrgScopedDb('permissionSetService.update');
    const [ps] = await updateScopedDb
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.id, id),
          eq(permissionSets.organisationId, orgId),
          isNull(permissionSets.deletedAt)
        )
      );

    if (!ps) return null;

    await configHistoryService.recordHistory({
      entityType: 'permission_set',
      entityId: ps.id,
      organisationId: orgId,
      snapshot: ps as unknown as Record<string, unknown>,
      changedBy: actorId,
      changeSource: 'ui',
    });

    const updateValues: Partial<typeof permissionSets.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) updateValues.name = data.name;
    if (data.description !== undefined) updateValues.description = data.description;

    const [updated] = await updateScopedDb
      .update(permissionSets)
      .set(updateValues)
      .where(and(eq(permissionSets.id, ps.id), eq(permissionSets.organisationId, orgId)))
      .returning();

    return updated;
  },

  /**
   * Soft-delete a permission set. Returns false if not found, throws 409-style
   * error string if in use by org user roles.
   */
  async delete(
    orgId: string,
    id: string,
    actorId: string | null,
  ): Promise<{ found: false } | { found: true; inUse: true } | { found: true; inUse: false }> {
    const deleteScopedDb = getOrgScopedDb('permissionSetService.delete');
    const [ps] = await deleteScopedDb
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.id, id),
          eq(permissionSets.organisationId, orgId),
          isNull(permissionSets.deletedAt)
        )
      );

    if (!ps) return { found: false };

    const [inUse] = await deleteScopedDb
      .select({ id: orgUserRoles.id })
      .from(orgUserRoles)
      .where(eq(orgUserRoles.permissionSetId, ps.id));

    if (inUse) return { found: true, inUse: true };

    await configHistoryService.recordHistory({
      entityType: 'permission_set',
      entityId: ps.id,
      organisationId: orgId,
      snapshot: ps as unknown as Record<string, unknown>,
      changedBy: actorId,
      changeSource: 'ui',
      changeSummary: 'Entity soft-deleted',
    });

    const now = new Date();
    await deleteScopedDb
      .update(permissionSets)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(permissionSets.id, ps.id), eq(permissionSets.organisationId, orgId)));

    return { found: true, inUse: false };
  },

  /**
   * Replace the full set of permission keys for a permission set atomically.
   * Returns null if not found.
   */
  async replaceItems(
    orgId: string,
    id: string,
    permissionKeys: string[],
  ): Promise<{ id: string; permissionKeys: string[] } | null> {
    const replaceItemsScopedDb = getOrgScopedDb('permissionSetService.replaceItems');
    const [ps] = await replaceItemsScopedDb
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.id, id),
          eq(permissionSets.organisationId, orgId),
          isNull(permissionSets.deletedAt)
        )
      );

    if (!ps) return null;

    await replaceItemsScopedDb.delete(permissionSetItems).where(eq(permissionSetItems.permissionSetId, ps.id));

    if (permissionKeys.length > 0) {
      await replaceItemsScopedDb.insert(permissionSetItems).values(
        permissionKeys.map((key) => ({
          permissionSetId: ps.id,
          permissionKey: key,
          createdAt: new Date(),
        }))
      );
    }

    await replaceItemsScopedDb.update(permissionSets).set({ updatedAt: new Date() }).where(and(eq(permissionSets.id, ps.id), eq(permissionSets.organisationId, orgId)));

    return { id: ps.id, permissionKeys };
  },

  /**
   * List all org users with their assigned permission sets.
   */
  async listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
    return getOrgScopedDb('permissionSetService.listOrgMembers')
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
      .where(eq(orgUserRoles.organisationId, orgId));
  },

  /**
   * Assign or update a user's org-level permission set (upsert).
   * Returns null if user or permission set not found in org.
   */
  async assignOrgRole(
    orgId: string,
    userId: string,
    permissionSetId: string,
  ): Promise<{ status: 'updated' | 'created'; row: OrgUserRole } | { status: 'user_not_found' } | { status: 'permission_set_not_found' }> {
    const assignScopedDb = getOrgScopedDb('permissionSetService.assignOrgRole');
    const [user] = await assignScopedDb
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organisationId, orgId),
          isNull(users.deletedAt)
        )
      );

    if (!user) return { status: 'user_not_found' };

    const [ps] = await assignScopedDb
      .select({ id: permissionSets.id })
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.id, permissionSetId),
          eq(permissionSets.organisationId, orgId),
          isNull(permissionSets.deletedAt)
        )
      );

    if (!ps) return { status: 'permission_set_not_found' };

    const [existing] = await assignScopedDb
      .select()
      .from(orgUserRoles)
      .where(
        and(
          eq(orgUserRoles.organisationId, orgId),
          eq(orgUserRoles.userId, userId)
        )
      );

    if (existing) {
      const [updated] = await assignScopedDb
        .update(orgUserRoles)
        .set({ permissionSetId, updatedAt: new Date() })
        .where(eq(orgUserRoles.id, existing.id))
        .returning();
      return { status: 'updated', row: updated };
    }

    const [created] = await assignScopedDb
      .insert(orgUserRoles)
      .values({
        organisationId: orgId,
        userId,
        permissionSetId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return { status: 'created', row: created };
  },

  /**
   * Remove a user's org-level role. Returns false if role not found.
   */
  async removeOrgRole(orgId: string, userId: string): Promise<boolean> {
    const removeRoleScopedDb = getOrgScopedDb('permissionSetService.removeOrgRole');
    const [existing] = await removeRoleScopedDb
      .select()
      .from(orgUserRoles)
      .where(
        and(
          eq(orgUserRoles.organisationId, orgId),
          eq(orgUserRoles.userId, userId)
        )
      );

    if (!existing) return false;

    await removeRoleScopedDb.delete(orgUserRoles).where(eq(orgUserRoles.id, existing.id));
    return true;
  },

  /**
   * Get org-level permission keys for a user.
   * Caller is responsible for handling system_admin / org_admin special cases.
   */
  async getMyOrgPermissions(orgId: string, userId: string): Promise<string[]> {
    const rows = await getOrgScopedDb('permissionSetService.getMyOrgPermissions')
      .select({ permissionKey: permissionSetItems.permissionKey })
      .from(orgUserRoles)
      .innerJoin(permissionSetItems, eq(permissionSetItems.permissionSetId, orgUserRoles.permissionSetId))
      .where(and(eq(orgUserRoles.userId, userId), eq(orgUserRoles.organisationId, orgId)));

    return rows.map((r) => r.permissionKey);
  },

  /**
   * Get subaccount-level permission keys for a user.
   */
  async getMySubaccountPermissions(subaccountId: string, userId: string): Promise<string[]> {
    const rows = await getOrgScopedDb('permissionSetService.getMySubaccountPermissions')
      .select({ permissionKey: permissionSetItems.permissionKey })
      .from(subaccountUserAssignments)
      .innerJoin(permissionSetItems, eq(permissionSetItems.permissionSetId, subaccountUserAssignments.permissionSetId))
      .where(
        and(
          eq(subaccountUserAssignments.userId, userId),
          eq(subaccountUserAssignments.subaccountId, subaccountId)
        )
      );

    return rows.map((r) => r.permissionKey);
  },

  /**
   * Check whether a user has a specific subaccount permission key.
   */
  async hasSubaccountPermission(userId: string, subaccountId: string, key: string): Promise<boolean> {
    const keys = await this.getMySubaccountPermissions(subaccountId, userId);
    return keys.includes(key);
  },
};
