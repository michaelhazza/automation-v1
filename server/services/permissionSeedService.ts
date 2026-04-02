import { db } from '../db';
import { permissions, permissionSets, permissionSetItems, orgUserRoles, users } from '../db/schema';
import { eq, and, isNull, isNotNull, ne } from 'drizzle-orm';
import { ALL_PERMISSIONS, DEFAULT_PERMISSION_SET_TEMPLATES } from '../lib/permissions';

/**
 * Idempotently seed the permissions table with all known atomic permission keys.
 * Safe to run multiple times — existing rows are left unchanged.
 */
export async function seedPermissions(): Promise<void> {
  for (const perm of ALL_PERMISSIONS) {
    const existing = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, perm.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(permissions).values(perm);
    }
  }
}

/**
 * Seed default permission sets for a given organisation.
 * Creates the six default templates (Org Admin, Org Manager, Org Viewer,
 * Subaccount Admin, Subaccount Manager, Subaccount User) if they don't exist.
 *
 * Returns the created/existing permission sets mapped by name.
 */
export async function seedDefaultPermissionSetsForOrg(
  organisationId: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const template of DEFAULT_PERMISSION_SET_TEMPLATES) {
    // Check if this default set already exists for the org
    const existing = await db
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.organisationId, organisationId),
          eq(permissionSets.name, template.name),
          isNull(permissionSets.deletedAt)
        )
      )
      .limit(1);

    let setId: string;

    if (existing.length > 0) {
      setId = existing[0].id;
    } else {
      const [created] = await db
        .insert(permissionSets)
        .values({
          organisationId,
          name: template.name,
          description: template.description,
          isDefault: false,
        })
        .returning({ id: permissionSets.id });

      setId = created.id;

      // Insert permission items
      for (const key of template.permissionKeys) {
        await db.insert(permissionSetItems).values({
          permissionSetId: setId,
          permissionKey: key,
        });
      }
    }

    result[template.name] = setId;
  }

  return result;
}

// Maps users.role values to the corresponding default permission set name.
// 'user' and 'client_user' are intentionally absent — they have no org-level
// assignment and access the system only through subaccount_user_assignments.
const ROLE_TO_PERMISSION_SET_NAME: Readonly<Record<string, string>> = {
  org_admin: 'Org Admin',
  manager: 'Org Manager',
};

/**
 * Ensures the default permission sets exist for the org, then upserts an
 * org_user_roles entry for the given user based on their role string.
 *
 * Roles that don't map to an org-level permission set ('user', 'client_user')
 * are silently skipped — the caller is responsible for deleting any stale entry
 * when downgrading a user to one of those roles.
 */
export async function assignOrgUserRole(
  organisationId: string,
  userId: string,
  role: string
): Promise<void> {
  const permSetName = ROLE_TO_PERMISSION_SET_NAME[role];
  if (!permSetName) return;

  const permSetsByName = await seedDefaultPermissionSetsForOrg(organisationId);
  const permissionSetId = permSetsByName[permSetName];
  if (!permissionSetId) return;

  await db
    .insert(orgUserRoles)
    .values({ organisationId, userId, permissionSetId })
    .onConflictDoUpdate({
      target: [orgUserRoles.organisationId, orgUserRoles.userId],
      set: { permissionSetId, updatedAt: new Date() },
    });
}

/**
 * One-time startup backfill. Finds all non-system-admin users who have a role
 * stored in users.role but no org_user_roles entry, and creates the missing
 * entries using the default permission set templates.
 *
 * Safe to run on every boot — only touches rows that are missing entries.
 */
export async function backfillOrgUserRoles(): Promise<void> {
  const rows = await db
    .select({ id: users.id, organisationId: users.organisationId, role: users.role })
    .from(users)
    .leftJoin(
      orgUserRoles,
      and(eq(orgUserRoles.userId, users.id), eq(orgUserRoles.organisationId, users.organisationId))
    )
    .where(
      and(
        isNull(users.deletedAt),
        isNotNull(users.role),
        ne(users.role, 'system_admin' as 'system_admin'),
        isNull(orgUserRoles.id)
      )
    );

  if (rows.length === 0) {
    console.log('[BACKFILL] org_user_roles: nothing to backfill');
    return;
  }

  console.log(`[BACKFILL] org_user_roles: backfilling ${rows.length} user(s)`);

  // Group by org so we only call seedDefaultPermissionSetsForOrg once per org
  const byOrg = new Map<string, Array<{ id: string; role: string }>>();
  for (const row of rows) {
    if (!row.role) continue;
    const list = byOrg.get(row.organisationId) ?? [];
    list.push({ id: row.id, role: row.role as string });
    byOrg.set(row.organisationId, list);
  }

  for (const [orgId, orgUsers] of byOrg) {
    const permSetsByName = await seedDefaultPermissionSetsForOrg(orgId);
    for (const u of orgUsers) {
      const permSetName = ROLE_TO_PERMISSION_SET_NAME[u.role];
      if (!permSetName) continue;
      const permissionSetId = permSetsByName[permSetName];
      if (!permissionSetId) continue;
      await db
        .insert(orgUserRoles)
        .values({ organisationId: orgId, userId: u.id, permissionSetId })
        .onConflictDoNothing();
    }
  }

  console.log('[BACKFILL] org_user_roles: complete');
}
